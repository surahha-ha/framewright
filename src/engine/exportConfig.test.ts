import { describe, it, expect } from 'vitest';
import { avcLevel, avcCodecString, containRect } from './exportConfig';
import { evenDimensions } from './exportPlan';

describe('avc level selection', () => {
  it('uses the macroblock RATE, not just the pixel count', () => {
    // 1280x720 = 3600 MBs. At 30fps -> 108000 MBPS (level 3.1 exactly),
    // at 60fps -> 216000 MBPS, which needs level 3.2. Area-only logic gets
    // this wrong and produces a file strict decoders reject.
    expect(avcLevel(1280, 720, 30)).toBe('1f'); // 3.1
    expect(avcLevel(1280, 720, 60)).toBe('20'); // 3.2
  });

  it('covers common sizes', () => {
    expect(avcLevel(1920, 1080, 30)).toBe('28'); // 4.0
    expect(avcLevel(1920, 1080, 60)).toBe('2a'); // 4.2
    expect(avcLevel(3840, 2160, 30)).toBe('33'); // 5.1
  });

  it('never returns an undersized level for huge frames', () => {
    expect(avcLevel(7680, 4320, 60)).toBe('3d'); // 6.1
    expect(avcLevel(7680, 4320, 120)).toBe('3e'); // 6.2 (top of the table)
  });

  it('builds a full codec string per profile', () => {
    expect(avcCodecString('high', 1920, 1080, 30)).toBe('avc1.640028');
    expect(avcCodecString('main', 1920, 1080, 30)).toBe('avc1.4d0028');
    expect(avcCodecString('baseline', 1280, 720, 30)).toBe('avc1.42001f');
  });
});

describe('containRect (preview == export letterboxing)', () => {
  it('fits a portrait source into a landscape canvas without distortion', () => {
    const r = containRect(1080, 1920, 1920, 1080);
    expect(r.height).toBe(1080);
    expect(r.width).toBeCloseTo(607.5, 1);
    expect(r.x).toBeCloseTo((1920 - 607.5) / 2, 1);
    expect(r.y).toBe(0);
    // aspect ratio preserved
    expect(r.width / r.height).toBeCloseTo(1080 / 1920, 6);
  });

  it('is identity when the aspect ratios match', () => {
    expect(containRect(1920, 1080, 1920, 1080)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it('scales up a small source to fit', () => {
    const r = containRect(640, 360, 1920, 1080);
    expect(r.width).toBe(1920);
    expect(r.height).toBe(1080);
  });

  it('degrades safely on a zero-sized source', () => {
    expect(containRect(0, 0, 100, 50)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
  });
});

describe('evenDimensions', () => {
  it('rounds odd sizes down (4:2:0 requires even)', () => {
    expect(evenDimensions(1921, 1081)).toEqual({ width: 1920, height: 1080 });
    expect(evenDimensions(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(evenDimensions(1, 1)).toEqual({ width: 2, height: 2 });
  });
});
