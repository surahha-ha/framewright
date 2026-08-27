// framewright — where a clip's thumbnails go (pure).
//
// A thumbnail strip is the same shape as the ruler's ticks: given a visible
// frame range and a pixels-per-frame, which marks do I draw? That is why the
// coordinate system came first (ADR-0010). What is different here is that each
// mark costs a DECODE, so two things this module owns are not cosmetic:
//
//   - the count is bounded by the WINDOW, not by the clip. A ten-minute clip
//     zoomed to 40px per frame is 18,000 frames wide; asking for a picture per
//     frame would decode for a minute and pin the tab.
//   - the grid is anchored to the CLIP and steps by a power of two, so scrolling
//     asks for the same frames again (cache hits) and zooming out by one step —
//     which is x2 — keeps every other picture instead of throwing the cache away.
//
// The decode and the drawing live in the UI (`src/ui/thumbnails.ts`); no
// WebCodecs, no DOM, no React here. This module is a sibling of `timelineView`
// rather than part of it because the waveform is next and wants its own answer
// to the same question — combine them when there are three, not two.

import { frameAtX, frameToX, type View } from './timelineView';

/**
 * How wide one thumbnail is drawn, in CSS pixels.
 *
 * A clip is 44px tall (56px track, 6px inset each side) less its border, so a
 * 16:9 picture filling that height is about 74px. 72 keeps a whole number of
 * them across common widths and is the same as `MIN_MAJOR_TICK_PX` by
 * coincidence, not by rule.
 */
export const THUMB_PX = 72;

/** Same reason as `xToFrame`'s: `x / scale` is not exact in binary, and the
 *  boundary being tested here is one the strip itself drew. */
const BOUNDARY_EPSILON = 1e-9;

/** One picture's place on the strip. */
export interface ThumbSlot {
  /** Timeline frame the picture is of — the slot's leading edge. */
  frame: number;
  /** Frame within the (conformed) source media. What the cache is keyed on. */
  sourceFrame: number;
  /** Left edge, in pixels from the STRIP's origin (not the clip's, not the
   *  document's) — so the component can draw straight onto its canvas. */
  x: number;
  /** How wide this slot is. The last one is short when the clip ends inside it. */
  widthPx: number;
}

export interface ThumbStrip {
  /** Where the strip starts, in pixels from the CLIP's left edge. */
  offsetPx: number;
  /** How wide the strip is. Bounded by the window plus at most one slot. */
  widthPx: number;
  /** How many timeline frames one picture stands for. Always a power of two. */
  step: number;
  slots: ThumbSlot[];
}

/** The clip, in the only terms this module needs. */
export interface ThumbSpan {
  /** Timeline frame the clip starts on. */
  start: number;
  /** How many frames long it is. Half-open, like everything else. */
  length: number;
  /** The clip's in-point within its source. */
  inFrame: number;
}

/**
 * Frames per picture: the smallest power of two that still draws each one at
 * least `THUMB_PX` wide.
 *
 * Power of two is the whole cache strategy. `ZOOM_STEP` is 2, so a zoom press
 * either doubles or halves this, and the coarser grid is a subset of the finer
 * one — every other picture is already decoded. Rounding to, say, "a nice round
 * number of frames" instead would land on a different set at every zoom and
 * make each press a full re-decode of the visible strip.
 */
export function thumbStep(scale: number, thumbPx = THUMB_PX): number {
  if (!(scale > 0)) return 1;
  const wanted = thumbPx / scale;
  if (!(wanted > 1)) return 1; // a frame is already wider than a picture
  return 2 ** Math.ceil(Math.log2(wanted));
}

/**
 * The pictures to draw for one clip, or `null` when there are none — the clip
 * is off screen, has no length, or the strip has not been measured yet.
 *
 * Positions are the clip's own coordinates so the result can be drawn on a
 * canvas parented to the clip button. That canvas is at most a window wide,
 * whatever the zoom, which is the other half of the bound above: nothing here
 * ever grows with the document.
 */
export function thumbStrip(
  view: View,
  clip: ThumbSpan,
  thumbPx = THUMB_PX,
): ThumbStrip | null {
  if (!(view.scale > 0) || view.widthPx <= 0) return null;
  if (!(clip.length > 0)) return null;

  const clipStart = clip.start;
  const clipEnd = clip.start + clip.length;
  // In frames, because the pixel form of the same comparison drifts: the strip
  // is laid out from these numbers, so a rounding difference here shows up as a
  // picture drawn a pixel outside the clip that owns it.
  const fromFrame = Math.max(clipStart, frameAtX(view, view.scrollPx));
  const toFrame = Math.min(
    clipEnd,
    frameAtX(view, view.scrollPx + view.widthPx),
  );
  if (toFrame <= fromFrame) return null;

  const step = thumbStep(view.scale, thumbPx);
  const lastIndex = Math.ceil(clip.length / step) - 1;
  const first = Math.max(0, Math.floor((fromFrame - clipStart) / step));
  // The half-open end: a clip ending exactly on a slot boundary must not get an
  // extra empty slot after it.
  const last = Math.min(
    lastIndex,
    Math.floor((toFrame - clipStart - BOUNDARY_EPSILON) / step),
  );
  if (last < first) return null;

  const originFrame = clipStart + first * step;
  const offsetPx = frameToX(view, originFrame) - frameToX(view, clipStart);
  const slots: ThumbSlot[] = [];
  for (let k = first; k <= last; k++) {
    const frame = clipStart + k * step;
    const end = Math.min(clipEnd, frame + step);
    slots.push({
      frame,
      sourceFrame: clip.inFrame + k * step,
      x: frameToX(view, frame) - frameToX(view, originFrame),
      widthPx: frameToX(view, end - frame),
    });
  }
  const tail = slots[slots.length - 1];
  return { offsetPx, widthPx: tail.x + tail.widthPx, step, slots };
}
