// framewright — the image commands (ADR-0020).
//
// Same contract as every other command (ADR-0003): data with a `canRun`, a
// reason for refusing, a pure `run` that returns an invertible patch, and a
// sentence for afterwards. Their own file for the reason the subtitle commands
// have one — a third kind of thing on the timeline is not `commands.ts`'s to
// carry — and the arithmetic they stand on is `images.ts`, which is itself a
// thin layer over `spans.ts`.
//
// Two things here are NOT the subtitle's:
//
//  - `image.import` is a REGISTRY command. The video's import is a
//    hand-written method on the editor (`Editor.importAsset`, which predates
//    ADR-0009), and that is the thing this one does not copy: the asset and
//    the picture that goes on the timeline are one patch, so one Ctrl+Z takes
//    back both. Its inverse deliberately does not rewind `nextId` — see the
//    note on the inverse itself.
//  - every command here is told its image in an ARGUMENT. A subtitle command
//    reads `ctx.selectedSubtitleId`; there is no `selectedImageId` yet, and a
//    refusal that has to name the image therefore cannot live in
//    `disabledReason`, which sees only the ctx. `imageTimingReason` is where
//    those sentences live until there is a selection to read them from.
//
// The three `*ToPlayhead` commands are knowingly a SECOND copy of the
// subtitle's `edgeToPlayhead` shape: the arithmetic is one call into
// `images.ts` either way, and what differs is every sentence. A shared span
// COMMAND factory is the third case's job, not this one's (see CLAUDE.md's
// tech-debt list).

import type { Command, EditorCtx } from './commands';
import type { Op } from './ops';
import type { Asset, StageImage } from './types';
import { formatTimecode } from './time';
import { videoDuration } from './timeline';
import {
  describeImagePosition,
  describeImageSize,
  imageLength,
  imageLimits,
  imagePlan,
  imageSizeOf,
  locateImage,
  normalizeImagePosition,
  normalizeImageSize,
  samePosition,
} from './images';

export interface ImageImportArgs {
  /** The file's name, shown in the media bin and in the export's warning. */
  name: string;
  /** Where the bytes were put in the media store, when they were kept. */
  opfsKey?: string;
  /** The picture's own pixel size. Recorded on the asset so the stage knows
   *  the aspect — and can hit-test the image — before any bitmap arrives. */
  width: number;
  height: number;
}

export interface ImageAddArgs {
  assetId: string;
}

/** Every command that acts on one image is told which one. */
export interface ImageArgs {
  imageId: string;
}

export interface ImagePositionArgs extends ImageArgs {
  /** Fractions of the box. An ABSENT axis is the CENTRE of that axis — the
   *  image's normal form (`images.ts`), not "leave that axis alone". */
  posX?: number;
  posY?: number;
}

export interface ImageSizeArgs extends ImageArgs {
  /** A fraction of the BOX's width; the height follows the picture's aspect. */
  size: number;
}

const NO_VIDEO = '먼저 영상을 불러오세요.';
const OFF_THE_END = '재생 위치를 영상 안으로 옮겨 주세요.';
const OCCUPIED =
  '이 자리에는 이미 이미지가 있어요. 그 이미지를 지우거나, 재생 위치를 옮겨 주세요.';
const NOTHING_TO_DO = '지금은 쓸 수 없어요.';

/** Why there is no room for a new image at the playhead. Shared by the two
 *  commands that place one, which are refused by exactly the same three
 *  walls. `subtitle.add`'s shape. */
function noRoomReason(ctx: EditorCtx): string {
  const plan = imagePlan(ctx.project, ctx.playhead);
  if (plan) return NOTHING_TO_DO;
  // `imagePlan` is null for three different reasons and the user can only act
  // on the right one, so they are told apart here rather than merged.
  const total = videoDuration(ctx.project);
  if (total === 0) return NO_VIDEO;
  if (ctx.playhead >= total) return OFF_THE_END;
  return OCCUPIED;
}

/** Where a new image goes, or a throw — the two placing commands' shared
 *  opening move, so neither can drift from `imagePlan`'s answer. */
function planOrThrow(ctx: EditorCtx, id: string) {
  const plan = imagePlan(ctx.project, ctx.playhead);
  if (!plan) throw new Error(`${id}: no room at the playhead`);
  return plan;
}

/** "Put it at 00:03:00" — both placing commands say the same thing, because
 *  from the user's side they did the same thing. */
function placedText(ctx: EditorCtx): string {
  const plan = imagePlan(ctx.project, ctx.playhead);
  const at = formatTimecode(
    plan?.startFrame ?? ctx.playhead,
    ctx.project.timeline.fps,
  );
  return `${at} 위치에 이미지를 넣었어요.`;
}

/**
 * Bring a picture in and put it on the timeline, as ONE edit.
 *
 * The video's import is two acts the user cannot tell apart and one undo step
 * already; this is the same promise, kept by the command machinery instead of
 * by hand. Ids come from the document counter in one run — `asset_<n>` for the
 * file, `img_<n+1>` for the picture on the timeline.
 */
export const importImageCommand: Command<ImageImportArgs> = {
  id: 'image.import',
  label: '이미지 넣기',
  icon: '🖼',
  hidden: true,
  requiresArgs: true,
  done: (before) => placedText(before),
  disabledReason: noRoomReason,
  canRun(ctx, args) {
    return !!args && imagePlan(ctx.project, ctx.playhead) !== null;
  },
  run(ctx, args) {
    const plan = planOrThrow(ctx, 'image.import');
    const assetId = `asset_${ctx.project.nextId}`;
    const asset: Asset = {
      id: assetId,
      kind: 'image',
      name: args.name,
      ...(args.opfsKey !== undefined ? { opfsKey: args.opfsKey } : {}),
      meta: { width: args.width, height: args.height },
    };
    const image: StageImage = {
      id: `img_${ctx.project.nextId + 1}`,
      assetId,
      startFrame: plan.startFrame,
      endFrame: plan.endFrame,
      // The centre and a quarter of the box are ABSENCE, so a fresh picture
      // carries nothing but its timing (ADR-0020).
    };
    return {
      forward: [
        { kind: 'addAsset', asset },
        { kind: 'insertImage', index: plan.index, image },
        { kind: 'setNextId', value: ctx.project.nextId + 2 },
      ],
      inverse: [
        // NOTE: deliberately no `setNextId` — `Editor.importAsset`'s rule, for
        // its reason. Rewinding would hand `asset_3` out twice in one session,
        // and anything still holding the old id (the bitmap cache, the decode
        // registry) would silently be pointing at a different file.
        { kind: 'removeImage', index: plan.index },
        { kind: 'removeAsset', assetId },
      ],
    };
  },
};

/**
 * Put a picture the document already has on the timeline again — the media
 * bin's row. No asset is made, so unlike the import this one DOES give its id
 * back on undo: nothing outside the document ever saw `img_<n>`.
 */
export const addImageCommand: Command<ImageAddArgs> = {
  id: 'image.add',
  label: '재생 위치에 넣기',
  hidden: true,
  requiresArgs: true,
  done: (before) => placedText(before),
  disabledReason: noRoomReason,
  canRun(ctx, args) {
    if (!args) return false;
    const asset = ctx.project.assets.find((a) => a.id === args.assetId);
    if (!asset || asset.kind !== 'image') return false;
    return imagePlan(ctx.project, ctx.playhead) !== null;
  },
  run(ctx, args) {
    const plan = planOrThrow(ctx, 'image.add');
    const image: StageImage = {
      id: `img_${ctx.project.nextId}`,
      assetId: args.assetId,
      startFrame: plan.startFrame,
      endFrame: plan.endFrame,
    };
    return {
      forward: [
        { kind: 'insertImage', index: plan.index, image },
        { kind: 'setNextId', value: ctx.project.nextId + 1 },
      ],
      inverse: [
        { kind: 'setNextId', value: ctx.project.nextId },
        { kind: 'removeImage', index: plan.index },
      ],
    };
  },
};

/** Take the picture off the timeline. Nothing else moves — like a subtitle,
 *  an image takes up no time of its own. The asset stays: the file is still
 *  in the bin, ready to be placed again. */
export const removeImageCommand: Command<ImageArgs> = {
  id: 'image.remove',
  label: '이미지 지우기',
  icon: '⌫',
  hidden: true,
  requiresArgs: true,
  done: '이미지를 지웠어요.',
  disabledReason: () => '지울 이미지를 먼저 골라 주세요.',
  canRun(ctx, args) {
    return !!args && !!locateImage(ctx.project, args.imageId);
  },
  run(ctx, args) {
    const found = locateImage(ctx.project, args.imageId);
    if (!found) throw new Error('image.remove: no such image');
    return {
      forward: [{ kind: 'removeImage', index: found.index }],
      inverse: [
        { kind: 'insertImage', index: found.index, image: found.image },
      ],
    };
  },
};

// ---- THE PLACE AND THE SIZE ----

/** One field, before and after, as forward and inverse ops. A field going back
 *  to "absent" is written as `undefined`, which `updateImage` applies and
 *  `dropUndefined` then removes — so undo and a reload agree on the document
 *  (`ops.ts`). `subtitleCommands.ts`'s `fieldOps`, for the image's list. */
function fieldOps(
  image: StageImage,
  changes: Partial<Omit<StageImage, 'id'>>,
): { forward: Op[]; inverse: Op[] } {
  const before: Partial<Omit<StageImage, 'id'>> = {};
  for (const key of Object.keys(changes) as (keyof typeof changes)[]) {
    (before as Record<string, unknown>)[key] = image[key];
  }
  return {
    forward: [{ kind: 'updateImage', imageId: image.id, changes }],
    inverse: [{ kind: 'updateImage', imageId: image.id, changes: before }],
  };
}

function decidePosition(ctx: EditorCtx, args: ImagePositionArgs | undefined) {
  if (!args) return null;
  if (args.posX !== undefined && !Number.isFinite(args.posX)) return null;
  if (args.posY !== undefined && !Number.isFinite(args.posY)) return null;
  const found = locateImage(ctx.project, args.imageId);
  if (!found) return null;
  const next = normalizeImagePosition(args);
  // Compared by PLACE, both axes through the normal form and an absent axis
  // read as the centre: a drag that ended a third of a percent from where it
  // started, or on the centre the picture is already at, changed nothing on
  // screen and must not cost the user a Ctrl+Z.
  if (samePosition(next, found.image)) return null;
  return { image: found.image, next };
}

/**
 * Where the picture sits (ADR-0020). The stage's drag and the panel's two
 * sliders write the same two numbers, in the normal form — whole percents,
 * the centre as an absent field on BOTH axes. Callers dispatch under the
 * coalesce key `imgpos:<id>` so one gesture is one undo step, exactly as the
 * words use `pos:<id>` and the pan `pan:<id>`.
 */
export const setImagePositionCommand: Command<ImagePositionArgs> = {
  id: 'image.setPosition',
  label: '이미지 자리 정하기',
  hidden: true,
  requiresArgs: true,
  done: (_before, _after, args) =>
    describeImagePosition(normalizeImagePosition(args as ImagePositionArgs)),
  canRun: (ctx, args) => decidePosition(ctx, args) !== null,
  run(ctx, args) {
    const d = decidePosition(ctx, args);
    if (!d) throw new Error('image.setPosition: nothing to change');
    return fieldOps(d.image, d.next);
  },
};

function decideSize(ctx: EditorCtx, args: ImageSizeArgs | undefined) {
  if (!args || !Number.isFinite(args.size)) return null;
  const found = locateImage(ctx.project, args.imageId);
  if (!found) return null;
  const next = normalizeImageSize(args.size);
  // By the size DRAWN, so the default asked for on a picture that already
  // draws at the default is not an edit — the position's rule, for one number.
  if (imageSizeOf({ size: next }) === imageSizeOf(found.image)) return null;
  return { image: found.image, next };
}

/**
 * How big the picture is drawn, as a fraction of the box's WIDTH — one slider,
 * 크기. Coalesce key `size:<id>`, for the same reason the position has one.
 * The value is held between the slider's ends and rounded to a whole percent
 * by `normalizeImageSize`; a quarter goes back in as an absent field.
 */
export const setImageSizeCommand: Command<ImageSizeArgs> = {
  id: 'image.setSize',
  label: '이미지 크기 정하기',
  hidden: true,
  requiresArgs: true,
  done: (_before, _after, args) =>
    describeImageSize(normalizeImageSize((args as ImageSizeArgs).size)),
  canRun: (ctx, args) => decideSize(ctx, args) !== null,
  run(ctx, args) {
    const d = decideSize(ctx, args);
    if (!d) throw new Error('image.setSize: nothing to change');
    return fieldOps(d.image, { size: d.next });
  },
};

// ---- THE TIMING, BY KEYBOARD ----

function moveOps(
  ctx: EditorCtx,
  imageId: string,
  startFrame: number,
): { forward: Op[]; inverse: Op[] } {
  const found = locateImage(ctx.project, imageId);
  const limits = imageLimits(ctx.project, imageId);
  if (!found || !limits) throw new Error('image.move: no such image');
  const { image } = found;
  const length = imageLength(image);
  const target = Math.min(
    limits.maxEnd - length,
    Math.max(limits.minStart, Math.round(startFrame)),
  );
  if (target === image.startFrame) throw new Error('image.move: no change');
  return {
    forward: [
      {
        kind: 'updateImage',
        imageId,
        changes: { startFrame: target, endFrame: target + length },
      },
    ],
    inverse: [
      {
        kind: 'updateImage',
        imageId,
        changes: { startFrame: image.startFrame, endFrame: image.endFrame },
      },
    ],
  };
}

function edgeOps(
  ctx: EditorCtx,
  imageId: string,
  edge: 'start' | 'end',
  frame: number,
): { forward: Op[]; inverse: Op[] } {
  const found = locateImage(ctx.project, imageId);
  const limits = imageLimits(ctx.project, imageId);
  if (!found || !limits) throw new Error('image.trim: no such image');
  const { image } = found;
  const [min, max, current] =
    edge === 'start'
      ? [limits.minStart, limits.maxStart, image.startFrame]
      : [limits.minEnd, limits.maxEnd, image.endFrame];
  const target = Math.min(max, Math.max(min, Math.round(frame)));
  if (target === current) throw new Error('image.trim: no change');
  const key = edge === 'start' ? 'startFrame' : 'endFrame';
  return {
    forward: [{ kind: 'updateImage', imageId, changes: { [key]: target } }],
    inverse: [{ kind: 'updateImage', imageId, changes: { [key]: current } }],
  };
}

/** "끝을 재생 위치로" keeps the picture ON the playhead's frame — the last
 *  frame it is shown is the one being looked at — so the new end is the
 *  playhead plus one. The subtitle's rule, for the same reason: a clip's W is
 *  a cut, and a fencepost the user cannot see is not. */
function targetFrame(ctx: EditorCtx, edge: 'start' | 'end'): number {
  return edge === 'start' ? ctx.playhead : ctx.playhead + 1;
}

/**
 * Why one of the three timing commands will not run right now, in words.
 *
 * Not a `disabledReason`: that is handed only the ctx, and these commands are
 * told their image in an argument because nothing selects an image yet. The
 * panel and the lane's chips call this; when a selection lands, this function
 * is what `disabledReason` will call, unchanged.
 */
export function imageTimingReason(
  ctx: EditorCtx,
  imageId: string | null,
  mode: 'move' | 'start' | 'end',
): string {
  const found = locateImage(ctx.project, imageId);
  const limits = imageId ? imageLimits(ctx.project, imageId) : null;
  if (!found || !limits) {
    return mode === 'move'
      ? '옮길 이미지를 먼저 골라 주세요.'
      : '이미지를 먼저 골라 주세요.';
  }
  const prev = ctx.project.images[found.index - 1];
  const next = ctx.project.images[found.index + 1];

  if (mode === 'move') {
    const length = imageLength(found.image);
    if (ctx.playhead < limits.minStart) {
      return prev
        ? '옆 이미지와 겹쳐요. 재생 위치를 옆 이미지 뒤로 옮겨 주세요.'
        : '맨 앞이에요.';
    }
    if (ctx.playhead > limits.maxEnd - length) {
      return next
        ? '옆 이미지와 겹쳐요. 재생 위치를 더 앞으로 옮겨 주세요.'
        : '영상 끝을 넘어가요. 재생 위치를 더 앞으로 옮겨 주세요.';
    }
    return '이미 재생 위치에서 시작해요.';
  }

  const t = targetFrame(ctx, mode);
  if (mode === 'start') {
    if (t < limits.minStart) {
      return prev
        ? '옆 이미지와 겹쳐요. 재생 위치를 옆 이미지 뒤로 옮겨 주세요.'
        : '맨 앞이에요.';
    }
    if (t > limits.maxStart) {
      return '재생 위치가 이미지 끝을 지났어요. 이미지 안으로 옮겨 주세요.';
    }
  } else {
    if (t > limits.maxEnd) {
      return next
        ? '옆 이미지와 겹쳐요. 재생 위치를 옆 이미지 앞으로 옮겨 주세요.'
        : '영상이 여기서 끝나요.';
    }
    if (t < limits.minEnd) {
      return '재생 위치가 이미지 시작보다 앞이에요. 이미지 안으로 옮겨 주세요.';
    }
  }
  return '이미 재생 위치에 맞춰져 있어요.';
}

/** The two edges, written once. A deliberate second copy of the subtitle's
 *  `edgeToPlayhead` (see this file's header): the arithmetic is one call, the
 *  sentences are all that differ, and a shared factory waits for a third. */
function edgeToPlayhead(
  edge: 'start' | 'end',
): Pick<Command<ImageArgs>, 'canRun' | 'run' | 'done'> {
  return {
    canRun(ctx, args) {
      if (!args) return false;
      const found = locateImage(ctx.project, args.imageId);
      const limits = imageLimits(ctx.project, args.imageId);
      if (!found || !limits) return false;
      const t = targetFrame(ctx, edge);
      const [min, max, current] =
        edge === 'start'
          ? [limits.minStart, limits.maxStart, found.image.startFrame]
          : [limits.minEnd, limits.maxEnd, found.image.endFrame];
      return t >= min && t <= max && t !== current;
    },
    done(_before, after, args) {
      const found = locateImage(after.project, (args as ImageArgs).imageId);
      if (!found) return '';
      const length = formatTimecode(
        imageLength(found.image),
        after.project.timeline.fps,
      );
      return edge === 'start'
        ? `이미지 시작을 재생 위치로 맞췄어요 · 길이 ${length}`
        : `이미지 끝을 재생 위치로 맞췄어요 · 길이 ${length}`;
    },
    run(ctx, args) {
      return edgeOps(ctx, args.imageId, edge, targetFrame(ctx, edge));
    },
  };
}

/** Slide the whole picture so it STARTS at the playhead, length unchanged —
 *  the keyboard's version of dragging the chip, which this unit does not have
 *  at all. Two edge moves are not the same thing when the neighbours leave no
 *  slack. */
export const imageToPlayheadCommand: Command<ImageArgs> = {
  id: 'image.moveToPlayhead',
  label: '이미지 전체를 재생 위치로',
  hidden: true,
  requiresArgs: true,
  canRun(ctx, args) {
    if (!args) return false;
    const found = locateImage(ctx.project, args.imageId);
    const limits = imageLimits(ctx.project, args.imageId);
    if (!found || !limits) return false;
    const length = imageLength(found.image);
    const target = Math.min(
      limits.maxEnd - length,
      Math.max(limits.minStart, ctx.playhead),
    );
    return target !== found.image.startFrame;
  },
  done(_before, after, args) {
    const found = locateImage(after.project, (args as ImageArgs).imageId);
    if (!found) return '';
    const at = formatTimecode(
      found.image.startFrame,
      after.project.timeline.fps,
    );
    return `이미지 전체를 ${at} 위치로 옮겼어요.`;
  },
  run: (ctx, args) => moveOps(ctx, args.imageId, ctx.playhead),
};

export const imageStartToPlayheadCommand: Command<ImageArgs> = {
  id: 'image.startToPlayhead',
  label: '이미지 시작을 재생 위치로',
  hidden: true,
  requiresArgs: true,
  ...edgeToPlayhead('start'),
};

export const imageEndToPlayheadCommand: Command<ImageArgs> = {
  id: 'image.endToPlayhead',
  label: '이미지 끝을 재생 위치로',
  hidden: true,
  requiresArgs: true,
  ...edgeToPlayhead('end'),
};

export const IMAGE_COMMANDS: Command<any>[] = [
  importImageCommand,
  addImageCommand,
  removeImageCommand,
  imageToPlayheadCommand,
  imageStartToPlayheadCommand,
  imageEndToPlayheadCommand,
  setImagePositionCommand,
  setImageSizeCommand,
];
