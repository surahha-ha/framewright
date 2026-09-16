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
// each handler answers whether it took the event. The gesture itself —
// capture, threshold, `dragAxis`, teardown — is `useStageDrag`; this hook
// is the hit test, the base, the command and the snap.
import { useRef, useState } from 'react';
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
import { useStageDrag, type StageEvent } from './useStageDrag';

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

/** What a press on the words locks for the rest of the gesture. */
interface Pressed {
  subtitleId: string;
  /** Where the bottom stack's centre is for these words, for the snap. */
  bottomCentreY: number;
  /** Whether the press changed the selection — a press that then does
   *  not move has only that to say. */
  chose: boolean;
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
  const setStatus = useStore((s) => s.setStatus);
  const selectSubtitle = useStore((s) => s.selectSubtitle);
  const selectedSubtitleId = useStore((s) => s.selectedSubtitleId);
  const [overWords, setOverWords] = useState(false);
  const measuredRef = useRef<Measured | null>(null);

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

  const drag = useStageDrag<Pressed>({
    // A press on the words selects the subtitle and starts its drag in the
    // same press: the block's rest centre is the base, the overlay's CSS
    // size the box, and the value stays inside [0, 1].
    press(e) {
      const hit = wordsUnder(e);
      if (!hit || !frame || !current) return null;
      const { overlay, ctx, rect, rest } = hit;
      const bottom = layoutOfFrame(ctx, frame, overlay.width, overlay.height, {
        posX: frame.posX,
      });
      const restY = (rest.top + rest.bottom) / 2 / overlay.height;
      const pressed: Pressed = {
        subtitleId: current.id,
        bottomCentreY: bottom ? bottomCentreY(bottom, overlay.height) : restY,
        chose: current.id !== selectedSubtitleId,
      };
      selectSubtitle(current.id);
      return {
        target: pressed,
        base: { x: (rest.left + rest.right) / 2 / overlay.width, y: restY },
        size: { x: rect.width, y: rect.height },
        min: { x: 0, y: 0 },
        max: { x: 1, y: 1 },
      };
    },
    move(t, v) {
      run(
        'subtitle.setPosition',
        { subtitleId: t.subtitleId, posX: v.x, posY: v.y },
        `pos:${t.subtitleId}`,
      );
    },
    release(t, moved, last) {
      if (moved) {
        // The drop: near a preset, on it — under the same key, so the whole
        // gesture stays one undo step.
        const snapped = snapPosition(
          { posX: last.x, posY: last.y },
          t.bottomCentreY,
        );
        run(
          'subtitle.setPosition',
          { subtitleId: t.subtitleId, ...snapped },
          `pos:${t.subtitleId}`,
        );
      } else if (t.chose) {
        // The press picked another subtitle and the panel changed under the
        // pointer; the picture's press says as much, so does this (a11y).
        setStatus('화면의 자막을 골랐어요 · 끌면 자리가 옮겨져요.');
      }
    },
  });

  /** A press on the words: selects the subtitle and starts its drag in the
   *  same press. True when it did. */
  function onPointerDown(e: StageEvent): boolean {
    return drag.onPointerDown(e);
  }

  /** A move: the drag when one is on (true), else the cursor (false, so the
   *  caller may go on to its own drag). */
  function onPointerMove(e: StageEvent): boolean {
    if (drag.onPointerMove(e)) return true;
    if (!drag.active) {
      const over = wordsUnder(e) !== null;
      if (over !== overWords) setOverWords(over);
    }
    return false;
  }

  /** The release (or a cancel): the snapped drop, or the one sentence a
   *  press that only chose has to say. True when a words drag ended. */
  function onPointerUp(e: StageEvent): boolean {
    return drag.onPointerUp(e);
  }

  return { onPointerDown, onPointerMove, onPointerUp, overWords };
}
