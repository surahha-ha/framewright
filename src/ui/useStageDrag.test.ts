// framewright — the two ways one stage drag goes wrong without looking
// wrong: a SECOND pointer pressing while a drag is on, and a
// `setPointerCapture` that throws.
//
// Both end the same way — the drag ref holds something nothing will ever
// end — and neither is visible on screen: the first pointer keeps moving
// the picture, and only its release (the words' snap at the drop) is
// silently missing.
//
// Everything browser-shaped the hook touches is one seam each: `useRef`
// (the ref lives for the mounted component, which one call of the hook
// stands in for here) and the element's pointer capture. jsdom is not a
// dependency of this project — unit tests run in Node — so the
// PointerEvent the hook reads is exactly its four fields plus the element
// it was dispatched on, built below.
//
// What is NOT here: whether a real Chrome routes pointermove to the
// captured element. That is the stage e2e's job.
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** One ref object per call, kept by the closures the hook returns — which
 *  is what a mounted component's ref is for the life of a drag. */
vi.mock('react', () => ({
  useRef: <T>(initial: T) => ({ current: initial }),
}));

const store = vi.hoisted(() => ({ endGestures: 0 }));
vi.mock('../store/projectStore', () => ({
  useStore: <T>(select: (s: { endGesture: () => void }) => T): T =>
    select({
      endGesture: () => {
        store.endGestures += 1;
      },
    }),
}));

import { useStageDrag, type StageEvent } from './useStageDrag';

/** The stage element, with the pointer-capture bookkeeping the hook uses
 *  and a switch for the one failure the DOM really has: capture on an
 *  element that is no longer in the document throws. */
function stageEl(opts: { throwsOnCapture?: boolean } = {}) {
  const el = {
    throwsOnCapture: opts.throwsOnCapture ?? false,
    captured: [] as number[],
    setPointerCapture(pointerId: number) {
      if (el.throwsOnCapture)
        throw new DOMException('no such pointer', 'NotFoundError');
      el.captured.push(pointerId);
    },
  };
  return el;
}

type StageElement = ReturnType<typeof stageEl>;

/** The press/move/up event: the four fields the hook reads, on an element. */
function ev(
  el: StageElement,
  p: { id: number; x: number; y: number; button?: number },
): StageEvent {
  return {
    pointerId: p.id,
    clientX: p.x,
    clientY: p.y,
    button: p.button ?? 0,
    currentTarget: el,
  } as unknown as StageEvent;
}

/** The caller's half, recorded: which presses were ASKED (the hit test has
 *  side effects — it selects — so a refused press must not reach it), and
 *  every move and release with what it was told. */
function recorder() {
  const asked: number[] = [];
  const moves: { target: string; value: { x: number; y: number } }[] = [];
  const releases: {
    target: string;
    moved: boolean;
    last: { x: number; y: number };
  }[] = [];
  const spec = {
    press(e: StageEvent) {
      asked.push(e.pointerId);
      return {
        target: `p${e.pointerId}`,
        base: { x: 0.5, y: 0.5 },
        // 100 CSS px per whole box: a 10px drag is 0.1 of it.
        size: { x: 100, y: 100 },
        min: { x: 0, y: 0 },
        max: { x: 1, y: 1 },
      };
    },
    move(target: string, value: { x: number; y: number }) {
      moves.push({ target, value });
    },
    release(target: string, moved: boolean, last: { x: number; y: number }) {
      releases.push({ target, moved, last });
    },
  };
  return { asked, moves, releases, spec };
}

beforeEach(() => {
  store.endGestures = 0;
});

describe('useStageDrag', () => {
  it('runs one drag: press, the threshold, a move, the release', () => {
    const r = recorder();
    const drag = useStageDrag(r.spec);
    const el = stageEl();

    expect(drag.onPointerDown(ev(el, { id: 1, x: 0, y: 0 }))).toBe(true);
    expect(el.captured).toEqual([1]);
    expect(drag.active).toBe(true);
    // Inside the 3px threshold: taken, but nothing written yet.
    expect(drag.onPointerMove(ev(el, { id: 1, x: 2, y: 0 }))).toBe(true);
    expect(r.moves).toEqual([]);
    expect(drag.onPointerMove(ev(el, { id: 1, x: 10, y: 0 }))).toBe(true);
    expect(r.moves).toEqual([{ target: 'p1', value: { x: 0.6, y: 0.5 } }]);
    expect(drag.onPointerUp(ev(el, { id: 1, x: 10, y: 0 }))).toBe(true);
    expect(r.releases).toEqual([
      { target: 'p1', moved: true, last: { x: 0.6, y: 0.5 } },
    ]);
    expect(store.endGestures).toBe(1);
    expect(drag.active).toBe(false);
  });

  it('refuses a second pointer instead of overwriting the drag it is on', () => {
    const r = recorder();
    const drag = useStageDrag(r.spec);
    const el = stageEl();

    drag.onPointerDown(ev(el, { id: 1, x: 0, y: 0 }));
    expect(drag.onPointerMove(ev(el, { id: 1, x: 20, y: 0 }))).toBe(true);

    // A second finger on the same element, mid-drag.
    expect(drag.onPointerDown(ev(el, { id: 2, x: 0, y: 0 }))).toBe(false);
    // The hit test is never even asked: it SELECTS, and a refused press
    // must not change what the panel shows under a running drag.
    expect(r.asked).toEqual([1]);
    expect(el.captured).toEqual([1]);

    // The first pointer is still the drag's, and its release still lands —
    // once, on its own target, with what it last wrote.
    expect(drag.onPointerMove(ev(el, { id: 1, x: 30, y: 0 }))).toBe(true);
    expect(r.moves.at(-1)).toEqual({
      target: 'p1',
      value: { x: 0.8, y: 0.5 },
    });
    expect(drag.onPointerUp(ev(el, { id: 2, x: 0, y: 0 }))).toBe(false);
    expect(drag.onPointerUp(ev(el, { id: 1, x: 30, y: 0 }))).toBe(true);
    expect(r.releases).toEqual([
      { target: 'p1', moved: true, last: { x: 0.8, y: 0.5 } },
    ]);
    expect(store.endGestures).toBe(1);
    expect(drag.active).toBe(false);
  });

  it('leaves no drag behind when the capture throws', () => {
    const r = recorder();
    const drag = useStageDrag(r.spec);
    const el = stageEl({ throwsOnCapture: true });

    // The element went away between the press and its handler.
    expect(drag.onPointerDown(ev(el, { id: 1, x: 0, y: 0 }))).toBe(false);
    expect(drag.active).toBe(false);
    // Ended the way a press that never moved ends, so a hit test that
    // chose something still gets its one sentence said.
    expect(r.releases).toEqual([
      { target: 'p1', moved: false, last: { x: 0.5, y: 0.5 } },
    ]);
    expect(store.endGestures).toBe(1);
    // No drag is on, so nothing follows that press.
    expect(drag.onPointerMove(ev(el, { id: 1, x: 40, y: 0 }))).toBe(false);
    expect(r.moves).toEqual([]);

    // The next gesture on the same hook and the same pointer runs whole.
    el.throwsOnCapture = false;
    expect(drag.onPointerDown(ev(el, { id: 1, x: 0, y: 0 }))).toBe(true);
    expect(el.captured).toEqual([1]);
    expect(drag.onPointerMove(ev(el, { id: 1, x: 10, y: 0 }))).toBe(true);
    expect(r.moves).toEqual([{ target: 'p1', value: { x: 0.6, y: 0.5 } }]);
    expect(drag.onPointerUp(ev(el, { id: 1, x: 10, y: 0 }))).toBe(true);
    expect(r.releases.at(-1)).toEqual({
      target: 'p1',
      moved: true,
      last: { x: 0.6, y: 0.5 },
    });
    expect(store.endGestures).toBe(2);
  });
});
