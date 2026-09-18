// framewright — the caller's half of the stage's third drag: the hit test
// that works before any bitmap has arrived, the base an absent axis reads
// as, the command with BOTH axes on every write, the snap at the drop, and
// the sentence a press that only chose has to say.
//
// The gesture itself is `useStageDrag`'s and is tested there. What is tested
// here is what would break silently: a one-axis `image.setPosition` (the
// other axis springs to the centre), a base taken from the drawn bitmap
// instead of the document (the picture jumps on the first move), and a hit
// test that needs a picture to have arrived.
//
// jsdom is not a dependency of this project — unit tests run in Node — so
// the canvas is its rect, the pointer event its four fields, exactly as
// `useStageDrag.test.ts` builds them.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ sets: [] as unknown[] }));

/** One ref object per call, and a `useState` that records what the hook
 *  would have set — the hook is called once per test, which is what a
 *  mounted component is for the life of a gesture. */
vi.mock('react', () => ({
  useRef: <T>(initial: T) => ({ current: initial }),
  useState: <T>(initial: T) =>
    [
      initial,
      (v: T) => {
        hooks.sets.push(v);
      },
    ] as const,
}));

const store = vi.hoisted(() => ({
  runs: [] as { id: string; args: unknown; key?: string }[],
  statuses: [] as string[],
  selected: [] as (string | null)[],
  selectedImageId: null as string | null,
  endGestures: 0,
}));

vi.mock('../store/projectStore', () => ({
  useStore: <T>(select: (s: Record<string, unknown>) => T): T =>
    select({
      run: (id: string, args: unknown, key?: string) => {
        store.runs.push({ id, args, key });
        return true;
      },
      setStatus: (s: string) => {
        store.statuses.push(s);
      },
      selectImage: (id: string | null) => {
        store.selected.push(id);
      },
      selectedImageId: store.selectedImageId,
      endGesture: () => {
        store.endGestures += 1;
      },
    }),
}));

import { useImageDrag } from './useImageDrag';
import type { StageEvent } from './useStageDrag';
import type { ImageFrame } from '../engine/imageRender';
import type { StageImage } from '../engine/types';

/** The image layer: 400×200 CSS px at the origin of the viewport, and the
 *  pointer-capture bookkeeping the gesture needs. */
function layer() {
  const el = {
    captured: [] as number[],
    setPointerCapture(pointerId: number) {
      el.captured.push(pointerId);
    },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 200,
    }),
  };
  return el;
}

type Layer = ReturnType<typeof layer>;

function ev(el: Layer, p: { id?: number; x: number; y: number }): StageEvent {
  return {
    pointerId: p.id ?? 1,
    clientX: p.x,
    clientY: p.y,
    button: 0,
    currentTarget: el,
  } as unknown as StageEvent;
}

const IMAGE: StageImage = {
  id: 'img_1',
  assetId: 'a1',
  startFrame: 0,
  endFrame: 48,
};

/** A square source, so the drawn rectangle is a quarter of the box's width
 *  (100px) and the same in height, centred: x 150..250, y 50..150. */
const FRAME: ImageFrame = { assetId: 'a1', srcWidth: 100, srcHeight: 100 };

function mount(
  over: { image?: StageImage | null; frame?: ImageFrame | null } = {},
) {
  const el = layer();
  const drag = useImageDrag({
    imageRef: { current: el } as unknown as Parameters<
      typeof useImageDrag
    >[0]['imageRef'],
    frame: over.frame === undefined ? FRAME : over.frame,
    image: over.image === undefined ? IMAGE : over.image,
  });
  return { el, drag };
}

beforeEach(() => {
  store.runs = [];
  store.statuses = [];
  store.selected = [];
  store.selectedImageId = null;
  store.endGestures = 0;
  hooks.sets = [];
});

describe('useImageDrag — the hit test', () => {
  it('takes a press inside the drawn rectangle, and only there', () => {
    const inside = mount();
    expect(inside.drag.onPointerDown(ev(inside.el, { x: 200, y: 100 }))).toBe(
      true,
    );
    expect(store.selected).toEqual(['img_1']);

    // Just outside its left edge (the rectangle starts at 150).
    const outside = mount();
    expect(outside.drag.onPointerDown(ev(outside.el, { x: 149, y: 100 }))).toBe(
      false,
    );
    // A refused press must not have chosen anything: the next handler (the
    // clip's pan) is about to be asked.
    expect(store.selected).toEqual(['img_1']);
  });

  it('answers from the asset size, so a picture still being read can be moved', () => {
    // Nothing here has ever seen a bitmap: `FRAME` carries the asset's
    // recorded pixels and that is the whole hit test.
    const { el, drag } = mount();
    expect(drag.onPointerDown(ev(el, { x: 160, y: 60 }))).toBe(true);
    expect(el.captured).toEqual([1]);
  });

  it('is asked nothing when no image is under the playhead', () => {
    const { el, drag } = mount({ image: null, frame: null });
    expect(drag.onPointerDown(ev(el, { x: 200, y: 100 }))).toBe(false);
    expect(store.selected).toEqual([]);
  });

  it('reports the hover for the cursor without starting anything', () => {
    const { el, drag } = mount();
    expect(drag.onPointerMove(ev(el, { x: 200, y: 100 }))).toBe(false);
    expect(hooks.sets).toEqual([true]);
    expect(store.runs).toEqual([]);
  });
});

describe('useImageDrag — the gesture', () => {
  it('writes BOTH axes on every move, from the document position', () => {
    const { el, drag } = mount();
    drag.onPointerDown(ev(el, { x: 200, y: 100 }));
    // 40px right and 20px down of a 400×200 box: a tenth of each axis, from
    // the centre an absent axis means.
    drag.onPointerMove(ev(el, { x: 240, y: 120 }));
    expect(store.runs).toEqual([
      {
        id: 'image.setPosition',
        args: { imageId: 'img_1', posX: 0.6, posY: 0.6 },
        key: 'imgpos:img_1',
      },
    ]);
  });

  it('starts from the position the document has, not from the centre', () => {
    const placed: StageImage = { ...IMAGE, posX: 0.25, posY: 0.8 };
    const el = layer();
    const drag = useImageDrag({
      imageRef: { current: el } as unknown as Parameters<
        typeof useImageDrag
      >[0]['imageRef'],
      frame: { ...FRAME, posX: 0.25, posY: 0.8 },
      image: placed,
    });
    // The rectangle is centred on 0.25 × 400 = 100, 0.8 × 200 = 160.
    drag.onPointerDown(ev(el, { x: 100, y: 160 }));
    drag.onPointerMove(ev(el, { x: 140, y: 160 }));
    expect(store.runs.at(-1)!.args).toEqual({
      imageId: 'img_1',
      posX: 0.35,
      posY: 0.8,
    });
  });

  it('snaps the drop to the middle under the same key, both axes', () => {
    const { el, drag } = mount();
    drag.onPointerDown(ev(el, { x: 200, y: 100 }));
    // Four pixels right: 1% of the box, inside the snap radius.
    drag.onPointerMove(ev(el, { x: 204, y: 100 }));
    drag.onPointerUp(ev(el, { x: 204, y: 100 }));
    expect(store.runs.at(-1)).toEqual({
      id: 'image.setPosition',
      // The normal form: the centre is an ABSENT axis, on both.
      args: { imageId: 'img_1', posX: undefined, posY: undefined },
      key: 'imgpos:img_1',
    });
    expect(store.endGestures).toBe(1);
  });

  it('leaves a drop that is not near the middle where it was let go', () => {
    const { el, drag } = mount();
    drag.onPointerDown(ev(el, { x: 200, y: 100 }));
    drag.onPointerMove(ev(el, { x: 360, y: 100 }));
    drag.onPointerUp(ev(el, { x: 360, y: 100 }));
    expect(store.runs.at(-1)!.args).toEqual({
      imageId: 'img_1',
      posX: 0.9,
      posY: undefined,
    });
  });

  it('holds the centre inside the box', () => {
    const { el, drag } = mount();
    drag.onPointerDown(ev(el, { x: 200, y: 100 }));
    // Far past the right edge and above the top.
    drag.onPointerMove(ev(el, { x: 900, y: -300 }));
    expect(store.runs.at(-1)!.args).toEqual({
      imageId: 'img_1',
      posX: 1,
      posY: 0,
    });
  });

  it('says one sentence for a press that only chose, and nothing else', () => {
    const { el, drag } = mount();
    drag.onPointerDown(ev(el, { x: 200, y: 100 }));
    drag.onPointerUp(ev(el, { x: 200, y: 100 }));
    expect(store.statuses).toEqual([
      '화면의 이미지를 골랐어요 · 끌면 자리가 옮겨져요.',
    ]);
    // A press that never moved writes nothing at all.
    expect(store.runs).toEqual([]);
  });

  it('says nothing when the image was already the chosen one', () => {
    store.selectedImageId = 'img_1';
    const { el, drag } = mount();
    drag.onPointerDown(ev(el, { x: 200, y: 100 }));
    drag.onPointerUp(ev(el, { x: 200, y: 100 }));
    expect(store.statuses).toEqual([]);
  });

  it('says nothing about choosing when the press became a drag', () => {
    const { el, drag } = mount();
    drag.onPointerDown(ev(el, { x: 200, y: 100 }));
    drag.onPointerMove(ev(el, { x: 260, y: 100 }));
    drag.onPointerUp(ev(el, { x: 260, y: 100 }));
    // The move's own sentence is the command's (`describeImagePosition`).
    expect(store.statuses).toEqual([]);
    expect(drag.active).toBe(false);
  });
});
