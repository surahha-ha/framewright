// framewright — the shape of the box (ADR-0015).
import { describe, expect, it } from 'vitest';
import {
  FRAME_SHAPES,
  describeFrame,
  frameShapeOf,
  frameSize,
  frameText,
} from './frame';

describe('frameShapeOf', () => {
  it('names the three presets within a percent, and nothing else', () => {
    expect(frameShapeOf(1280, 720)).toBe('landscape');
    expect(frameShapeOf(1920, 1080)).toBe('landscape');
    expect(frameShapeOf(854, 480)).toBe('landscape');
    expect(frameShapeOf(720, 1280)).toBe('portrait');
    expect(frameShapeOf(1080, 1920)).toBe('portrait');
    expect(frameShapeOf(720, 720)).toBe('square');
    // 4:3 is none of them.
    expect(frameShapeOf(1440, 1080)).toBeNull();
    expect(frameShapeOf(0, 720)).toBeNull();
  });
});

describe('frameSize', () => {
  it('keeps the short side and lets the long side follow the ratio', () => {
    expect(frameSize('portrait', 1280, 720)).toEqual({
      width: 720,
      height: 1280,
    });
    expect(frameSize('portrait', 1920, 1080)).toEqual({
      width: 1080,
      height: 1920,
    });
    expect(frameSize('square', 1280, 720)).toEqual({ width: 720, height: 720 });
    expect(frameSize('landscape', 720, 1280)).toEqual({
      width: 1280,
      height: 720,
    });
    // A 4:3 project stood up: its 1080 short side, a 1920 long one.
    expect(frameSize('portrait', 1440, 1080)).toEqual({
      width: 1080,
      height: 1920,
    });
  });

  it('is its own inverse across the presets', () => {
    for (const from of FRAME_SHAPES) {
      const start = frameSize(from, 1280, 720);
      for (const to of FRAME_SHAPES) {
        const there = frameSize(to, start.width, start.height);
        const back = frameSize(from, there.width, there.height);
        expect(back).toEqual(start);
      }
    }
  });

  it('never makes an odd side, and rounds to the nearest even one', () => {
    // 181 → 182, and 182 × 16/9 = 323.6 → 324.
    expect(frameSize('portrait', 320, 181)).toEqual({
      width: 182,
      height: 324,
    });
    expect(frameSize('landscape', 99, 99)).toEqual({ width: 178, height: 100 });
    // The conventional 480p width, not the one below it.
    expect(frameSize('landscape', 640, 480)).toEqual({
      width: 854,
      height: 480,
    });
  });
});

describe('the words', () => {
  it('names the box as a preset when it is one, and as a size when not', () => {
    expect(frameText(720, 1280)).toBe('세로 영상 (9:16 · 720×1280)');
    expect(frameText(1280, 720)).toBe('가로 영상 (16:9 · 1280×720)');
    expect(frameText(1440, 1080)).toBe('1440×1080');
  });

  it('says where to go next only when a picture stopped covering the box, or is zoomed past it', () => {
    const none = { uncovered: false, overzoomed: false };
    expect(describeFrame('portrait', 720, 1280, none)).toBe(
      '세로 영상(9:16 · 720×1280)으로 바꿨어요.',
    );
    // The fill lives in the clip panel, so "pick the clip" is part of it.
    expect(
      describeFrame('portrait', 720, 1280, { ...none, uncovered: true }),
    ).toBe(
      '세로 영상(9:16 · 720×1280)으로 바꿨어요 · 비는 클립을 고르고 화면 채우기를 누르면 꽉 차요.',
    );
    expect(
      describeFrame('landscape', 1280, 720, { ...none, overzoomed: true }),
    ).toBe(
      '가로 영상(16:9 · 1280×720)으로 바꿨어요 · 크게 확대된 클립은 화면 원래대로로 되돌릴 수 있어요.',
    );
    expect(
      describeFrame('square', 720, 720, { uncovered: true, overzoomed: true }),
    ).toBe(
      '정사각 영상(1:1 · 720×720)으로 바꿨어요 · 비는 클립을 고르고 화면 채우기를 누르면 꽉 차요 · 크게 확대된 클립은 화면 원래대로로 되돌릴 수 있어요.',
    );
  });
});
