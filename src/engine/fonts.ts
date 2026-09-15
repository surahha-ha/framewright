// framewright — the faces a subtitle may be set in (pure, ADR-0018).
//
// Three bundled OFL faces, the original files as published, each with its
// licence text beside it in `public/fonts/`. This module is what the engine
// knows about them: the ids, the labels, the CSS family names and files,
// the font string a face produces, which faces an export plan needs, and
// the sentences. LOADING a face is a browser act (`FontFace`,
// `document.fonts`) and lives behind the `FontLoader` seam in `ui/fonts.ts`
// — rule 8, the engine never touches it, so a Node test can hand in a
// loader that says yes, or no, to everything.

import type { ExportFrame } from './exportPlan';
import type { Subtitle, SubtitleFont } from './types';
import { LOOK_LABEL, toward, type LookId } from './subtitleStyle';

export type FontId = 'system' | SubtitleFont;
export const FONT_IDS: FontId[] = ['system', 'brush', 'pen', 'black'];
export const FONT_LABEL: Record<FontId, string> = {
  system: '기본',
  brush: '붓글씨',
  pen: '손글씨',
  black: '굵은고딕',
};
/** What the face IS, for the radio's description and hover. */
export const FONT_HINT: Record<FontId, string> = {
  system: '기기에 있는 고딕 글꼴',
  brush: '나눔붓 · 붓으로 쓴 글씨',
  pen: '나눔손글씨 펜 · 펜으로 쓴 글씨',
  black: '검은고딕 · 굵고 각진 글씨',
};

export interface FontFile {
  /** The family name inside the file — what the font string names. */
  family: string;
  /** Served from the app's own origin (`public/fonts/`), never a CDN. */
  file: string;
  licence: 'OFL';
}

/** The shipped faces. Original TTFs from the google/fonts repository;
 *  each `OFL-<Face>.txt` beside the file is the licence that lets us
 *  bundle it, burn it into a video and let the user sell that video, on
 *  condition the file is not modified (so: no subsetting). */
export const SUBTITLE_FONT_FILES: Record<SubtitleFont, FontFile> = {
  brush: {
    family: 'Nanum Brush Script',
    file: '/fonts/NanumBrushScript-Regular.ttf',
    licence: 'OFL',
  },
  pen: {
    family: 'Nanum Pen Script',
    file: '/fonts/NanumPenScript-Regular.ttf',
    licence: 'OFL',
  },
  black: {
    family: 'Black Han Sans',
    file: '/fonts/BlackHanSans-Regular.ttf',
    licence: 'OFL',
  },
};

export function fontOf(s: Pick<Subtitle, 'font'>): FontId {
  return s.font ?? 'system';
}

/** What the document stores for a font id: nothing for 기본. */
export function fontField(id: FontId): SubtitleFont | undefined {
  return id === 'system' ? undefined : id;
}

/**
 * The family list for a font string: the face first, then the system
 * stack, so a glyph the face lacks (a rare syllable, a symbol) falls back
 * per character rather than the whole line changing face.
 */
export function fontFamilyStack(
  font: SubtitleFont | undefined,
  systemStack: string,
): string {
  const face = knownFont(font);
  return face
    ? `"${SUBTITLE_FONT_FILES[face].family}", ${systemStack}`
    : systemStack;
}

/**
 * The face if this build ships it, else nothing. A document can name a face
 * this build does not know — written by a later build, or a hand edit — and
 * the words must still draw, in the system face: the preview has no error
 * boundary, so a throw here would blank the whole editor.
 */
export function knownFont(font: string | undefined): SubtitleFont | undefined {
  return font !== undefined &&
    Object.prototype.hasOwnProperty.call(SUBTITLE_FONT_FILES, font)
    ? (font as SubtitleFont)
    : undefined;
}

/** How a face reaches the page. `load` never throws: it resolves true
 *  when the face can be drawn, false when it cannot (offline, a bad
 *  file), and the caller draws the fallback either way. */
export interface FontLoader {
  ready(font: SubtitleFont): boolean;
  load(font: SubtitleFont): Promise<boolean>;
}

/** No face ever arrives — what a Node test, or an export with no loader
 *  handed in, runs against. */
export const NO_FONTS: FontLoader = {
  ready: () => false,
  load: async () => false,
};

/** The faces an export plan draws, once each, in first-use order — what
 *  the export must have loaded before its first frame. */
export function fontsInPlan(
  plan: readonly Pick<ExportFrame, 'subtitle'>[],
): SubtitleFont[] {
  const out: SubtitleFont[] = [];
  for (const f of plan) {
    const font = knownFont(f.subtitle?.font);
    if (font && !out.includes(font)) out.push(font);
  }
  return out;
}

// ---- SENTENCES ----

/** The choice's sentence, one full stop at the end whatever it carries.
 *  With a bold look (강조 / 외침) it also says the one thing the two
 *  choices do to each other: a face is drawn at its own weight, never the
 *  look's — the sentence is the only place that says so. With `loading`
 *  (the panel, while the file is on its way) it ends with the wait. */
export function describeFont(
  id: FontId,
  look: LookId = 'plain',
  loading = false,
): string {
  if (id === 'system') return '자막 글꼴을 기본으로 되돌렸어요.';
  const clauses = [`자막 글꼴을 ${toward(FONT_LABEL[id])} 바꿨어요`];
  if (look !== 'plain') {
    clauses.push(
      `${LOOK_LABEL[look]}의 굵은 글씨는 ${FONT_LABEL[id]} 본래 굵기로 보여요`,
    );
  }
  if (loading) clauses.push(FONT_LOADING_CLAUSE);
  return `${clauses.join(' · ')}.`;
}

export const SAME_FONT = (id: FontId) =>
  id === 'system'
    ? '이미 기본 글꼴이에요.'
    : `이미 ${FONT_LABEL[id]} 글꼴이에요.`;

/** The wait, as the choice's last clause (`describeFont`). */
const FONT_LOADING_CLAUSE = '글꼴을 받는 중이에요 · 받으면 바로 바뀌어요';
/** The preview's sentence when a reopened document names a face the page
 *  does not have yet (ADR-0018) — the same words, with the face named. */
export const FONT_FETCHING = (font: SubtitleFont) =>
  `${FONT_LABEL[font]} ${FONT_LOADING_CLAUSE}.`;
/** Pressing the face already chosen after its file failed to come. */
export const FONT_RETRYING = (font: SubtitleFont) =>
  `${FONT_LABEL[font]} 글꼴을 다시 받는 중이에요 · 받으면 바로 바뀌어요.`;
export const FONT_ARRIVED = (font: SubtitleFont) =>
  `${FONT_LABEL[font]} 글꼴을 받았어요.`;
export const FONT_FAILED = (font: SubtitleFont) =>
  `${FONT_LABEL[font]} 글꼴을 받지 못했어요 · 기본 글꼴로 보여요.`;
/** The export's warning for the faces it could not load. */
export function missingFontsText(fonts: readonly SubtitleFont[]): string {
  if (fonts.length === 0) return '';
  const names = fonts.map((f) => FONT_LABEL[f]).join(', ');
  return ` ⚠ ${names} 글꼴을 받지 못해 기본 글꼴로 그렸어요.`;
}
