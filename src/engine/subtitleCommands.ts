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
import {
  describeEffect,
  describeLook,
  describePlace,
  effectField,
  effectOf,
  lookField,
  lookOf,
  placeFields,
  placeOf,
  type EffectId,
  type LookId,
  type PlaceId,
} from './subtitleStyle';
import { describeFont, fontField, fontOf, type FontId } from './fonts';
import { describePosition, normalizePosition } from './subtitlePosition';

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

// ---- ADR-0017: a look, a place, a way in ----
//
// Three arg-taking commands, each one `updateSubtitle` op with its exact
// inverse, each one undo step. Arg-taking like `subtitle.setText` (the panel
// supplies the subtitle and the choice), so no palette row per choice —
// three radiogroups in the panel are the surface. A choice already made is
// refused like a no-op text edit: not an edit, not an undo entry.

export interface SubtitleLookArgs {
  subtitleId: string;
  look: LookId;
}

export interface SubtitlePlaceArgs {
  subtitleId: string;
  place: PlaceId;
}

export interface SubtitleEffectArgs {
  subtitleId: string;
  effect: EffectId;
}

export interface SubtitleFontArgs {
  subtitleId: string;
  font: FontId;
}

/** One field, before and after, as forward and inverse ops. A field going
 *  back to "absent" is written as `undefined`, which `updateSubtitle`'s
 *  spread applies and JSON then drops — the document reads as it did. */
function fieldOps(
  subtitle: Subtitle,
  changes: Partial<Omit<Subtitle, 'id'>>,
): { forward: Op[]; inverse: Op[] } {
  const before: Partial<Omit<Subtitle, 'id'>> = {};
  for (const key of Object.keys(changes) as (keyof typeof changes)[]) {
    (before as Record<string, unknown>)[key] = subtitle[key];
  }
  return {
    forward: [{ kind: 'updateSubtitle', subtitleId: subtitle.id, changes }],
    inverse: [
      { kind: 'updateSubtitle', subtitleId: subtitle.id, changes: before },
    ],
  };
}

export const setSubtitleLookCommand: Command<SubtitleLookArgs> = {
  id: 'subtitle.setLook',
  label: '자막 모양 고르기',
  hidden: true,
  requiresArgs: true,
  done: (_before, _after, args) =>
    describeLook((args as SubtitleLookArgs).look),
  canRun(ctx, args) {
    if (!args) return false;
    const found = locateSubtitle(ctx.project, args.subtitleId);
    return !!found && lookOf(found.subtitle) !== args.look;
  },
  run(ctx, args) {
    const found = locateSubtitle(ctx.project, args.subtitleId);
    if (!found) throw new Error('subtitle.setLook: no such subtitle');
    if (lookOf(found.subtitle) === args.look) {
      throw new Error('subtitle.setLook: no change');
    }
    return fieldOps(found.subtitle, { look: lookField(args.look) });
  },
};

export const setSubtitlePlaceCommand: Command<SubtitlePlaceArgs> = {
  id: 'subtitle.setPlace',
  label: '자막 자리 고르기',
  hidden: true,
  requiresArgs: true,
  done: (_before, _after, args) =>
    describePlace((args as SubtitlePlaceArgs).place),
  canRun(ctx, args) {
    if (!args) return false;
    const found = locateSubtitle(ctx.project, args.subtitleId);
    return !!found && placeOf(found.subtitle) !== args.place;
  },
  run(ctx, args) {
    const found = locateSubtitle(ctx.project, args.subtitleId);
    if (!found) throw new Error('subtitle.setPlace: no such subtitle');
    if (placeOf(found.subtitle) === args.place) {
      throw new Error('subtitle.setPlace: no change');
    }
    return fieldOps(found.subtitle, placeFields(args.place));
  },
};

export const setSubtitleEffectCommand: Command<SubtitleEffectArgs> = {
  id: 'subtitle.setEffect',
  label: '자막 효과 고르기',
  hidden: true,
  requiresArgs: true,
  done: (_before, _after, args) =>
    describeEffect((args as SubtitleEffectArgs).effect),
  canRun(ctx, args) {
    if (!args) return false;
    const found = locateSubtitle(ctx.project, args.subtitleId);
    return !!found && effectOf(found.subtitle) !== args.effect;
  },
  run(ctx, args) {
    const found = locateSubtitle(ctx.project, args.subtitleId);
    if (!found) throw new Error('subtitle.setEffect: no such subtitle');
    if (effectOf(found.subtitle) === args.effect) {
      throw new Error('subtitle.setEffect: no change');
    }
    return fieldOps(found.subtitle, { effect: effectField(args.effect) });
  },
};

export interface SubtitlePositionArgs {
  subtitleId: string;
  /** Fractions of the box; absent = the preset value on that axis. */
  posX?: number;
  posY?: number;
}

function decidePosition(
  ctx: EditorCtx,
  args: SubtitlePositionArgs | undefined,
) {
  if (!args) return null;
  if (args.posX !== undefined && !Number.isFinite(args.posX)) return null;
  if (args.posY !== undefined && !Number.isFinite(args.posY)) return null;
  const found = locateSubtitle(ctx.project, args.subtitleId);
  if (!found) return null;
  const next = normalizePosition(args);
  const { subtitle } = found;
  // Compared by VALUE: a preset wrote `posX` 0.5, the normal form writes
  // nothing for it, and neither is a move.
  if (
    (next.posX ?? 0.5) === (subtitle.posX ?? 0.5) &&
    next.posY === subtitle.posY
  )
    return null;
  return { subtitle, next };
}

/** Where the words are put by hand (E8-2c, ADR-0019): the stage's drag
 *  and the panel's sliders write any position, in the normal form
 *  (`subtitlePosition.ts`), so a drop on a preset IS the preset. Callers
 *  dispatch under the coalesce key `pos:<id>` so a gesture is one undo
 *  step — the pan's shape. */
export const setSubtitlePositionCommand: Command<SubtitlePositionArgs> = {
  id: 'subtitle.setPosition',
  label: '자막 자리 정하기',
  hidden: true,
  requiresArgs: true,
  done: (_before, _after, args) =>
    describePosition(normalizePosition(args as SubtitlePositionArgs)),
  canRun: (ctx, args) => decidePosition(ctx, args) !== null,
  run(ctx, args) {
    const d = decidePosition(ctx, args);
    if (!d) throw new Error('subtitle.setPosition: nothing to change');
    return fieldOps(d.subtitle, d.next);
  },
};

/** The face the words are set in (ADR-0018). The same shape as the look:
 *  one field, an exact inverse, the face already set refused. Loading the
 *  file is the panel's and the preview's business, not the document's. */
export const setSubtitleFontCommand: Command<SubtitleFontArgs> = {
  id: 'subtitle.setFont',
  label: '자막 글꼴 고르기',
  hidden: true,
  requiresArgs: true,
  done: (_before, after, args) => {
    const { subtitleId, font } = args as SubtitleFontArgs;
    const found = locateSubtitle(after.project, subtitleId);
    return describeFont(font, found ? lookOf(found.subtitle) : 'plain');
  },
  canRun(ctx, args) {
    if (!args) return false;
    const found = locateSubtitle(ctx.project, args.subtitleId);
    return !!found && fontOf(found.subtitle) !== args.font;
  },
  run(ctx, args) {
    const found = locateSubtitle(ctx.project, args.subtitleId);
    if (!found) throw new Error('subtitle.setFont: no such subtitle');
    if (fontOf(found.subtitle) === args.font) {
      throw new Error('subtitle.setFont: no change');
    }
    return fieldOps(found.subtitle, { font: fontField(args.font) });
  },
};

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
  setSubtitleLookCommand,
  setSubtitlePlaceCommand,
  setSubtitleEffectCommand,
  setSubtitleFontCommand,
  setSubtitlePositionCommand,
];
