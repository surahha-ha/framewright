// framewright — the words dragged on the stage (E8-2c, ADR-0019), as a hook.
//
// A press inside the drawn block of the subtitle under the playhead drags
// it: pointer pixels over the overlay's CSS size are fractions of the BOX,
// which is what `subtitle.setPosition` takes; every move is the command
// under one coalesce key (one undo step, the pan's shape); the drop snaps
// near a preset. The subtitle is locked at press, so playback moving the
// playhead off it mid-drag changes nothing about the gesture.
//
// Out of `Preview.tsx` because the stage has two drags and a playback loop
// in one file; the stage's ONE handler set stays there and asks this hook
// first (a press on the words is unambiguous, the picture's is not), so
// each handler answers whether it took the event.
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { RefObject } from 'react';
import { useStore } from '../store/projectStore';
import type { Subtitle } from '../engine/types';
import {
  drawnBounds,
  layoutBounds,
  layoutOfFrame,
  type SubtitleFrame,
  type SubtitleLayout,
} from '../engine/subtitleRender';
import { bottomCentreY, snapPosition } from '../engine/subtitlePosition';
import { dragAxis } from '../engine/stageDrag';

type StageEvent = ReactPointerEvent<HTMLDivElement>;
type Box = { left: number; right: number; top: number; bottom: number };

/** The frame's layout, measured once and kept until the frame, the
 *  overlay's size or the fonts on the page change — a hover move only
 *  tests a point against it (the reviewer's E8-2c finding: a layout with
 *  `measureText` per line ran at pointermove rate). */
interface Measured {
  frame: SubtitleFrame;
  width: number;
  height: number;
  fonts: number;
  layout: SubtitleLayout;
  /** The ink as DRAWN on this frame — an effect's first frames shift or
   *  shrink it — for the hit test. */
  drawn: Box;
  /** The block at REST, the one the stored fractions name — the drag's base,
   *  so the first move does not add the effect's offset to the document. */
  rest: Box;
}

export function useWordsDrag({
  overlayRef,
  frame,
  current,
  fontsVersion,
}: {
  overlayRef: RefObject<HTMLCanvasElement>;
  /** What the overlay draws right now, null when nothing. */
  frame: SubtitleFrame | null;
  /** The subtitle under the playhead, the one `frame` came from. */
  current: Subtitle | null;
  /** Bumped when a face lands: the same words then lay out differently. */
  fontsVersion: number;
}) {
  const run = useStore((s) => s.run);
  const endGesture = useStore((s) => s.endGesture);
  const setStatus = useStore((s) => s.setStatus);
  const selectSubtitle = useStore((s) => s.selectSubtitle);
  const selectedSubtitleId = useStore((s) => s.selectedSubtitleId);
  const [overWords, setOverWords] = useState(false);
  const measuredRef = useRef<Measured | null>(null);
  const dragRef = useRef<{
    subtitleId: string;
    pointerId: number;
    /** The pointer coordinates the offset is measured from. They MOVE when
     *  the value clamps at the box's edge (`dragAxis`), so the pointer
     *  stays attached to the words instead of running ahead of them. */
    originX: number;
    originY: number;
    /** The block's rest centre at press, as fractions of the box. */
    baseX: number;
    baseY: number;
    /** The overlay's CSS size at press: a pixel of drag over it is a
     *  fraction of the box. */
    width: number;
    height: number;
    /** Where the bottom stack's centre is for these words, for the snap. */
    bottomCentreY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    /** Whether the press changed the selection — a press that then does
     *  not move has only that to say. */
    chose: boolean;
  } | null>(null);

  function measure(
    overlay: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
  ): Measured | null {
    if (!frame || !frame.text) return null;
    const m = measuredRef.current;
    if (
      m &&
      m.frame === frame &&
      m.width === overlay.width &&
      m.height === overlay.height &&
      m.fonts === fontsVersion
    )
      return m;
    const layout = layoutOfFrame(ctx, frame, overlay.width, overlay.height);
    const next = layout
      ? {
          frame,
          width: overlay.width,
          height: overlay.height,
          fonts: fontsVersion,
          layout,
          drawn: drawnBounds(frame, layout, overlay.height),
          rest: layoutBounds(layout),
        }
      : null;
    measuredRef.current = next;
    return next;
  }

  /** The drawn block under the pointer, or null: the overlay's rect maps
   *  the pointer onto the export grid the words were laid out on. */
  function wordsUnder(e: StageEvent) {
    const overlay = overlayRef.current;
    const ctx = overlay?.getContext('2d');
    if (!overlay || !ctx || !current) return null;
    const rect = overlay.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const m = measure(overlay, ctx);
    if (!m) return null;
    const x = ((e.clientX - rect.left) * overlay.width) / rect.width;
    const y = ((e.clientY - rect.top) * overlay.height) / rect.height;
    const { drawn } = m;
    if (x < drawn.left || x > drawn.right || y < drawn.top || y > drawn.bottom)
      return null;
    return { overlay, ctx, rect, rest: m.rest };
  }

  /** A press on the words: selects the subtitle and starts its drag in the
   *  same press. True when it did. */
  function onPointerDown(e: StageEvent): boolean {
    const hit = wordsUnder(e);
    if (!hit || !frame || !current) return false;
    const { overlay, ctx, rect, rest } = hit;
    const bottom = layoutOfFrame(ctx, frame, overlay.width, overlay.height, {
      posX: frame.posX,
    });
    const restY = (rest.top + rest.bottom) / 2 / overlay.height;
    dragRef.current = {
      subtitleId: current.id,
      pointerId: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      baseX: (rest.left + rest.right) / 2 / overlay.width,
      baseY: restY,
      width: rect.width,
      height: rect.height,
      bottomCentreY: bottom ? bottomCentreY(bottom, overlay.height) : restY,
      lastX: 0,
      lastY: 0,
      moved: false,
      chose: current.id !== selectedSubtitleId,
    };
    selectSubtitle(current.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    return true;
  }

  /** A move: the drag when one is on (true), else the cursor (false, so the
   *  caller may go on to its own drag). */
  function onPointerMove(e: StageEvent): boolean {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) {
      if (!d) {
        const over = wordsUnder(e) !== null;
        if (over !== overWords) setOverWords(over);
      }
      return false;
    }
    if (
      !d.moved &&
      Math.abs(e.clientX - d.originX) < 3 &&
      Math.abs(e.clientY - d.originY) < 3
    )
      return true;
    d.moved = true;
    // Clamped to the box; at the edge the origin comes along, so dragging
    // back moves at once (ADR-0019, amended).
    const ax = dragAxis({
      base: d.baseX,
      origin: d.originX,
      pointer: e.clientX,
      size: d.width,
      min: 0,
      max: 1,
    });
    const ay = dragAxis({
      base: d.baseY,
      origin: d.originY,
      pointer: e.clientY,
      size: d.height,
      min: 0,
      max: 1,
    });
    d.originX = ax.origin;
    d.originY = ay.origin;
    d.lastX = ax.value;
    d.lastY = ay.value;
    run(
      'subtitle.setPosition',
      { subtitleId: d.subtitleId, posX: d.lastX, posY: d.lastY },
      `pos:${d.subtitleId}`,
    );
    return true;
  }

  /** The release (or a cancel): the snapped drop, or the one sentence a
   *  press that only chose has to say. True when a words drag ended. */
  function onPointerUp(e: StageEvent): boolean {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return false;
    dragRef.current = null;
    if (d.moved) {
      // The drop: near a preset, on it — under the same key, so the whole
      // gesture stays one undo step.
      const snapped = snapPosition(
        { posX: d.lastX, posY: d.lastY },
        d.bottomCentreY,
      );
      run(
        'subtitle.setPosition',
        { subtitleId: d.subtitleId, ...snapped },
        `pos:${d.subtitleId}`,
      );
    } else if (d.chose) {
      // The press picked another subtitle and the panel changed under the
      // pointer; the picture's press says as much, so does this (a11y).
      setStatus('화면의 자막을 골랐어요 · 끌면 자리가 옮겨져요.');
    }
    endGesture();
    return true;
  }

  return { onPointerDown, onPointerMove, onPointerUp, overWords };
}
