// framewright — a subtitle's look, place and effect (pure, ADR-0017).
//
// 예능 자막: the variety-show caption. Three named looks, three named places
// and three ways in and out, each an optional field on the subtitle, each
// absent for the subtitle every project had before. This module is the
// vocabulary (ids, labels, the sentences) and the ONE piece of arithmetic
// that is about time rather than pixels: how far into its way in or out a
// subtitle is on a given frame. The pixels are `subtitleRender.ts`.
//
// `subtitleFrameAt` is the one answer to "what do the words look like on
// frame N": the export plan records it per frame and the preview builds the
// same object, so the two surfaces cannot disagree (ADR-0011's rule, kept).

import type { Project, Subtitle, SubtitleEffect, SubtitleLook } from './types';
import type { Rational } from './types';
import { secToFrame } from './time';
import { subtitleAt } from './subtitles';
import type { SubtitleFrame } from './subtitleRender';

// ---- LOOKS ----

export type LookId = 'plain' | SubtitleLook;
export const LOOK_IDS: LookId[] = ['plain', 'bold', 'shout'];
export const LOOK_LABEL: Record<LookId, string> = {
  plain: '기본',
  bold: '강조',
  shout: '외침',
};
/** One line each, for a hover: what the look IS, since the word cannot say. */
export const LOOK_HINT: Record<LookId, string> = {
  plain: '흰 글자에 어두운 바탕',
  bold: '노란 글자에 검은 테두리, 조금 크게',
  shout: '흰 글자에 굵은 검은 테두리, 크게',
};

export function lookOf(s: Pick<Subtitle, 'look'>): LookId {
  return s.look ?? 'plain';
}

/** What the document stores for a look id: nothing for 기본. */
export function lookField(id: LookId): SubtitleLook | undefined {
  return id === 'plain' ? undefined : id;
}

// ---- PLACES ----

export type PlaceId = 'bottom' | 'middle' | 'top';
export const PLACE_IDS: PlaceId[] = ['bottom', 'middle', 'top'];
export const PLACE_LABEL: Record<PlaceId, string> = {
  bottom: '아래',
  middle: '가운데',
  top: '위',
};
/** The centre of the block, as a fraction of the box height, per place.
 *  아래 is not a number: it is the bottom-margin stack the renderer always
 *  had, and stays absent so an old document and a new one draw alike. */
const PLACE_Y: Record<Exclude<PlaceId, 'bottom'>, number> = {
  middle: 0.5,
  top: 0.15,
};

/** From here down, `posY` IS the bottom stack: the renderer clamps a placed
 *  block into the bottom margin, so it draws where the absent field draws.
 *  The normal form (`subtitlePosition.ts`) stores such a value as absent;
 *  a document that holds one anyway (a hand edit) is read the same way. */
export const BOTTOM_FROM = 0.97;
export function isBottomY(posY: number | undefined): boolean {
  return posY !== undefined && posY >= BOTTOM_FROM;
}

/** Which preset the subtitle's place is, or null when it is somewhere a
 *  preset does not name (a drag on the picture, E8-2c). An absent `posX`
 *  is the centre, as the renderer reads it — the presets write 0.5, the
 *  drag's normal form writes nothing (`subtitlePosition.ts`), and both
 *  are 가운데. */
export function placeOf(s: Pick<Subtitle, 'posX' | 'posY'>): PlaceId | null {
  // By VALUE: an absent posX is the centre, a posY from the bottom's
  // threshold up is the bottom stack — however the document spells them.
  const posX = s.posX ?? 0.5;
  const posY = isBottomY(s.posY) ? undefined : s.posY;
  if (posX !== 0.5) return null;
  if (posY === undefined) return 'bottom';
  for (const id of ['middle', 'top'] as const) {
    if (posY === PLACE_Y[id]) return id;
  }
  return null;
}

/** What the document stores for a place id. */
export function placeFields(id: PlaceId): Pick<Subtitle, 'posX' | 'posY'> {
  return id === 'bottom'
    ? { posX: undefined, posY: undefined }
    : { posX: 0.5, posY: PLACE_Y[id] };
}

// ---- EFFECTS ----

export type EffectId = 'none' | SubtitleEffect;
export const EFFECT_IDS: EffectId[] = ['none', 'fade', 'pop', 'rise'];
export const EFFECT_LABEL: Record<EffectId, string> = {
  none: '바로',
  fade: '서서히',
  pop: '톡',
  rise: '올라오기',
};
export const EFFECT_HINT: Record<EffectId, string> = {
  none: '효과 없이 바로 나타나요',
  fade: '서서히 나타났다가 서서히 사라져요',
  pop: '작았다가 톡 커지며 나타나요',
  rise: '아래에서 올라오며 나타나요',
};

export function effectOf(s: Pick<Subtitle, 'effect'>): EffectId {
  return s.effect ?? 'none';
}

export function effectField(id: EffectId): SubtitleEffect | undefined {
  return id === 'none' ? undefined : id;
}

/** How long the way in (and the way out) takes. A caption effect longer
 *  than this reads as a title card. An engine constant, not a setting. */
export const EFFECT_SEC = 0.25;

/**
 * The effect's length in frames for this subtitle: `EFFECT_SEC` at this
 * fps, never less than one frame, and never more than half the subtitle —
 * so the way in and the way out cannot overlap, and a subtitle is always
 * fully shown for at least the middle of its life.
 */
export function effectFrames(
  s: Pick<Subtitle, 'startFrame' | 'endFrame'>,
  fps: Rational,
): number {
  const wanted = Math.max(1, secToFrame(EFFECT_SEC, fps));
  return Math.min(wanted, Math.floor((s.endFrame - s.startFrame) / 2));
}

/**
 * How far along the effect is on `frame`, 0 → 1, where 1 is fully shown.
 * Rises over the first `n` frames, holds at 1, falls over the last `n`,
 * mirrored: the first frame and the last frame both show `1 / n`, so every
 * frame the subtitle owns shows SOMETHING. 1 on every frame when there is no
 * effect, or no room for one (a one-frame subtitle).
 */
export function subtitlePhase(
  s: Subtitle,
  frame: number,
  fps: Rational,
): number {
  if (!s.effect) return 1;
  const n = effectFrames(s, fps);
  if (n <= 0) return 1;
  const enter = (frame - s.startFrame + 1) / n;
  const exit = (s.endFrame - frame) / n;
  return Math.max(0, Math.min(1, enter, exit));
}

/**
 * The words as they look on `frame` — the draw's whole input. `text` may be
 * substituted (the preview shows the draft being typed); everything else
 * comes from the subtitle. Only the fields the subtitle has are present, so
 * a plain subtitle's frame is `{ text, t: 1 }` and nothing else.
 */
export function subtitleFrameOf(
  s: Subtitle,
  frame: number,
  fps: Rational,
  text: string = s.text,
): SubtitleFrame {
  return {
    text,
    ...(s.look !== undefined ? { look: s.look } : {}),
    ...(s.posX !== undefined ? { posX: s.posX } : {}),
    ...(s.posY !== undefined ? { posY: s.posY } : {}),
    ...(s.effect !== undefined ? { effect: s.effect } : {}),
    ...(s.font !== undefined ? { font: s.font } : {}),
    t: subtitlePhase(s, frame, fps),
  };
}

/** What frame `frame` shows, or null: no subtitle there, or one with no
 *  words (never drawn, never exported). */
export function subtitleFrameAt(
  project: Project,
  frame: number,
): SubtitleFrame | null {
  const s = subtitleAt(project, frame);
  if (!s || !s.text.length) return null;
  return subtitleFrameOf(s, frame, project.timeline.fps);
}

// ---- SENTENCES ----

/**
 * The word plus 로 / 으로: 로 after a vowel or ㄹ (위로, 아래로, 글로), 으로
 * after any other final consonant (톡으로, 외침으로, 기본으로). The e2e
 * caught "톡로" on the first run; the rule lives here so every sentence
 * that names a choice gets it right.
 */
export function toward(word: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return `${word}로`;
  const final = (code - 0xac00) % 28;
  return final === 0 || final === 8 ? `${word}로` : `${word}으로`;
}

export function describeLook(id: LookId): string {
  return id === 'plain'
    ? '자막 모양을 기본으로 되돌렸어요.'
    : `자막 모양을 ${toward(LOOK_LABEL[id])} 바꿨어요.`;
}

export function describePlace(id: PlaceId): string {
  return id === 'bottom'
    ? '자막 자리를 아래로 되돌렸어요.'
    : `자막 자리를 ${toward(PLACE_LABEL[id])} 옮겼어요.`;
}

/** The effect's sentence carries what the effect IS: unlike a look or a
 *  place, an effect shows only on the frames where the subtitle comes and
 *  goes, so on most frames the status line is the only proof it changed
 *  (novice review). */
export function describeEffect(id: EffectId): string {
  return id === 'none'
    ? '자막 효과를 없앴어요 · 바로 나타나요.'
    : `자막 효과를 ${toward(EFFECT_LABEL[id])} 바꿨어요 · ${EFFECT_HINT[id]}.`;
}

/** Why pressing the choice that is already chosen changes nothing. */
export const SAME_LOOK = (id: LookId) => `이미 ${LOOK_LABEL[id]} 모양이에요.`;
export const SAME_PLACE = (id: PlaceId) => `이미 ${PLACE_LABEL[id]}에 있어요.`;
export const SAME_EFFECT = (id: EffectId) =>
  id === 'none' ? '이미 효과가 없어요.' : `이미 ${EFFECT_LABEL[id]} 효과예요.`;
