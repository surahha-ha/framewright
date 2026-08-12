// framewright — WebCodecs video decode service.
// Two paths:
//   - decodeAtSec(): frame-accurate SCRUB (seek to keyframe, decode forward).
//   - createPlaybackSession(): streaming forward decode for smooth PLAYBACK.
// Optimization seam: a warm decoder + proxy media + frame cache come next.

import type { DemuxResult, DemuxSample } from './demux';
import { PlaybackSession } from './playbackSession';
import { secToUs, timescaleToUs } from './time';

export class VideoDecodeService {
  private config: VideoDecoderConfig;
  private samples: DemuxSample[];
  /** sample indices sorted by presentation time (cts) — B-frames make decode
   *  order != presentation order, so seeking must use this, not the raw array. */
  private byCts: number[];

  constructor(demux: DemuxResult) {
    this.samples = demux.samples;
    this.config = {
      codec: demux.track.codec,
      codedWidth: demux.track.width,
      codedHeight: demux.track.height,
      ...(demux.description ? { description: demux.description } : {}),
    };
    this.byCts = this.samples
      .map((_, i) => i)
      .sort((a, b) => this.tsUs(this.samples[a]) - this.tsUs(this.samples[b]));
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
    return timescaleToUs(s.cts, s.timescale);
  }

  /** Decode-order index of the last frame presented at or before targetUs. */
  private indexForUs(targetUs: number): number {
    let lo = 0;
    let hi = this.byCts.length - 1;
    let best = this.byCts[0] ?? 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const idx = this.byCts[mid];
      if (this.tsUs(this.samples[idx]) <= targetUs) {
        best = idx;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  /**
   * Decode the frame covering targetSec (scrub). Returns a VideoFrame the caller
   * MUST close() after drawing. Cold path — fine for scrubbing single frames.
   */
  async decodeAtSec(targetSec: number): Promise<VideoFrame | null> {
    if (this.samples.length === 0) return null;
    const targetIdx = this.indexForUs(secToUs(targetSec));
    const targetTs = this.tsUs(this.samples[targetIdx]);

    let kf = targetIdx;
    while (kf > 0 && !this.samples[kf].is_sync) kf--;
    const endIdx = Math.min(targetIdx + 8, this.samples.length - 1);

    let matched: VideoFrame | null = null;
    let fail: ((e: unknown) => void) | null = null;

    // The decoder is created OUTSIDE the promise so the cleanup path below is
    // guaranteed to see it — a decoder leaked per failed scrub kills the tab.
    const decoder = new VideoDecoder({
      output: (frame) => {
        if (matched === null && Math.abs(frame.timestamp - targetTs) <= 1) {
          matched = frame; // handed to the caller
        } else {
          frame.close();
        }
      },
      error: (e) => fail?.(e),
    });

    try {
      decoder.configure(this.config);
      await new Promise<void>((resolve, reject) => {
        fail = reject;
        for (let i = kf; i <= endIdx; i++) {
          const s = this.samples[i];
          decoder.decode(
            new EncodedVideoChunk({
              type: s.is_sync ? 'key' : 'delta',
              timestamp: this.tsUs(s),
              duration: timescaleToUs(s.duration, s.timescale),
              data: s.data,
            }),
          );
        }
        decoder.flush().then(() => resolve(), reject);
      });
      const out = matched as VideoFrame | null;
      matched = null; // ownership transfers to the caller
      return out;
    } finally {
      // Every path — success, error, abort — releases the frame and the decoder.
      (matched as VideoFrame | null)?.close();
      matched = null;
      try {
        decoder.close();
      } catch {
        /* already closed */
      }
    }
  }
}
