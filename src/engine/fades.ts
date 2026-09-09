// framewright — fades (pure). ADR-0012.
//
// A clip's edge can be softened over its first or last N timeline frames. The
// document stores only N (`Clip.fadeIn` / `Clip.fadeOut`); everything else is
// derived here, so the preview, the export plan, the audio schedule and the
// strip all ask the same three questions and get the same answers:
//
//   - `effectiveFades`: how many frames each edge REALLY softens. A fade longer
//     than its clip is clamped when read, the head first — a trim never has to
//     rewrite a fade, and a clip that is lengthened again gets it back.
//   - `fadePartner`: what the edge softens INTO. The butted neighbour, when it
//     exists and does not soften the same cut itself; black otherwise. So the
//     one field is a dissolve at a cut and a fade from black at the start of
//     the video, and a fade never moves a clip (ADR-0006).
//   - `blendAt`: the second picture for a timeline frame and how much of it
//     shows. This is what the export plan records and the preview draws.
//
// A neighbour's picture beyond its own edge comes from the file's OVERHANG —
// the frames after its out-point or before its in-point. When the file has
// none (a clip that uses it whole), the last real frame is held rather than a
// frame that does not exist, and the file's length is trusted the same way
// trimming trusts it: unmeasured means none.

import type { Clip, Project, Rational } from './types';
import { clipLength, locateClip, resolveAt, sourceFrames } from './timeline';
import { frameToSec, secToFrame } from './time';

export type FadeEdge = 'in' | 'out';

/** What a fade lasts when nothing else is said. */
export const DEFAULT_FADE_SEC = 0.5;

/** Lengths the panel offers. Seconds, because that is how the choice is
 *  thought about; the document keeps frames. */
export const FADE_CHOICES_SEC = [0.3, 0.5, 1, 2];

export function defaultFadeFrames(fps: Rational): number {
  return Math.max(1, secToFrame(DEFAULT_FADE_SEC, fps));
}

export interface Fades {
  fadeIn: number;
  fadeOut: number;
}

/** The fades as drawn: clamped to the clip, head first, never overlapping. */
export function effectiveFades(clip: Clip): Fades {
  const length = clipLength(clip);
  const fadeIn = Math.min(Math.max(0, clip.fadeIn ?? 0), length);
  const fadeOut = Math.min(Math.max(0, clip.fadeOut ?? 0), length - fadeIn);
  return { fadeIn, fadeOut };
}

/** The most frames this edge may soften, given what the other edge takes. */
export function fadeLimit(clip: Clip, edge: FadeEdge): number {
  const length = clipLength(clip);
  const other = edge === 'in' ? (clip.fadeOut ?? 0) : (clip.fadeIn ?? 0);
  return length - Math.min(Math.max(0, other), length);
}

export type FadePartner =
  { kind: 'clip'; clipId: string; clip: Clip } | { kind: 'black' };

/** What the edge softens into. Null when the clip does not exist. */
export function fadePartner(
  project: Project,
  clipId: string,
  edge: FadeEdge,
): FadePartner | null {
  const found = locateClip(project, clipId);
  if (!found) return null;
  const { track, index, clip } = found;
  const neighbour = track.clips[edge === 'in' ? index - 1 : index + 1];
  if (!neighbour) return { kind: 'black' };
  const butted =
    edge === 'in'
      ? neighbour.startFrame + clipLength(neighbour) === clip.startFrame
      : clip.startFrame + clipLength(clip) === neighbour.startFrame;
  if (!butted) return { kind: 'black' };
  // Both sides softening one cut is a dip through black. Otherwise a's
  // picture would go dark on its last frame and come back at full strength
  // on the next, as the overhang under b.
  const theirs = effectiveFades(neighbour);
  const theyFadeToo = edge === 'in' ? theirs.fadeOut > 0 : theirs.fadeIn > 0;
  if (theyFadeToo) return { kind: 'black' };
  return { kind: 'clip', clipId: neighbour.id, clip: neighbour };
}

export interface Blend {
  /** The second picture's source, or null for black. */
  assetId: string | null;
  sourceFrame: number;
  /** How much of the second picture shows, (0, 1]. */
  weight: number;
}

/** The last frame the file can supply for this clip's asset; the clip's own
 *  last frame when the file's length is unknown. */
function lastSourceFrame(project: Project, clip: Clip): number {
  const total = sourceFrames(project, clip.assetId);
  return total === null ? clip.outFrame - 1 : total - 1;
}

/** The second picture at this timeline frame, or null for a plain frame. */
export function blendAt(project: Project, frame: number): Blend | null {
  const hit = resolveAt(project, frame);
  if (!hit) return null;
  const { clip } = hit;
  const length = clipLength(clip);
  const { fadeIn, fadeOut } = effectiveFades(clip);
  const k = frame - clip.startFrame;

  if (k < fadeIn) {
    const weight = (fadeIn - k) / fadeIn;
    const partner = fadePartner(project, clip.id, 'in');
    if (!partner || partner.kind === 'black') {
      return { assetId: null, sourceFrame: 0, weight };
    }
    const prev = partner.clip;
    return {
      assetId: prev.assetId,
      sourceFrame: Math.min(prev.outFrame + k, lastSourceFrame(project, prev)),
      weight,
    };
  }

  const j = k - (length - fadeOut);
  if (fadeOut > 0 && j >= 0) {
    const weight = (j + 1) / fadeOut;
    const partner = fadePartner(project, clip.id, 'out');
    if (!partner || partner.kind === 'black') {
      return { assetId: null, sourceFrame: 0, weight };
    }
    const next = partner.clip;
    return {
      assetId: next.assetId,
      sourceFrame: Math.max(0, next.inFrame - (fadeOut - j)),
      weight,
    };
  }

  return null;
}

/** "0.5초", "1초", "0.33초" — seconds, because a first-time user reads
 *  `00:00:15` as fifteen seconds. */
export function fadeSecondsText(frames: number, fps: Rational): string {
  const sec = Number(frameToSec(frames, fps).toFixed(2));
  return `${sec}초`;
}

/** What the edge goes to, in words. One source for the status line and the
 *  panel, so the two can never drift into two names for one thing. */
export function fadeIntoText(
  project: Project,
  clipId: string,
  edge: FadeEdge,
): string {
  const partner = fadePartner(project, clipId, edge);
  if (partner?.kind === 'clip') {
    return edge === 'in'
      ? '앞 클립과 겹쳐서 넘어와요'
      : '뒤 클립과 겹쳐서 넘어가요';
  }
  return edge === 'in' ? '검은 화면에서 시작해요' : '검은 화면으로 끝나요';
}

/**
 * Why a fade is shorter than asked — and it is not always the clip. The room
 * an edge has is the clip minus the OTHER edge's fade, so when that other fade
 * is what took the room, blaming the clip's length sends the user looking
 * for longer footage; naming the other fade tells them which control to
 * turn down. `frames` is what fits, `asked` what was wanted. Empty when
 * nothing was cut short.
 */
export function fadeShortenedText(
  clip: Clip,
  edge: FadeEdge,
  frames: number,
  asked: number,
  fps: Rational,
): string {
  if (asked <= frames) return '';
  const other = edge === 'in' ? (clip.fadeOut ?? 0) : (clip.fadeIn ?? 0);
  if (other > 0) {
    const theirs =
      edge === 'in' ? '뒷부분의 서서히 사라지기' : '앞부분의 서서히 나타나기';
    return `${theirs}와 겹치지 않게 ${fadeSecondsText(frames, fps)}로 줄였어요`;
  }
  return `클립이 짧아 ${fadeSecondsText(asked, fps)}에서 줄였어요`;
}

/**
 * What the edit did, for the status line. `asked` is what the user wanted
 * when it did not fit — the sentence says so, or a fade that came out
 * shorter than the choice reads as a bug.
 */
export function describeFade(
  project: Project,
  clipId: string,
  edge: FadeEdge,
  frames: number,
  asked?: number,
): string {
  const fps = project.timeline.fps;
  const where = edge === 'in' ? '앞부분' : '뒷부분';
  if (frames <= 0) {
    return edge === 'in'
      ? `${where}이 바로 시작해요.`
      : `${where}이 바로 끝나요.`;
  }
  const verb = edge === 'in' ? '서서히 나타나요' : '서서히 사라져요';
  const into = fadeIntoText(project, clipId, edge);
  const clip = locateClip(project, clipId)?.clip;
  const why =
    asked !== undefined && clip
      ? fadeShortenedText(clip, edge, frames, asked, fps)
      : '';
  const shortened = why ? ` · ${why}` : '';
  return `${where}이 ${fadeSecondsText(frames, fps)} 동안 ${verb} · ${into}${shortened}.`;
}
