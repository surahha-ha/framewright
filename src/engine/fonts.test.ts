// framewright — the faces a subtitle may be set in (ADR-0018): what the
// engine knows without a browser. Loading is the browser's (`ui/fonts.ts`,
// covered by `e2e/subtitle-font.spec.ts`).
import { describe, expect, it } from 'vitest';
import {
  FONT_FAILED,
  FONT_FETCHING,
  FONT_HINT,
  FONT_IDS,
  NO_FONTS,
  SUBTITLE_FONT_FILES,
  describeFont,
  fontFamilyStack,
  fontField,
  fontOf,
  fontsInPlan,
  knownFont,
  missingFontsText,
} from './fonts';
import { SUBTITLE_FONT_FAMILY, subtitleFont } from './subtitleRender';
import { subtitleFrameOf } from './subtitleStyle';
import { FPS_30 } from './time';
import type { SubtitleFrame } from './subtitleRender';
import type { SubtitleFont } from './types';

describe('the shipped faces', () => {
  it('are three OFL files under the app’s own /fonts/, one family name each', () => {
    for (const id of FONT_IDS) {
      if (id === 'system') continue;
      const f = SUBTITLE_FONT_FILES[id];
      expect(f.licence).toBe('OFL');
      expect(f.file.startsWith('/fonts/')).toBe(true);
      expect(f.family.length).toBeGreaterThan(0);
    }
  });

  it('read an absent field as 기본 and store nothing for it', () => {
    expect(fontOf({})).toBe('system');
    expect(fontOf({ font: 'pen' })).toBe('pen');
    expect(fontField('system')).toBeUndefined();
    expect(fontField('brush')).toBe('brush');
  });
});

describe('the font string', () => {
  it('puts the face before the system stack, so a missing glyph falls back per character', () => {
    expect(fontFamilyStack(undefined, 'A, B')).toBe('A, B');
    expect(fontFamilyStack('brush', 'A, B')).toBe('"Nanum Brush Script", A, B');
  });

  it('draws a face at weight 400 whatever the look asks — a synthetic bold is not the face', () => {
    expect(subtitleFont(37, 800)).toBe(`800 37px ${SUBTITLE_FONT_FAMILY}`);
    expect(subtitleFont(37, 800, 'black')).toBe(
      `400 37px "Black Han Sans", ${SUBTITLE_FONT_FAMILY}`,
    );
  });

  it("draws a face this build does not know as the system face, at the look's weight — never throws", () => {
    // A document written by a build that shipped a fourth face, opened by
    // this one: the words must still draw (the preview has no error
    // boundary; a throw here blanks the whole editor).
    const unknown = 'calligraphy' as unknown as SubtitleFont;
    expect(fontFamilyStack(unknown, 'A, B')).toBe('A, B');
    expect(subtitleFont(37, 800, unknown)).toBe(
      `800 37px ${SUBTITLE_FONT_FAMILY}`,
    );
    expect(knownFont(unknown)).toBeUndefined();
    expect(knownFont('pen')).toBe('pen');
    expect(knownFont(undefined)).toBeUndefined();
  });

  it('reaches the frame both surfaces draw from', () => {
    const f = subtitleFrameOf(
      { id: 's', text: '붓', startFrame: 0, endFrame: 30, font: 'brush' },
      10,
      FPS_30,
    );
    expect(f.font).toBe('brush');
    expect(
      subtitleFrameOf(
        { id: 's', text: '붓', startFrame: 0, endFrame: 30 },
        10,
        FPS_30,
      ),
    ).toEqual({ text: '붓', t: 1 });
  });
});

describe('fontsInPlan', () => {
  const frame = (
    font?: SubtitleFrame['font'],
  ): { subtitle: SubtitleFrame } => ({
    subtitle: { text: 'x', t: 1, ...(font ? { font } : {}) },
  });

  it('lists each face once, in first-use order, and nothing for a plan without one', () => {
    expect(fontsInPlan([{ subtitle: null }, frame(), frame()])).toEqual([]);
    expect(
      fontsInPlan([
        frame('pen'),
        frame(),
        frame('brush'),
        { subtitle: null },
        frame('pen'),
      ]),
    ).toEqual(['pen', 'brush']);
  });

  it('does not wait for, or report, a face this build does not know', () => {
    const unknown = 'calligraphy' as unknown as SubtitleFont;
    expect(fontsInPlan([frame(unknown), frame('pen'), frame(unknown)])).toEqual(
      ['pen'],
    );
  });
});

describe('the loader seam', () => {
  it('NO_FONTS never has a face and never delivers one, without throwing', async () => {
    expect(NO_FONTS.ready('brush')).toBe(false);
    await expect(NO_FONTS.load('brush')).resolves.toBe(false);
  });
});

describe('the sentences', () => {
  it('name the face, 로/으로 by its last syllable', () => {
    expect(describeFont('brush')).toBe('자막 글꼴을 붓글씨로 바꿨어요.');
    expect(describeFont('black')).toBe('자막 글꼴을 굵은고딕으로 바꿨어요.');
    expect(describeFont('system')).toBe('자막 글꼴을 기본으로 되돌렸어요.');
  });

  it('say that a bold look loses its weight to the face, and only then', () => {
    // 강조 / 외침 are drawn bold on the system face; a face is always its
    // own weight (400). The choice's sentence is the one place that says
    // the two choices meet.
    expect(describeFont('brush', 'shout')).toBe(
      '자막 글꼴을 붓글씨로 바꿨어요 · 외침의 굵은 글씨는 붓글씨 본래 굵기로 보여요.',
    );
    expect(describeFont('pen', 'bold')).toBe(
      '자막 글꼴을 손글씨로 바꿨어요 · 강조의 굵은 글씨는 손글씨 본래 굵기로 보여요.',
    );
    expect(describeFont('brush', 'plain')).toBe(
      '자막 글꼴을 붓글씨로 바꿨어요.',
    );
    expect(describeFont('system', 'shout')).toBe(
      '자막 글꼴을 기본으로 되돌렸어요.',
    );
  });

  it('end with the wait while the file is on its way — one full stop, never ". ·"', () => {
    // Seen in the owner's Chrome: the panel had glued the finished
    // sentence and the wait with " · ", giving "바꿨어요. · 글꼴을".
    expect(describeFont('brush', 'plain', true)).toBe(
      '자막 글꼴을 붓글씨로 바꿨어요 · 글꼴을 받는 중이에요 · 받으면 바로 바뀌어요.',
    );
    expect(describeFont('black', 'shout', true)).toBe(
      '자막 글꼴을 굵은고딕으로 바꿨어요 · 외침의 굵은 글씨는 굵은고딕 본래 굵기로 보여요 · 글꼴을 받는 중이에요 · 받으면 바로 바뀌어요.',
    );
    expect(FONT_FETCHING('pen')).toBe(
      '손글씨 글꼴을 받는 중이에요 · 받으면 바로 바뀌어요.',
    );
    expect(describeFont('brush', 'plain', true)).not.toContain('. ·');
  });

  it('warn about the faces an export could not load, or say nothing', () => {
    expect(missingFontsText([])).toBe('');
    expect(missingFontsText(['pen', 'black'])).toBe(
      ' ⚠ 손글씨, 굵은고딕 글꼴을 받지 못해 기본 글꼴로 그렸어요.',
    );
  });

  it('name the way back when a face did not come — the same radio is the retry', () => {
    // The radio stays checked after a failure (the document already says
    // the face), so nothing on screen shows there IS a way back.
    // "자막을 고른 뒤" first: during playback nothing is selected and the
    // 글꼴 row is not on screen, so the sentence must start there.
    expect(FONT_FAILED('brush')).toBe(
      '붓글씨 글꼴을 받지 못했어요 · 기본 글꼴로 보여요 · 자막을 고른 뒤 글꼴에서 붓글씨 단추를 다시 누르면 다시 받아요.',
    );
    expect(FONT_FAILED('black')).toContain(
      '자막을 고른 뒤 글꼴에서 굵은고딕 단추를 다시 누르면',
    );
  });

  it('describe a face by what it looks like first, the product name after', () => {
    for (const id of ['brush', 'pen', 'black'] as const) {
      const [look, name] = FONT_HINT[id].split(' · ');
      expect(look).toMatch(/글씨$/);
      expect(name).not.toMatch(/글씨$/);
    }
    expect(FONT_HINT.brush).toBe('붓으로 쓴 글씨 · 나눔붓');
  });
});
