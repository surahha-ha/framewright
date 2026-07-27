// framewright — WebCodecs video decode service.
// Frame-accurate seek: find the nearest keyframe <= target, decode forward to
// the requested frame. Encapsulated so we can later add a WARM DECODER
// (reuse one VideoDecoder via reset() instead of recreating per seek) and a
// frame cache without touching callers.

import type { DemuxResult, DemuxSample } from './demux';

export class VideoDecodeService {
  private config: VideoDecoderConfig;
  private samples: DemuxSample[];
  // instrumentation (helps verify the "close every frame" discipline)
  allocated = 0;
  closed = 0;

  constructor(private demux: DemuxResult) {
    this.samples = demux.samples;
    this.config = {
      codec: demux.track.codec,
      codedWidth: demux.track.width,
      codedHeight: demux.track.height,
      ...(demux.description ? { description: demux.description } : {}),
    };
  }

  async isSupported(): Promise<boolean> {
    try {
      const res = await VideoDecoder.isConfigSupported(this.config);
      return !!res.supported;
    } catch {
      return false;
    }
  }

  private tsUs(s: DemuxSample): number {
    return Math.round((s.cts * 1e6) / s.timescale);
  }

  /**
   * Decode the frame covering targetSec. Returns a VideoFrame the caller MUST
   * close() after drawing. Returns null if nothing matched.
   *
   * NOTE: This is the seam for optimization. Today it spins up a decoder per
   * call (cold path — see the verification harness for why that is slow at
   * full res). Next: reuse a warm decoder + proxy media + frame cache.
   */
  async decodeAtSec(targetSec: number): Promise<VideoFrame | null> {
    const targetUs = targetSec * 1e6;
    let targetIdx = 0;
    for (let i = 0; i < this.samples.length; i++) {
      if (this.tsUs(this.samples[i]) <= targetUs) targetIdx = i;
      else break;
    }
    if (this.samples.length === 0) return null;

    const targetTs = this.tsUs(this.samples[targetIdx]);
    let kf = targetIdx;
    while (kf > 0 && !this.samples[kf].is_sync) kf--;
    const endIdx = Math.min(targetIdx + 8, this.samples.length - 1); // reorder margin

    return await new Promise<VideoFrame | null>((resolve, reject) => {
      let matched: VideoFrame | null = null;
      const dec = new VideoDecoder({
        output: (frame) => {
          this.allocated++;
          if (matched === null && Math.abs(frame.timestamp - targetTs) <= 1) {
            matched = frame;
          } else {
            frame.close();
            this.closed++;
          }
        },
        error: (e) => reject(e),
      });
      dec.configure(this.config);
      for (let i = kf; i <= endIdx; i++) {
        const s = this.samples[i];
        dec.decode(
          new EncodedVideoChunk({
            type: s.is_sync ? 'key' : 'delta',
            timestamp: this.tsUs(s),
            duration: Math.round((s.duration * 1e6) / s.timescale),
            data: s.data,
          }),
        );
      }
      dec
        .flush()
        .then(() => {
          try {
            dec.close();
          } catch {
            /* ignore */
          }
          resolve(matched);
        })
        .catch(reject);
    });
  }
}
