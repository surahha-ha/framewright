// framewright — the command catalogue.
// A command is DATA: id, label, icon, default key, a `canRun` gate and a pure
// `run` that returns a Patch. Buttons, menus, shortcuts and (later) the palette
// all derive from this — add a command here and every entry point gets it.

import type { Clip, Project } from './types';
import type { Op, Patch } from './ops';
import {
  clipLength,
  locateClip,
  resolveAt,
  sourceFrames,
  trimLimits,
  videoTrack,
} from './timeline';
import { dragBounds, limitHit, type DragLimit, type DragMode } from './drag';
import { formatTimecode } from './time';
import {
  entryLength,
  pasteIndex,
  pastePlan,
  type ClipboardEntry,
} from './clipboard';

export interface EditorCtx {
  project: Project;
  playhead: number; // timeline frame
  selectedClipId: string | null;
  /** What copy/cut put aside. Not document state — it outlives undo. */
  clipboard?: ClipboardEntry | null;
}

/** Why a clip stopped moving, in words. Silence here reads as a bug, and one
 *  wording keeps a drag and a nudge from explaining the same wall differently. */
export const LIMIT_TEXT: Record<DragLimit, string> = {
  timelineStart: '맨 앞이에요. 더 앞으로는 갈 수 없어요.',
  neighbour: '옆 클립에 닿았어요.',
  source: '원본 영상이 여기까지예요.',
  minLength: '더 짧게는 줄일 수 없어요.',
  none: '',
};

export interface Command<Args = void> {
  id: string;
  label: string;
  icon?: string;
  /** Default binding, e.g. "c" or "mod+z". User keymaps override this. */
  defaultKey?: string;
  /** Not a toolbar button — reachable by key, palette or drag only. */
  hidden?: boolean;
  /** Needs arguments only a drag can supply, so no button or palette entry
   *  could ever run it. */
  requiresArgs?: boolean;
  /** A held key is ONE gesture and must be ONE undo step, exactly like a drag.
   *  Only sound for commands whose forward ops are absolute assignments — a
   *  relative op would compound as the key repeats. */
  repeatable?: boolean;
  /**
   * Announced (status bar / screen reader) after the command actually ran.
   * Silence after a click reads as "nothing happened".
   *
   * As a function it gets the ctx from both sides of the edit: `after` is where
   * things ended up (a nudge reports the new position), `before` is the only
   * place that still knows what was ASKED for (a paste reports where it decided
   * to put the clip, which the finished document can no longer tell you).
   */
  done?: string | ((before: EditorCtx, after: EditorCtx) => string);
  /** Clip to select once the command has run. A command that CREATES a clip has
   *  to say which one, or the user is left guessing which of the clips that
   *  just moved is the new one. */
  selects?(before: EditorCtx): string;
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
  requiresArgs: true,
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
  requiresArgs: true,
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
  requiresArgs: true,
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
  disabledReason: () => '재생 위치를 클립 안(맨 앞이 아닌 곳)으로 옮겨 주세요.',
  canRun(ctx) {
    const hit = resolveAt(ctx.project, ctx.playhead);
    return !!hit && ctx.playhead > hit.clip.startFrame;
  },
  run(ctx) {
    const hit = resolveAt(ctx.project, ctx.playhead);
    if (!hit)
      throw new Error('clip.trimStartToPlayhead: nothing under playhead');
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
  disabledReason: () => '재생 위치를 클립 안(맨 앞이 아닌 곳)으로 옮겨 주세요.',
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

/**
 * One sentence for one edit, whatever caused it — a drag, a nudge key, or the
 * palette. Reads the CURRENT document, so callers pass the state after the edit.
 */
export function describeEdit(
  mode: DragMode,
  project: Project,
  clipId: string,
): string {
  const found = locateClip(project, clipId);
  if (!found) return '';
  const { track, index, clip } = found;
  const fps = project.timeline.fps;
  const prev = track.clips[index - 1];
  const prevEnd = prev ? prev.startFrame + clipLength(prev) : 0;
  const gap = clip.startFrame > prevEnd ? ' · 앞에 빈 곳이 생겼어요' : '';
  if (mode === 'move') {
    return `클립을 ${formatTimecode(clip.startFrame, fps)} 위치로 옮겼어요.${gap}`;
  }
  if (mode === 'trimStart') {
    return `앞부분을 잘라냈어요 · 남은 길이 ${formatTimecode(clipLength(clip), fps)}${gap}`;
  }
  return `뒷부분을 잘라냈어요 · 남은 길이 ${formatTimecode(clipLength(clip), fps)}`;
}

/**
 * Move or trim the selected clip by one frame.
 *
 * These used to be spelled out inside `ui/Timeline.tsx`, which made them the
 * last bindings a user keymap could not reach. As commands they are data like
 * everything else: bindable, listable in the palette, and testable in Node.
 */
function nudgeTarget(clip: Clip, mode: DragMode, step: 1 | -1): number {
  const end = clip.startFrame + clipLength(clip);
  return (mode === 'trimEnd' ? end : clip.startFrame) + step;
}

function nudgeCommand(
  id: string,
  label: string,
  mode: DragMode,
  step: 1 | -1,
  defaultKey: string,
): Command {
  return {
    id,
    label,
    hidden: true, // six more toolbar buttons would drown the five that matter
    defaultKey,
    repeatable: true,
    canRun(ctx) {
      const found = locateClip(ctx.project, ctx.selectedClipId);
      if (!found) return false;
      // A clip already against a wall CANNOT be nudged, and saying otherwise is
      // how the palette ends up offering a row that closes and does nothing.
      // The bound has to be the same one `run` clamps to, or the two disagree.
      const bounds = dragBounds(ctx.project, found.clip.id, mode);
      if (!bounds) return false;
      const target = nudgeTarget(found.clip, mode, step);
      const clamped = Math.min(bounds.max, Math.max(bounds.min, target));
      const current = target - step;
      return clamped !== current;
    },
    disabledReason(ctx) {
      const found = locateClip(ctx.project, ctx.selectedClipId);
      if (!found) {
        return mode === 'move'
          ? '옮길 클립을 먼저 골라 주세요.'
          : '자를 클립을 먼저 골라 주세요.';
      }
      const bounds = dragBounds(ctx.project, found.clip.id, mode);
      if (!bounds) return '지금은 쓸 수 없어요.';
      const reason =
        LIMIT_TEXT[limitHit(nudgeTarget(found.clip, mode, step), bounds)];
      return reason || '더 이상 움직일 수 없어요.';
    },
    done(_before, after) {
      return after.selectedClipId
        ? describeEdit(mode, after.project, after.selectedClipId)
        : '';
    },
    run(ctx) {
      const found = locateClip(ctx.project, ctx.selectedClipId);
      if (!found) throw new Error(`${id}: no selected clip`);
      const clipId = found.clip.id;
      const frame = nudgeTarget(found.clip, mode, step);
      // Delegate, so a nudge and a drag can never disagree about the limits.
      if (mode === 'move') {
        return moveClipCommand.run(ctx, { clipId, startFrame: frame });
      }
      return mode === 'trimStart'
        ? trimStartCommand.run(ctx, { clipId, frame })
        : trimEndCommand.run(ctx, { clipId, frame });
    },
  };
}

export const NUDGE_COMMANDS: Command[] = [
  nudgeCommand(
    'clip.moveLeft',
    '한 프레임 왼쪽으로',
    'move',
    -1,
    'alt+arrowleft',
  ),
  nudgeCommand(
    'clip.moveRight',
    '한 프레임 오른쪽으로',
    'move',
    1,
    'alt+arrowright',
  ),
  nudgeCommand(
    'clip.headExtend',
    '앞부분 한 프레임 늘리기',
    'trimStart',
    -1,
    'alt+shift+arrowleft',
  ),
  nudgeCommand(
    'clip.headShrink',
    '앞부분 한 프레임 줄이기',
    'trimStart',
    1,
    'alt+shift+arrowright',
  ),
  nudgeCommand(
    'clip.tailShrink',
    '뒷부분 한 프레임 줄이기',
    'trimEnd',
    -1,
    'mod+alt+arrowleft',
  ),
  nudgeCommand(
    'clip.tailExtend',
    '뒷부분 한 프레임 늘리기',
    'trimEnd',
    1,
    'mod+alt+arrowright',
  ),
];

/**
 * Put the clipboard's media on the timeline. See `clipboard.ts` for the
 * placement rules — the short version is that a paste never splits, overwrites
 * or drops anything, and it says where it landed.
 */
export const pasteCommand: Command = {
  id: 'clip.paste',
  label: '붙여넣기',
  icon: '📋',
  defaultKey: 'mod+v',
  disabledReason(ctx) {
    if (!ctx.clipboard) return '먼저 클립을 복사하거나 잘라내 주세요.';
    return '복사해 둔 영상이 이 프로젝트에 없어요. 다시 복사해 주세요.';
  },
  /** The pasted clip, so the user can see which one is new among the clips the
   *  push just moved. Computed from the pre-run counter, like the id itself. */
  selects: (before) => `clip_${before.project.nextId}`,
  done(before) {
    const entry = before.clipboard;
    if (!entry) return '붙여넣었어요.';
    const plan = pastePlan(before.project, before.playhead, entryLength(entry));
    const fps = before.project.timeline.fps;
    const snap =
      plan.snapped === 'start'
        ? ' · 클립 앞에 넣었어요'
        : plan.snapped === 'end'
          ? ' · 클립 뒤에 넣었어요'
          : '';
    const push = plan.pushBy > 0 ? ' · 뒤 클립을 밀었어요' : '';
    return `${formatTimecode(plan.startFrame, fps)} 위치에 붙여넣었어요.${snap}${push}`;
  },
  canRun(ctx) {
    const entry = ctx.clipboard;
    if (!entry || entryLength(entry) <= 0) return false;
    // The source can disappear from under a clipboard entry (undo an import),
    // and a clip pointing at a missing asset exports as black.
    if (!ctx.project.assets.some((a) => a.id === entry.assetId)) return false;
    // ...and it can be REPLACED, which is worse than missing: the id still
    // resolves, so nothing looks wrong while a paste inserts frames measured
    // against a different file. A range the source cannot cover proves that.
    const total = sourceFrames(ctx.project, entry.assetId);
    return total === null || entry.outFrame <= total;
  },
  run(ctx) {
    const entry = ctx.clipboard;
    if (!entry) throw new Error('clip.paste: nothing on the clipboard');
    const track = videoTrack(ctx.project);
    const length = entryLength(entry);
    const plan = pastePlan(ctx.project, ctx.playhead, length);
    const index = pasteIndex(ctx.project, plan.startFrame);
    const clip: Clip = {
      id: `clip_${ctx.project.nextId}`,
      assetId: entry.assetId,
      startFrame: plan.startFrame,
      inFrame: entry.inFrame,
      outFrame: entry.outFrame,
    };
    // Pushing preserves order, so the insert index is the same before and after.
    const moved =
      plan.pushBy > 0
        ? track.clips.filter((c) => c.startFrame >= plan.startFrame)
        : [];

    const forward: Op[] = [
      ...moved.map<Op>((c) => ({
        kind: 'updateClip',
        trackId: track.id,
        clipId: c.id,
        changes: { startFrame: c.startFrame + plan.pushBy },
      })),
      { kind: 'insertClip', trackId: track.id, index, clip },
      { kind: 'setNextId', value: ctx.project.nextId + 1 },
    ];
    const inverse: Op[] = [
      { kind: 'setNextId', value: ctx.project.nextId },
      { kind: 'removeClip', trackId: track.id, index },
      ...moved.map<Op>((c) => ({
        kind: 'updateClip',
        trackId: track.id,
        clipId: c.id,
        changes: { startFrame: c.startFrame },
      })),
    ];
    return { forward, inverse };
  },
};

export const BUILTIN_COMMANDS: Command<any>[] = [
  splitCommand,
  trimStartToPlayheadCommand,
  trimEndToPlayheadCommand,
  deleteRippleCommand,
  pasteCommand,
  closeGapsCommand,
  trimStartCommand,
  trimEndCommand,
  moveClipCommand,
  ...NUDGE_COMMANDS,
];
