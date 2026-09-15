// framewright — where the words are put by hand (E8-2c): the normal form
// a dragged or slid position is stored in, the snap near a preset, the
// sentences, and the slider's numbers. Pure; the gesture is the preview's.
import { describe, expect, it } from 'vitest';
import {
  SNAP,
  bottomCentreY,
  describePosition,
  normalizePosition,
  positionOfSlider,
  positionText,
  positionXText,
  positionYText,
  sliderOfPosition,
  snapPosition,
} from './subtitlePosition';
import { layoutSubtitle } from './subtitleRender';
import { placeOf } from './subtitleStyle';

const measure = (perChar: number) => (s: string) => s.length * perChar;

describe('normalizePosition — the form the document stores', () => {
  it('rounds to whole percents and clamps to the box', () => {
    expect(normalizePosition({ posX: 0.3249, posY: 0.7051 })).toEqual({
      posX: 0.32,
      posY: 0.71,
    });
    expect(normalizePosition({ posX: -0.2, posY: 0.2 })).toEqual({
      posX: 0,
      posY: 0.2,
    });
  });

  it('stores the horizontal centre and the bottom stack as ABSENT fields, so a drop there is the preset', () => {
    // posX 0.5 is what the renderer uses when the field is absent; posY at
    // the bottom margin draws exactly where the absent field draws
    // (layoutSubtitle clamps into the margin), so ≥ 0.97 is the same place.
    expect(normalizePosition({ posX: 0.5, posY: 0.97 })).toStrictEqual({
      posX: undefined,
      posY: undefined,
    });
    expect(normalizePosition({ posX: 0.504, posY: 1 })).toStrictEqual({
      posX: undefined,
      posY: undefined,
    });
    expect(normalizePosition({ posX: 0.5, posY: 0.96 })).toStrictEqual({
      posX: undefined,
      posY: 0.96,
    });
    expect(normalizePosition({ posX: 0.32, posY: undefined })).toStrictEqual({
      posX: 0.32,
      posY: undefined,
    });
  });
});

describe('snapPosition — near a preset, on it', () => {
  it('pulls each axis to a preset value within the snap distance, independently', () => {
    expect(SNAP).toBe(0.03);
    // 가운데: posX 0.5, posY 0.5.
    expect(snapPosition({ posX: 0.52, posY: 0.48 }, 0.9)).toStrictEqual({
      posX: undefined,
      posY: 0.5,
    });
    // 위: posY 0.15, x free.
    expect(snapPosition({ posX: 0.2, posY: 0.17 }, 0.9)).toStrictEqual({
      posX: 0.2,
      posY: 0.15,
    });
    // Off every preset: stored as dropped, rounded.
    expect(snapPosition({ posX: 0.2, posY: 0.7 }, 0.9)).toStrictEqual({
      posX: 0.2,
      posY: 0.7,
    });
  });

  it("a drop near the bottom stack's own centre is the 아래 preset — absent", () => {
    // The bottom stack's centre depends on the block (one line at 720p is
    // ~0.9); the caller measures it, the snap compares against it.
    expect(snapPosition({ posX: 0.5, posY: 0.88 }, 0.9)).toStrictEqual({
      posX: undefined,
      posY: undefined,
    });
    expect(snapPosition({ posX: 0.3, posY: 0.91 }, 0.9)).toStrictEqual({
      posX: 0.3,
      posY: undefined,
    });
    // Beyond the distance: kept.
    expect(snapPosition({ posX: 0.5, posY: 0.85 }, 0.9)).toStrictEqual({
      posX: undefined,
      posY: 0.85,
    });
  });
});

describe("bottomCentreY — the caller's measure for the snap", () => {
  it('is the centre of the block the bottom stack draws, as a fraction of the box', () => {
    const box = { width: 1280, height: 720 };
    const layout = layoutSubtitle('안녕', box, measure(20))!;
    // One line sits on the bottom margin: its centre is half a line above
    // the margin (from the layout's own public numbers, not its bounds).
    const expected =
      (box.height - layout.bottomPx - layout.lineHeightPx / 2) / box.height;
    expect(bottomCentreY(layout, box.height)).toBeCloseTo(expected, 6);
    expect(expected).toBeGreaterThan(0.85);
    const two = layoutSubtitle('안녕\n둘째', box, measure(20))!;
    expect(bottomCentreY(two, box.height)).toBeLessThan(expected);
  });
});

describe('placeOf reads both spellings of a preset', () => {
  it('lights 가운데 / 위 whether posX is written as 0.5 or left absent', () => {
    // The radios write posX 0.5 (ADR-0017); the drag's normal form writes
    // nothing for the centre. Both must light the radio, or a drop on
    // 가운데 would show nothing checked.
    expect(placeOf({ posX: 0.5, posY: 0.5 })).toBe('middle');
    expect(placeOf({ posY: 0.5 })).toBe('middle');
    expect(placeOf({ posY: 0.15 })).toBe('top');
    expect(placeOf({ posX: 0.32, posY: 0.5 })).toBeNull();
    expect(placeOf({ posX: 0.32 })).toBeNull();
  });
});

describe('the sentences', () => {
  it('say where the words are, in percents from the left and the top', () => {
    expect(positionText({ posX: 0.32, posY: 0.7 })).toBe(
      '왼쪽에서 32% · 위에서 70%',
    );
    // Not "가운데" alone: that is the vertical preset's name (novice).
    expect(positionText({ posX: undefined, posY: 0.7 })).toBe(
      '가로 가운데 · 위에서 70%',
    );
    expect(positionText({ posX: 0.32, posY: undefined })).toBe(
      '왼쪽에서 32% · 맨 아래',
    );
    expect(positionXText(undefined)).toBe('가로 가운데');
    expect(positionXText(0.05)).toBe('왼쪽에서 5%');
    expect(positionYText(undefined)).toBe('맨 아래');
    expect(positionYText(0.15)).toBe('위에서 15%');
    // A hand-edited document holding a value the normal form would have
    // dropped: it draws at the bottom, so it is said and lit as the bottom.
    expect(positionYText(0.98)).toBe('맨 아래');
    expect(placeOf({ posY: 0.98 })).toBe('bottom');
    expect(placeOf({ posX: 0.5, posY: 1 })).toBe('bottom');
  });

  it("use the preset's own sentence when the position IS a preset", () => {
    expect(describePosition({ posX: 0.32, posY: 0.7 })).toBe(
      '자막을 옮겼어요 · 왼쪽에서 32% · 위에서 70%.',
    );
    expect(describePosition({ posX: undefined, posY: 0.5 })).toBe(
      '자막 자리를 가운데로 옮겼어요.',
    );
    expect(describePosition({ posX: undefined, posY: 0.15 })).toBe(
      '자막 자리를 위로 옮겼어요.',
    );
    expect(describePosition({ posX: undefined, posY: undefined })).toBe(
      '자막 자리를 아래로 되돌렸어요.',
    );
  });
});

describe('the sliders — 0–100, the preset as 50 and 100', () => {
  it('reads a position as two slider values and writes them back as the normal form', () => {
    expect(sliderOfPosition({ posX: 0.32, posY: 0.7 })).toEqual({
      x: 32,
      y: 70,
    });
    expect(sliderOfPosition({ posX: undefined, posY: undefined })).toEqual({
      x: 50,
      y: 100,
    });
    expect(positionOfSlider(32, 70)).toStrictEqual({ posX: 0.32, posY: 0.7 });
    expect(positionOfSlider(50, 100)).toStrictEqual({
      posX: undefined,
      posY: undefined,
    });
    expect(positionOfSlider(50, 98)).toStrictEqual({
      posX: undefined,
      posY: undefined,
    });
    expect(positionOfSlider(0, 0)).toStrictEqual({ posX: 0, posY: 0 });
  });

  it('round-trips every whole percent the document can hold', () => {
    for (let x = 0; x <= 100; x++) {
      const p = positionOfSlider(x, 40);
      expect(sliderOfPosition(p).x).toBe(x);
    }
  });
});
