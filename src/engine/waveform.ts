// framewright — the audio waveform's arithmetic (pure).
//
// Sibling of `engine/thumbnails.ts`, and the same question asked of a different
// medium: given a visible frame range and a pixels-per-frame, what do I draw?
// What is NOT the same is where the cost sits.
//
// A thumbnail costs a DECODE, so that module's whole job is to ask for as few
// pictures as it can. Audio is already decoded — `engine/audio.ts` holds a whole
// `AudioBuffer` per asset — so nothing here is waiting on a codec. The cost is
// the REDUCTION: three minutes of stereo is sixteen million samples, and walking
// them to draw a nine-hundred-pixel strip on every scroll pixel would pin the
// tab just as thoroughly as a decode per frame would.
//
// So the samples are reduced ONCE, into a pyramid of min/max pairs where each
// level is half the resolution of the one below. `ZOOM_STEP` is 2, so one zoom
// press moves exactly one level — the same reason `thumbStep` is a power of two,
// arrived at from the other end. Building it is `buildPyramid`; choosing a level
// is `peakLevelFor`; `wavePlan` says which of that level's buckets a clip draws
// and where they go.
//
// The buckets are anchored to the SOURCE FILE, not to the clip and not to the
// viewport. That is not a preference: a pyramid level IS a partition of the
// file, so trimming a clip cannot move its buckets, and two clips cut from the
// same source read the same array.
//
// No DOM, no WebAudio, no React: `buildPyramid` takes plain `Float32Array`s so
// it can be tested in Node. Pulling those out of an `AudioBuffer`, caching the
// result and drawing it is `src/ui/waveform.ts`.

import { frameAtX, frameToX, type View } from './timelineView';
import { frameToSec } from './time';
import type { Rational } from './types';

/**
 * Samples in one bucket of the finest level.
 *
 * 128 samples is 2.7ms at 48kHz. At the deepest zoom the editor allows (40px
 * per frame, so a pixel is 40 samples) one bucket is 3.2px wide, which is the
 * blockiest the wave ever gets; the alternative is a finer base that costs
 * proportionally more memory at every level for detail no one is looking for.
 * A waveform answers "where is the sound", not "what is sample 41,000".
 */
export const BASE_BUCKET = 128;

/**
 * A sample value, curved for a band eighteen pixels tall.
 *
 * Drawn at its literal amplitude, ordinary audio is invisible here. The repo's
 * own fixture peaks at 0.19 — about -14 dBFS, an unremarkable level — which in
 * a band of that height is one and a half pixels either side of the centre: a
 * wave that is arithmetically perfect and reads as a flat line. That was found
 * by looking at it in a browser, after the gate was green.
 *
 * A square root is the smallest honest fix. It is monotonic and sign-preserving,
 * so louder is still bigger and the shape is still the shape; it is the same
 * family of curve a dB meter uses, for the same reason. And because it depends
 * on nothing but the value, two clips cut from different sources stay comparable
 * — which normalising each asset to its own peak, the other obvious fix, would
 * quietly destroy.
 *
 * Clamped: an `AudioBuffer` is float and may exceed ±1, and the band may not.
 */
export function waveAmplitude(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.min(1, Math.sqrt(Math.abs(value)));
  return value < 0 ? -magnitude : magnitude;
}

/** One rung: the min and the max of every `bucket` samples. */
export interface PeakLevel {
  /** How many source samples one entry stands for. A power of two times `BASE_BUCKET`. */
  bucket: number;
  min: Float32Array;
  max: Float32Array;
}

export interface Pyramid {
  sampleRate: number;
  /** Samples in the source. The last bucket of level 0 may be partial. */
  length: number;
  /** Finest first. Empty when there is no audio to reduce. */
  levels: PeakLevel[];
}

/** The clip, in the only terms this module needs — the same three numbers
 *  `thumbStrip` asks for, deliberately not shared: they are two modules'
 *  answers to the same question and the merge waits for the third. */
export interface WaveSpan {
  /** Timeline frame the clip starts on. */
  start: number;
  /** How many frames long it is. Half-open, like everything else. */
  length: number;
  /** The clip's in-point within its source. */
  inFrame: number;
}

export interface WavePlan {
  /** Left edge of the first bucket, in px from the CLIP's left edge. Slightly
   *  negative when the bucket grid starts just before the visible edge, which
   *  it usually does — the grid belongs to the file, not to the clip. */
  offsetPx: number;
  /** `count * bucketPx`. Bounded by the window plus a bucket, never by the clip. */
  widthPx: number;
  /** Index into `pyramid.levels`. */
  level: number;
  /** That level's bucket size, in samples. */
  bucket: number;
  /** First entry of that level to draw. */
  firstBucket: number;
  /** How many entries to draw. */
  count: number;
  /** How wide one entry is drawn, in CSS px. Always at least 1. */
  bucketPx: number;
}

const EMPTY: Pyramid = { sampleRate: 0, length: 0, levels: [] };

/**
 * Reduce decoded audio to a pyramid of peaks.
 *
 * Every channel folds into ONE pair per bucket. A waveform in a 44px clip is
 * one shape, and a sound in the right ear only must not be drawn as silence, so
 * the min and the max span all channels rather than being averaged — an average
 * cancels a signal that is out of phase between them.
 *
 * Runs in O(samples) once per asset, then O(buckets) per level, which is the
 * same total again. The caller decides when to pay it (see `src/ui/waveform.ts`).
 */
export function buildPyramid(
  channels: readonly Float32Array[],
  sampleRate: number,
  base = BASE_BUCKET,
): Pyramid {
  const length = channels.reduce((n, c) => Math.max(n, c.length), 0);
  if (length === 0 || channels.length === 0) return { ...EMPTY, sampleRate };

  const count = Math.ceil(length / base);
  const min = new Float32Array(count);
  const max = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    const from = b * base;
    // The tail is short, and it reads only the samples that exist. Padding it
    // with zeros would draw a fake silence at the end of every clip.
    const to = Math.min(length, from + base);
    let lo = Infinity;
    let hi = -Infinity;
    for (const channel of channels) {
      const end = Math.min(to, channel.length);
      for (let i = from; i < end; i++) {
        const v = channel[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    // A bucket past the end of every channel (only reachable when the channels
    // are ragged) is silence, not ±Infinity.
    min[b] = lo === Infinity ? 0 : lo;
    max[b] = hi === -Infinity ? 0 : hi;
  }

  const levels: PeakLevel[] = [{ bucket: base, min, max }];
  while (levels[levels.length - 1].min.length > 1) {
    const below = levels[levels.length - 1];
    const n = Math.ceil(below.min.length / 2);
    const up: PeakLevel = {
      bucket: below.bucket * 2,
      min: new Float32Array(n),
      max: new Float32Array(n),
    };
    for (let b = 0; b < n; b++) {
      const a = b * 2;
      const c = a + 1;
      // An odd level carries its last bucket up alone rather than dropping it.
      up.min[b] =
        c < below.min.length
          ? Math.min(below.min[a], below.min[c])
          : below.min[a];
      up.max[b] =
        c < below.max.length
          ? Math.max(below.max[a], below.max[c])
          : below.max[a];
    }
    levels.push(up);
  }

  return { sampleRate, length, levels };
}

/**
 * Which level to read at this many samples per pixel: the finest one whose
 * column is still at least a pixel wide.
 *
 * Going finer than that would hand the canvas two or three rectangles for the
 * same pixel — the envelope drawn is identical and the work is doubled. Going
 * coarser is not wrong either (a bigger bucket still holds the true extremes of
 * a wider window, so the shape stays honest) but it draws in visible steps.
 * Between those, the finest level that earns its rectangles.
 */
export function peakLevelFor(pyramid: Pyramid, samplesPerPx: number): number {
  const top = pyramid.levels.length - 1;
  if (top < 0) return 0;
  if (!(samplesPerPx > 0)) return 0;
  for (let i = 0; i <= top; i++) {
    if (pyramid.levels[i].bucket >= samplesPerPx) return i;
  }
  return top;
}

/**
 * The buckets one clip draws, or `null` when there are none — off screen, no
 * length, nothing measured yet, no audio, or a clip whose in-point is past the
 * end of its own soundtrack.
 *
 * Positions are the clip's own coordinates, like `thumbStrip`'s, so the result
 * can be drawn on a canvas parented to the clip button. The count is bounded by
 * the WINDOW: whatever the zoom and however long the clip, this is a screenful
 * of rectangles.
 */
export function wavePlan(
  view: View,
  clip: WaveSpan,
  fps: Rational,
  pyramid: Pyramid,
): WavePlan | null {
  if (!(view.scale > 0) || view.widthPx <= 0) return null;
  if (!(clip.length > 0)) return null;
  if (pyramid.levels.length === 0 || !(pyramid.sampleRate > 0)) return null;

  const clipStart = clip.start;
  const clipEnd = clipStart + clip.length;
  // Compared in frames, not in pixels, for the reason `thumbStrip` gives: the
  // strip is laid out from these numbers and a rounding difference here shows
  // up as a wave drawn a pixel outside the clip that owns it.
  const fromFrame = Math.max(clipStart, frameAtX(view, view.scrollPx));
  const toFrame = Math.min(
    clipEnd,
    frameAtX(view, view.scrollPx + view.widthPx),
  );
  if (toFrame <= fromFrame) return null;

  const samplesPerFrame = frameToSec(1, fps) * pyramid.sampleRate;
  const samplesPerPx = samplesPerFrame / view.scale;
  const level = peakLevelFor(pyramid, samplesPerPx);
  const rung = pyramid.levels[level];
  const bucketPx = rung.bucket / samplesPerPx;

  // Timeline frame -> sample of the SOURCE. The same mapping playback uses
  // (`buildAudioSchedule`'s `offsetSec`), so the wave shows what will be heard.
  const sampleAt = (frame: number) =>
    (clip.inFrame + (frame - clipStart)) * samplesPerFrame;

  const fromSample = sampleAt(fromFrame);
  if (fromSample >= pyramid.length) return null;
  const toSample = Math.min(pyramid.length, sampleAt(toFrame));

  const firstBucket = Math.max(0, Math.floor(fromSample / rung.bucket));
  const endBucket = Math.min(
    rung.min.length,
    Math.ceil(toSample / rung.bucket),
  );
  const count = endBucket - firstBucket;
  if (count <= 0) return null;

  const visiblePx = frameToX(view, fromFrame) - frameToX(view, clipStart);
  // The grid belongs to the file, so the first bucket usually starts a little
  // before the visible edge. Giving that back here is what keeps a bucket's
  // width on screen equal to the audio it stands for.
  const offsetPx =
    visiblePx - (fromSample - firstBucket * rung.bucket) / samplesPerPx;

  return {
    offsetPx,
    widthPx: count * bucketPx,
    level,
    bucket: rung.bucket,
    firstBucket,
    count,
    bucketPx,
  };
}
