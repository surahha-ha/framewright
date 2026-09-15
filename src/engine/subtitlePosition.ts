// framewright — where the words are put by hand (E8-2c, ADR-0019).
//
// A subtitle's place is the centre of its block as fractions of the box
// (ADR-0017); the three presets are three values of it. A drag on the
// stage and two sliders in the panel write ANY value — through this
// module, so all three speak one language:
//
// - the NORMAL FORM the document stores: whole percents, and the preset
//   values as ABSENT fields (`posX` 0.5 is what the renderer uses when the
//   field is absent; `posY` at the bottom margin draws exactly where the
//   absent field draws, because `layoutSubtitle` clamps a placed block into
//   that margin) — so a drop on a preset IS the preset, byte for byte, and
//   `placeOf` lights its radio;
// - the SNAP near a preset, applied once at the drop;
// - the sentences, and the slider's numbers.
//
// The gesture itself is the preview's (`ui/Preview.tsx`); nothing here
// knows a pointer.

import type { Subtitle } from './types';
import { describePlace, isBottomY, placeOf } from './subtitleStyle';
import { layoutBounds, type SubtitleLayout } from './subtitleRender';

export type Position = Pick<Subtitle, 'posX' | 'posY'>;

/** How close to a preset's value (a fraction of the box) a drop snaps. */
export const SNAP = 0.03;
const CENTRE_X = 0.5;
const PRESET_Y = [0.15, 0.5];

function percent(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
}

/** The form the document stores (see the header). */
export function normalizePosition(p: {
  posX?: number;
  posY?: number;
}): Position {
  const x = p.posX === undefined ? undefined : percent(p.posX);
  const y = p.posY === undefined ? undefined : percent(p.posY);
  return {
    posX: x === CENTRE_X ? undefined : x,
    posY: isBottomY(y) ? undefined : y,
  };
}

function near(v: number, target: number): boolean {
  return Math.abs(v - target) <= SNAP;
}

/**
 * The drop: each axis pulled to a preset value it is within `SNAP` of —
 * `posX` to the centre; `posY` to 위, 가운데, or the bottom stack's own
 * centre (`bottomCentreY`, which depends on the block: the caller
 * measures it with `layoutSubtitle` and no `posY`). Returns the normal
 * form.
 */
export function snapPosition(
  p: { posX: number; posY: number },
  bottomCentreY: number,
): Position {
  const posX = near(p.posX, CENTRE_X) ? CENTRE_X : p.posX;
  let posY: number | undefined = p.posY;
  if (near(p.posY, bottomCentreY)) posY = undefined;
  else {
    for (const y of PRESET_Y) if (near(p.posY, y)) posY = y;
  }
  return normalizePosition({ posX, posY });
}

/** The centre of the block a layout draws, as a fraction of the box —
 *  measured on the bottom stack's layout, the value `snapPosition`
 *  compares a drop against. */
export function bottomCentreY(layout: SubtitleLayout, boxHeight: number) {
  const b = layoutBounds(layout);
  return (b.top + b.bottom) / 2 / boxHeight;
}

// ---- SENTENCES ----

/** One axis in words — the slider's value as a screen reader hears it. */
export function positionXText(posX: number | undefined): string {
  // 가로 가운데, not 가운데: that word alone is the vertical preset's name,
  // and "가운데 · 위에서 63%" read as the preset to a first-time user.
  return posX === undefined
    ? '가로 가운데'
    : `왼쪽에서 ${Math.round(posX * 100)}%`;
}
export function positionYText(posY: number | undefined): string {
  // A stored value from the bottom's threshold up draws at the bottom
  // (`isBottomY`), so it is said as the bottom, not as "위에서 98%".
  return posY === undefined || isBottomY(posY)
    ? '맨 아래'
    : `위에서 ${Math.round(posY * 100)}%`;
}

/** Where the words are, without a verb: the row's sentence. */
export function positionText(p: Position): string {
  return `${positionXText(p.posX)} · ${positionYText(p.posY)}`;
}

/** The move's sentence: the preset's own when the position is one. */
export function describePosition(p: Position): string {
  const preset = placeOf(p);
  return preset
    ? describePlace(preset)
    : `자막을 옮겼어요 · ${positionText(p)}.`;
}

// ---- SLIDERS ----

/** 0–100 each; the absent fields read as 50 (centre) and 100 (bottom). */
export function sliderOfPosition(p: Position): { x: number; y: number } {
  return {
    x: p.posX === undefined ? 50 : Math.round(p.posX * 100),
    y: p.posY === undefined ? 100 : Math.round(p.posY * 100),
  };
}

export function positionOfSlider(x: number, y: number): Position {
  return normalizePosition({ posX: x / 100, posY: y / 100 });
}
