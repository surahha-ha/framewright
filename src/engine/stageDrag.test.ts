import { describe, it, expect } from 'vitest';
import { dragAxis } from './stageDrag';

// A 400px-wide box: a pixel of drag is 1/400 of it.
const box = { size: 400, min: 0, max: 1 };

describe('dragAxis', () => {
  it('inside the limits the value follows the pointer and the origin stays put', () => {
    const r = dragAxis({ ...box, base: 0.5, origin: 100, pointer: 140 });
    expect(r.value).toBeCloseTo(0.6);
    expect(r.origin).toBe(100);
  });

  it('past the far limit the value stops and the origin comes along, so the next step back moves at once', () => {
    // 0.5 + 400/400 = 1.5 → clamped to 1; the origin moves so that the
    // pointer sits exactly on the clamped value.
    const over = dragAxis({ ...box, base: 0.5, origin: 100, pointer: 500 });
    expect(over.value).toBe(1);
    expect(over.origin).toBe(300);
    // Back by 40px from there: 1 - 40/400 = 0.9, not stuck at 1 until the
    // pointer has returned by the 200px overshoot.
    const back = dragAxis({
      ...box,
      base: 0.5,
      origin: over.origin,
      pointer: 460,
    });
    expect(back.value).toBeCloseTo(0.9);
    expect(back.origin).toBe(300);
  });

  it('past the near limit, the same, mirrored', () => {
    const over = dragAxis({ ...box, base: 0.2, origin: 100, pointer: -100 });
    expect(over.value).toBe(0);
    expect(over.origin).toBe(-20);
    const back = dragAxis({
      ...box,
      base: 0.2,
      origin: over.origin,
      pointer: -60,
    });
    expect(back.value).toBeCloseTo(0.1);
  });

  it('treats a box with no extent, or a pointer with no coordinate, as no move — never NaN', () => {
    // A third stage drag (E10) will call this too; the contract is that one
    // bad event leaves the gesture where it was rather than poisoning its
    // origin for every move after.
    const still = dragAxis({
      ...box,
      size: 0,
      base: 0.5,
      origin: 100,
      pointer: 140,
    });
    expect(still).toEqual({ value: 0.5, origin: 100 });
    const nan = dragAxis({ ...box, base: 1.2, origin: 100, pointer: NaN });
    expect(nan).toEqual({ value: 1, origin: 100 });
  });

  it('takes any limits, so the pan uses it with its own', () => {
    // A pan on a stood-up picture: ±0.15 of the box, base 0, 200px box.
    const r = dragAxis({
      size: 200,
      min: -0.15,
      max: 0.15,
      base: 0,
      origin: 0,
      pointer: 60,
    });
    expect(r.value).toBe(0.15);
    expect(r.origin).toBe(30);
  });
});
