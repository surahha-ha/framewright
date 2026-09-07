// framewright — the editor instance: command registry + dispatcher + history.
// This is the spine (ADR-0003). It is framework-agnostic and unit-testable:
// every document edit goes through `dispatch`, which records an invertible patch.

import type { Asset, Clip, Project, Rational } from './types';
import type { Op, Patch } from './ops';
import { applyOps } from './ops';
import { clipLength, timelineDuration, videoTrack } from './timeline';
import { BUILTIN_COMMANDS, type Command, type EditorCtx } from './commands';
import type { ClipboardEntry } from './clipboard';

export interface Editor {
  readonly project: Project;
  readonly playhead: number;
  readonly selectedClipId: string | null;
  /** Never set together with `selectedClipId` — one selection at a time. */
  readonly selectedSubtitleId: string | null;
  /**
   * What copy/cut set aside. Deliberately NOT part of the document: undo must
   * not empty your clipboard, and a version restore must not repopulate it.
   */
  readonly clipboard: ClipboardEntry | null;

  commands(): Command<any>[];
  /** The ctx commands see — exposed so callers can evaluate `disabledReason`
   *  and `done` against exactly what the dispatcher used. */
  context(): EditorCtx;
  canRun(commandId: string, args?: unknown): boolean;
  /**
   * Returns true if the command ran. Unknown/blocked commands are no-ops.
   *
   * `coalesceKey` folds this edit into the previous undo entry when the key
   * matches the last one — a held arrow key is ONE gesture and must be ONE undo
   * step, exactly like a drag. Only safe for commands whose forward ops are
   * absolute assignments (trim/move are); a relative op would compound.
   */
  dispatch(commandId: string, args?: unknown, coalesceKey?: string): boolean;

  setPlayhead(frame: number): void;
  /** Selecting a clip drops any selected subtitle, and vice versa. */
  select(clipId: string | null): void;
  selectSubtitle(subtitleId: string | null): void;
  setClipboard(entry: ClipboardEntry | null): void;

  /** End the current coalescing gesture (key released, pointer lifted). */
  endCoalesce(): void;

  canUndo(): boolean;
  canRedo(): boolean;
  undo(): boolean;
  redo(): boolean;

  /** Replace the whole document (restore a version). Undoable, like any edit. */
  restoreProject(project: Project): void;

  /** Import is an edit too — it goes through the same patch/undo machinery. */
  importAsset(
    asset: Omit<Asset, 'id'>,
    durationFrames: number,
    /** Set the sequence from this source when it is the first import. */
    sequence?: { width: number; height: number; fps: Rational },
  ): { assetId: string; clipId: string };
}

export function createEditor(initial: Project): Editor {
  const registry = new Map<string, Command<any>>();
  for (const c of BUILTIN_COMMANDS) registry.set(c.id, c);

  let project = initial;
  let playhead = 0;
  let selectedClipId: string | null = null;
  let selectedSubtitleId: string | null = null;
  let clipboard: ClipboardEntry | null = null;
  const undoStack: Patch[] = [];
  const redoStack: Patch[] = [];
  let lastCoalesceKey: string | null = null;

  const ctx = (): EditorCtx => ({
    project,
    playhead,
    selectedClipId,
    selectedSubtitleId,
    clipboard,
  });

  /** Keep the playhead inside the timeline — a shorter document would otherwise
   *  leave it stranded, freezing the preview and disabling every command. */
  function clampPlayhead(): void {
    const last = Math.max(0, timelineDuration(project) - 1);
    playhead = Math.min(last, Math.max(0, playhead));
  }

  /** Drop a selection pointing at a clip or subtitle that no longer exists. */
  function pruneSelection(): void {
    if (selectedClipId) {
      const exists = project.tracks.some((t) =>
        t.clips.some((c) => c.id === selectedClipId),
      );
      if (!exists) selectedClipId = null;
    }
    if (selectedSubtitleId) {
      const exists = project.subtitles.some((s) => s.id === selectedSubtitleId);
      if (!exists) selectedSubtitleId = null;
    }
  }

  function commit(patch: Patch, coalesceKey?: string): void {
    project = applyOps(project, patch.forward);
    const top = undoStack[undoStack.length - 1];
    if (coalesceKey && coalesceKey === lastCoalesceKey && top) {
      // Keep the ORIGINAL inverse (that is what "back to before the gesture"
      // means) and adopt the newest forward, which is absolute and therefore
      // still correct when replayed from the pre-gesture state.
      top.forward = patch.forward;
    } else {
      undoStack.push(patch);
    }
    lastCoalesceKey = coalesceKey ?? null;
    redoStack.length = 0; // a new edit invalidates redo
    clampPlayhead();
    pruneSelection();
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
    get selectedSubtitleId() {
      return selectedSubtitleId;
    },
    get clipboard() {
      return clipboard;
    },

    commands: () => [...registry.values()],
    context: ctx,

    canRun(commandId, args) {
      const cmd = registry.get(commandId);
      return !!cmd && cmd.canRun(ctx(), args);
    },

    dispatch(commandId, args, coalesceKey) {
      const cmd = registry.get(commandId);
      if (!cmd) return false;
      const c = ctx();
      if (!cmd.canRun(c, args)) return false;
      let patch;
      try {
        patch = cmd.run(c, args);
      } catch {
        // A drag that lands where the clip already is is not an error, and must
        // not push an empty entry onto the undo stack.
        return false;
      }
      commit(patch, coalesceKey);
      // After the edit, so `pruneSelection` cannot drop the clip we just made.
      const created = cmd.selects?.(c);
      if (created) {
        selectedClipId = created;
        selectedSubtitleId = null;
      }
      const createdSubtitle = cmd.selectsSubtitle?.(c);
      if (createdSubtitle) {
        selectedSubtitleId = createdSubtitle;
        selectedClipId = null;
      }
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
      if (clipId) selectedSubtitleId = null;
    },
    selectSubtitle(subtitleId) {
      selectedSubtitleId = subtitleId;
      if (subtitleId) selectedClipId = null;
    },
    setClipboard(entry) {
      clipboard = entry;
    },

    endCoalesce() {
      lastCoalesceKey = null;
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,

    undo() {
      lastCoalesceKey = null;
      const patch = undoStack.pop();
      if (!patch) return false;
      project = applyOps(project, patch.inverse);
      redoStack.push(patch);
      clampPlayhead(); // the timeline may now be shorter
      pruneSelection();
      return true;
    },

    redo() {
      lastCoalesceKey = null;
      const patch = redoStack.pop();
      if (!patch) return false;
      project = applyOps(project, patch.forward); // replayed, not re-run
      undoStack.push(patch);
      clampPlayhead();
      pruneSelection();
      return true;
    },

    restoreProject(next) {
      // NEVER rewind the id counter. Ids are handed out to media in registries
      // that outlive a restore, so reusing one would make a later import claim
      // an old asset's id — and the editor would silently play the wrong file.
      const safe: Project = {
        ...next,
        nextId: Math.max(next.nextId, project.nextId),
      };
      commit({
        forward: [{ kind: 'replaceProject', project: safe }],
        inverse: [{ kind: 'replaceProject', project }],
      });
      // The old playhead may be past the end of the restored timeline.
      this.setPlayhead(playhead);
      selectedClipId = null;
      selectedSubtitleId = null;
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
        // NOTE: deliberately no `setNextId` here. Rewinding the counter would
        // hand `asset_1` out twice in one session — undo an import, import a
        // different file, and anything still holding the old id (the decode
        // registry, the clipboard) would silently be pointing at the new file.
        // Ids are cheap; a paste that inserts frames from the wrong video is not.
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
