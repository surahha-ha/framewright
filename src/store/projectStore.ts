// framewright — UI state.
// The document itself lives in the Editor instance (engine); this store mirrors
// it for React and forwards every edit through `editor.dispatch` (ADR-0003).

import { create } from 'zustand';
import { createEditor, type Editor } from '../engine/command';
import { createProject } from '../engine/project';
import type { Project } from '../engine/types';

export const editor: Editor = createEditor(createProject());

interface State {
  project: Project;
  playhead: number;
  selectedClipId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  isPlaying: boolean;
  status: string;
  /** Bumped ONLY by user-initiated seeks. The playback loop watches this to
   *  know it must re-cue; comparing playhead values instead was unreliable —
   *  a slow re-render made every frame look like a seek and audio never
   *  survived long enough to be heard. */
  seekVersion: number;

  sync: () => void;
  run: (commandId: string) => void;
  undo: () => void;
  redo: () => void;
  /** Playback loop: advance the playhead without signalling a seek. */
  setPlayhead: (frame: number) => void;
  /** User action (timeline click, slider, arrow keys): a real seek. */
  seekTo: (frame: number) => void;
  select: (clipId: string | null) => void;
  setPlaying: (b: boolean) => void;
  setStatus: (s: string) => void;
}

export const useStore = create<State>((set) => ({
  project: editor.project,
  playhead: 0,
  selectedClipId: null,
  canUndo: false,
  canRedo: false,
  isPlaying: false,
  status: '영상을 불러오세요.',
  seekVersion: 0,

  sync: () =>
    set({
      project: editor.project,
      playhead: editor.playhead,
      selectedClipId: editor.selectedClipId,
      canUndo: editor.canUndo(),
      canRedo: editor.canRedo(),
    }),

  run: (commandId) => {
    editor.dispatch(commandId);
    set({
      project: editor.project,
      playhead: editor.playhead,
      selectedClipId: editor.selectedClipId,
      canUndo: editor.canUndo(),
      canRedo: editor.canRedo(),
    });
  },

  undo: () => {
    editor.undo();
    set({
      project: editor.project,
      canUndo: editor.canUndo(),
      canRedo: editor.canRedo(),
    });
  },

  redo: () => {
    editor.redo();
    set({
      project: editor.project,
      canUndo: editor.canUndo(),
      canRedo: editor.canRedo(),
    });
  },

  setPlayhead: (frame) => {
    editor.setPlayhead(frame);
    set({ playhead: editor.playhead });
  },

  seekTo: (frame) => {
    editor.setPlayhead(frame);
    set((s) => ({ playhead: editor.playhead, seekVersion: s.seekVersion + 1 }));
  },

  select: (clipId) => {
    editor.select(clipId);
    set({ selectedClipId: editor.selectedClipId });
  },

  setPlaying: (isPlaying) => set({ isPlaying }),
  setStatus: (status) => set({ status }),
}));
