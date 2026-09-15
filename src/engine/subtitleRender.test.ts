// framewright — where the words go on the picture (pure half).
//
// The canvas half cannot run in Node; the arithmetic that decides the font
// size, the line breaks and where each pill sits can, and that is the part
// where "looks fine at 720p, unreadable at 1080p" would otherwise hide.
import { describe, expect, it } from 'vitest';
import {
  effectState,
  layoutBounds,
  layoutSubtitle,
  lookFontPx,
  subtitleFontPx,
  wrapSubtitle,
} from './subtitleRender';
import type { SubtitleLook } from './types';

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

// ---- ADR-0017: a look, a place, a way in ----

describe('layoutSubtitle — looks', () => {
  const box = { width: 1280, height: 720 };

  it('draws the plain look exactly as before: pill, white ink, no outline', () => {
    const layout = layoutSubtitle('안녕', box, measure(20))!;
    expect(layout.fontPx).toBe(37);
    expect(layout.ground).toBe('rgba(0, 0, 0, 0.62)');
    expect(layout.ink).toBe('#ffffff');
    expect(layout.outlinePx).toBe(0);
  });

  it('scales the font per look from the plain size', () => {
    expect(lookFontPx(720)).toBe(37);
    expect(lookFontPx(720, 'bold')).toBe(52); // 37 × 1.4 = 51.8
    expect(lookFontPx(720, 'shout')).toBe(67); // 37 × 1.8 = 66.6
    expect(layoutSubtitle('안녕', box, measure(20), 'bold')!.fontPx).toBe(52);
  });

  it('draws a look this build does not know as the plain look — never throws', () => {
    // A document from a build with a fourth look, opened by this one: the
    // words still draw, as plain (the preview has no error boundary).
    const unknown = 'neon' as unknown as SubtitleLook;
    expect(lookFontPx(720, unknown)).toBe(37);
    expect(layoutSubtitle('안녕', box, measure(20), unknown)).toEqual(
      layoutSubtitle('안녕', box, measure(20)),
    );
  });

  it('gives 강조 and 외침 an outline and no pill', () => {
    const bold = layoutSubtitle('안녕', box, measure(20), 'bold')!;
    expect(bold.ground).toBeNull();
    expect(bold.ink).toBe('#ffe14d');
    expect(bold.outlinePx).toBe(6); // 52 × 0.12
    const shout = layoutSubtitle('안녕', box, measure(20), 'shout')!;
    expect(shout.ground).toBeNull();
    expect(shout.ink).toBe('#ffffff');
    expect(shout.outlinePx).toBe(12); // 67 × 0.18
  });
});

describe('layoutSubtitle — places', () => {
  const box = { width: 1280, height: 720 };

  it('keeps the bottom stack, to the pixel, when no place is given', () => {
    const before = layoutSubtitle('안녕하세요\n둘째 줄', box, measure(20))!;
    const after = layoutSubtitle(
      '안녕하세요\n둘째 줄',
      box,
      measure(20),
      undefined,
      {},
    )!;
    expect(after).toEqual(before);
  });

  it('centres the block on the given fractions — a two-line block has one line each side', () => {
    const layout = layoutSubtitle(
      '첫 줄\n둘째 줄',
      box,
      measure(20),
      undefined,
      {
        posX: 0.5,
        posY: 0.5,
      },
    )!;
    const [first, second] = layout.lines;
    expect(first.y + layout.lineHeightPx).toBe(second.y);
    // The block's middle is the picture's middle.
    expect((first.y + second.y + layout.lineHeightPx) / 2).toBeCloseTo(360, 0);
    expect(first.x + first.widthPx / 2).toBeCloseTo(640, 0);
  });

  it('puts 위 near the top, and never lets a tall block off the top edge', () => {
    const one = layoutSubtitle('위', box, measure(20), undefined, {
      posY: 0.15,
    })!;
    expect(one.lines[0].y).toBeGreaterThanOrEqual(one.bottomPx);
    expect(one.lines[0].y).toBeLessThan(720 * 0.15);
    const tall = layoutSubtitle(
      '1\n2\n3\n4\n5\n6',
      box,
      measure(20),
      undefined,
      {
        posY: 0.15,
      },
    )!;
    // Six lines wanted to start above the margin; they start AT it.
    expect(tall.lines[0].y).toBe(tall.bottomPx);
  });

  it('keeps a block wider than its place inside the sides', () => {
    const left = layoutSubtitle('안녕', box, measure(20), undefined, {
      posX: 0,
    })!;
    expect(left.lines[0].x).toBe(0);
    const right = layoutSubtitle('안녕', box, measure(20), undefined, {
      posX: 1,
    })!;
    expect(right.lines[0].x + right.lines[0].widthPx).toBe(1280);
  });

  it('centres a block taller than the whole room rather than pushing it off an edge', () => {
    const small = { width: 200, height: 100 };
    const layout = layoutSubtitle(
      '1\n2\n3\n4\n5\n6\n7\n8',
      small,
      measure(5),
      undefined,
      {
        posY: 0.9,
      },
    )!;
    const b = layoutBounds(layout);
    expect((b.top + b.bottom) / 2).toBeCloseTo(50, 0);
  });

  it('takes each axis on its own: a posX alone keeps the bottom stack', () => {
    const layout = layoutSubtitle('안녕', box, measure(20), undefined, {
      posX: 0.2,
    })!;
    expect(layout.lines[0].y + layout.lineHeightPx).toBe(720 - layout.bottomPx);
    expect(layout.lines[0].x + layout.lines[0].widthPx / 2).toBeCloseTo(256, 0);
  });
});

describe('effectState', () => {
  const box = { width: 1280, height: 720 };
  const layout = () => layoutSubtitle('안녕', box, measure(20))!;

  it('is the identity without an effect, and once fully shown', () => {
    const l = layout();
    const b = layoutBounds(l);
    for (const s of [
      effectState(undefined, 0.2, l, 720),
      effectState('pop', 1, l, 720),
    ]) {
      expect(s.alpha).toBe(1);
      expect(s.scale).toBe(1);
      expect(s.dx).toBe(0);
      expect(s.dy).toBe(0);
      expect(s.cx).toBe((b.left + b.right) / 2);
      expect(s.cy).toBe((b.top + b.bottom) / 2);
    }
  });

  it('서서히 is the alpha, and only the alpha', () => {
    const s = effectState('fade', 0.25, layout(), 720);
    expect(s.alpha).toBe(0.25);
    expect(s.scale).toBe(1);
    expect(s.dy).toBe(0);
  });

  it('톡 grows from six tenths, settling as it arrives', () => {
    expect(effectState('pop', 0, layout(), 720).scale).toBeCloseTo(0.6);
    // Ease-out: half the time is more than half the way.
    expect(effectState('pop', 0.5, layout(), 720).scale).toBeCloseTo(0.9);
    expect(effectState('pop', 0.5, layout(), 720).alpha).toBe(1);
  });

  it('올라오기 starts six hundredths of the picture below and rises', () => {
    expect(effectState('rise', 0, layout(), 720).dy).toBe(43); // 0.06 × 720
    expect(effectState('rise', 0.5, layout(), 720).dy).toBe(11); // × 0.25
    expect(effectState('rise', 0.5, layout(), 720).scale).toBe(1);
  });
});
