// framewright — one axis of a drag on the stage whose value has a limit
// (ADR-0019, amended 2026-09-16; ADR-0014 for the picture's pan).
//
// Both stage drags — the picture's pan and the words — turn a pointer
// offset into a fraction of the box and clamp it: the pan to its limit,
// the words to [0, 1]. Clamping alone detaches the pointer: past the edge
// the stored value stops while the pointer runs on, and dragging back then
// does nothing until the pointer has returned by the whole overshoot.
// `dragAxis` keeps them attached: when the value was clamped the drag's
// ORIGIN moves with it, so that pointer and value coincide again and the
// next step back moves at once. Pure, so it is tested in Node; the
// pointer events stay in `ui/`.

export interface DragAxisInput {
  /** The value at the press, as a fraction of the box. */
  base: number;
  /** The pointer's coordinate the offset is measured from (CSS px). */
  origin: number;
  /** The pointer's coordinate now (CSS px). */
  pointer: number;
  /** The box's extent on this axis (CSS px): a pixel of drag over it is
   *  a fraction of the box. */
  size: number;
  min: number;
  max: number;
}

export function dragAxis(a: DragAxisInput): { value: number; origin: number } {
  // A box with no extent, or a pointer with no coordinate, is no drag: the
  // value stays where it is (clamped) and the origin is left alone, so one
  // bad event cannot poison the rest of the gesture with NaN.
  if (!(a.size > 0) || !Number.isFinite(a.pointer)) {
    return {
      value: Math.min(a.max, Math.max(a.min, a.base)),
      origin: a.origin,
    };
  }
  const raw = a.base + (a.pointer - a.origin) / a.size;
  const value = Math.min(a.max, Math.max(a.min, raw));
  if (value === raw) return { value, origin: a.origin };
  return { value, origin: a.pointer - (value - a.base) * a.size };
}
