import { describe, it, expect } from 'vitest';
import { analyzeFrameRate } from './demux';
import type { DemuxSample } from './demux';

const TS = 90000;

function sample(cts: number): DemuxSample {
  return {
    cts,
    dts: cts,
    duration: 0,
    timescale: TS,
    is_sync: true,
    data: new Uint8Array(),
  };
}

// Build samples from a list of inter-frame intervals (seconds).
function fromIntervals(intervalsSec: number[]): DemuxSample[] {
  const out: DemuxSample[] = [sample(0)];
  let t = 0;
  for (const dt of intervalsSec) {
    t += dt;
    out.push(sample(Math.round(t * TS)));
  }
  return out;
}

describe('analyzeFrameRate (VFR detection)', () => {
  it('flags constant 30fps as CFR', () => {
    const r = analyzeFrameRate(fromIntervals(Array(60).fill(1 / 30)));
    expect(r.isVFR).toBe(false);
    expect(r.nominalFps).toBeCloseTo(30, 0);
  });

  it('flags irregular intervals as VFR', () => {
    const intervals: number[] = [];
    for (let i = 0; i < 60; i++) intervals.push(i % 5 === 0 ? 1 / 15 : 1 / 60);
    const r = analyzeFrameRate(fromIntervals(intervals));
    expect(r.isVFR).toBe(true);
  });

  it('is safe on too-few samples', () => {
    expect(analyzeFrameRate([sample(0)]).isVFR).toBe(false);
  });
});
