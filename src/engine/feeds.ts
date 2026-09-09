// framewright — the decoders behind a frame (ADR-0012).
//
// Playback and export both used to keep ONE streaming decoder and the same
// eight lines to decide whether it could carry on or had to be re-cued
// (`isContinuous`). A dissolve needs two pictures per frame, from two
// sources, and after the cut the source that was primary becomes the one
// underneath — the same forward run, not a restart. That is the third
// consumer of the rule, so the rule lives here once.
//
// Per frame: `begin()`, ask for each picture with `feed()`, pull it, then
// `end()` stops whatever was not asked for. A feed keeps its newest picture
// (`current`) until the next one arrives or the feed stops, so a held frame —
// a source slower than the timeline, or a decoder still catching up — is drawn
// from here rather than remembered by a canvas. Every frame is closed here too.
//
// Node-testable: the session is a shape, and the frames are only ever closed.

import type { Rational } from './types';
import { frameToSec } from './time';
import { isContinuous } from './exportPlan';
import { HOLD } from './playbackSession';

/** The part of `PlaybackSession` a feed uses. */
export interface FeedSession {
  start(fromSec: number): void;
  frameFor(sec: number): VideoFrame | null;
  awaitFrameFor(
    sec: number,
    signal?: AbortSignal,
  ): Promise<VideoFrame | typeof HOLD | null>;
  stop(): void;
}

export interface Want {
  assetId: string;
  sourceFrame: number;
}

export interface Feed {
  readonly assetId: string;
  /** The newest picture pulled. Owned by the pool: never close it. */
  readonly current: VideoFrame | null;
}

interface Slot extends Feed {
  assetId: string;
  current: VideoFrame | null;
  session: FeedSession;
  /** The last source frame asked of it — what continuity is judged against. */
  last: number;
  /** Asked for since `begin()`. */
  used: boolean;
}

export class FeedPool {
  private slots: Slot[] = [];
  private open: (assetId: string) => FeedSession | null;
  private fps: Rational;

  constructor(open: (assetId: string) => FeedSession | null, fps: Rational) {
    this.open = open;
    this.fps = fps;
  }

  get size(): number {
    return this.slots.length;
  }

  /** A new frame: nothing has been asked for yet. */
  begin(): void {
    for (const s of this.slots) s.used = false;
  }

  /**
   * The feed for this picture: one already running through these frames, or
   * a fresh one cued at them. Null when the source cannot be opened.
   */
  feed(want: Want): Feed | null {
    // Asked for the identical frame twice in one go (a dissolve across a
    // split of one shot): one decoder answers both.
    const same = this.slots.find(
      (s) =>
        s.used && s.assetId === want.assetId && s.last === want.sourceFrame,
    );
    if (same) return same;
    const running = this.slots.find(
      (s) =>
        !s.used &&
        isContinuous(s.assetId, s.last, want.assetId, want.sourceFrame),
    );
    if (running) {
      running.last = want.sourceFrame;
      running.used = true;
      return running;
    }
    const session = this.open(want.assetId);
    if (!session) return null;
    session.start(frameToSec(want.sourceFrame, this.fps));
    const slot: Slot = {
      assetId: want.assetId,
      current: null,
      session,
      last: want.sourceFrame,
      used: true,
    };
    this.slots.push(slot);
    return slot;
  }

  /** Stop every feed nothing asked for this frame. */
  end(): void {
    const keep: Slot[] = [];
    for (const s of this.slots) {
      if (s.used) keep.push(s);
      else this.close(s);
    }
    this.slots = keep;
  }

  private take(slot: Slot, frame: VideoFrame | null): void {
    slot.current?.close();
    slot.current = frame;
  }

  /** Playback: the newest picture at `sec` if one is ready. Late frames are
   *  dropped; the feed keeps showing what it has. */
  pull(feed: Feed, sec: number): boolean {
    const slot = feed as Slot;
    const frame = slot.session.frameFor(sec);
    if (!frame) return false;
    this.take(slot, frame);
    return true;
  }

  /** Export: WAIT for the picture at `sec`. 'hold' means the source repeats
   *  the one it has; 'missing' means it has none at all any more. */
  async pullWait(
    feed: Feed,
    sec: number,
    signal?: AbortSignal,
  ): Promise<'frame' | 'hold' | 'missing'> {
    const slot = feed as Slot;
    const out = await slot.session.awaitFrameFor(sec, signal);
    if (out === HOLD) return 'hold';
    if (out === null) {
      this.take(slot, null);
      return 'missing';
    }
    this.take(slot, out);
    return 'frame';
  }

  private close(slot: Slot): void {
    slot.session.stop();
    this.take(slot, null);
  }

  stopAll(): void {
    for (const s of this.slots) this.close(s);
    this.slots = [];
  }
}
