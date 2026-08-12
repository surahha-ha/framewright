// framewright — the arithmetic behind dragging a clip (pure).
//
// This lives in the engine, not in the component, for one reason: it is the part
// that is easy to get subtly wrong (snapping to your own edge, clamping to the
// wrong neighbour, a move that quietly changes a clip's length) and impossible to
// see in a screenshot. Here it is unit-testable in Node.

import type { Project } from './types';
import {
  clipLength,
  locateClip,
  snapFrame,
  timelineDuration,
  trimLimits,
} from './timeline';

export type DragMode = 'move' | 'trimStart' | 'trimEnd';

/** Why a drag stopped. The UI turns this into a sentence — a clip that freezes
 *  under the pointer with no explanation reads as a bug, not as a limit. */
export type DragLimit =
  'timelineStart' | 'neighbour' | 'source' | 'minLength' | 'none';

export interface DragBounds {
  min: number;
  max: number;
  minReason: DragLimit;
  maxReason: DragLimit;
}

/** How far the dragged boundary may travel, in TIMELINE frames. */
export function dragBounds(
  project: Project,
  clipId: string,
  mode: DragMode,
): DragBounds | null {
  const found = locateClip(project, clipId);
  const limits = trimLimits(project, clipId);
  if (!found || !limits) return null;
  const { track, index, clip } = found;
  const prev = track.clips[index - 1];
  const next = track.clips[index + 1];
  const prevEnd = prev ? prev.startFrame + clipLength(prev) : 0;

  if (mode === 'trimStart') {
    return {
      min: limits.minStart,
      // The head stops either at the clip before it or at the first frame that
      // actually exists in the source file.
      minReason:
        limits.minStart === prevEnd && prev
          ? 'neighbour'
          : limits.minStart === 0 && clip.inFrame >= clip.startFrame
            ? 'timelineStart'
            : 'source',
      max: limits.maxStart,
      maxReason: 'minLength',
    };
  }
  if (mode === 'trimEnd') {
    return {
      min: limits.minEnd,
      minReason: 'minLength',
      max: limits.maxEnd,
      maxReason:
        next && limits.maxEnd === next.startFrame ? 'neighbour' : 'source',
    };
  }

  const length = clipLength(clip);
  return {
    min: prevEnd,
    minReason: prev ? 'neighbour' : 'timelineStart',
    max: next ? next.startFrame - length : Number.MAX_SAFE_INTEGER,
    maxReason: next ? 'neighbour' : 'none',
  };
}

/** Did the plan hit a wall, and which one? */
export function limitHit(frame: number, bounds: DragBounds): DragLimit {
  if (frame <= bounds.min) return bounds.minReason;
  if (frame >= bounds.max) return bounds.maxReason;
  return 'none';
}

/**
 * Frames worth snapping to. Never includes an edge the clip already sits on:
 * a lone clip's end IS the timeline end, so without that filter every small
 * nudge would spring straight back where it started.
 *
 * `playhead` is offered for trims ("trim to where I'm looking") but not for
 * moves, where pressing the clip body has just scrubbed the playhead under the
 * pointer — the clip would snap to itself.
 */
export function dragTargets(
  project: Project,
  clipId: string,
  mode: DragMode,
  playhead: number,
): number[] {
  const found = locateClip(project, clipId);
  if (!found) return [];
  const start = found.clip.startFrame;
  const end = start + clipLength(found.clip);
  const total = timelineDuration(project);

  const candidates = mode === 'move' ? [0, total] : [0, total, playhead];
  for (const track of project.tracks) {
    for (const other of track.clips) {
      if (other.id === clipId) continue;
      candidates.push(other.startFrame, other.startFrame + clipLength(other));
    }
  }
  const own =
    mode === 'move' ? [start, end] : mode === 'trimStart' ? [start] : [end];
  return [...new Set(candidates)]
    .filter((t) => !own.includes(t))
    .sort((a, b) => a - b);
}

export interface DragPlan {
  mode: DragMode;
  originStart: number;
  originEnd: number;
  /** Pointer travel, already converted to frames. */
  deltaFrames: number;
  targets: number[];
  snapThreshold: number;
  bounds: DragBounds;
}

/** Where the dragged boundary should land: snapped, then clamped. */
export function planDrag(plan: DragPlan): number {
  const length = plan.originEnd - plan.originStart;
  let raw: number;

  if (plan.mode === 'move') {
    const wanted = plan.originStart + plan.deltaFrames;
    // Either end of a moving clip may butt up against something, so try both and
    // keep whichever snap is nearer. (Snapping only the head makes a clip refuse
    // to sit flush against the clip on its right.)
    const byStart = snapFrame(wanted, plan.targets, plan.snapThreshold);
    const byEnd =
      snapFrame(wanted + length, plan.targets, plan.snapThreshold) - length;
    // Compare only the edges that ACTUALLY snapped. Ranking by distance alone
    // lets "no snap" (distance 0) beat a real snap, and the trailing edge would
    // never win anything.
    const startSnapped = byStart !== wanted;
    const endSnapped = byEnd !== wanted;
    if (startSnapped && endSnapped) {
      raw =
        Math.abs(byStart - wanted) <= Math.abs(byEnd - wanted)
          ? byStart
          : byEnd;
    } else if (startSnapped) {
      raw = byStart;
    } else if (endSnapped) {
      raw = byEnd;
    } else {
      raw = wanted;
    }
  } else {
    const anchor =
      plan.mode === 'trimStart' ? plan.originStart : plan.originEnd;
    raw = snapFrame(
      anchor + plan.deltaFrames,
      plan.targets,
      plan.snapThreshold,
    );
  }

  return Math.min(plan.bounds.max, Math.max(plan.bounds.min, raw));
}

/** The command a finished drag turns into. `null` when nothing actually moved. */
export function dragCommand(
  mode: DragMode,
  clipId: string,
  frame: number,
  originStart: number,
  originEnd: number,
): { id: string; args: Record<string, unknown> } | null {
  if (mode === 'move') {
    if (frame === originStart) return null;
    return { id: 'clip.move', args: { clipId, startFrame: frame } };
  }
  if (mode === 'trimStart') {
    if (frame === originStart) return null;
    return { id: 'clip.trimStart', args: { clipId, frame } };
  }
  if (frame === originEnd) return null;
  return { id: 'clip.trimEnd', args: { clipId, frame } };
}

/** Where the clip is drawn mid-drag, before any command has been dispatched. */
export function previewGeometry(
  mode: DragMode,
  frame: number,
  originStart: number,
  originEnd: number,
): { start: number; length: number } {
  if (mode === 'move') {
    return { start: frame, length: originEnd - originStart };
  }
  if (mode === 'trimStart') return { start: frame, length: originEnd - frame };
  return { start: originStart, length: frame - originStart };
}
