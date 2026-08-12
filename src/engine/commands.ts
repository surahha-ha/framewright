// framewright — the command catalogue.
// A command is DATA: id, label, icon, default key, a `canRun` gate and a pure
// `run` that returns a Patch. Buttons, menus, shortcuts and (later) the palette
// all derive from this — add a command here and every entry point gets it.

import type { Clip, Project, Track } from './types';
import type { Op, Patch } from './ops';
import { clipLength, resolveAt, sourceFrames, videoTrack } from './timeline';

export interface EditorCtx {
  project: Project;
  playhead: number; // timeline frame
  selectedClipId: string | null;
}

export interface Command<Args = void> {
  id: string;
  label: string;
  icon?: string;
  /** Default binding, e.g. "c" or "mod+z". User keymaps override this. */
  defaultKey?: string;
  /** Direct-manipulation commands (drag to trim/move) take arguments and are
   *  driven by the mouse, so they are not offered as toolbar buttons. */
  hidden?: boolean;
  /** Announced (status bar / screen reader) after the command actually ran.
   *  Silence after a click reads as "nothing happened". */
  done?: string;
  /** Why the button is greyed out right now. A disabled control that will not
   *  say what it is waiting for is indistinguishable from a broken one. */
  disabledReason?(ctx: EditorCtx): string;
  canRun(ctx: EditorCtx, args?: Args): boolean;
  run(ctx: EditorCtx, args: Args): Patch;
}

export interface TrimArgs {
  clipId: string;
  /** New boundary, as a TIMELINE frame. */
  frame: number;
}

export interface MoveArgs {
  clipId: string;
  /** New start position, as a TIMELINE frame. */
  startFrame: number;
}

export interface Located {
  track: Track;
  index: number;
  clip: Clip;
}

export function locateClip(
  project: Project,
  clipId: string | null,
): Located | null {
  if (!clipId) return null;
  for (const track of project.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index >= 0) return { track, index, clip: track.clips[index] };
  }
  return null;
}

/** Room a clip has to grow/shrink, in TIMELINE frames. Half-open throughout. */
export function trimLimits(
  project: Project,
  clipId: string,
): { minStart: number; maxStart: number; minEnd: number; maxEnd: number } | null {
  const found = locateClip(project, clipId);
  if (!found) return null;
  const { track, index, clip } = found;
  const start = clip.startFrame;
  const end = start + clipLength(clip);

  const prev = track.clips[index - 1];
  const next = track.clips[index + 1];
  const prevEnd = prev ? prev.startFrame + clipLength(prev) : 0;
  const nextStart = next ? next.startFrame : Number.MAX_SAFE_INTEGER;

  // Head cannot pass the source's first frame, the previous clip, or its own tail.
  const headRoom = clip.inFrame; // frames available before the current in-point
  const minStart = Math.max(prevEnd, start - headRoom);
  const maxStart = end - 1; // keep at least one frame

  // Tail cannot pass the end of the source, the next clip, or its own head.
  // An unmeasurable source proves no headroom at all. Treating "unknown" as
  // "infinite" let a trim invent frames that were never in the file — they
  // exported as black and were only ever reported as `missingFrames`.
  const total = sourceFrames(project, clip.assetId);
  const tailRoom = total === null ? 0 : total - clip.outFrame;
  const minEnd = start + 1;
  const maxEnd = Math.min(nextStart, end + tailRoom);

  return { minStart, maxStart, minEnd, maxEnd };
}

/** Split the clip under the playhead into two contiguous clips. */
export const splitCommand: Command = {
  id: 'clip.split',
  label: '나누기',
  icon: '✂',
  defaultKey: 'c',
  done: '재생 위치에서 두 개로 나눴어요.',
  // N.B. `canRun` also needs playhead > startFrame — saying "move it onto the
  // clip" when it is already on the clip's first frame is a dead end.
  disabledReason: () =>
    '재생 위치를 나눌 지점(클립 맨 앞이 아닌 곳)으로 옮겨 주세요.',
  canRun(ctx) {
    const hit = resolveAt(ctx.project, ctx.playhead);
    // Half-open ranges guarantee playhead < clip end; only the very start is invalid.
    return !!hit && ctx.playhead > hit.clip.startFrame;
  },
  run(ctx) {
    const hit = resolveAt(ctx.project, ctx.playhead);
    if (!hit) throw new Error('clip.split: nothing under the playhead');
    const { clip, trackId, index, sourceFrame } = hit;

    const right: Clip = {
      id: `clip_${ctx.project.nextId}`,
      assetId: clip.assetId,
      startFrame: ctx.playhead,
      inFrame: sourceFrame, // left ends exactly where right begins
      outFrame: clip.outFrame,
    };

    const forward: Op[] = [
      {
        kind: 'updateClip',
        trackId,
        clipId: clip.id,
        changes: { outFrame: sourceFrame },
      },
      { kind: 'insertClip', trackId, index: index + 1, clip: right },
      { kind: 'setNextId', value: ctx.project.nextId + 1 },
    ];
    const inverse: Op[] = [
      { kind: 'setNextId', value: ctx.project.nextId },
      { kind: 'removeClip', trackId, index: index + 1 },
      {
        kind: 'updateClip',
        trackId,
        clipId: clip.id,
        changes: { outFrame: clip.outFrame },
      },
    ];
    return { forward, inverse };
  },
};

/** Delete the selected clip and pull everything after it back by its length. */
export const deleteRippleCommand: Command = {
  id: 'clip.deleteRipple',
  label: '지우기(뒤 당기기)',
  icon: '🗑',
  defaultKey: 'delete',
  done: '클립을 지우고 뒤를 앞으로 당겼어요.',
  disabledReason: () => '지울 클립을 먼저 골라 주세요.',
  canRun(ctx) {
    if (!ctx.selectedClipId) return false;
    return videoTrack(ctx.project).clips.some(
      (c) => c.id === ctx.selectedClipId,
    );
  },
  run(ctx) {
    const track = videoTrack(ctx.project);
    const index = track.clips.findIndex((c) => c.id === ctx.selectedClipId);
    if (index < 0) throw new Error('clip.deleteRipple: no selected clip');
    const clip = track.clips[index];
    const len = clipLength(clip);
    const later = track.clips.slice(index + 1);

    const forward: Op[] = [
      { kind: 'removeClip', trackId: track.id, index },
      ...later.map<Op>((c) => ({
        kind: 'updateClip',
        trackId: track.id,
        clipId: c.id,
        changes: { startFrame: c.startFrame - len },
      })),
    ];
    const inverse: Op[] = [
      ...later.map<Op>((c) => ({
        kind: 'updateClip',
        trackId: track.id,
        clipId: c.id,
        changes: { startFrame: c.startFrame },
      })),
      { kind: 'insertClip', trackId: track.id, index, clip },
    ];
    return { forward, inverse };
  },
};

/**
 * Drag the head of a clip. The in-point and the timeline position move together,
 * so the rest of the clip stays put — that is what "trim" means to an editor.
 */
export const trimStartCommand: Command<TrimArgs> = {
  id: 'clip.trimStart',
  label: '앞부분 자르기',
  hidden: true,
  canRun(ctx, args) {
    if (!args) return false;
    const limits = trimLimits(ctx.project, args.clipId);
    return !!limits;
  },
  run(ctx, args) {
    const found = locateClip(ctx.project, args.clipId);
    const limits = trimLimits(ctx.project, args.clipId);
    if (!found || !limits) throw new Error('clip.trimStart: no such clip');
    const { track, clip } = found;
    const target = Math.min(
      limits.maxStart,
      Math.max(limits.minStart, Math.round(args.frame)),
    );
    const delta = target - clip.startFrame;
    if (delta === 0) throw new Error('clip.trimStart: no change');
    return {
      forward: [
        {
          kind: 'updateClip',
          trackId: track.id,
          clipId: clip.id,
          changes: { startFrame: target, inFrame: clip.inFrame + delta },
        },
      ],
      inverse: [
        {
          kind: 'updateClip',
          trackId: track.id,
          clipId: clip.id,
          changes: { startFrame: clip.startFrame, inFrame: clip.inFrame },
        },
      ],
    };
  },
};

/** Drag the tail of a clip: only the out-point moves. */
export const trimEndCommand: Command<TrimArgs> = {
  id: 'clip.trimEnd',
  label: '뒷부분 자르기',
  hidden: true,
  canRun(ctx, args) {
    if (!args) return false;
    return !!trimLimits(ctx.project, args.clipId);
  },
  run(ctx, args) {
    const found = locateClip(ctx.project, args.clipId);
    const limits = trimLimits(ctx.project, args.clipId);
    if (!found || !limits) throw new Error('clip.trimEnd: no such clip');
    const { track, clip } = found;
    const target = Math.min(
      limits.maxEnd,
      Math.max(limits.minEnd, Math.round(args.frame)),
    );
    const newOut = clip.inFrame + (target - clip.startFrame);
    if (newOut === clip.outFrame) throw new Error('clip.trimEnd: no change');
    return {
      forward: [
        {
          kind: 'updateClip',
          trackId: track.id,
          clipId: clip.id,
          changes: { outFrame: newOut },
        },
      ],
      inverse: [
        {
          kind: 'updateClip',
          trackId: track.id,
          clipId: clip.id,
          changes: { outFrame: clip.outFrame },
        },
      ],
    };
  },
};

/** Slide a clip along the timeline. Its media is untouched. */
export const moveClipCommand: Command<MoveArgs> = {
  id: 'clip.move',
  label: '옮기기',
  hidden: true,
  canRun(ctx, args) {
    return !!args && !!locateClip(ctx.project, args.clipId);
  },
  run(ctx, args) {
    const found = locateClip(ctx.project, args.clipId);
    if (!found) throw new Error('clip.move: no such clip');
    const { track, index, clip } = found;
    const length = clipLength(clip);
    const prev = track.clips[index - 1];
    const next = track.clips[index + 1];
    const min = prev ? prev.startFrame + clipLength(prev) : 0;
    const max = next ? next.startFrame - length : Number.MAX_SAFE_INTEGER;
    const target = Math.min(max, Math.max(min, Math.round(args.startFrame)));
    if (target === clip.startFrame) throw new Error('clip.move: no change');
    return {
      forward: [
        {
          kind: 'updateClip',
          trackId: track.id,
          clipId: clip.id,
          changes: { startFrame: target },
        },
      ],
      inverse: [
        {
          kind: 'updateClip',
          trackId: track.id,
          clipId: clip.id,
          changes: { startFrame: clip.startFrame },
        },
      ],
    };
  },
};

/**
 * Pull every clip left until there are no gaps. Moving clips by hand is how you
 * get holes in a timeline; this is the one-click way out, and it is the whole of
 * "magnetic" behaviour we need at MVP — an explicit command beats a mode that
 * silently rearranges the edit under the user.
 */
export function gapsIn(project: Project): boolean {
  let cursor = 0;
  for (const c of videoTrack(project).clips) {
    if (c.startFrame !== cursor) return true;
    cursor = c.startFrame + clipLength(c);
  }
  return false;
}

export const closeGapsCommand: Command = {
  id: 'timeline.closeGaps',
  label: '빈 곳 없애기',
  icon: '⇤',
  done: '클립 사이 빈 곳을 없앴어요.',
  disabledReason: () => '없앨 빈 곳이 없어요.',
  canRun(ctx) {
    return gapsIn(ctx.project);
  },
  run(ctx) {
    const track = videoTrack(ctx.project);
    const forward: Op[] = [];
    const inverse: Op[] = [];
    let cursor = 0;
    for (const c of track.clips) {
      if (c.startFrame !== cursor) {
        forward.push({
          kind: 'updateClip',
          trackId: track.id,
          clipId: c.id,
          changes: { startFrame: cursor },
        });
        // Every op is an absolute assignment keyed by clip id, so order does not
        // matter here — do NOT convert these to relative deltas without revisiting it.
        inverse.push({
          kind: 'updateClip',
          trackId: track.id,
          clipId: c.id,
          changes: { startFrame: c.startFrame },
        });
      }
      cursor += clipLength(c);
    }
    if (forward.length === 0) throw new Error('timeline.closeGaps: no gaps');
    return { forward, inverse };
  },
};

/**
 * Trim the clip under the playhead back to it (Premiere's Q), and forward to it
 * (W). These exist because dragging is not the only way anyone edits: they are
 * modifier-free, no window manager or browser claims them, and they are the only
 * way to land an edit EXACTLY on the playhead with a keyboard.
 */
export const trimStartToPlayheadCommand: Command = {
  id: 'clip.trimStartToPlayhead',
  label: '앞부분 잘라내기',
  icon: '◧',
  defaultKey: 'q',
  done: '앞부분을 잘라냈어요 · 앞에 빈 곳이 생기면 "빈 곳 없애기"로 붙일 수 있어요.',
  disabledReason: () =>
    '재생 위치를 클립 안(맨 앞이 아닌 곳)으로 옮겨 주세요.',
  canRun(ctx) {
    const hit = resolveAt(ctx.project, ctx.playhead);
    return !!hit && ctx.playhead > hit.clip.startFrame;
  },
  run(ctx) {
    const hit = resolveAt(ctx.project, ctx.playhead);
    if (!hit) throw new Error('clip.trimStartToPlayhead: nothing under playhead');
    return trimStartCommand.run(ctx, {
      clipId: hit.clip.id,
      frame: ctx.playhead,
    });
  },
};

export const trimEndToPlayheadCommand: Command = {
  id: 'clip.trimEndToPlayhead',
  label: '뒷부분 잘라내기',
  icon: '◨',
  defaultKey: 'w',
  done: '재생 위치부터 뒷부분을 잘라냈어요.',
  disabledReason: () =>
    '재생 위치를 클립 안(맨 앞이 아닌 곳)으로 옮겨 주세요.',
  canRun(ctx) {
    const hit = resolveAt(ctx.project, ctx.playhead);
    return !!hit && ctx.playhead > hit.clip.startFrame;
  },
  run(ctx) {
    const hit = resolveAt(ctx.project, ctx.playhead);
    if (!hit) throw new Error('clip.trimEndToPlayhead: nothing under playhead');
    return trimEndCommand.run(ctx, {
      clipId: hit.clip.id,
      frame: ctx.playhead,
    });
  },
};

export const BUILTIN_COMMANDS: Command<any>[] = [
  splitCommand,
  trimStartToPlayheadCommand,
  trimEndToPlayheadCommand,
  deleteRippleCommand,
  closeGapsCommand,
  trimStartCommand,
  trimEndCommand,
  moveClipCommand,
];
