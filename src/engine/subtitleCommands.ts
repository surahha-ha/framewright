// framewright — the subtitle commands.
//
// Same contract as every other command (ADR-0003): data with a `canRun`, a
// reason for refusing, a pure `run` that returns an invertible patch, and a
// sentence for afterwards. They are in their own file because `commands.ts`
// was the whole catalogue in one place and a second kind of thing on the
// timeline is where that stops being a convenience.

import type { Command, EditorCtx } from './commands';
import type { Op } from './ops';
import type { Subtitle } from './types';
import { formatTimecode } from './time';
import { videoDuration } from './timeline';
import {
  describeSubtitleEdit,
  locateSubtitle,
  normalizeSubtitleText,
  subtitleAt,
  subtitleLength,
  subtitleLimits,
  subtitlePlan,
} from './subtitles';

export interface SubtitleTextArgs {
  subtitleId: string;
  text: string;
}

export interface SubtitleEdgeArgs {
  subtitleId: string;
  /** New boundary, as a TIMELINE frame. */
  frame: number;
}

export interface SubtitleMoveArgs {
  subtitleId: string;
  startFrame: number;
}

const PICK_FIRST = '자막을 먼저 골라 주세요.';

/**
 * Put a new, empty subtitle at the playhead. Empty on purpose: the words are
 * what the user is about to type, and a placeholder that has to be deleted
 * first is one more step than typing.
 */
export const addSubtitleCommand: Command = {
  id: 'subtitle.add',
  label: '자막 넣기',
  icon: '💬',
  defaultKey: 't',
  selectsSubtitle: (before) => `sub_${before.project.nextId}`,
  done(before) {
    const plan = subtitlePlan(before.project, before.playhead);
    const at = formatTimecode(
      plan?.startFrame ?? before.playhead,
      before.project.timeline.fps,
    );
    return `${at} 위치에 자막을 넣었어요 · 내용을 적어 주세요.`;
  },
  disabledReason(ctx) {
    const total = videoDuration(ctx.project);
    if (total === 0) return '먼저 영상을 불러오세요.';
    if (ctx.playhead >= total) return '재생 위치를 영상 안으로 옮겨 주세요.';
    if (subtitleAt(ctx.project, ctx.playhead)) {
      return '이 자리에는 이미 자막이 있어요. 그 자막을 고치거나, 재생 위치를 옮겨 주세요.';
    }
    return '지금은 쓸 수 없어요.';
  },
  canRun(ctx) {
    return subtitlePlan(ctx.project, ctx.playhead) !== null;
  },
  run(ctx) {
    const plan = subtitlePlan(ctx.project, ctx.playhead);
    if (!plan) throw new Error('subtitle.add: no room at the playhead');
    const subtitle: Subtitle = {
      id: `sub_${ctx.project.nextId}`,
      text: '',
      startFrame: plan.startFrame,
      endFrame: plan.endFrame,
    };
    return {
      forward: [
        { kind: 'insertSubtitle', index: plan.index, subtitle },
        { kind: 'setNextId', value: ctx.project.nextId + 1 },
      ],
      inverse: [
        { kind: 'setNextId', value: ctx.project.nextId },
        { kind: 'removeSubtitle', index: plan.index },
      ],
    };
  },
};

/** What the subtitle says. Refuses a no-op so retyping the same words is not
 *  an undo step. */
export const setSubtitleTextCommand: Command<SubtitleTextArgs> = {
  id: 'subtitle.setText',
  label: '자막 내용 바꾸기',
  hidden: true,
  requiresArgs: true,
  done: '자막 내용을 바꿨어요.',
  canRun(ctx, args) {
    if (!args) return false;
    const found = locateSubtitle(ctx.project, args.subtitleId);
    return !!found && normalizeSubtitleText(args.text) !== found.subtitle.text;
  },
  run(ctx, args) {
    const found = locateSubtitle(ctx.project, args.subtitleId);
    if (!found) throw new Error('subtitle.setText: no such subtitle');
    const text = normalizeSubtitleText(args.text);
    if (text === found.subtitle.text) {
      throw new Error('subtitle.setText: no change');
    }
    return {
      forward: [
        {
          kind: 'updateSubtitle',
          subtitleId: found.subtitle.id,
          changes: { text },
        },
      ],
      inverse: [
        {
          kind: 'updateSubtitle',
          subtitleId: found.subtitle.id,
          changes: { text: found.subtitle.text },
        },
      ],
    };
  },
};

/** Remove the selected subtitle. Nothing else moves — unlike a clip, a
 *  subtitle takes up no time of its own. */
export const removeSubtitleCommand: Command = {
  id: 'subtitle.remove',
  label: '자막 지우기',
  icon: '⌫',
  hidden: true,
  done: '자막을 지웠어요.',
  disabledReason: () => `지울 ${PICK_FIRST}`,
  canRun(ctx) {
    return !!locateSubtitle(ctx.project, ctx.selectedSubtitleId ?? null);
  },
  run(ctx) {
    const found = locateSubtitle(ctx.project, ctx.selectedSubtitleId ?? null);
    if (!found) throw new Error('subtitle.remove: no selected subtitle');
    return {
      forward: [{ kind: 'removeSubtitle', index: found.index }],
      inverse: [
        {
          kind: 'insertSubtitle',
          index: found.index,
          subtitle: found.subtitle,
        },
      ],
    };
  },
};

function moveOps(
  ctx: EditorCtx,
  subtitleId: string,
  startFrame: number,
): { forward: Op[]; inverse: Op[] } {
  const found = locateSubtitle(ctx.project, subtitleId);
  const limits = subtitleLimits(ctx.project, subtitleId);
  if (!found || !limits) throw new Error('subtitle.move: no such subtitle');
  const { subtitle } = found;
  const length = subtitleLength(subtitle);
  const target = Math.min(
    limits.maxEnd - length,
    Math.max(limits.minStart, Math.round(startFrame)),
  );
  if (target === subtitle.startFrame)
    throw new Error('subtitle.move: no change');
  return {
    forward: [
      {
        kind: 'updateSubtitle',
        subtitleId,
        changes: { startFrame: target, endFrame: target + length },
      },
    ],
    inverse: [
      {
        kind: 'updateSubtitle',
        subtitleId,
        changes: {
          startFrame: subtitle.startFrame,
          endFrame: subtitle.endFrame,
        },
      },
    ],
  };
}

function edgeOps(
  ctx: EditorCtx,
  subtitleId: string,
  edge: 'start' | 'end',
  frame: number,
): { forward: Op[]; inverse: Op[] } {
  const found = locateSubtitle(ctx.project, subtitleId);
  const limits = subtitleLimits(ctx.project, subtitleId);
  if (!found || !limits) throw new Error(`subtitle.trim: no such subtitle`);
  const { subtitle } = found;
  const [min, max, current] =
    edge === 'start'
      ? [limits.minStart, limits.maxStart, subtitle.startFrame]
      : [limits.minEnd, limits.maxEnd, subtitle.endFrame];
  const target = Math.min(max, Math.max(min, Math.round(frame)));
  if (target === current) throw new Error('subtitle.trim: no change');
  const key = edge === 'start' ? 'startFrame' : 'endFrame';
  return {
    forward: [
      { kind: 'updateSubtitle', subtitleId, changes: { [key]: target } },
    ],
    inverse: [
      { kind: 'updateSubtitle', subtitleId, changes: { [key]: current } },
    ],
  };
}

/** Slide a subtitle along the timeline (a drag). Length is untouched. */
export const moveSubtitleCommand: Command<SubtitleMoveArgs> = {
  id: 'subtitle.move',
  label: '자막 끌기',
  hidden: true,
  requiresArgs: true,
  canRun(ctx, args) {
    return !!args && !!locateSubtitle(ctx.project, args.subtitleId);
  },
  run: (ctx, args) => moveOps(ctx, args.subtitleId, args.startFrame),
};

export const trimSubtitleStartCommand: Command<SubtitleEdgeArgs> = {
  id: 'subtitle.trimStart',
  label: '자막 시작 끌기',
  hidden: true,
  requiresArgs: true,
  canRun(ctx, args) {
    return !!args && !!locateSubtitle(ctx.project, args.subtitleId);
  },
  run: (ctx, args) => edgeOps(ctx, args.subtitleId, 'start', args.frame),
};

export const trimSubtitleEndCommand: Command<SubtitleEdgeArgs> = {
  id: 'subtitle.trimEnd',
  label: '자막 끝 끌기',
  hidden: true,
  requiresArgs: true,
  canRun(ctx, args) {
    return !!args && !!locateSubtitle(ctx.project, args.subtitleId);
  },
  run: (ctx, args) => edgeOps(ctx, args.subtitleId, 'end', args.frame),
};

/**
 * The keyboard's way to time a subtitle exactly: park the playhead where the
 * words should start (or stop), press. The same idea as Q/W for a clip, and
 * the only route that needs no mouse.
 *
 * "끝을 재생 위치로" keeps the subtitle ON the playhead's frame — the last
 * frame it is shown is the one the user is looking at — so the new end is the
 * playhead plus one. A clip's W does the opposite (the playhead frame is the
 * first one removed); for a clip that is a cut, for a subtitle it would be a
 * fencepost the user cannot see.
 */
function edgeToPlayhead(
  edge: 'start' | 'end',
): Pick<Command, 'canRun' | 'disabledReason' | 'run' | 'done'> {
  const target = (ctx: EditorCtx) =>
    edge === 'start' ? ctx.playhead : ctx.playhead + 1;
  return {
    canRun(ctx) {
      const id = ctx.selectedSubtitleId ?? null;
      const found = locateSubtitle(ctx.project, id);
      const limits = id ? subtitleLimits(ctx.project, id) : null;
      if (!found || !limits) return false;
      const t = target(ctx);
      const [min, max, current] =
        edge === 'start'
          ? [limits.minStart, limits.maxStart, found.subtitle.startFrame]
          : [limits.minEnd, limits.maxEnd, found.subtitle.endFrame];
      return t >= min && t <= max && t !== current;
    },
    disabledReason(ctx) {
      const id = ctx.selectedSubtitleId ?? null;
      const found = locateSubtitle(ctx.project, id);
      const limits = id ? subtitleLimits(ctx.project, id) : null;
      if (!found || !limits) return PICK_FIRST;
      const index = found.index;
      const t = target(ctx);
      if (edge === 'start') {
        if (t < limits.minStart) {
          return ctx.project.subtitles[index - 1]
            ? '옆 자막과 겹쳐요. 재생 위치를 옆 자막 뒤로 옮겨 주세요.'
            : '맨 앞이에요.';
        }
        if (t > limits.maxStart) {
          return '재생 위치가 자막 끝을 지났어요. 자막 안으로 옮겨 주세요.';
        }
      } else {
        if (t > limits.maxEnd) {
          return ctx.project.subtitles[index + 1]
            ? '옆 자막과 겹쳐요. 재생 위치를 옆 자막 앞으로 옮겨 주세요.'
            : '영상이 여기서 끝나요.';
        }
        if (t < limits.minEnd) {
          return '재생 위치가 자막 시작보다 앞이에요. 자막 안으로 옮겨 주세요.';
        }
      }
      return '이미 재생 위치에 맞춰져 있어요.';
    },
    done(_before, after) {
      const found = locateSubtitle(
        after.project,
        after.selectedSubtitleId ?? null,
      );
      if (!found) return '';
      const length = formatTimecode(
        subtitleLength(found.subtitle),
        after.project.timeline.fps,
      );
      return edge === 'start'
        ? `자막 시작을 재생 위치로 맞췄어요 · 길이 ${length}`
        : `자막 끝을 재생 위치로 맞췄어요 · 길이 ${length}`;
    },
    run(ctx) {
      const id = ctx.selectedSubtitleId ?? null;
      if (!id) throw new Error('subtitle.edgeToPlayhead: nothing selected');
      return edgeOps(ctx, id, edge, target(ctx));
    },
  };
}

/**
 * Slide the whole subtitle so it STARTS at the playhead, length unchanged —
 * the keyboard's version of dragging the chip. Without it a keyboard user
 * could time each edge but never shift the words as a block, and two edge
 * moves are not the same thing when the neighbours leave no slack.
 */
export const subtitleToPlayheadCommand: Command = {
  id: 'subtitle.moveToPlayhead',
  label: '자막 전체를 재생 위치로',
  hidden: true,
  canRun(ctx) {
    const id = ctx.selectedSubtitleId ?? null;
    const found = locateSubtitle(ctx.project, id);
    const limits = id ? subtitleLimits(ctx.project, id) : null;
    if (!found || !limits) return false;
    const length = subtitleLength(found.subtitle);
    const target = Math.min(
      limits.maxEnd - length,
      Math.max(limits.minStart, ctx.playhead),
    );
    return target !== found.subtitle.startFrame;
  },
  disabledReason(ctx) {
    const id = ctx.selectedSubtitleId ?? null;
    const found = locateSubtitle(ctx.project, id);
    const limits = id ? subtitleLimits(ctx.project, id) : null;
    if (!found || !limits) return PICK_FIRST;
    const length = subtitleLength(found.subtitle);
    if (ctx.playhead < limits.minStart) {
      return ctx.project.subtitles[found.index - 1]
        ? '옆 자막과 겹쳐요. 재생 위치를 옆 자막 뒤로 옮겨 주세요.'
        : '맨 앞이에요.';
    }
    if (ctx.playhead > limits.maxEnd - length) {
      return ctx.project.subtitles[found.index + 1]
        ? '옆 자막과 겹쳐요. 재생 위치를 더 앞으로 옮겨 주세요.'
        : '영상 끝을 넘어가요. 재생 위치를 더 앞으로 옮겨 주세요.';
    }
    return '이미 재생 위치에서 시작해요.';
  },
  done(_before, after) {
    const found = locateSubtitle(
      after.project,
      after.selectedSubtitleId ?? null,
    );
    if (!found) return '';
    return `자막 전체를 ${formatTimecode(found.subtitle.startFrame, after.project.timeline.fps)} 위치로 옮겼어요.`;
  },
  run(ctx) {
    const id = ctx.selectedSubtitleId ?? null;
    if (!id) throw new Error('subtitle.moveToPlayhead: nothing selected');
    return moveOps(ctx, id, ctx.playhead);
  },
};

export const subtitleStartToPlayheadCommand: Command = {
  id: 'subtitle.startToPlayhead',
  label: '자막 시작을 재생 위치로',
  hidden: true,
  ...edgeToPlayhead('start'),
};

export const subtitleEndToPlayheadCommand: Command = {
  id: 'subtitle.endToPlayhead',
  label: '자막 끝을 재생 위치로',
  hidden: true,
  ...edgeToPlayhead('end'),
};

/** Sentences for the drag commands, in one place with the clip's wording. */
export function describeSubtitleDrag(
  mode: 'move' | 'trimStart' | 'trimEnd',
  ctx: EditorCtx,
  subtitleId: string,
  lengthBefore?: number,
): string {
  return describeSubtitleEdit(mode, ctx.project, subtitleId, lengthBefore);
}

export const SUBTITLE_COMMANDS: Command<any>[] = [
  addSubtitleCommand,
  removeSubtitleCommand,
  subtitleToPlayheadCommand,
  subtitleStartToPlayheadCommand,
  subtitleEndToPlayheadCommand,
  setSubtitleTextCommand,
  moveSubtitleCommand,
  trimSubtitleStartCommand,
  trimSubtitleEndCommand,
];
