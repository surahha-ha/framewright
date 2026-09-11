// framewright — the picture commands (ADR-0014).
//
// Four commands, of two kinds. `clip.rotate` and `clip.pictureReset` are
// things a key or a palette row can do whole: turn the selected clip a
// quarter, put its picture back as shot. `clip.zoom` and `clip.pan` set a
// number and need one, so they have no palette row and no key — the panel's
// slider and a drag on the preview are their only callers, and each notch
// or pointer move goes through here so the sentence and the undo step are
// the command's, not the control's.

import type { Command, EditorCtx } from './commands';
import type { Op } from './ops';
import { locateClip } from './timeline';
import type { Clip } from './types';
import {
  ZOOM_MAX,
  clipEmptySides,
  clipFillZoom,
  clipPanLimits,
  describePan,
  describeRotation,
  describeZoom,
  emptySidesText,
  isAsShot,
  isRotation,
  nextRotation,
  pictureTransform,
  roundPan,
  roundZoom,
  zoomText,
  type PanLimits,
  type Rotation,
} from './picture';

function within(pan: number, limit: number): number {
  return roundPan(Math.min(limit, Math.max(-limit, pan)));
}

function withinLimits(x: number, y: number, limits: PanLimits) {
  return { x: within(x, limits.x), y: within(y, limits.y) };
}

export interface RotateArgs {
  clipId?: string;
  /** A quarter on from now when absent. */
  rotation?: Rotation;
}

export interface ZoomArgs {
  clipId?: string;
  /** 1 = fitted. Clamped to 1–4 and rounded to a percent. */
  zoom: number;
}

export interface PanArgs {
  clipId?: string;
  /** Fractions of the box at the fit, -0.5..0.5, rounded to a percent. */
  x: number;
  y: number;
}

const PICK_FIRST = '클립을 먼저 골라 주세요.';

function pick(ctx: EditorCtx, clipId: string | undefined) {
  return locateClip(ctx.project, clipId ?? ctx.selectedClipId);
}

/** One `updateClip` and its inverse for a set of picture fields. */
function patch(
  trackId: string,
  clip: Clip,
  changes: Partial<Pick<Clip, 'zoom' | 'panX' | 'panY' | 'rotation'>>,
): { forward: Op[]; inverse: Op[] } {
  const inverse: Partial<Clip> = {};
  for (const key of Object.keys(changes) as (keyof typeof changes)[]) {
    inverse[key] = clip[key] as never;
  }
  return {
    forward: [{ kind: 'updateClip', trackId, clipId: clip.id, changes }],
    inverse: [
      { kind: 'updateClip', trackId, clipId: clip.id, changes: inverse },
    ],
  };
}

function decideRotation(ctx: EditorCtx, args: RotateArgs | undefined) {
  const found = pick(ctx, args?.clipId);
  if (!found) return null;
  const t = pictureTransform(found.clip);
  const next =
    args?.rotation === undefined
      ? nextRotation(t.rotation)
      : isRotation(args.rotation)
        ? args.rotation
        : null;
  if (next === null || next === t.rotation) return null;
  // Turned, the picture may be narrower than it was, and a pan that was
  // fine may now carry it out of the box: the turn pulls the pan inside
  // its new limit in the same step, so the document never holds a pan
  // the box cannot show and one undo puts both back.
  const pan = withinLimits(
    t.panX,
    t.panY,
    clipPanLimits(ctx.project, found.clip, next),
  );
  const panChanged = pan.x !== t.panX || pan.y !== t.panY;
  return { ...found, next, pan, panChanged };
}

export const rotateCommand: Command<RotateArgs | undefined> = {
  id: 'clip.rotate',
  label: '화면 돌리기',
  icon: '↻',
  defaultKey: 'r',
  hidden: true,
  done(before, _after, args) {
    const d = decideRotation(before, args as RotateArgs | undefined);
    return d ? describeRotation(d.next, d.panChanged) : '';
  },
  disabledReason: () => PICK_FIRST,
  canRun: (ctx, args) => decideRotation(ctx, args) !== null,
  run(ctx, args) {
    const d = decideRotation(ctx, args);
    if (!d) throw new Error('clip.rotate: nothing to change');
    return patch(d.track.id, d.clip, {
      rotation: d.next === 0 ? undefined : d.next,
      ...(d.panChanged
        ? {
            panX: d.pan.x === 0 ? undefined : d.pan.x,
            panY: d.pan.y === 0 ? undefined : d.pan.y,
          }
        : {}),
    });
  },
};

function decideZoom(ctx: EditorCtx, args: ZoomArgs | undefined) {
  if (!args || !Number.isFinite(args.zoom)) return null;
  const found = pick(ctx, args.clipId);
  if (!found) return null;
  const current = pictureTransform(found.clip).zoom;
  const next = roundZoom(args.zoom);
  if (next === current) return null;
  return { ...found, current, next };
}

export const zoomCommand: Command<ZoomArgs | undefined> = {
  id: 'clip.zoom',
  label: '화면 확대 조절',
  icon: '🔍',
  hidden: true,
  requiresArgs: true,
  done(before, _after, args) {
    const d = decideZoom(before, args as ZoomArgs | undefined);
    return d ? describeZoom(d.current, d.next) : '';
  },
  disabledReason: () => PICK_FIRST,
  canRun: (ctx, args) => decideZoom(ctx, args) !== null,
  run(ctx, args) {
    const d = decideZoom(ctx, args);
    if (!d) throw new Error('clip.zoom: nothing to change');
    return patch(d.track.id, d.clip, {
      zoom: d.next === 1 ? undefined : d.next,
    });
  },
};

function decidePan(ctx: EditorCtx, args: PanArgs | undefined) {
  if (!args || !Number.isFinite(args.x) || !Number.isFinite(args.y))
    return null;
  const found = pick(ctx, args.clipId);
  if (!found) return null;
  const t = pictureTransform(found.clip);
  // As far as THIS picture may go in the box (ADR-0014): half a box for
  // one that fills the box's width, less for a narrower one.
  const { x, y } = withinLimits(
    args.x,
    args.y,
    clipPanLimits(ctx.project, found.clip),
  );
  if (x === t.panX && y === t.panY) return null;
  return { ...found, x, y };
}

export const panCommand: Command<PanArgs | undefined> = {
  id: 'clip.pan',
  label: '화면 위치 바꾸기',
  icon: '✥',
  hidden: true,
  requiresArgs: true,
  done(before, _after, args) {
    const d = decidePan(before, args as PanArgs | undefined);
    return d ? describePan(d.x, d.y) : '';
  },
  disabledReason: () => PICK_FIRST,
  canRun: (ctx, args) => decidePan(ctx, args) !== null,
  run(ctx, args) {
    const d = decidePan(ctx, args);
    if (!d) throw new Error('clip.pan: nothing to change');
    return patch(d.track.id, d.clip, {
      panX: d.x === 0 ? undefined : d.x,
      panY: d.y === 0 ? undefined : d.y,
    });
  },
};

export const pictureResetCommand: Command = {
  id: 'clip.pictureReset',
  label: '화면 원래대로',
  icon: '⟲',
  hidden: true,
  done: '화면을 찍은 그대로 되돌렸어요.',
  disabledReason(ctx) {
    return pick(ctx, undefined) ? '화면이 이미 찍은 그대로예요.' : PICK_FIRST;
  },
  canRun(ctx) {
    const found = pick(ctx, undefined);
    return !!found && !isAsShot(pictureTransform(found.clip));
  },
  run(ctx) {
    const found = pick(ctx, undefined);
    if (!found) throw new Error('clip.pictureReset: no clip');
    return patch(found.track.id, found.clip, {
      zoom: undefined,
      panX: undefined,
      panY: undefined,
      rotation: undefined,
    });
  },
};

function decideFill(ctx: EditorCtx) {
  const found = pick(ctx, undefined);
  if (!found) return null;
  const t = pictureTransform(found.clip);
  const next = clipFillZoom(ctx.project, found.clip);
  if (next <= t.zoom) return null;
  // What is still black after the fill: the pan is kept (it is the user's
  // framing), so a picture moved off centre can leave a side empty at any
  // zoom, and a very wide one runs out of slider before it covers the box.
  const after = clipEmptySides(ctx.project, { ...found.clip, zoom: next });
  const capped = next === ZOOM_MAX && after.length > 0;
  return { ...found, next, after, capped };
}

/** The fill's sentence: the zoom it chose, and the honest rest. */
export function describeFill(
  zoom: number,
  after: ReturnType<typeof emptySidesText>,
  capped: boolean,
): string {
  if (!after) return `화면을 ${zoomText(zoom)}로 확대해 꽉 채웠어요.`;
  return capped
    ? `화면을 ${zoomText(zoom)}까지 확대했어요 · 더는 키울 수 없어 ${after}`
    : `화면을 ${zoomText(zoom)}로 확대했어요 · 옮겨 둔 위치 때문에 ${after}`;
}

/**
 * Grow the picture until it covers the box (ADR-0015): the zoom
 * `fillZoom` finds, nothing else. One press after the box changed shape,
 * instead of finding 320% on a slider. The pan stays — the fill is not a
 * reset — and the sentence says what that leaves.
 */
export const pictureFillCommand: Command = {
  id: 'clip.pictureFill',
  label: '화면 채우기',
  icon: '⛶',
  hidden: true,
  done(before) {
    const d = decideFill(before);
    return d ? describeFill(d.next, emptySidesText(d.after), d.capped) : '';
  },
  disabledReason(ctx) {
    const found = pick(ctx, undefined);
    if (!found) return PICK_FIRST;
    const sides = clipEmptySides(ctx.project, found.clip);
    if (sides.length === 0) return '화면이 이미 꽉 차 있어요.';
    // Black remains, and the zoom cannot help. Two reasons, told apart by
    // asking whether the same zoom CENTRED would cover the box: if so the
    // fix is the position; if not, the picture is too wide for the slider
    // (a 21:9 in 9:16 at 400%), and "move it to the centre" would be a
    // lie about footage that is already centred (QA reviewer).
    const centred = clipEmptySides(ctx.project, {
      ...found.clip,
      panX: undefined,
      panY: undefined,
    });
    return centred.length === 0
      ? '확대는 충분해요 · 위치를 가운데로 옮기면 꽉 차요.'
      : `더는 키울 수 없어요 · ${emptySidesText(centred)}`;
  },
  canRun: (ctx) => decideFill(ctx) !== null,
  run(ctx) {
    const d = decideFill(ctx);
    if (!d) throw new Error('clip.pictureFill: nothing to change');
    return patch(d.track.id, d.clip, { zoom: d.next });
  },
};

export const PICTURE_COMMANDS: Command<any>[] = [
  rotateCommand,
  pictureFillCommand,
  pictureResetCommand,
  zoomCommand,
  panCommand,
];
