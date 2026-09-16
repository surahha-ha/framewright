// framewright — one drag on the stage, the DOM half (E10 step 1; ADR-0019,
// amended: the third stage drag was the trigger to write this once).
//
// The picture's pan and the words are the same gesture with different
// answers: a press lands on something, the pointer's offset over the box
// becomes a fraction of it, clamped on each axis with the origin rebased
// so the pointer stays attached at the edge (`engine/stageDrag.dragAxis`),
// and the release ends one undo step. That gesture is here, once.
//
// The hook owns: the drag-state ref (pointer id, origin, base, size,
// limits, the last value, whether it moved), the main-button check,
// pointer capture, the 3px threshold before the first write, `dragAxis`
// on both axes with the origin rebase, the pointer-id check on every
// event, the teardown on up / cancel, and `endGesture`.
//
// A caller supplies: `press` — its hit test, and what the press measures
// (the rect, the value at press as fractions of the box, the box's CSS
// size, the limits) and what the release will need to know (`target`);
// `move` — its coalesced command per step (`run(cmd, args, key)`); and
// `release` — the snap at the drop when it moved, or the press-only
// sentence when it did not. Hover state and the cursor stay with the
// caller: an idle move is a hit test, not a drag.
//
// The stage keeps ONE handler set and asks each caller in turn; every
// handler answers whether it took the event, so the next can be asked.
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../store/projectStore';
import { dragAxis } from '../engine/stageDrag';

export type StageEvent = ReactPointerEvent<HTMLDivElement>;

export interface StagePress<T> {
  /** What the press landed on and what the release needs to know. */
  target: T;
  /** The value at press, fractions of the box, per axis. */
  base: { x: number; y: number };
  /** CSS px per whole box on each axis (the pan's is width × zoom). */
  size: { x: number; y: number };
  min: { x: number; y: number };
  max: { x: number; y: number };
}

export interface StageDragSpec<T> {
  /** The hit test. Null = not this drag's press (the caller may have
   *  selected something and said so; the next handler is asked). Only
   *  asked for the main button. */
  press(e: StageEvent): StagePress<T> | null;
  /** Every move past the threshold: the caller's coalesced command,
   *  the value clamped by `dragAxis` already. */
  move(target: T, value: { x: number; y: number }): void;
  /** The release or a cancel: the snapped last write when it moved, the
   *  press-only sentence when it did not. `endGesture` follows. */
  release(target: T, moved: boolean, last: { x: number; y: number }): void;
}

export interface StageDrag {
  /** True when this drag took the press (and captured the pointer). */
  onPointerDown(e: StageEvent): boolean;
  /** True when a drag of this kind is on and the event is its pointer's —
   *  inside the threshold too, so no other handler acts on the press. */
  onPointerMove(e: StageEvent): boolean;
  /** True when a drag of this kind ended on this event. */
  onPointerUp(e: StageEvent): boolean;
  /** Whether a drag is on right now (live, read from the ref). */
  readonly active: boolean;
}

interface Drag<T> {
  target: T;
  pointerId: number;
  /** The pointer coordinates the offset is measured from. They MOVE when
   *  the value clamps at a limit (`dragAxis`), so the pointer stays
   *  attached instead of running ahead. */
  originX: number;
  originY: number;
  base: { x: number; y: number };
  size: { x: number; y: number };
  min: { x: number; y: number };
  max: { x: number; y: number };
  last: { x: number; y: number };
  moved: boolean;
}

/** Pixels the pointer must travel before a press becomes a drag. */
const THRESHOLD_PX = 3;

export function useStageDrag<T>(spec: StageDragSpec<T>): StageDrag {
  const endGesture = useStore((s) => s.endGesture);
  const dragRef = useRef<Drag<T> | null>(null);

  function onPointerDown(e: StageEvent): boolean {
    if (e.button !== 0) return false;
    const p = spec.press(e);
    if (!p) return false;
    dragRef.current = {
      target: p.target,
      pointerId: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      base: p.base,
      size: p.size,
      min: p.min,
      max: p.max,
      last: p.base,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    return true;
  }

  function onPointerMove(e: StageEvent): boolean {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return false;
    if (
      !d.moved &&
      Math.abs(e.clientX - d.originX) < THRESHOLD_PX &&
      Math.abs(e.clientY - d.originY) < THRESHOLD_PX
    )
      return true;
    d.moved = true;
    // Clamped to the limits; at a limit the origin comes along, so dragging
    // back moves at once (ADR-0019, amended).
    const ax = dragAxis({
      base: d.base.x,
      origin: d.originX,
      pointer: e.clientX,
      size: d.size.x,
      min: d.min.x,
      max: d.max.x,
    });
    const ay = dragAxis({
      base: d.base.y,
      origin: d.originY,
      pointer: e.clientY,
      size: d.size.y,
      min: d.min.y,
      max: d.max.y,
    });
    d.originX = ax.origin;
    d.originY = ay.origin;
    d.last = { x: ax.value, y: ay.value };
    spec.move(d.target, d.last);
    return true;
  }

  function onPointerUp(e: StageEvent): boolean {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return false;
    dragRef.current = null;
    spec.release(d.target, d.moved, d.last);
    endGesture();
    return true;
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    get active() {
      return dragRef.current !== null;
    },
  };
}
