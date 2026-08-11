// framewright — the command catalogue.
// A command is DATA: id, label, icon, default key, a `canRun` gate and a pure
// `run` that returns a Patch. Buttons, menus, shortcuts and (later) the palette
// all derive from this — add a command here and every entry point gets it.

import type { Clip, Project } from './types';
import type { Op, Patch } from './ops';
import { clipLength, resolveAt, videoTrack } from './timeline';

export interface EditorCtx {
  project: Project;
  playhead: number; // timeline frame
  selectedClipId: string | null;
}

export interface Command {
  id: string;
  label: string;
  icon?: string;
  /** Default binding, e.g. "c" or "mod+z". User keymaps override this. */
  defaultKey?: string;
  canRun(ctx: EditorCtx): boolean;
  run(ctx: EditorCtx): Patch;
}

/** Split the clip under the playhead into two contiguous clips. */
export const splitCommand: Command = {
  id: 'clip.split',
  label: '분할',
  icon: '✂',
  defaultKey: 'c',
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
  label: '삭제(간격 제거)',
  icon: '🗑',
  defaultKey: 'delete',
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

export const BUILTIN_COMMANDS: Command[] = [
  splitCommand,
  deleteRippleCommand,
];
