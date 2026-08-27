// framewright — where a clip's thumbnails go, specified before they exist.
//
// The picture itself needs WebCodecs and cannot be tested in Node. The part
// that decides WHICH frames to ask for and WHERE to put them is arithmetic, and
// it is the part that goes wrong invisibly: a strip that asks for a thumbnail
// per frame of a ten-minute clip decodes for a minute and pins the tab, and a
// grid that moves with the scroll misses its cache on every pointer event while
// looking perfectly correct in a screenshot.
import { describe, expect, it } from 'vitest';
import { fitScale, frameToX, type View } from './timelineView';
import { THUMB_PX, thumbStrip, type ThumbSlot } from './thumbnails';

const MINUTE = 60 * 30;
const WIDTH = 900;

function view(scale: number, scrollPx = 0, total = MINUTE): View {
  return { total, widthPx: WIDTH, scale, scrollPx };
}

function fittedView(total = MINUTE): View {
  return view(fitScale(total, WIDTH), 0, total);
}

/** A clip filling the whole document, starting at the head of its source. */
const WHOLE = { start: 0, length: MINUTE, inFrame: 0 };

function sources(slots: ThumbSlot[]): number[] {
  return slots.map((s) => s.sourceFrame);
}

describe('how many pictures the strip asks for', () => {
  it('is bounded by the WINDOW, never by how long the clip is', () => {
    // The whole point. A ten-minute clip zoomed to a frame per 40px is
    // 18,000 frames wide; the answer must still be a screenful of thumbnails.
    const long = 10 * 60 * 30;
    const strip = thumbStrip(view(40, 100_000, long), {
      start: 0,
      length: long,
      inFrame: 0,
    });
    expect(strip).not.toBeNull();
    expect(strip!.slots.length).toBeLessThanOrEqual(WIDTH / THUMB_PX + 2);
  });

  it('holds that bound at every zoom of a long clip, scrolled anywhere', () => {
    const long = 10 * 60 * 30;
    const fit = fitScale(long, WIDTH);
    for (let scale = fit; scale <= 40; scale *= 2) {
      const v = view(scale, 0, long);
      for (const scrollPx of [0, 137, long * scale - WIDTH]) {
        const strip = thumbStrip(
          { ...v, scrollPx: Math.max(0, scrollPx) },
          { start: 0, length: long, inFrame: 0 },
        );
        expect(strip!.slots.length).toBeLessThanOrEqual(WIDTH / THUMB_PX + 2);
      }
    }
  });

  it('draws at least one picture for a clip too small to hold one', () => {
    // A three-frame clip in a fitted minute is under a pixel wide. It still has
    // to look like a clip of something rather than an empty box.
    const strip = thumbStrip(fittedView(), {
      start: 100,
      length: 3,
      inFrame: 0,
    });
    expect(strip!.slots).toHaveLength(1);
    expect(strip!.slots[0].sourceFrame).toBe(0);
  });
});

describe('which frame each picture is of', () => {
  it('starts a clip with its own first frame', () => {
    // The head of a clip is what identifies it. A strip that starts on whatever
    // frame the grid happened to land on shows two clips of the same source as
    // two different things.
    const strip = thumbStrip(fittedView(), WHOLE);
    expect(strip!.slots[0].sourceFrame).toBe(0);
    expect(strip!.slots[0].frame).toBe(0);
  });

  it('counts from the clip’s in-point, not from the timeline', () => {
    const strip = thumbStrip(fittedView(), {
      start: 300,
      length: 600,
      inFrame: 900,
    });
    expect(strip!.slots[0].sourceFrame).toBe(900);
    for (const s of strip!.slots) {
      expect(s.sourceFrame - 900).toBe(s.frame - 300);
      expect(s.sourceFrame).toBeGreaterThanOrEqual(900);
      expect(s.sourceFrame).toBeLessThan(900 + 600);
    }
  });

  it('never asks for a frame the clip does not contain', () => {
    const strip = thumbStrip(view(2, 0), { start: 0, length: 37, inFrame: 5 });
    for (const s of strip!.slots) {
      expect(s.sourceFrame).toBeGreaterThanOrEqual(5);
      expect(s.sourceFrame).toBeLessThan(5 + 37);
    }
  });
});

describe('the grid is anchored to the clip, so the cache survives', () => {
  it('asks for the same frames after a scroll that moves nothing off screen', () => {
    // Scrolling is the most frequent thing that happens to a timeline. If the
    // grid were anchored to the viewport, every pixel of scroll would ask for a
    // different set of source frames and every one of them would be a decode.
    const a = thumbStrip(view(4, 400), WHOLE)!;
    const b = thumbStrip(view(4, 430), WHOLE)!;
    const shared = sources(b.slots).filter((f) =>
      sources(a.slots).includes(f),
    );
    expect(shared.length).toBeGreaterThanOrEqual(sources(b.slots).length - 1);
  });

  it('halves the work of a zoom step: the coarser grid sits ON the finer one', () => {
    // Zoom is x2, so a step size rounded to a power of two means zooming out
    // keeps every other thumbnail. Any other rounding throws the whole cache
    // away on every press. (The two strips do not cover the same footage — the
    // coarser one sees twice as much — so the claim is about the GRID: every
    // frame the coarse strip wants is one the fine grid also lands on, and is
    // therefore already decoded if it was ever on screen.)
    const fine = thumbStrip(view(8, 0), WHOLE)!;
    const coarse = thumbStrip(view(4, 0), WHOLE)!;
    expect(coarse.step).toBe(fine.step * 2);
    for (const f of sources(coarse.slots)) {
      expect(f % fine.step).toBe(0);
    }
    const shared = sources(coarse.slots).filter((f) =>
      sources(fine.slots).includes(f),
    );
    expect(shared.length).toBeGreaterThan(1);
  });

  it('steps by a power of two at every scale', () => {
    for (let scale = 0.05; scale <= 40; scale *= 1.37) {
      const strip = thumbStrip(view(scale, 0), WHOLE);
      const step = strip!.step;
      expect(step).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(Math.log2(step))).toBe(true);
    }
  });

  it('puts one picture per frame once a frame is wider than a picture', () => {
    const strip = thumbStrip(view(THUMB_PX + 10, 0), WHOLE);
    expect(strip!.step).toBe(1);
  });
});

describe('where the pictures are drawn', () => {
  it('tiles without a gap or an overlap', () => {
    const strip = thumbStrip(view(4, 600), WHOLE)!;
    for (let i = 1; i < strip.slots.length; i++) {
      expect(strip.slots[i].x).toBeCloseTo(
        strip.slots[i - 1].x + strip.slots[i - 1].widthPx,
        6,
      );
    }
  });

  it('starts at the strip’s own origin and stays inside its width', () => {
    const strip = thumbStrip(view(4, 600), WHOLE)!;
    expect(strip.slots[0].x).toBe(0);
    const last = strip.slots[strip.slots.length - 1];
    expect(last.x + last.widthPx).toBeCloseTo(strip.widthPx, 6);
  });

  it('places the strip relative to the CLIP, so it can live inside it', () => {
    // The canvas is a child of the clip button, which is itself positioned. An
    // offset measured from the document would put it a screen away.
    const v = view(4, 600);
    const clip = { start: 100, length: 600, inFrame: 0 };
    const strip = thumbStrip(v, clip)!;
    const firstX = frameToX(v, strip.slots[0].frame) - frameToX(v, clip.start);
    expect(strip.offsetPx).toBeCloseTo(firstX, 6);
    expect(strip.offsetPx).toBeGreaterThanOrEqual(0);
  });

  it('never runs past the end of a clip that ends mid-picture', () => {
    // 37 frames at a 16-frame step is two full pictures and a stub. Drawing the
    // stub full width would paint over the clip after it.
    const v = view(4, 0);
    const clip = { start: 0, length: 37, inFrame: 0 };
    const strip = thumbStrip(v, clip)!;
    expect(strip.offsetPx + strip.widthPx).toBeLessThanOrEqual(
      frameToX(v, clip.length) + 1e-6,
    );
  });

  it('covers the visible part of the clip from edge to edge', () => {
    const v = view(4, 600);
    const strip = thumbStrip(v, WHOLE)!;
    // The grid starts on a step boundary at or before the left edge, so the
    // strip may begin slightly off-screen — but it must not begin AFTER it.
    expect(strip.offsetPx).toBeLessThanOrEqual(v.scrollPx);
    expect(strip.offsetPx + strip.widthPx).toBeGreaterThanOrEqual(
      v.scrollPx + v.widthPx,
    );
  });
});

describe('the cases that would otherwise throw or draw nothing', () => {
  it('has nothing to draw for a clip that is off screen', () => {
    expect(
      thumbStrip(view(4, 0), { start: 5000, length: 60, inFrame: 0 }),
    ).toBe(null);
    expect(
      thumbStrip(view(4, 100_000), { start: 0, length: 60, inFrame: 0 }),
    ).toBe(null);
  });

  it('has nothing to draw before the strip has been measured', () => {
    expect(thumbStrip(view(0, 0), WHOLE)).toBe(null);
    expect(thumbStrip({ ...view(4, 0), widthPx: 0 }, WHOLE)).toBe(null);
  });

  it('has nothing to draw for a clip with no length', () => {
    expect(thumbStrip(view(4, 0), { start: 0, length: 0, inFrame: 0 })).toBe(
      null,
    );
  });

  it('survives a scale the zoom clamps would never produce', () => {
    const strip = thumbStrip(view(1e9, 0), WHOLE);
    expect(strip!.slots.length).toBeLessThanOrEqual(WIDTH / THUMB_PX + 2);
    expect(strip!.step).toBe(1);
  });
});
