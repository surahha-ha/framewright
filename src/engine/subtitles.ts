// framewright — subtitles (pure).
//
// A subtitle is words over the picture for a range of timeline frames. It has
// no source and no in/out point, so it is not a clip (see `types.ts`), but it
// is edited like one: it sits between neighbours, it can be moved and its two
// edges can be dragged, and every limit it runs into is named. This module is
// the arithmetic for that — where a new one may go, how far an edge may travel
// — kept in the engine so it is unit-tested in Node like `drag.ts`.
//
// The timing half of that is not the words' own: it is true of anything that
// sits on the timeline for a range of frames, and it lives once, in
// `spans.ts`. What is left here is what makes it a SUBTITLE — the document it
// reads (a Project, not a bare list), the two seconds a new one lasts, the
// `sub_<n>` id, the three subtitle op kinds, the sentences. Everything below
// that delegates keeps its name and its shape, so no caller changes.

import type { Project, Subtitle } from './types';
import { snapFrame, videoDuration } from './timeline';
import { formatTimecode, secToFrame } from './time';
import type { DragBounds, DragLimit, DragMode } from './drag';
import type { Op } from './ops';
import {
  locateSpan,
  rippleSpans,
  spanAt,
  spanDiffOps,
  spanLimits,
  spanPlan,
  splitSpanAt,
} from './spans';

/** How long a freshly placed subtitle lasts. Two seconds is roughly one short
 *  spoken sentence; the user drags it from there. */
export const DEFAULT_SUBTITLE_SEC = 2;

export function subtitleLength(s: Subtitle): number {
  return s.endFrame - s.startFrame;
}

/** The subtitle shown on this frame, if any. Half-open like everything else. */
export function subtitleAt(project: Project, frame: number): Subtitle | null {
  return spanAt(project.subtitles, frame);
}

export function locateSubtitle(
  project: Project,
  id: string | null,
): { index: number; subtitle: Subtitle } | null {
  const found = locateSpan(project.subtitles, id);
  return found ? { index: found.index, subtitle: found.span } : null;
}

/**
 * Where "자막 넣기" puts a new subtitle: at the playhead, for the default
 * length, cut short by whichever comes first — the next subtitle or the end of
 * the picture. Null when there is no room at all: off the end of the video, or
 * on a frame that already has a subtitle (edit that one instead). The
 * two seconds become frames here, through `time.ts`; `spanPlan` counts frames.
 */
export function subtitlePlan(
  project: Project,
  playhead: number,
): { startFrame: number; endFrame: number; index: number } | null {
  return spanPlan(
    project.subtitles,
    videoDuration(project),
    secToFrame(DEFAULT_SUBTITLE_SEC, project.timeline.fps),
    playhead,
  );
}

/**
 * Room a subtitle's edges have, in timeline frames. The same four numbers
 * `trimLimits` gives a clip, minus the source: a subtitle's only far wall is
 * the end of the picture — unless it already sticks out past a video that was
 * shortened underneath it, in which case its own end stays reachable so it can
 * be pulled back in.
 */
export function subtitleLimits(
  project: Project,
  id: string,
): {
  minStart: number;
  maxStart: number;
  minEnd: number;
  maxEnd: number;
} | null {
  return spanLimits(project.subtitles, videoDuration(project), id);
}

/** How far the dragged boundary may travel, and why it stops — `planDrag`
 *  takes this exactly as it takes a clip's. */
export function subtitleDragBounds(
  project: Project,
  id: string,
  mode: DragMode,
): DragBounds | null {
  const found = locateSubtitle(project, id);
  const limits = subtitleLimits(project, id);
  if (!found || !limits) return null;
  const { index, subtitle } = found;
  const prev = project.subtitles[index - 1];
  const next = project.subtitles[index + 1];

  if (mode === 'trimStart') {
    return {
      min: limits.minStart,
      minReason: prev ? 'neighbour' : 'timelineStart',
      max: limits.maxStart,
      maxReason: 'minLength',
    };
  }
  if (mode === 'trimEnd') {
    return {
      min: limits.minEnd,
      minReason: 'minLength',
      max: limits.maxEnd,
      maxReason: next ? 'neighbour' : 'videoEnd',
    };
  }
  const length = subtitleLength(subtitle);
  return {
    min: limits.minStart,
    minReason: prev ? 'neighbour' : 'timelineStart',
    max: limits.maxEnd - length,
    maxReason: next ? 'neighbour' : 'videoEnd',
  };
}

/**
 * Frames worth snapping a subtitle to: the cuts in the picture (a subtitle
 * usually starts where a shot does), the other subtitles, the two ends, and —
 * for trims only — the playhead. Never an edge it already sits on.
 */
export function subtitleDragTargets(
  project: Project,
  id: string,
  mode: DragMode,
  playhead: number,
): number[] {
  const found = locateSubtitle(project, id);
  if (!found) return [];
  const { startFrame: start, endFrame: end } = found.subtitle;
  const total = videoDuration(project);
  const candidates = mode === 'move' ? [0, total] : [0, total, playhead];
  for (const track of project.tracks) {
    for (const c of track.clips) {
      candidates.push(c.startFrame, c.startFrame + (c.outFrame - c.inFrame));
    }
  }
  for (const s of project.subtitles) {
    if (s.id === id) continue;
    candidates.push(s.startFrame, s.endFrame);
  }
  const own =
    mode === 'move' ? [start, end] : mode === 'trimStart' ? [start] : [end];
  return [...new Set(candidates)]
    .filter((t) => !own.includes(t))
    .sort((a, b) => a - b);
}

/** The command a finished subtitle drag turns into; null when nothing moved. */
export function subtitleDragCommand(
  mode: DragMode,
  subtitleId: string,
  frame: number,
  originStart: number,
  originEnd: number,
): { id: string; args: Record<string, unknown> } | null {
  if (mode === 'move') {
    if (frame === originStart) return null;
    return { id: 'subtitle.move', args: { subtitleId, startFrame: frame } };
  }
  if (mode === 'trimStart') {
    if (frame === originStart) return null;
    return { id: 'subtitle.trimStart', args: { subtitleId, frame } };
  }
  if (frame === originEnd) return null;
  return { id: 'subtitle.trimEnd', args: { subtitleId, frame } };
}

/**
 * Move the subtitles the way a ripple edit moved the footage under them: the
 * words go with the pictures they were written for. `rippleSpans` holds the
 * rule and the reasoning — including why a subtitle straddling the insert
 * point is NOT handled there but split first (`splitSubtitleAt`, which the
 * paste command runs before this).
 */
export function rippleSubtitles(
  subtitles: Subtitle[],
  at: number,
  delta: number,
): Subtitle[] {
  return rippleSpans(subtitles, at, delta);
}

/**
 * Cut the one subtitle that straddles `at` into two: the head keeps its id and
 * ends at `at`, the tail is a new subtitle with the same words — and the same
 * look, place and effect (ADR-0017) — from `at` on. The id is this list's own
 * `sub_<n>`, minted from the document's counter so redo is deterministic.
 * Returns the counter to store after it; unmoved when nothing straddled.
 */
export function splitSubtitleAt(
  subtitles: Subtitle[],
  at: number,
  nextId: number,
): { subtitles: Subtitle[]; nextId: number } {
  const { spans, split } = splitSpanAt(subtitles, at, () => `sub_${nextId}`);
  return { subtitles: spans, nextId: split ? nextId + 1 : nextId };
}

/**
 * The ops that take `before` to `after`, with their inverses — for a command
 * that moved the footage and now has to move the words. The order that keeps
 * the index arithmetic honest is `spanDiffOps`'; the three op kinds are this
 * list's (`ops.ts`).
 */
export function subtitleDiffOps(
  before: Subtitle[],
  after: Subtitle[],
): { forward: Op[]; inverse: Op[] } {
  return spanDiffOps<Subtitle, Op>(before, after, {
    insert: (index, subtitle) => ({ kind: 'insertSubtitle', index, subtitle }),
    remove: (index) => ({ kind: 'removeSubtitle', index }),
    retime: (subtitleId, startFrame, endFrame) => ({
      kind: 'updateSubtitle',
      subtitleId,
      changes: { startFrame, endFrame },
    }),
  });
}

/**
 * What is actually stored when the user finishes typing. Line breaks are
 * meaningful (a two-line subtitle is a real thing), runs of them are not, and
 * trailing spaces would only ever show up as a pill that is wider than its
 * words. `\r\n` comes from a paste on Windows.
 */
export function normalizeSubtitleText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * One sentence per subtitle edit, whatever caused it — the same rules as a
 * clip's `describeEdit`: the verb hedges (조절) only when the caller cannot say
 * which way the edge went.
 */
export function describeSubtitleEdit(
  mode: DragMode,
  project: Project,
  id: string,
  lengthBefore?: number,
): string {
  const found = locateSubtitle(project, id);
  if (!found) return '';
  const { subtitle } = found;
  const fps = project.timeline.fps;
  const length = subtitleLength(subtitle);
  if (mode === 'move') {
    return `자막을 ${formatTimecode(subtitle.startFrame, fps)} 위치로 옮겼어요.`;
  }
  const verb =
    lengthBefore === undefined || lengthBefore === length
      ? '조절했어요'
      : length < lengthBefore
        ? '줄였어요'
        : '늘렸어요';
  const where = mode === 'trimStart' ? '앞부분' : '뒷부분';
  return `자막 ${where}을 ${verb} · 길이 ${formatTimecode(length, fps)}`;
}

/**
 * Why a subtitle drag stopped, in words. The clip's `LIMIT_TEXT` says 옆 클립
 * for a neighbour, and a subtitle's neighbour is another subtitle — the drag
 * readout was naming a thing that was nowhere near the lane. Defined in full
 * here rather than spread from the clip's table: `commands.ts` imports this
 * module's commands at load, so importing its table back would be a cycle.
 * `subtitles.test.ts` pins the shared sentences to the clip's.
 */
export const SUBTITLE_LIMIT_TEXT: Record<DragLimit, string> = {
  timelineStart: '맨 앞이에요. 더 앞으로는 갈 수 없어요.',
  neighbour: '옆 자막에 닿았어요.',
  source: '원본 영상이 여기까지예요.',
  videoEnd: '영상이 여기서 끝나요.',
  minLength: '더 짧게는 줄일 수 없어요.',
  none: '',
};

/** Re-exported so a caller snapping a subtitle needs only this module. */
export { snapFrame };
