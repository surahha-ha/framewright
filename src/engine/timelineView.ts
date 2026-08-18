// framewright — the timeline's coordinate system (pure).
//
// The timeline used to have no scale of its own. Every position was a percentage
// of the container (`frames / documentLength * 100`), which meant one pixel was
// worth a different number of frames in every document, the scale moved whenever
// the document got longer, and zoom could not be expressed at all.
//
// Here the timeline has ONE scale — pixels per frame — and a scroll offset, and
// everything else is derived from those two numbers. That is what makes ruler
// ticks, thumbnails and a waveform cheap: each of them is "given a visible frame
// range and a pixels-per-frame, what do I draw".
//
// This lives in the engine, like `drag.ts` and for the same reason: the parts
// that are easy to get subtly wrong (an anchor that drifts a frame per zoom
// step, a tick ladder that slides off the timecode it is labelled with, a scroll
// that can run past the document) are invisible in a screenshot and cheap to
// pin down in Node.

import { secToFrame } from './time';
import type { Rational } from './types';

/**
 * How magnified the strip is — everything that does NOT depend on where it
 * happens to be scrolled to. Split out so a caller that only knows the zoom
 * (the toolbar action deciding whether zooming in is still possible) does not
 * have to invent a scroll position it cannot see.
 */
export interface Zoom {
  /** Document length in frames. Half-open, so frame `total` is the end edge. */
  total: number;
  /** Width of the visible strip, in CSS pixels. */
  widthPx: number;
  /** Pixels per frame. */
  scale: number;
}

/**
 * The whole view state: the zoom, plus how far along it is scrolled.
 *
 * `scrollPx` and every x this module returns are CONTENT pixels — measured from
 * the start of the document, not from the left edge of the screen. That is what
 * the browser's own scroll container works in, so the component can hand the
 * DOM's `scrollLeft` straight back without a second coordinate system.
 */
export interface View extends Zoom {
  /** How much content has been scrolled off to the left, in pixels. */
  scrollPx: number;
}

/**
 * How far in zoom goes. At 40 px/frame a single frame is a comfortable click
 * target and a ruler tick can be drawn on every one of them; magnifying further
 * shows nothing new.
 */
export const MAX_SCALE = 40;

/** One press of zoom in/out. */
export const ZOOM_STEP = 2;

/** A labelled tick carries a timecode ("00:05:00") and needs room for it. */
export const MIN_MAJOR_TICK_PX = 72;

/**
 * An unlabelled tick is a hairline; below this they read as a grey band rather
 * than as marks you could count. Set by looking at it: at 9px a ten-minute
 * document drew a comb across the whole ruler, at 14 the same document gets a
 * mark every six seconds and a three-second one still gets one per frame.
 */
export const MIN_MINOR_TICK_PX = 14;

/** How much of the strip is kept between the playhead and the edge it is near. */
const FOLLOW_MARGIN_PX = 24;

/** The scale at which the whole document exactly fills the strip. */
export function fitScale(total: number, widthPx: number): number {
  // An empty document has no length to fit, but a click on it still has to
  // resolve to a frame. One frame per strip is arbitrary and harmless; a scale
  // of zero would divide by zero on the very first pointer event.
  return widthPx / Math.max(1, total);
}

/**
 * The scale, kept inside what is useful.
 *
 * The floor is the fitted scale — you can never zoom out past the whole
 * document, so there is no state where the timeline is a small thing floating
 * in an empty strip. The floor also WINS over the ceiling: a five-frame
 * document already fills 900px at 180 px/frame, and clamping that down to
 * `MAX_SCALE` would pull it away from the edges it has always filled.
 */
export function clampScale(
  scale: number,
  total: number,
  widthPx: number,
): number {
  const fit = fitScale(total, widthPx);
  return Math.min(Math.max(fit, MAX_SCALE), Math.max(fit, scale));
}

/** The scale one press of zoom in/out lands on. */
export function zoomedScale(view: Zoom, direction: 'in' | 'out'): number {
  const wanted =
    direction === 'in' ? view.scale * ZOOM_STEP : view.scale / ZOOM_STEP;
  return clampScale(wanted, view.total, view.widthPx);
}

/** How wide the scrolled content is. Never narrower than the strip itself. */
export function contentWidth(view: Zoom): number {
  return Math.max(view.widthPx, view.total * view.scale);
}

/** Where a frame's leading edge is drawn, in content pixels. */
export function frameToX(view: Zoom, frame: number): number {
  return frame * view.scale;
}

/**
 * Which frame is at this content x — FRACTIONAL, on purpose.
 *
 * Rounding here and then using the result as a zoom anchor is exactly how a
 * timeline walks away from the frame the user pointed at after a few steps.
 * Use `xToFrame` when the answer has to be a real frame of the document.
 */
export function frameAtX(view: Zoom, x: number): number {
  return view.scale > 0 ? x / view.scale : 0;
}

/**
 * The frame a click at this content x means. One rounding rule, floor — plus a
 * whisker, and the whisker is not decoration.
 *
 * `x / scale` is not exact in binary. 30 frames fitted across 301px draws frame
 * 29 at x = 290.9666…, and dividing that back by the same scale gives
 * 28.999999999999996 — so flooring puts the playhead one frame BEFORE the
 * boundary the timeline itself drew. A sweep of ordinary strip widths (300 to
 * 2000px) against ordinary document lengths finds two thousand such pairs, so
 * this is the common case, not a corner. The tolerance is nine orders of
 * magnitude below one frame: it can never merge two frames a user could tell
 * apart.
 */
const BOUNDARY_EPSILON = 1e-9;

export function xToFrame(view: Zoom, x: number): number {
  const last = Math.max(0, view.total - 1);
  const exact = frameAtX(view, x) + BOUNDARY_EPSILON;
  // `Math.max(0, NaN)` is NaN, not 0. This answer goes straight to `seekTo`,
  // and a playhead at NaN is a document that has stopped agreeing with itself.
  if (Number.isNaN(exact)) return 0;
  return Math.min(last, Math.max(0, Math.floor(exact)));
}

/**
 * Pointer travel, in frames. The drag is the one gesture that works in deltas
 * rather than positions, and it used to do this division in the component —
 * which put the conversion this module exists to own in two places.
 */
export function deltaFrames(view: Zoom, dx: number): number {
  if (!(view.scale > 0)) return 0;
  return Math.round(dx / view.scale);
}

/** How much footage the strip can show at once, in frames. What a zoom READOUT
 *  is about: unlike `visibleRange` this is the window, not the window clipped
 *  to the document, so it does not change as the document grows. */
export function visibleSpan(view: Zoom): number {
  return view.scale > 0 ? view.widthPx / view.scale : 0;
}

/** The furthest the strip can be scrolled. Zero when everything already fits. */
export function maxScroll(view: Zoom): number {
  return Math.max(0, contentWidth(view) - view.widthPx);
}

export function clampScroll(view: Zoom, scrollPx: number): number {
  return Math.min(maxScroll(view), Math.max(0, scrollPx));
}

/** The frames currently on screen, half-open `[from, to)` like everything else. */
export function visibleRange(view: View): { from: number; to: number } {
  if (view.total <= 0) return { from: 0, to: 0 };
  const from = Math.max(0, Math.floor(frameAtX(view, view.scrollPx)));
  const to = Math.min(
    view.total,
    Math.ceil(frameAtX(view, view.scrollPx + view.widthPx)),
  );
  return { from: Math.min(from, view.total), to: Math.max(from, to) };
}

/**
 * Put a frame in the middle of the strip. This is what a zoom step uses: after
 * changing the scale, "keep looking at what I was looking at" is a promise the
 * minimum-movement rule below cannot make — it would leave the frame pinned
 * against whichever edge it happened to be nearest.
 */
export function centerOn(view: Zoom, frame: number): number {
  const middleOfFrame = frameToX(view, frame) + view.scale / 2;
  return clampScroll(view, middleOfFrame - view.widthPx / 2);
}

/**
 * Scroll only as far as it takes to bring a frame back on screen, and not at
 * all while it is comfortably inside. Called on every playhead move: nudging
 * the scroll by a pixel per frame during playback makes the strip shimmer.
 */
export function keepVisible(
  view: View,
  frame: number,
  marginPx = FOLLOW_MARGIN_PX,
): number {
  // A margin wider than half the strip would make the two rules fight.
  const margin = Math.min(marginPx, view.widthPx / 4);
  const x = frameToX(view, frame);
  const left = view.scrollPx + margin;
  const right = view.scrollPx + view.widthPx - margin;
  if (x < left) return clampScroll(view, x - margin);
  if (x + view.scale > right) {
    return clampScroll(view, x + view.scale - view.widthPx + margin);
  }
  return clampScroll(view, view.scrollPx);
}

/** A mark on the ruler. Major ones carry a timecode; minor ones are hairlines. */
export interface Tick {
  frame: number;
  major: boolean;
}

/**
 * Steps a LABELLED mark may be spaced at, in frames, smallest first.
 *
 * Whole seconds only, and built from the frame rate rather than hardcoded, so a
 * label always lands on a second the clock can name: at 29.97 a "one second"
 * step is 30 frames, and a ruler stepping by 29.97 would slide off the time
 * written under it. Nothing below a second is a candidate — a sub-second step
 * would print the same "0:03" several times in a row, and the frames-within-a-
 * second format that could tell them apart is the one this ruler deliberately
 * does not use (see `formatClock`).
 */
function ladder(fps: Rational): number[] {
  const seconds = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const steps = seconds.map((s) => secToFrame(s, fps));
  return [...new Set(steps)].sort((a, b) => a - b);
}

/**
 * How far apart the labelled and unlabelled marks go at this zoom.
 *
 * The unlabelled ones are where the sub-second structure lives, so they go as
 * FINE as they can while staying readable — right down to one mark per frame
 * once a frame is wide enough to see.
 */
export function tickSteps(
  view: Zoom,
  fps: Rational,
): { major: number; minor: number } {
  const steps = ladder(fps);
  const major =
    steps.find((s) => s * view.scale >= MIN_MAJOR_TICK_PX) ??
    steps[steps.length - 1];
  // A minor step must DIVIDE the major one, or the small marks drift against
  // the labelled ones and the ruler reads as two rulers laid over each other.
  const minor =
    [30, 15, 10, 5, 4, 2]
      .filter((n) => major % n === 0)
      .map((n) => major / n)
      .sort((a, b) => a - b)
      .find((s) => s >= 1 && s * view.scale >= MIN_MINOR_TICK_PX) ?? 0;
  return { major, minor };
}

/**
 * The marks to draw — only the ones on screen. An hour of 30fps footage is
 * 108,000 frames; building a tick for each and letting the DOM sort it out is
 * how a timeline stops answering the pointer.
 */
export function ticks(view: View, fps: Rational): Tick[] {
  if (view.total <= 0 || view.scale <= 0) return [];
  const { major, minor } = tickSteps(view, fps);
  const step = minor || major;
  if (step <= 0) return [];
  const range = visibleRange(view);
  const out: Tick[] = [];
  const first = Math.floor(range.from / step) * step;
  for (let frame = first; frame <= range.to; frame += step) {
    if (frame < 0 || frame > view.total) continue;
    out.push({ frame, major: frame % major === 0 });
  }
  return out;
}
