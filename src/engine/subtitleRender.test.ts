// framewright — where the words go on the picture (pure half).
//
// The canvas half cannot run in Node; the arithmetic that decides the font
// size, the line breaks and where each pill sits can, and that is the part
// where "looks fine at 720p, unreadable at 1080p" would otherwise hide.
import { describe, expect, it } from 'vitest';
import { layoutSubtitle, subtitleFontPx, wrapSubtitle } from './subtitleRender';

/** A fake measurer: every character is `perChar` px wide. */
const measure =
  (perChar: number) =>
  (s: string): number =>
    s.length * perChar;

describe('subtitleFontPx', () => {
  it('scales with the picture height and never goes below legible', () => {
    expect(subtitleFontPx(720)).toBe(37);
    expect(subtitleFontPx(1080)).toBe(56);
    expect(subtitleFontPx(180)).toBe(12);
    expect(subtitleFontPx(2160)).toBe(112);
  });
});

describe('wrapSubtitle', () => {
  it('keeps the line breaks the user typed', () => {
    expect(wrapSubtitle('첫 줄\n둘째 줄', 1000, measure(10))).toEqual([
      '첫 줄',
      '둘째 줄',
    ]);
  });

  it('wraps at spaces when a line is too wide', () => {
    // 10px a character, 50px wide: "가나 다라 마바" (7 chars) does not fit.
    expect(wrapSubtitle('가나 다라 마바', 50, measure(10))).toEqual([
      '가나 다라',
      '마바',
    ]);
  });

  it('breaks a spaceless run by character rather than overflowing', () => {
    expect(wrapSubtitle('가나다라마바사', 30, measure(10))).toEqual([
      '가나다',
      '라마바',
      '사',
    ]);
  });

  it('drops blank lines and returns nothing for blank text', () => {
    expect(wrapSubtitle('  \n\n  ', 100, measure(10))).toEqual([]);
  });
});

describe('layoutSubtitle', () => {
  it('centres each line and stacks them upward from the bottom margin', () => {
    const box = { width: 1280, height: 720 };
    const layout = layoutSubtitle('안녕하세요\n둘째 줄', box, measure(20))!;
    expect(layout.fontPx).toBe(37);
    expect(layout.lines).toHaveLength(2);
    const [first, second] = layout.lines;
    // Every pill is as wide as its words plus the padding, centred.
    expect(first.widthPx).toBe(5 * 20 + 2 * layout.padX);
    expect(first.x).toBe(Math.round((1280 - first.widthPx) / 2));
    expect(second.widthPx).toBe(4 * 20 + 2 * layout.padX);
    // The LAST line sits on the bottom margin; the first is one line above it.
    expect(second.y + layout.lineHeightPx).toBe(720 - layout.bottomPx);
    expect(first.y).toBe(second.y - layout.lineHeightPx);
    expect(first.y).toBeGreaterThan(0);
  });

  it('never makes a pill wider than nine tenths of the picture', () => {
    const box = { width: 400, height: 300 };
    const layout = layoutSubtitle('가'.repeat(80), box, measure(10))!;
    for (const line of layout.lines) {
      expect(line.widthPx).toBeLessThanOrEqual(400 * 0.9);
      expect(line.x).toBeGreaterThanOrEqual(0);
    }
    expect(layout.lines.length).toBeGreaterThan(1);
  });

  it('is null for blank text — nothing to draw, so nothing is drawn', () => {
    expect(layoutSubtitle('   ', { width: 100, height: 100 }, measure(1))).toBe(
      null,
    );
  });
});
