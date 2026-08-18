import { describe, it, expect } from 'vitest';
import {
  FPS_30,
  FPS_2997,
  frameToSec,
  secToFrame,
  framesForDuration,
  secToSample,
  formatTimecode,
  fpsToNumber,
  nearestStandardFps,
  timescaleToSec,
  secToTimescale,
  formatClock,
} from './time';

describe('time-model', () => {
  it('round-trips frame <-> sec at 30fps', () => {
    for (let f = 0; f <= 10000; f++) {
      expect(secToFrame(frameToSec(f, FPS_30), FPS_30)).toBe(f);
    }
  });

  it('handles 29.97 (30000/1001) exactly with no drift over long durations', () => {
    expect(frameToSec(30, FPS_2997)).toBeCloseTo(1.001, 9);
    // ~15k samples across ~1.8 hours of footage — this is the drift trap.
    for (let f = 0; f <= 200000; f += 13) {
      expect(secToFrame(frameToSec(f, FPS_2997), FPS_2997)).toBe(f);
    }
  });

  it('applies one deterministic rounding rule at cut boundaries', () => {
    const justAfter5 = frameToSec(5, FPS_30) + 1e-6;
    expect(secToFrame(justAfter5, FPS_30, 'round')).toBe(5);
    expect(secToFrame(justAfter5, FPS_30, 'floor')).toBe(5);
    const justBefore6 = frameToSec(6, FPS_30) - 1e-6;
    expect(secToFrame(justBefore6, FPS_30, 'floor')).toBe(5);
  });

  it('framesForDuration rounds and is at least 1', () => {
    expect(framesForDuration(10, FPS_30)).toBe(300);
    expect(framesForDuration(0, FPS_30)).toBe(1);
    expect(framesForDuration(10, FPS_2997)).toBe(300); // 299.7 -> 300
  });

  it('round-trips container timescale units <-> seconds', () => {
    // 15360 with 512-unit frames is what a real 30fps H.264 file carries.
    for (const units of [0, 512, 1024, 46080]) {
      expect(secToTimescale(timescaleToSec(units, 15360), 15360)).toBe(units);
    }
    expect(secToTimescale(1, 90000)).toBe(90000);
  });

  it('secToSample cuts audio on sample boundaries', () => {
    expect(secToSample(1, 48000)).toBe(48000);
    expect(secToSample(0.5, 48000)).toBe(24000);
  });

  it('formats timecode as mm:ss:ff', () => {
    expect(formatTimecode(0, FPS_30)).toBe('00:00:00');
    expect(formatTimecode(90, FPS_30)).toBe('00:03:00');
    expect(formatTimecode(95, FPS_30)).toBe('00:03:05');
  });

  it('fpsToNumber', () => {
    expect(fpsToNumber(FPS_30)).toBe(30);
    expect(fpsToNumber(FPS_2997)).toBeCloseTo(29.97, 2);
  });

  it('snaps a measured rate to the nearest standard RATIONAL rate', () => {
    // storing 29.97 as a float is exactly how an hour drifts by seconds
    expect(nearestStandardFps(29.97)).toEqual({ num: 30000, den: 1001 });
    expect(nearestStandardFps(29.9701)).toEqual({ num: 30000, den: 1001 });
    expect(nearestStandardFps(25)).toEqual({ num: 25, den: 1 });
    expect(nearestStandardFps(59.94)).toEqual({ num: 60000, den: 1001 });
    expect(nearestStandardFps(23.976)).toEqual({ num: 24000, den: 1001 });
  });

  it('keeps an unusual rate exact instead of forcing it to a standard one', () => {
    expect(fpsToNumber(nearestStandardFps(12.5))).toBeCloseTo(12.5, 9);
  });

  it('falls back to 30 for a nonsense rate', () => {
    expect(nearestStandardFps(0)).toEqual(FPS_30);
    expect(nearestStandardFps(NaN)).toEqual(FPS_30);
  });

  describe('how far along, for a ruler', () => {
    it('writes m:ss, so nobody reads it as hours', () => {
      // `formatTimecode` is mm:ss:ff and a ruler is a row of them at once: a
      // three-second clip used to be labelled up to "00:02:25", which reads as
      // two and a half minutes.
      expect(formatClock(0, FPS_30)).toBe('0:00');
      expect(formatClock(90, FPS_30)).toBe('0:03');
      expect(formatClock(30 * 65, FPS_30)).toBe('1:05');
      expect(formatClock(30 * 600, FPS_30)).toBe('10:00');
    });

    it('grows an hours field only when there is one', () => {
      expect(formatClock(30 * 3599, FPS_30)).toBe('59:59');
      expect(formatClock(30 * 3600, FPS_30)).toBe('1:00:00');
      expect(formatClock(30 * 3661, FPS_30)).toBe('1:01:01');
    });

    it('counts a 29.97 second as a second, not as 30 frames of wall clock', () => {
      // One second of 29.97 footage is 30 frames; labelling frame 30 as 0:01
      // is what keeps the ruler agreeing with the file's own duration.
      expect(formatClock(30, FPS_2997)).toBe('0:01');
      expect(formatClock(30 * 60, FPS_2997)).toBe('1:00');
    });

    it('never prints a negative time', () => {
      expect(formatClock(-5, FPS_30)).toBe('0:00');
    });
  });
});