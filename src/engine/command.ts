// framewright — the editor instance: command registry + dispatcher + history.
// This is the spine (ADR-0003). It is framework-agnostic and unit-testable:
// every document edit goes through `dispatch`, which records an invertible patch.

import type { Asset, Clip, Project, Rational } from './types';
import type { Op, Patch } from './ops';
import { applyOps } from './ops';
import { clipLength, timelineDuration, videoTrack } from './timeline';
import { BUILTIN_COMMANDS, type Command, type EditorCtx } from './commands';

export interface Editor {
  readonly project: Project;
  readonly playhead: number;
  readonly selectedClipId: string | null;

  commands(): Command[];
  canRun(commandId: string): boolean;
  /** Returns true if the command ran. Unknown/blocked commands are no-ops. */
  dispatch(commandId: string): boolean;

  setPlayhead(frame: number): void;
  select(clipId: string | null): void;

  canUndo(): boolean;
  canRedo(): boolean;
  undo(): boolean;
  redo(): boolean;

  /** Import is an edit too — it goes through the same patch/undo machinery. */
  importAsset(
    asset: Omit<Asset, 'id'>,
    durationFrames: number,
    /** Set the sequence from this source when it is the first import. */
    sequence?: { width: number; height: number; fps: Rational },
  ): { assetId: string; clipId: string };
}

export function createEditor(initial: Project): Editor {
  const registry = new Map<string, Command>();
  for (const c of BUILTIN_COMMANDS) registry.set(c.id, c);

  let project = initial;
  let playhead = 0;
  let selectedClipId: string | null = null;
  const undoStack: Patch[] = [];
  const redoStack: Patch[] = [];

  const ctx = (): EditorCtx => ({ project, playhead, selectedClipId });

  function commit(patch: Patch): void {
    project = applyOps(project, patch.forward);
    undoStack.push(patch);
    redoStack.length = 0; // a new edit invalidates redo
  }

  return {
    get project() {
      return project;
    },
    get playhead() {
      return playhead;
    },
    get selectedClipId() {
      return selectedClipId;
    },

    commands: () => [...registry.values()],

    canRun(commandId) {
      const cmd = registry.get(commandId);
      return !!cmd && cmd.canRun(ctx());
    },

    dispatch(commandId) {
      const cmd = registry.get(commandId);
      if (!cmd) return false;
      const c = ctx();
      if (!cmd.canRun(c)) return false;
      commit(cmd.run(c));
      return true;
    },

    setPlayhead(frame) {
      // Clamp to the timeline so the playhead can never sit past the last frame
      // (which would make every command's canRun silently false).
      const last = Math.max(0, timelineDuration(project) - 1);
      playhead = Math.min(last, Math.max(0, Math.round(frame)));
    },
    select(clipId) {
      selectedClipId = clipId;
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,

    undo() {
      const patch = undoStack.pop();
      if (!patch) return false;
      project = applyOps(project, patch.inverse);
      redoStack.push(patch);
      return true;
    },

    redo() {
      const patch = redoStack.pop();
      if (!patch) return false;
      project = applyOps(project, patch.forward); // replayed, not re-run
      undoStack.push(patch);
      return true;
    },

    importAsset(assetInput, durationFrames, sequence) {
      const assetId = `asset_${project.nextId}`;
      const clipId = `clip_${project.nextId + 1}`;
      const track = videoTrack(project);
      const startFrame = track.clips.reduce(
        (end, c) => Math.max(end, c.startFrame + clipLength(c)),
        0,
      );
      const asset: Asset = { ...assetInput, id: assetId };
      const clip: Clip = {
        id: clipId,
        assetId,
        startFrame,
        inFrame: 0,
        outFrame: durationFrames,
      };
      // The first import defines the sequence (like a real NLE), so export
      // resolution and frame rate match the footage instead of a stub default.
      const isFirst = project.assets.length === 0;
      const setsTimeline = isFirst && sequence;

      const forward: Op[] = [
        ...(setsTimeline
          ? [
              {
                kind: 'setTimeline' as const,
                config: {
                  fps: sequence.fps,
                  width: sequence.width,
                  height: sequence.height,
                },
              },
            ]
          : []),
        { kind: 'addAsset', asset },
        {
          kind: 'insertClip',
          trackId: track.id,
          index: track.clips.length,
          clip,
        },
        { kind: 'setNextId', value: project.nextId + 2 },
      ];
      const inverse: Op[] = [
        { kind: 'setNextId', value: project.nextId },
        { kind: 'removeClip', trackId: track.id, index: track.clips.length },
        { kind: 'removeAsset', assetId },
        ...(setsTimeline
          ? [{ kind: 'setTimeline' as const, config: project.timeline }]
          : []),
      ];
      commit({ forward, inverse });
      return { assetId, clipId };
    },
  };
}
