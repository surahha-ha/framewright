// framewright — drawing a subtitle onto a picture.
//
// One function draws the words for BOTH the preview and the export, at
// whatever size the picture is, so the two can never disagree about where the
// words go or how big they are. Everything is relative to the picture's
// height: the font, the padding, the margin from the bottom edge. That is what
// makes the preview (drawn at the timeline's size, scaled by CSS) and the
// export (drawn at the timeline's size, encoded) the same image.
//
// The arithmetic — font size, line breaks, pill positions, where the block
// sits, how far an effect has moved it — is separated from the canvas calls
// so it can be unit-tested in Node with a fake measurer.
//
// Since ADR-0017 a subtitle may carry a LOOK (기본 / 강조 / 외침), a PLACE
// (the centre of its block as fractions of the box) and an EFFECT (a way in
// and out). Each is optional and each absent field draws exactly what every
// subtitle drew before: the plain look, the bottom stack, no motion.

import type { SubtitleEffect, SubtitleFont, SubtitleLook } from './types';
import { fontFamilyStack, knownFont } from './fonts';

/** How tall the words are, as a share of the picture's height. About 5% is
 *  where broadcast captions sit: readable on a phone, not a banner on a TV. */
const FONT_SHARE = 0.052;
/** Below this the words are dots. Only a very small picture reaches it. */
const MIN_FONT_PX = 12;
const LINE_HEIGHT = 1.35;
/** A pill may span at most this much of the width before the line wraps. */
const MAX_WIDTH_SHARE = 0.9;
/** Distance from the bottom edge to the bottom of the last pill — and, for
 *  a placed block, the least it keeps from any edge. */
const BOTTOM_SHARE = 0.06;

/** Set once for every draw. A system Korean face first, so 한글 and Latin
 *  come from the same family on Windows, macOS and Linux desktops. */
export const SUBTITLE_FONT_FAMILY =
  '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif';

export const SUBTITLE_GROUND = 'rgba(0, 0, 0, 0.62)';
export const SUBTITLE_INK = '#ffffff';
export const SUBTITLE_OUTLINE = '#000000';

/** What a look IS, in numbers relative to the plain subtitle. */
export interface SubtitleLookSpec {
  /** Font size as a multiple of the plain size. */
  fontScale: number;
  /** CSS font weight. */
  weight: number;
  ink: string;
  /** The pill behind each line, or null for none. */
  ground: string | null;
  /** Outline width as a share of the font size; 0 for none. */
  outlineShare: number;
}

/** The three looks. Keyed by the document's field plus 'plain' for absent,
 *  so a caller can index by `subtitle.look ?? 'plain'`. */
export const SUBTITLE_LOOKS: Record<'plain' | SubtitleLook, SubtitleLookSpec> =
  {
    plain: {
      fontScale: 1,
      weight: 600,
      ink: SUBTITLE_INK,
      ground: SUBTITLE_GROUND,
      outlineShare: 0,
    },
    bold: {
      fontScale: 1.4,
      weight: 800,
      ink: '#ffe14d',
      ground: null,
      outlineShare: 0.12,
    },
    shout: {
      fontScale: 1.8,
      weight: 800,
      ink: SUBTITLE_INK,
      ground: null,
      outlineShare: 0.18,
    },
  };

export interface SubtitleBox {
  width: number;
  height: number;
}

/** Where the block goes: fractions of the box for its centre. Either may
 *  be absent — see `Subtitle` in `types.ts`. */
export interface SubtitlePlace {
  posX?: number;
  posY?: number;
}

/** The draw's whole input for one frame: the words, how they look, where
 *  they sit, and how far in (or out) their effect is. Built once per frame
 *  by `subtitleStyle.subtitleFrameOf`, for both surfaces. */
export interface SubtitleFrame extends SubtitlePlace {
  text: string;
  look?: SubtitleLook;
  effect?: SubtitleEffect;
  /** The face (ADR-0018). Absent = the system stack. */
  font?: SubtitleFont;
  /** 0 → 1; 1 is fully shown. Always 1 without an effect. */
  t: number;
}

export interface SubtitleLine {
  text: string;
  /** Pill width, padding included. */
  widthPx: number;
  /** Pill's left edge. */
  x: number;
  /** Pill's top edge. */
  y: number;
}

export interface SubtitleLayout {
  fontPx: number;
  lineHeightPx: number;
  padX: number;
  bottomPx: number;
  lines: SubtitleLine[];
  /** The look's colours and outline, resolved, so the draw has no table. */
  ink: string;
  ground: string | null;
  outlinePx: number;
}

/** The plain look's font size. The other looks scale from this. */
export function subtitleFontPx(pictureHeight: number): number {
  return Math.max(MIN_FONT_PX, Math.round(pictureHeight * FONT_SHARE));
}

/** The look's spec, the plain one for a look this build does not know (a
 *  document from a later build, or a hand edit): the words must still draw. */
export function lookSpec(look?: SubtitleLook): SubtitleLookSpec {
  return (look && SUBTITLE_LOOKS[look]) || SUBTITLE_LOOKS.plain;
}

export function lookFontPx(pictureHeight: number, look?: SubtitleLook): number {
  return Math.round(subtitleFontPx(pictureHeight) * lookSpec(look).fontScale);
}

/**
 * Break the text into drawable lines. The user's own line breaks are kept;
 * a line wider than `maxWidthPx` is wrapped at spaces, and a run with no
 * spaces at all (ordinary for 한글) is broken between characters rather than
 * being allowed to run off the picture.
 */
export function wrapSubtitle(
  text: string,
  maxWidthPx: number,
  measure: (s: string) => number,
): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (measure(line) <= maxWidthPx) {
      out.push(line);
      continue;
    }
    let current = '';
    const push = () => {
      if (current) out.push(current);
      current = '';
    };
    for (const word of line.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate) <= maxWidthPx) {
        current = candidate;
        continue;
      }
      push();
      if (measure(word) <= maxWidthPx) {
        current = word;
        continue;
      }
      // One word wider than the whole line: break it wherever it fits.
      for (const ch of Array.from(word)) {
        const next = current + ch;
        if (current && measure(next) > maxWidthPx) push();
        current += ch;
      }
    }
    push();
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/**
 * Where every pill goes. Null when there is nothing to draw. `measure` must
 * measure in the look's font — the draw sets `ctx.font` first.
 *
 * With no place, the lines stack upward from the bottom margin, centred:
 * the layout every subtitle had. With a place, the block's centre goes to
 * the fractions given (each axis on its own: `posY` absent keeps the
 * bottom stack, `posX` absent keeps the centre), and the block is kept a
 * margin inside the box — a block taller than the room is centred rather
 * than pushed off an edge.
 */
export function layoutSubtitle(
  text: string,
  box: SubtitleBox,
  measure: (s: string) => number,
  look?: SubtitleLook,
  place: SubtitlePlace = {},
): SubtitleLayout | null {
  const spec = lookSpec(look);
  const fontPx = lookFontPx(box.height, look);
  const lineHeightPx = Math.round(fontPx * LINE_HEIGHT);
  const padX = Math.round(fontPx * 0.4);
  const bottomPx = Math.round(box.height * BOTTOM_SHARE);
  const maxTextPx = box.width * MAX_WIDTH_SHARE - 2 * padX;
  const lines = wrapSubtitle(text, maxTextPx, measure);
  if (lines.length === 0) return null;
  const blockPx = lines.length * lineHeightPx;
  let top: number;
  if (place.posY === undefined) {
    top = box.height - bottomPx - blockPx;
  } else {
    const wanted = Math.round(place.posY * box.height - blockPx / 2);
    const lo = bottomPx;
    const hi = box.height - bottomPx - blockPx;
    top =
      hi < lo ? Math.round((box.height - blockPx) / 2) : clamp(wanted, lo, hi);
  }
  const cx = (place.posX ?? 0.5) * box.width;
  const placed: SubtitleLine[] = lines.map((line, i) => {
    const widthPx = Math.round(measure(line) + 2 * padX);
    return {
      text: line,
      widthPx,
      x: clamp(
        Math.round(cx - widthPx / 2),
        0,
        Math.max(0, box.width - widthPx),
      ),
      y: top + i * lineHeightPx,
    };
  });
  return {
    fontPx,
    lineHeightPx,
    padX,
    bottomPx,
    lines: placed,
    ink: spec.ink,
    ground: spec.ground,
    outlinePx: Math.round(fontPx * spec.outlineShare),
  };
}

/** The block's bounding box, from a layout: what an effect scales about. */
export function layoutBounds(layout: SubtitleLayout): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const l of layout.lines) {
    left = Math.min(left, l.x);
    right = Math.max(right, l.x + l.widthPx);
    top = Math.min(top, l.y);
    bottom = Math.max(bottom, l.y + layout.lineHeightPx);
  }
  return { left, top, right, bottom };
}

/** What an effect does to the block at progress `t`: an alpha, a scale
 *  about the block's centre, and a shift. Identity at t = 1. */
export interface EffectState {
  alpha: number;
  scale: number;
  dx: number;
  dy: number;
  /** The point the scale is about. */
  cx: number;
  cy: number;
}

/** Ease-out: fast at first, settling — the shape of something arriving. */
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

/** 톡 starts at this share of full size. */
const POP_FROM = 0.6;
/** 올라오기 starts this share of the box height below its place. */
const RISE_SHARE = 0.06;

export function effectState(
  effect: SubtitleEffect | undefined,
  t: number,
  layout: SubtitleLayout,
  pictureHeight: number,
): EffectState {
  const b = layoutBounds(layout);
  const state: EffectState = {
    alpha: 1,
    scale: 1,
    dx: 0,
    dy: 0,
    cx: (b.left + b.right) / 2,
    cy: (b.top + b.bottom) / 2,
  };
  if (!effect || t >= 1) return state;
  const k = clamp(t, 0, 1);
  switch (effect) {
    case 'fade':
      state.alpha = k;
      break;
    case 'pop':
      state.scale = POP_FROM + (1 - POP_FROM) * easeOut(k);
      break;
    case 'rise':
      state.dy = Math.round((1 - easeOut(k)) * RISE_SHARE * pictureHeight);
      break;
  }
  return state;
}

/** The 2D context both a `<canvas>` and an `OffscreenCanvas` hand out. */
export type SubtitleContext =
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * The canvas font string. A face (ADR-0018) goes before the system stack,
 * and is always drawn at weight 400: the look's weight is for the system
 * stack, and a brush face thickened by a synthetic bold is not the face.
 * A face this build does not know is the system stack at the look's weight.
 */
export function subtitleFont(
  fontPx: number,
  weight = 600,
  font?: SubtitleFont,
): string {
  const face = knownFont(font);
  return `${face ? 400 : weight} ${fontPx}px ${fontFamilyStack(face, SUBTITLE_FONT_FAMILY)}`;
}

/**
 * Draw the words onto a picture of the given size. Draws nothing for blank
 * text. The caller owns the canvas: this neither clears it nor, when there
 * is no effect to apply, saves state — a plain subtitle goes through exactly
 * the calls it always did. An effect is applied inside a save/restore, so
 * the caller's alpha and transform come back as they were.
 */
export function drawSubtitle(
  ctx: SubtitleContext,
  frame: SubtitleFrame,
  width: number,
  height: number,
): void {
  const spec = lookSpec(frame.look);
  const fontPx = lookFontPx(height, frame.look);
  ctx.font = subtitleFont(fontPx, spec.weight, frame.font);
  const layout = layoutSubtitle(
    frame.text,
    { width, height },
    (s) => ctx.measureText(s).width,
    frame.look,
    frame,
  );
  if (!layout) return;
  const moving = !!frame.effect && frame.t < 1;
  if (moving) {
    const e = effectState(frame.effect, frame.t, layout, height);
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * e.alpha;
    ctx.translate(e.cx + e.dx, e.cy + e.dy);
    ctx.scale(e.scale, e.scale);
    ctx.translate(-e.cx, -e.cy);
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const line of layout.lines) {
    const x = line.x + layout.padX;
    const y = line.y + layout.lineHeightPx / 2;
    if (layout.ground) {
      ctx.fillStyle = layout.ground;
      ctx.fillRect(line.x, line.y, line.widthPx, layout.lineHeightPx);
    }
    if (layout.outlinePx > 0) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = layout.outlinePx;
      ctx.strokeStyle = SUBTITLE_OUTLINE;
      ctx.strokeText(line.text, x, y);
    }
    ctx.fillStyle = layout.ink;
    ctx.fillText(line.text, x, y);
  }
  if (moving) ctx.restore();
}
