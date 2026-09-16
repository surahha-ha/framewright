// framewright — silence auto-cut (pure). ADR-0016.
//
// Three questions, three functions, no DOM and no decoding:
//
//   - `silentRuns`: where is a SOURCE quiet for long enough to matter? Read
//     from the finest level of the waveform's own peak pyramid — the 128-sample
//     buckets `buildPyramid` already makes for the strip — so nothing here
//     walks a sample. The answer is in source frames, with the padding already
//     taken off, and it is memoised per pyramid: the toolbar asks on every
//     render whether the button can run, and a pyramid never changes once
//     built (a re-linked file is a new object).
//   - `silencePlan`: which TIMELINE frames go, given the clips that show those
//     sources. A run is cut only where a clip actually shows it, so a clip
//     trimmed into the middle of a pause loses only the part it has, and a run
//     that spans a split is cut once per piece.
//   - `silencePatch`: the plan as one patch — every split and ripple delete
//     folded into one forward list with one exact inverse, so the whole cut
//     is ONE undo step (ADR-0006's promise for a drag, kept for a button).
//
// The rule is the owner's, decided on 2026-09-14 (docs/STATUS.md, E9 plan,
// and ADR-0016 for the why): an absolute level, a minimum length, a padding,
// a floor. The constants live here and nowhere in the UI in this unit.

import type { Clip, Project, Rational } from './types';
import type { Op, Patch } from './ops';
import { videoTrack } from './timeline';
import { frameToSec, sampleToFrame, secToSample } from './time';
import { carriedFields } from './clipboard';
import { rippleSubtitles, subtitleDiffOps } from './subtitles';
import { imageDiffOps, rippleImages } from './images';
import type { Pyramid } from './waveform';

/** A bucket is quiet when its peak is below this: -40 dBFS, as a linear
 *  magnitude. Absolute, not relative to the clip — a whispered take is not
 *  "silent" because the rest of the file is louder. */
export const SILENCE_PEAK = 0.01;
/** A run of quiet buckets counts from this long. Shorter is a breath. */
export const SILENCE_MIN_SEC = 0.5;
/** Kept on each side of a run, so a consonant at the edge is not clipped.
 *  Rounded UP to whole frames: when in doubt, keep a frame. */
export const SILENCE_PAD_SEC = 0.2;
/** A cut that would remove less than this is not made — after the padding,
 *  and after a clip's edge has taken its share. */
export const SILENCE_FLOOR_SEC = 0.1;

/** A range of SOURCE frames to remove, half-open like everything else. */
export interface SourceRange {
  inFrame: number;
  outFrame: number;
}

/** Peaks by asset, from whoever holds them — the UI's cache in the app, a
 *  fixture in a test. Null means "not measured yet" (or no audio bound); a
 *  pyramid with no levels means "measured, and there is nothing". */
export type PeaksSource = (assetId: string) => Pyramid | null;

const memo = new WeakMap<Pyramid, Map<string, SourceRange[]>>();

/**
 * The quiet runs of a source, as the frames that would be cut: each run at
 * least `SILENCE_MIN_SEC` long, with `SILENCE_PAD_SEC` taken off each end
 * (rounded up to the frame), and dropped when under `SILENCE_FLOOR_SEC` is
 * left. In source frames at `fps`, ascending, disjoint.
 *
 * Memoised per pyramid and fps, and the same array is returned each time —
 * so a render may ask, and so a caller may compare by identity.
 */
export function silentRuns(pyramid: Pyramid, fps: Rational): SourceRange[] {
  const key = `${fps.num}/${fps.den}`;
  let byFps = memo.get(pyramid);
  if (!byFps) {
    byFps = new Map();
    memo.set(pyramid, byFps);
  }
  const hit = byFps.get(key);
  if (hit) return hit;
  const runs = findRuns(pyramid, fps);
  byFps.set(key, runs);
  return runs;
}

function findRuns(pyramid: Pyramid, fps: Rational): SourceRange[] {
  const level = pyramid.levels[0];
  if (!level || !(pyramid.sampleRate > 0)) return [];
  const sr = pyramid.sampleRate;
  const minSamples = secToSample(SILENCE_MIN_SEC, sr);
  const padSamples = secToSample(SILENCE_PAD_SEC, sr);
  const out: SourceRange[] = [];

  const emit = (firstBucket: number, endBucket: number) => {
    const from = firstBucket * level.bucket;
    // The last bucket may be partial; it holds only the samples that exist.
    const to = Math.min(pyramid.length, endBucket * level.bucket);
    if (to - from < minSamples) return;
    // Padding in, rounded so that at least the padding is kept on each side.
    const inFrame = sampleToFrame(from + padSamples, sr, fps, 'ceil');
    const outFrame = sampleToFrame(to - padSamples, sr, fps, 'floor');
    if (outFrame <= inFrame) return;
    if (frameToSec(outFrame - inFrame, fps) < SILENCE_FLOOR_SEC) return;
    out.push({ inFrame, outFrame });
  };

  const count = level.max.length;
  let start = -1;
  for (let b = 0; b <= count; b++) {
    const quiet =
      b < count &&
      Math.max(Math.abs(level.max[b]), Math.abs(level.min[b])) < SILENCE_PEAK;
    if (quiet) {
      if (start < 0) start = b;
      continue;
    }
    if (start >= 0) {
      emit(start, b);
      start = -1;
    }
  }
  return out;
}

/** One stretch of the TIMELINE to remove, in the frame numbers the document
 *  has BEFORE any cut is made. */
export interface SilenceCut {
  clipId: string;
  startFrame: number;
  length: number;
}

export interface SilencePlan {
  /** In timeline order, disjoint. Empty when there is nothing to do. */
  cuts: SilenceCut[];
  /** The sum of the cuts. */
  removedFrames: number;
  /** Clips whose source has been measured (sound or none). */
  read: number;
  /** Clips whose peaks have not arrived — skipped, and worth saying. */
  unread: number;
  /** Clips with the sound switched off — skipped on purpose (ADR-0016). */
  muted: number;
}

/**
 * Which timeline frames go. A muted clip is left alone: the sound was taken
 * out of the question by the user, and cutting its pauses would remove
 * pictures they kept on purpose. A clip whose peaks are not in yet is
 * skipped and counted, never guessed at.
 */
export function silencePlan(project: Project, peaks: PeaksSource): SilencePlan {
  const fps = project.timeline.fps;
  const cuts: SilenceCut[] = [];
  let read = 0;
  let unread = 0;
  let muted = 0;
  for (const clip of videoTrack(project).clips) {
    if (clip.muted) {
      muted++;
      continue;
    }
    const pyramid = peaks(clip.assetId);
    if (!pyramid) {
      unread++;
      continue;
    }
    read++;
    for (const run of silentRuns(pyramid, fps)) {
      const inFrame = Math.max(run.inFrame, clip.inFrame);
      const outFrame = Math.min(run.outFrame, clip.outFrame);
      const length = outFrame - inFrame;
      // A clip's edge can leave a sliver of a run; the floor applies to what
      // would actually be cut, not to the run it came from.
      if (length <= 0 || frameToSec(length, fps) < SILENCE_FLOOR_SEC) continue;
      cuts.push({
        clipId: clip.id,
        startFrame: clip.startFrame + (inFrame - clip.inFrame),
        length,
      });
    }
  }
  const removedFrames = cuts.reduce((n, c) => n + c.length, 0);
  return { cuts, removedFrames, read, unread, muted };
}

/** What is left of a clip after its cuts: the source ranges kept, each
 *  with where it lands on the timeline. */
interface Piece {
  inFrame: number;
  outFrame: number;
  startFrame: number;
}

interface Step {
  forward: Op;
  inverse: Op;
}

/**
 * The plan as one patch. The head of each clip keeps the clip's id (and its
 * fade-in, if the head was not cut away); every later piece is a new clip
 * with the next deterministic id, carrying the clip's sound and picture
 * fields (`carriedFields`) and — the last piece only, if the tail was not
 * cut — the fade-out, each fade written at what its piece can hold, exactly
 * as `clip.split` does. A clip that lies wholly inside a run is removed.
 * Everything after a cut slides left by it; the words go with the pictures.
 */
export function silencePatch(project: Project, plan: SilencePlan): Patch {
  if (plan.cuts.length === 0) {
    throw new Error('timeline.cutSilence: nothing to cut');
  }
  const track = videoTrack(project);
  const byClip = new Map<string, SilenceCut[]>();
  for (const cut of plan.cuts) {
    const list = byClip.get(cut.clipId) ?? [];
    list.push(cut);
    byClip.set(cut.clipId, list);
  }

  // The new layout, walked forward so positions and ids come out in timeline
  // order. Ops are then emitted from the LAST clip to the first, so every
  // index in them is the original one: an insert after a later clip cannot
  // move an earlier clip, and the inverse, reversed, finds the same indices.
  let removedBefore = 0;
  let nextId = project.nextId;
  const layout = track.clips.map((clip, index) => {
    const cuts = byClip.get(clip.id) ?? [];
    const pieces: Piece[] = [];
    let cursor = clip.inFrame;
    let pos = clip.startFrame - removedBefore;
    for (const cut of cuts) {
      const cutIn = clip.inFrame + (cut.startFrame - clip.startFrame);
      if (cutIn > cursor) {
        pieces.push({ inFrame: cursor, outFrame: cutIn, startFrame: pos });
        pos += cutIn - cursor;
      }
      cursor = cutIn + cut.length;
      removedBefore += cut.length;
    }
    if (clip.outFrame > cursor) {
      pieces.push({
        inFrame: cursor,
        outFrame: clip.outFrame,
        startFrame: pos,
      });
    }
    const ids = pieces.map((_, j) => (j === 0 ? clip.id : `clip_${nextId++}`));
    return { index, clip, pieces, ids };
  });

  const steps: Step[] = [];
  for (const { index, clip, pieces, ids } of [...layout].reverse()) {
    if (pieces.length === 0) {
      steps.push({
        forward: { kind: 'removeClip', trackId: track.id, index },
        inverse: { kind: 'insertClip', trackId: track.id, index, clip },
      });
      continue;
    }
    const last = pieces.length - 1;
    const fadeInOf = (piece: Piece, j: number) =>
      j === 0 && piece.inFrame === clip.inFrame && clip.fadeIn !== undefined
        ? Math.min(clip.fadeIn, piece.outFrame - piece.inFrame)
        : undefined;
    const fadeOutOf = (piece: Piece, j: number) =>
      j === last &&
      piece.outFrame === clip.outFrame &&
      clip.fadeOut !== undefined
        ? Math.min(clip.fadeOut, piece.outFrame - piece.inFrame)
        : undefined;

    const head = pieces[0];
    steps.push({
      forward: {
        kind: 'updateClip',
        trackId: track.id,
        clipId: clip.id,
        changes: {
          startFrame: head.startFrame,
          inFrame: head.inFrame,
          outFrame: head.outFrame,
          fadeIn: fadeInOf(head, 0),
          fadeOut: fadeOutOf(head, 0),
        },
      },
      inverse: {
        kind: 'updateClip',
        trackId: track.id,
        clipId: clip.id,
        changes: {
          startFrame: clip.startFrame,
          inFrame: clip.inFrame,
          outFrame: clip.outFrame,
          fadeIn: clip.fadeIn,
          fadeOut: clip.fadeOut,
        },
      },
    });
    for (let j = 1; j < pieces.length; j++) {
      const piece = pieces[j];
      const made: Clip = {
        id: ids[j],
        assetId: clip.assetId,
        startFrame: piece.startFrame,
        inFrame: piece.inFrame,
        outFrame: piece.outFrame,
        ...carriedFields({
          ...clip,
          fadeIn: undefined,
          fadeOut: fadeOutOf(piece, j),
        }),
      };
      steps.push({
        forward: {
          kind: 'insertClip',
          trackId: track.id,
          index: index + j,
          clip: made,
        },
        inverse: { kind: 'removeClip', trackId: track.id, index: index + j },
      });
    }
  }
  if (nextId !== project.nextId) {
    steps.push({
      forward: { kind: 'setNextId', value: nextId },
      inverse: { kind: 'setNextId', value: project.nextId },
    });
  }

  // The words: each cut rippled where it sits once the cuts before it are
  // made, on a running copy — the same shape as `timeline.closeGaps`.
  // ...and the pictures, on their own running copy through the same cuts: an
  // image over a pause goes with it, one after a pause slides left (ADR-0020).
  let words = project.subtitles;
  let pictures = project.images;
  let removed = 0;
  for (const cut of plan.cuts) {
    words = rippleSubtitles(words, cut.startFrame - removed, -cut.length);
    pictures = rippleImages(pictures, cut.startFrame - removed, -cut.length);
    removed += cut.length;
  }
  const diff = subtitleDiffOps(project.subtitles, words);
  const pics = imageDiffOps(project.images, pictures);

  return {
    forward: [...steps.map((s) => s.forward), ...diff.forward, ...pics.forward],
    inverse: [
      ...pics.inverse,
      ...diff.inverse,
      ...steps.map((s) => s.inverse).reverse(),
    ],
  };
}
