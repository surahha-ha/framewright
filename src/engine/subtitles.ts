// framewright — subtitles (pure).
//
// A subtitle is words over the picture for a range of timeline frames. It has
// no source and no in/out point, so it is not a clip (see `types.ts`), but it
// is edited like one: it sits between neighbours, it can be moved and its two
// edges can be dragged, and every limit it runs into is named. This module is
// the arithmetic for that — where a new one may go, how far an edge may travel
// — kept in the engine so it is unit-tested in Node like `drag.ts`.

import type { Project, Subtitle } from './types';
import { snapFrame, videoDuration } from './timeline';
import { formatTimecode, secToFrame } from './time';
import type { DragBounds, DragLimit, DragMode } from './drag';
import type { Op } from './ops';

/** How long a freshly placed subtitle lasts. Two seconds is roughly one short
 *  spoken sentence; the user drags it from there. */
export const DEFAULT_SUBTITLE_SEC = 2;

export function subtitleLength(s: Subtitle): number {
  return s.endFrame - s.startFrame;
}

/** The subtitle shown on this frame, if any. Half-open like everything else. */
export function subtitleAt(project: Project, frame: number): Subtitle | null {
  for (const s of project.subtitles) {
    if (s.startFrame > frame) break; // sorted: nothing later can cover it
    if (frame < s.endFrame) return s;
  }
  return null;
}

export function locateSubtitle(
  project: Project,
  id: string | null,
): { index: number; subtitle: Subtitle } | null {
  if (!id) return null;
  const index = project.subtitles.findIndex((s) => s.id === id);
  return index < 0 ? null : { index, subtitle: project.subtitles[index] };
}

/**
 * Where "자막 넣기" puts a new subtitle: at the playhead, for the default
 * length, cut short by whichever comes first — the next subtitle or the end of
 * the picture. Null when there is no room at all: off the end of the video, or
 * on a frame that already has a subtitle (edit that one instead).
 */
export function subtitlePlan(
  project: Project,
  playhead: number,
): { startFrame: number; endFrame: number; index: number } | null {
  const total = videoDuration(project);
  if (playhead < 0 || playhead >= total) return null;
  if (subtitleAt(project, playhead)) return null;
  // The list is sorted and nothing covers the playhead, so every subtitle that
  // starts at or before it also ends at or before it.
  const index = project.subtitles.filter(
    (s) => s.startFrame <= playhead,
  ).length;
  const next = project.subtitles[index];
  const ceiling = next ? Math.min(next.startFrame, total) : total;
  const wanted =
    playhead + secToFrame(DEFAULT_SUBTITLE_SEC, project.timeline.fps);
  return { startFrame: playhead, endFrame: Math.min(wanted, ceiling), index };
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
  const found = locateSubtitle(project, id);
  if (!found) return null;
  const { index, subtitle } = found;
  const prev = project.subtitles[index - 1];
  const next = project.subtitles[index + 1];
  const total = videoDuration(project);
  return {
    minStart: prev ? prev.endFrame : 0,
    maxStart: subtitle.endFrame - 1,
    minEnd: subtitle.startFrame + 1,
    maxEnd: next ? next.startFrame : Math.max(total, subtitle.endFrame),
  };
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
 * Move the subtitles the way a ripple edit moved the footage under them.
 *
 * A subtitle captions particular frames. When a ripple delete pulls the
 * footage after a cut to the left, or a paste pushes it right, the words have
 * to go with the pictures they were written for — a caption that stays put
 * while the shot slides out from under it is silently wrong, which is the
 * worst kind.
 *
 * `delta < 0` removes the span `[at, at − delta)`: a subtitle wholly inside it
 * is dropped (its footage is gone), one straddling an edge keeps the part
 * that survives, everything after slides left. `delta > 0` inserts `delta`
 * frames at `at`: everything starting at or after `at` slides right. A
 * subtitle straddling `at` is NOT handled here — it has to become two, and
 * that needs an id, so a caller runs `splitSubtitleAt` first (the paste
 * command does). Left alone it would caption the new footage with words
 * meant for the old, and the old footage would lose them; stretched it
 * would do the first half of that.
 */
export function rippleSubtitles(
  subtitles: Subtitle[],
  at: number,
  delta: number,
): Subtitle[] {
  if (delta === 0) return subtitles;
  if (delta > 0) {
    return subtitles.map((s) =>
      s.startFrame >= at
        ? {
            ...s,
            startFrame: s.startFrame + delta,
            endFrame: s.endFrame + delta,
          }
        : s,
    );
  }
  const cutEnd = at - delta;
  const out: Subtitle[] = [];
  for (const s of subtitles) {
    if (s.endFrame <= at) {
      out.push(s);
      continue;
    }
    // Before the cut: stays. Inside it: collapses to the cut point. After
    // it: slides left by the cut's length.
    const startFrame =
      s.startFrame < at
        ? s.startFrame
        : s.startFrame >= cutEnd
          ? s.startFrame + delta
          : at;
    const endFrame = s.endFrame > cutEnd ? s.endFrame + delta : at;
    if (endFrame > startFrame) out.push({ ...s, startFrame, endFrame });
  }
  return out;
}

/**
 * Cut the one subtitle that straddles `at` — starts before it, ends after it
 * — into two: the head keeps its id and ends at `at`, the tail is a new
 * subtitle with the same words from `at` on. Used before a paste ripples the
 * footage after `at` to the right, so each half can stay with the frames it
 * captioned. Nothing straddles an EDGE (`at` equal to a start or an end), so
 * those are untouched. Returns the counter to store after the new id.
 */
export function splitSubtitleAt(
  subtitles: Subtitle[],
  at: number,
  nextId: number,
): { subtitles: Subtitle[]; nextId: number } {
  const index = subtitles.findIndex(
    (s) => s.startFrame < at && at < s.endFrame,
  );
  if (index < 0) return { subtitles, nextId };
  const s = subtitles[index];
  const head: Subtitle = { ...s, endFrame: at };
  const tail: Subtitle = {
    id: `sub_${nextId}`,
    text: s.text,
    startFrame: at,
    endFrame: s.endFrame,
  };
  const out = subtitles.slice();
  out.splice(index, 1, head, tail);
  return { subtitles: out, nextId: nextId + 1 };
}

/**
 * The ops that take `before` to `after`, with their inverses — for a command
 * that moved the footage and now has to move the words. Ids are the key: a
 * subtitle may be re-timed, removed (a cut swallowed it) or added (the tail
 * of a split). Never re-ordered by id, which is what keeps the index
 * arithmetic below honest.
 *
 * Forward: re-time (by id, order-free), then remove from the highest
 * `before` index down (so each index still means what it meant), then insert
 * from the lowest `after` index up (so each lands where `after` has it).
 * Inverse: exactly backwards.
 */
export function subtitleDiffOps(
  before: Subtitle[],
  after: Subtitle[],
): { forward: Op[]; inverse: Op[] } {
  const inAfter = new Map(after.map((s) => [s.id, s]));
  const inBefore = new Set(before.map((s) => s.id));

  const retime: Op[] = [];
  const untime: Op[] = [];
  const removals: Op[] = [];
  const reinserts: Op[] = [];
  before.forEach((old, index) => {
    const now = inAfter.get(old.id);
    if (!now) {
      removals.push({ kind: 'removeSubtitle', index });
      reinserts.push({ kind: 'insertSubtitle', index, subtitle: old });
      return;
    }
    if (now.startFrame === old.startFrame && now.endFrame === old.endFrame) {
      return;
    }
    retime.push({
      kind: 'updateSubtitle',
      subtitleId: old.id,
      changes: { startFrame: now.startFrame, endFrame: now.endFrame },
    });
    untime.push({
      kind: 'updateSubtitle',
      subtitleId: old.id,
      changes: { startFrame: old.startFrame, endFrame: old.endFrame },
    });
  });
  const inserts: Op[] = [];
  const uninserts: Op[] = [];
  after.forEach((s, index) => {
    if (inBefore.has(s.id)) return;
    inserts.push({ kind: 'insertSubtitle', index, subtitle: s });
    uninserts.push({ kind: 'removeSubtitle', index });
  });

  return {
    forward: [...retime, ...removals.reverse(), ...inserts],
    inverse: [...uninserts.reverse(), ...reinserts, ...untime],
  };
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
