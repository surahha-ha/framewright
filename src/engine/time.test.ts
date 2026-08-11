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
});
