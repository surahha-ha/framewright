// framewright — the audio waveform's arithmetic, specified before it exists.
//
// The thumbnail strip's expensive thing was a DECODE, so its module bounded the
// number of pictures. Audio is already decoded — `engine/audio.ts` holds a whole
// AudioBuffer per asset — so the expensive thing here is the REDUCTION: a
// three-minute stereo source is sixteen million samples, and drawing a
// nine-hundred-pixel strip from them on every scroll pixel is the same mistake
// wearing different clothes.
//
// So this module owns two answers, and both are arithmetic:
//   - build the peak pyramid ONCE, each level half the resolution of the one
//     below, so a zoom press (x2) moves exactly one level;
//   - given a view and a clip, which level do I read and which of its buckets.
import { describe, expect, it } from 'vitest';
import { fitScale, type View } from './timelineView';
import type { Rational } from './types';
import {
  BASE_BUCKET,
  buildPyramid,
  peakLevelFor,
  waveAmplitude,
  wavePlan,
  type Pyramid,
} from './waveform';

const FPS: Rational = { num: 30, den: 1 };
const RATE = 48_000;
/** 48000 / 30 — a whole number, so the tests can say what they mean. */
const SAMPLES_PER_FRAME = RATE / 30;
const WIDTH = 900;
const MINUTE = 60 * 30;

function view(scale: number, scrollPx = 0, total = MINUTE): View {
  return { total, widthPx: WIDTH, scale, scrollPx };
}

/** A ramp is the easiest signal to check a reduction against: the max of any
 *  window is its last sample and the min is its first. */
function ramp(n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = i / n;
  return out;
}

function silence(n: number): Float32Array {
  return new Float32Array(n);
}

/** Seconds of audio, as a one-channel pyramid. */
function pyramidOf(seconds: number, make = ramp): Pyramid {
  return buildPyramid([make(Math.round(seconds * RATE))], RATE);
}

const WHOLE = { start: 0, length: 90, inFrame: 0 };

describe('building the peak pyramid', () => {
  it('reduces the first level to the min and max of each bucket', () => {
    const samples = ramp(BASE_BUCKET * 4);
    const p = buildPyramid([samples], RATE);
    const level0 = p.levels[0];
    expect(level0.bucket).toBe(BASE_BUCKET);
    expect(level0.min).toHaveLength(4);
    for (let b = 0; b < 4; b++) {
      expect(level0.min[b]).toBeCloseTo(samples[b * BASE_BUCKET], 6);
      expect(level0.max[b]).toBeCloseTo(samples[(b + 1) * BASE_BUCKET - 1], 6);
    }
  });

  it('spans every channel, so a sound in one ear is not drawn as silence', () => {
    const n = BASE_BUCKET;
    const left = silence(n);
    const right = silence(n);
    right[10] = 0.8;
    left[20] = -0.6;
    const p = buildPyramid([left, right], RATE);
    expect(p.levels[0].max[0]).toBeCloseTo(0.8, 6);
    expect(p.levels[0].min[0]).toBeCloseTo(-0.6, 6);
  });

  it('keeps a short tail instead of dropping it', () => {
    // 2.5 buckets: the last one is half full and must still be drawn, or the
    // wave stops before the clip does.
    const n = BASE_BUCKET * 2 + BASE_BUCKET / 2;
    const p = buildPyramid([ramp(n)], RATE);
    expect(p.levels[0].min).toHaveLength(3);
    expect(p.length).toBe(n);
    // The tail bucket reads only the samples that exist — not zeros past the
    // end, which would draw a fake silence at the end of every clip.
    const samples = ramp(n);
    expect(p.levels[0].max[2]).toBeCloseTo(samples[n - 1], 6);
  });

  it('halves each level, and each parent is the extreme of its two children', () => {
    const p = buildPyramid([ramp(BASE_BUCKET * 8)], RATE);
    expect(p.levels[0].min).toHaveLength(8);
    expect(p.levels[1].min).toHaveLength(4);
    expect(p.levels[1].bucket).toBe(BASE_BUCKET * 2);
    for (let b = 0; b < 4; b++) {
      expect(p.levels[1].min[b]).toBeCloseTo(
        Math.min(p.levels[0].min[b * 2], p.levels[0].min[b * 2 + 1]),
        6,
      );
      expect(p.levels[1].max[b]).toBeCloseTo(
        Math.max(p.levels[0].max[b * 2], p.levels[0].max[b * 2 + 1]),
        6,
      );
    }
  });

  it('stops when a level is one bucket wide', () => {
    const p = buildPyramid([ramp(BASE_BUCKET * 8)], RATE);
    const last = p.levels[p.levels.length - 1];
    expect(last.min).toHaveLength(1);
    // 8 -> 4 -> 2 -> 1
    expect(p.levels).toHaveLength(4);
  });

  it('carries an odd level up without losing its last bucket', () => {
    const p = buildPyramid([ramp(BASE_BUCKET * 5)], RATE);
    expect(p.levels[0].min).toHaveLength(5);
    expect(p.levels[1].min).toHaveLength(3);
    expect(p.levels[1].max[2]).toBeCloseTo(p.levels[0].max[4], 6);
  });

  it('is empty, not broken, for an asset with no samples', () => {
    const p = buildPyramid([new Float32Array(0)], RATE);
    expect(p.levels).toHaveLength(0);
    expect(p.length).toBe(0);
    expect(wavePlan(view(1), WHOLE, FPS, p)).toBeNull();
  });

  it('is empty, not broken, for an asset with no channels at all', () => {
    const p = buildPyramid([], RATE);
    expect(p.levels).toHaveLength(0);
    expect(p.length).toBe(0);
  });
});

describe('which level a zoom reads', () => {
  it('picks the finest level whose column is still a whole pixel wide', () => {
    const p = pyramidOf(4);
    // 1024 samples per pixel: a bucket of 1024 is exactly one pixel. Finer
    // would hand the canvas two rectangles for the same pixel and draw the
    // identical envelope.
    expect(p.levels[peakLevelFor(p, 1024)].bucket).toBe(1024);
    // And between two rungs it rounds UP, never down: 700 samples per pixel
    // takes the 1024 bucket, because 512 would be drawn at 0.7px.
    expect(p.levels[peakLevelFor(p, 700)].bucket).toBe(1024);
  });

  it('moves exactly one level per zoom press, which is the whole point', () => {
    // ZOOM_STEP is 2, so samples-per-pixel halves. If the ladder were anything
    // other than powers of two, a press would land between levels and the
    // pyramid would be rebuilt or resampled on every press.
    const p = pyramidOf(20);
    let previous = peakLevelFor(p, 4096);
    for (const spp of [2048, 1024, 512, 256, 128]) {
      const level = peakLevelFor(p, spp);
      expect(level).toBe(previous - 1);
      previous = level;
    }
  });

  it('bottoms out at the finest level rather than inventing detail', () => {
    const p = pyramidOf(4);
    expect(peakLevelFor(p, 1)).toBe(0);
    expect(peakLevelFor(p, 0)).toBe(0);
    expect(peakLevelFor(p, -1)).toBe(0);
  });

  it('tops out at the coarsest level rather than reading past the pyramid', () => {
    const p = pyramidOf(4);
    expect(peakLevelFor(p, 1e12)).toBe(p.levels.length - 1);
  });
});

describe('which buckets a clip draws', () => {
  it('is bounded by the WINDOW, never by how long the clip is', () => {
    // The same bound the thumbnail strip has, for a different reason: not decode
    // cost but the number of rectangles handed to a canvas every scroll pixel.
    const long = 10 * 60 * 30;
    const p = pyramidOf(10 * 60);
    const plan = wavePlan(
      view(40, 100_000, long),
      { start: 0, length: long, inFrame: 0 },
      FPS,
      p,
    );
    expect(plan).not.toBeNull();
    expect(plan!.count).toBeLessThanOrEqual(WIDTH + 2);
    expect(plan!.count * plan!.bucketPx).toBeLessThanOrEqual(
      WIDTH + 2 * plan!.bucketPx,
    );
  });

  it('holds that bound at every zoom, scrolled anywhere', () => {
    const long = 10 * 60 * 30;
    const p = pyramidOf(10 * 60);
    const clip = { start: 0, length: long, inFrame: 0 };
    for (const scale of [fitScale(long, WIDTH), 0.5, 2, 8, 40]) {
      for (const scrollPx of [0, 1000, 50_000, long * scale - WIDTH]) {
        const plan = wavePlan(
          view(scale, Math.max(0, scrollPx), long),
          clip,
          FPS,
          p,
        );
        if (!plan) continue;
        expect(plan.count).toBeLessThanOrEqual(WIDTH + 2);
      }
    }
  });

  it('starts at the clip, not at the document, and not at the viewport', () => {
    const p = pyramidOf(4);
    const plan = wavePlan(
      view(4),
      { start: 10, length: 60, inFrame: 0 },
      FPS,
      p,
    );
    expect(plan).not.toBeNull();
    // Positions are the CLIP's own coordinates, so a canvas parented to the
    // clip button can draw them without knowing where the clip is.
    expect(plan!.offsetPx).toBeLessThanOrEqual(0.5);
    expect(plan!.offsetPx).toBeGreaterThan(-plan!.bucketPx - 1e-9);
  });

  it('reads the clip’s IN-POINT, not the head of the file', () => {
    const p = pyramidOf(4);
    const head = wavePlan(
      view(4),
      { start: 0, length: 30, inFrame: 0 },
      FPS,
      p,
    );
    const middle = wavePlan(
      view(4),
      { start: 0, length: 30, inFrame: 30 },
      FPS,
      p,
    );
    expect(head).not.toBeNull();
    expect(middle).not.toBeNull();
    expect(middle!.firstBucket).toBeGreaterThan(head!.firstBucket);
    // One second in, at 48kHz, is 48000 samples along.
    const level = head!.level;
    expect(middle!.firstBucket - head!.firstBucket).toBe(
      Math.floor((30 * SAMPLES_PER_FRAME) / p.levels[level].bucket),
    );
  });

  it('follows the scroll: scrolling right reads later samples', () => {
    const p = pyramidOf(4);
    const clip = { start: 0, length: 120, inFrame: 0 };
    const left = wavePlan(view(20, 0), clip, FPS, p);
    const right = wavePlan(view(20, 400), clip, FPS, p);
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(right!.firstBucket).toBeGreaterThan(left!.firstBucket);
  });

  it('never reads past the end of the audio it has', () => {
    // A clip longer than its own soundtrack — a source whose audio track is
    // shorter than its video, which is ordinary.
    const p = pyramidOf(1);
    const plan = wavePlan(
      view(8),
      { start: 0, length: 300, inFrame: 0 },
      FPS,
      p,
    );
    expect(plan).not.toBeNull();
    const level = p.levels[plan!.level];
    expect(plan!.firstBucket + plan!.count).toBeLessThanOrEqual(
      level.min.length,
    );
  });

  it('draws nothing at all when the clip starts past the end of the audio', () => {
    const p = pyramidOf(1);
    const plan = wavePlan(
      view(8),
      { start: 0, length: 30, inFrame: 300 },
      FPS,
      p,
    );
    expect(plan).toBeNull();
  });

  it('doubles the detail for one zoom press over the same footage', () => {
    const p = pyramidOf(20);
    const clip = { start: 0, length: 600, inFrame: 0 };
    const out = wavePlan(view(2), clip, FPS, p);
    const inn = wavePlan(view(4), clip, FPS, p);
    expect(out).not.toBeNull();
    expect(inn).not.toBeNull();
    expect(out!.bucket).toBe(inn!.bucket * 2);
    expect(inn!.level).toBe(out!.level - 1);
  });

  it('says nothing to draw for a clip that is off screen', () => {
    const p = pyramidOf(4);
    expect(
      wavePlan(view(4, 5000), { start: 0, length: 30, inFrame: 0 }, FPS, p),
    ).toBeNull();
  });

  it('says nothing to draw before the strip has been measured', () => {
    const p = pyramidOf(4);
    const unmeasured: View = { total: 90, widthPx: 0, scale: 0, scrollPx: 0 };
    expect(wavePlan(unmeasured, WHOLE, FPS, p)).toBeNull();
  });

  it('says nothing to draw for a clip with no length', () => {
    const p = pyramidOf(4);
    expect(
      wavePlan(view(4), { start: 0, length: 0, inFrame: 0 }, FPS, p),
    ).toBeNull();
  });

  it('lays its buckets out edge to edge, with no gap and no overlap', () => {
    const p = pyramidOf(4);
    const plan = wavePlan(
      view(6),
      { start: 0, length: 90, inFrame: 0 },
      FPS,
      p,
    );
    expect(plan).not.toBeNull();
    expect(plan!.widthPx).toBeCloseTo(plan!.count * plan!.bucketPx, 6);
    // And it covers the visible part of the clip: 90 frames at 6px is 540px,
    // which fits inside the 900px window, so the whole clip is drawn.
    expect(plan!.offsetPx + plan!.widthPx).toBeGreaterThanOrEqual(
      540 - plan!.bucketPx,
    );
  });
});

describe('how loud a sample is drawn', () => {
  it('lifts ordinary audio off the centre line', () => {
    // The number that made this exist: the repo's own fixture peaks at 0.19,
    // which is 1.5px of an 18px band drawn literally — a flat line with
    // nothing wrong with it. Curved, it is nearly half the band.
    expect(waveAmplitude(0.19)).toBeGreaterThan(0.4);
    expect(waveAmplitude(0.05)).toBeGreaterThan(0.2);
  });

  it('keeps louder bigger, so two clips can still be compared', () => {
    let previous = -1;
    for (const v of [0, 0.01, 0.1, 0.25, 0.5, 0.8, 1]) {
      const drawn = waveAmplitude(v);
      expect(drawn).toBeGreaterThan(previous);
      previous = drawn;
    }
  });

  it('keeps the sign, so a trough stays below the line', () => {
    expect(waveAmplitude(-0.25)).toBeCloseTo(-waveAmplitude(0.25), 12);
    expect(waveAmplitude(-1)).toBe(-1);
  });

  it('leaves silence and full scale exactly where they are', () => {
    expect(waveAmplitude(0)).toBe(0);
    expect(waveAmplitude(1)).toBe(1);
  });

  it('never leaves the band, whatever the float says', () => {
    // An AudioBuffer is float and is allowed to go past full scale; the 18px
    // band is not.
    expect(waveAmplitude(4)).toBe(1);
    expect(waveAmplitude(-4)).toBe(-1);
    expect(waveAmplitude(NaN)).toBe(0);
    expect(waveAmplitude(Infinity)).toBe(0);
  });
});
