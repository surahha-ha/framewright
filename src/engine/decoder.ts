// framewright — WebCodecs video decode service.
// Two paths:
//   - decodeAtSec(): frame-accurate SCRUB (seek to keyframe, decode forward).
//   - createPlaybackSession(): streaming forward decode for smooth PLAYBACK.
// Optimization seam: a warm decoder + proxy media + frame cache come next.

import type { DemuxResult, DemuxSample } from './demux';
import { PlaybackSession } from './playbackSession';

export class VideoDecodeService {
  private config: VideoDecoderConfig;
  private samples: DemuxSample[];
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

  createPlaybackSession(onError: (e: DOMException) => void): PlaybackSession {
    return new PlaybackSession(this.samples, this.config, onError);
  }

  private tsUs(s: DemuxSample): number {
    return Math.round((s.cts * 1e6) / s.timescale);
  }

  /**
   * Decode the frame covering targetSec (scrub). Returns a VideoFrame the caller
   * MUST close() after drawing. Cold path — fine for scrubbing single frames.
   */
  async decodeAtSec(targetSec: number): Promise<VideoFrame | null> {
    if (this.samples.length === 0) return null;
    const targetUs = targetSec * 1e6;
    let targetIdx = 0;
    for (let i = 0; i < this.samples.length; i++) {
      if (this.tsUs(this.samples[i]) <= targetUs) targetIdx = i;
      else break;
    }

    const targetTs = this.tsUs(this.samples[targetIdx]);
    let kf = targetIdx;
    while (kf > 0 && !this.samples[kf].is_sync) kf--;
    const endIdx = Math.min(targetIdx + 8, this.samples.length - 1);

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
