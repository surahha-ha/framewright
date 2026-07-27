// framewright — streaming playback decoder.
// Unlike scrub (which re-seeks per frame), playback decodes FORWARD once through
// the samples, buffering a few frames ahead. Each source frame is decoded exactly
// once -> smooth playback. The render loop pulls the frame matching the clock.

import type { DemuxSample } from './demux';

export class PlaybackSession {
  private decoder: VideoDecoder;
  private queue: VideoFrame[] = [];
  private feedIdx = 0;
  private stopped = false;

  constructor(
    private samples: DemuxSample[],
    config: VideoDecoderConfig,
    onError: (e: DOMException) => void,
  ) {
    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.queue.push(frame);
        this.pump();
      },
      error: onError,
    });
    this.decoder.configure(config);
  }

  private tsUs(s: DemuxSample): number {
    return Math.round((s.cts * 1e6) / s.timescale);
  }

  /** Begin decoding from the keyframe at or before fromSec. */
  start(fromSec: number): void {
    const target = fromSec * 1e6;
    let kf = 0;
    for (let i = 0; i < this.samples.length; i++) {
      const ts = this.tsUs(this.samples[i]);
      if (this.samples[i].is_sync && ts <= target) kf = i;
      if (ts > target) break;
    }
    this.feedIdx = kf;
    this.pump();
  }

  private pump(): void {
    while (
      !this.stopped &&
      this.feedIdx < this.samples.length &&
      this.decoder.decodeQueueSize < 4 &&
      this.queue.length < 8
    ) {
      const s = this.samples[this.feedIdx++];
      this.decoder.decode(
        new EncodedVideoChunk({
          type: s.is_sync ? 'key' : 'delta',
          timestamp: this.tsUs(s),
          duration: Math.round(((s.duration || 0) * 1e6) / s.timescale),
          data: s.data,
        }),
      );
    }
  }

  /**
   * Newest buffered frame whose timestamp <= sec. Older frames are dropped/closed.
   * The CALLER owns the returned frame and must close() it after drawing.
   * Returns null if nothing is ready yet (keep showing the last drawn frame).
   */
  frameFor(sec: number): VideoFrame | null {
    const ts = sec * 1e6;
    let chosen: VideoFrame | null = null;
    while (this.queue.length && this.queue[0].timestamp <= ts + 1) {
      if (chosen) chosen.close();
      chosen = this.queue.shift() ?? null;
    }
    this.pump();
    return chosen;
  }

  get finished(): boolean {
    return this.feedIdx >= this.samples.length && this.queue.length === 0;
  }

  stop(): void {
    this.stopped = true;
    try {
      this.decoder.close();
    } catch {
      /* ignore */
    }
    for (const f of this.queue) f.close();
    this.queue = [];
  }
}
