// framewright — streaming forward decoder.
// Unlike scrub (which re-seeks per frame), this decodes FORWARD once through the
// samples, buffering a few frames ahead, so each source frame is decoded exactly
// once. Playback pulls with `frameFor` (drops late frames); export pulls with
// `awaitFrameFor` (must never skip a frame).

import type { DemuxSample } from './demux';
import { secToUs, timescaleToUs } from './time';

/** The requested time comes from the timeline (frames -> sec) while frame
 *  timestamps come from the container timescale; they can differ by a unit. */
const ROUNDING_TOLERANCE_US = 1;

/** Returned when the source has no NEW frame for this time — the caller should
 *  keep showing the previous one (source slower than the timeline, or VFR). */
export const HOLD = 'hold' as const;

/**
 * How many buffered frames can be consumed for `ts`, and whether that answer is
 * final. It is only final once we have SEEN a frame later than `ts` (or the
 * stream ended) — otherwise a later, closer frame may still be decoded.
 *
 * Getting this wrong is what made a clip that starts mid-source play fast:
 * returning the newest *currently buffered* frame handed back frame 7 when
 * frame 40 was asked for, then frame 15, and so on.
 */
export function drainPlan(
  queueTimestamps: number[],
  ts: number,
  streamEnded: boolean,
): { consume: number; resolved: boolean } {
  let consume = 0;
  while (consume < queueTimestamps.length && queueTimestamps[consume] <= ts) {
    consume++;
  }
  return { consume, resolved: consume < queueTimestamps.length || streamEnded };
}

export class PlaybackSession {
  private decoder: VideoDecoder;
  private queue: VideoFrame[] = [];
  private feedIdx = 0;
  private stopped = false;
  private flushing = false;
  private flushed = false;
  private waiters: (() => void)[] = [];
  /** Best candidate so far for the time being asked about. Held ACROSS calls:
   *  we must keep consuming (so the decoder can refill and advance) even while
   *  the answer is not yet certain — otherwise the queue jams and playback
   *  freezes. */
  private pending: VideoFrame | null = null;

  // NOTE: plain fields, not constructor parameter properties — the engine must
  // stay loadable by Node's type-stripping runner (see docs/TESTING.md).
  private samples: DemuxSample[];
  private onDecodeError: (e: DOMException) => void;

  constructor(
    samples: DemuxSample[],
    config: VideoDecoderConfig,
    onDecodeError: (e: DOMException) => void,
  ) {
    this.samples = samples;
    this.onDecodeError = onDecodeError;
    this.decoder = new VideoDecoder({
      output: (frame) => {
        if (this.stopped) {
          frame.close();
          return;
        }
        this.queue.push(frame);
        this.wake();
        this.pump();
      },
      error: (e) => {
        this.wake(); // never leave an awaiter hanging on a dead decoder
        this.onDecodeError(e);
      },
    });
    this.decoder.configure(config);
  }

  private wake(): void {
    const waiting = this.waiters;
    this.waiters = [];
    for (const w of waiting) w();
  }

  private tsUs(s: DemuxSample): number {
    return timescaleToUs(s.cts, s.timescale);
  }

  /** Begin decoding from the keyframe at or before fromSec. */
  start(fromSec: number): void {
    const target = secToUs(fromSec);
    let kf = 0;
    for (let i = 0; i < this.samples.length; i++) {
      if (this.samples[i].is_sync && this.tsUs(this.samples[i]) <= target)
        kf = i;
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
          duration: timescaleToUs(s.duration || 0, s.timescale),
          data: s.data,
        }),
      );
    }
    // Decoders hold several frames internally and only guarantee emission on
    // flush(). Without this, the tail of every clip is silently lost.
    if (
      !this.stopped &&
      !this.flushing &&
      this.feedIdx >= this.samples.length
    ) {
      this.flushing = true;
      this.decoder
        .flush()
        .then(() => {
          this.flushed = true;
          this.wake();
        })
        .catch(() => {
          this.flushed = true;
          this.wake();
        });
    }
  }

  /**
   * Newest buffered frame at or before `sec`; older ones are dropped and closed.
   * The CALLER owns the returned frame and must close() it.
   */
  /**
   * Consume every buffered frame at or before `ts` into `pending`, then keep the
   * decoder fed. Returns whether the answer is final — i.e. we have SEEN a frame
   * later than `ts`, or the stream has ended.
   */
  private drain(ts: number): boolean {
    const { consume, resolved } = drainPlan(
      this.queue.map((f) => f.timestamp),
      ts,
      this.flushed, // all samples decoded -> nothing closer can still arrive
    );
    for (let i = 0; i < consume; i++) {
      this.pending?.close();
      this.pending = this.queue.shift() ?? null;
    }
    this.pump();
    return resolved;
  }

  private takePending(): VideoFrame | null {
    const out = this.pending;
    this.pending = null;
    return out;
  }

  /**
   * Newest frame at or before `sec`, or null while the decoder is still catching
   * up (the caller should keep showing the previous picture). The CALLER owns the
   * returned frame and must close() it.
   */
  frameFor(sec: number): VideoFrame | null {
    const ts = secToUs(sec) + ROUNDING_TOLERANCE_US;
    if (!this.drain(ts)) return null; // not certain yet — keep the candidate
    return this.takePending();
  }

  /** True once every sample has been decoded and the buffer is drained. */
  get finished(): boolean {
    return this.flushed && this.queue.length === 0;
  }

  private waitForOutput(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const i = this.waiters.indexOf(finish);
        if (i >= 0) this.waiters.splice(i, 1);
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, 50);
      this.waiters.push(finish);
      signal?.addEventListener('abort', finish, { once: true });
    });
  }

  /**
   * Like frameFor, but WAITS for the decoder instead of dropping the frame.
   * Returns HOLD when the source simply has no new frame for this time (a
   * repeated frame — mixed frame rates or VFR); returns null at end of stream.
   */
  async awaitFrameFor(
    sec: number,
    signal?: AbortSignal,
  ): Promise<VideoFrame | typeof HOLD | null> {
    const ts = secToUs(sec) + ROUNDING_TOLERANCE_US;
    for (;;) {
      if (this.stopped || signal?.aborted) return null;
      if (this.drain(ts)) {
        const out = this.takePending();
        if (out) return out;
        // No frame at or before ts: either the source repeats the previous
        // picture (HOLD), or the stream is simply over.
        return this.finished ? null : HOLD;
      }
      await this.waitForOutput(signal);
    }
  }

  stop(): void {
    this.stopped = true;
    try {
      this.decoder.close();
    } catch {
      /* already closed */
    }
    for (const f of this.queue) f.close();
    this.queue = [];
    this.pending?.close();
    this.pending = null;
    this.wake();
  }
}
