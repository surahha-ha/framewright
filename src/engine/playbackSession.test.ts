import { describe, it, expect } from 'vitest';
import { drainPlan } from './playbackSession';

// PlaybackSession itself needs WebCodecs (browser only), but the rule that
// decides WHEN a buffered frame is the right one is pure — and it is exactly
// where the "clip plays fast after a cut" bug lived.
describe('drainPlan', () => {
  it('is unresolved while every buffered frame is still <= the target', () => {
    // Session seeked to a keyframe far before the target: frames 0..7 buffered,
    // target is frame 40. Answering now would hand back frame 7 — the bug.
    const buffered = [0, 1, 2, 3, 4, 5, 6, 7];
    const { consume, resolved } = drainPlan(buffered, 40, false);
    expect(consume).toBe(8);
    expect(resolved).toBe(false); // must keep decoding, not answer yet
  });

  it('resolves once a later frame proves nothing closer is coming', () => {
    const { consume, resolved } = drainPlan([38, 39, 40, 41], 40, false);
    expect(consume).toBe(3); // 38, 39, 40
    expect(resolved).toBe(true); // 41 > 40 proves 40 is the closest
  });

  it('resolves at end of stream even with nothing later buffered', () => {
    expect(drainPlan([98, 99], 200, true)).toEqual({
      consume: 2,
      resolved: true,
    });
  });

  it('consumes nothing when the next frame is in the future (a repeat)', () => {
    const { consume, resolved } = drainPlan([50, 51], 40, false);
    expect(consume).toBe(0);
    expect(resolved).toBe(true); // caller should HOLD the previous picture
  });

  it('an empty buffer is only resolved at end of stream', () => {
    expect(drainPlan([], 10, false).resolved).toBe(false);
    expect(drainPlan([], 10, true).resolved).toBe(true);
  });
});
