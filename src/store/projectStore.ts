// framewright — UI state.
// The document itself lives in the Editor instance (engine); this store mirrors
// it for React, forwards every edit through `editor.dispatch` (ADR-0003), and
// owns persistence (autosave + version history).

import { create } from 'zustand';
import { createEditor, type Editor } from '../engine/command';
import { createProject } from '../engine/project';
import type { Project } from '../engine/types';
import {
  createLocalRepository,
  isStorageAvailable,
  STORAGE_KEY,
} from '../engine/storage';
import { shouldAutoSnapshot, type Version } from '../engine/persistence';
import { copyEntry } from '../engine/clipboard';

const repository = createLocalRepository();
const AUTO_SNAPSHOT_INTERVAL_MS = 3 * 60_000;
const SAVE_DEBOUNCE_MS = 600;
const RECUE_DEBOUNCE_MS = 120;

const loaded = repository.load();
export const editor: Editor = createEditor(loaded?.project ?? createProject());

/** A blank autosave is not "previous work" — saying so on a first visit would
 *  make the message worthless the one time it matters. */
const hadRealWork =
  !!loaded && (loaded.project.assets.length > 0 || loaded.versions.length > 0);

let versions: Version[] = loaded?.versions ?? [];
let generation = loaded?.generation ?? 0;
let versionCounter = versions.length;
let lastSnapshotTs: number | null = versions.length
  ? Math.max(...versions.map((v) => v.ts))
  : null;
let editsSinceSnapshot = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let recueTimer: ReturnType<typeof setTimeout> | undefined;
/** Set when another tab owns the document — we stop writing rather than clobber. */
let saveBlocked = false;

function nextVersionId(): string {
  versionCounter += 1;
  return `ver_${versionCounter}`;
}

interface State {
  project: Project;
  playhead: number;
  selectedClipId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  isPlaying: boolean;
  isExporting: boolean;
  status: string;
  /** Bumped ONLY by user-initiated seeks. The playback loop watches this to know
   *  it must re-cue; comparing playhead values was unreliable. */
  seekVersion: number;
  /** Bumped when something (e.g. a restore) must stop playback immediately. */
  stopSignal: number;
  versions: Version[];
  savedAt: number | null;
  /** Persistence is unavailable or blocked — the UI must not promise saving. */
  saveDisabledReason: string | null;
  /** At most one modal is open at a time; both are keyboard-first surfaces. */
  overlay: 'none' | 'palette' | 'shortcuts';
  setOverlay: (overlay: 'none' | 'palette' | 'shortcuts') => void;

  sync: () => void;
  /**
   * Direct-manipulation commands (trim/move) carry arguments; the rest take none.
   * `coalesceKey` folds a held-key repeat into one undo step.
   * Returns whether the command actually ran — announcing an edit that was
   * refused is how a UI teaches people not to trust it.
   */
  run: (commandId: string, args?: unknown, coalesceKey?: string) => boolean;
  /** A held key was released: the next press starts a new undo entry. */
  endGesture: () => void;
  /** Mirrors `editor.clipboard` for React — the clipboard is not document state,
   *  so it deliberately survives undo and version restore. */
  hasClipboard: boolean;
  /** Both return whether anything was actually put on the clipboard. */
  copyClip: () => boolean;
  cutClip: () => boolean;
  undo: () => void;
  redo: () => void;
  saveVersion: (label: string) => void;
  restoreVersion: (versionId: string) => void;
  deleteVersion: (versionId: string) => void;
  setPlayhead: (frame: number) => void;
  seekTo: (frame: number) => void;
  select: (clipId: string | null) => void;
  setPlaying: (b: boolean) => void;
  setExporting: (b: boolean) => void;
  setStatus: (s: string) => void;
}

export const useStore = create<State>((set, get) => {
  function persistNow() {
    if (saveBlocked) return;
    const result = repository.save(editor.project, versions, generation);
    if (result.conflict) {
      saveBlocked = true;
      set({
        saveDisabledReason: result.error ?? '다른 탭에서 편집 중이에요.',
        status: result.error ?? '다른 탭에서 편집 중이에요.',
      });
      return;
    }
    // Adopt what was ACTUALLY stored, so the history panel never lists versions
    // that are already gone from disk.
    versions = result.versions;
    if (result.ok) {
      generation += 1;
      set({
        versions: [...versions],
        savedAt: Date.now(),
        saveDisabledReason: null,
        ...(result.error ? { status: result.error } : {}),
      });
    } else {
      set({
        versions: [...versions],
        saveDisabledReason: result.error ?? '저장할 수 없어요.',
        status: result.error ?? '저장할 수 없어요.',
      });
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, SAVE_DEBOUNCE_MS);
  }

  /**
   * Publish a document change to the UI. While playing, the audio schedule was
   * built once at play time — without a seek bump the picture follows the edit
   * and the sound keeps playing the old arrangement.
   */
  function afterDocumentChange() {
    set(snapshot());
    if (get().isPlaying) {
      // Trailing debounce: a held nudge key fires ~30×/s, and bumping the seek
      // every time tore down and rebuilt the decoder and the audio schedule that
      // often — the picture froze for as long as the key was held.
      if (recueTimer) clearTimeout(recueTimer);
      recueTimer = setTimeout(() => {
        recueTimer = undefined;
        if (get().isPlaying) set((s) => ({ seekVersion: s.seekVersion + 1 }));
      }, RECUE_DEBOUNCE_MS);
    }
    afterEdit();
  }

  /** After every document change: autosave, and snapshot now and then. */
  function afterEdit() {
    editsSinceSnapshot++;
    const now = Date.now();
    if (
      shouldAutoSnapshot(
        lastSnapshotTs,
        now,
        AUTO_SNAPSHOT_INTERVAL_MS,
        editsSinceSnapshot,
      )
    ) {
      versions = [
        ...versions,
        { id: nextVersionId(), kind: 'auto', ts: now, project: editor.project },
      ];
      lastSnapshotTs = now;
      editsSinceSnapshot = 0;
    }
    scheduleSave();
  }

  const snapshot = () => ({
    project: editor.project,
    playhead: editor.playhead,
    selectedClipId: editor.selectedClipId,
    canUndo: editor.canUndo(),
    canRedo: editor.canRedo(),
  });

  return {
    project: editor.project,
    playhead: 0,
    selectedClipId: null,
    canUndo: false,
    canRedo: false,
    isPlaying: false,
    isExporting: false,
    hasClipboard: false,
    status: hadRealWork
      ? '이전 작업을 그대로 불러왔어요.'
      : '영상을 불러오세요.',
    seekVersion: 0,
    stopSignal: 0,
    versions,
    savedAt: null,
    saveDisabledReason: isStorageAvailable()
      ? null
      : '이 브라우저에서는 자동 저장을 쓸 수 없어요. (비공개 모드일 수 있어요)',

    sync: () => {
      set(snapshot());
      afterEdit();
    },

    run: (commandId, args, coalesceKey) => {
      // An export renders the document it was started with. Letting it change
      // underneath would produce a file that silently disagrees with the screen.
      if (get().isExporting) {
        set({
          status: '내보내는 중에는 편집할 수 없어요. 먼저 취소해 주세요.',
        });
        return false;
      }
      // Captured BEFORE the edit: a paste can only say where it decided to put
      // the clip while the request is still in hand.
      const before = editor.context();
      if (!editor.dispatch(commandId, args, coalesceKey)) return false;
      afterDocumentChange();
      const done = editor.commands().find((c) => c.id === commandId)?.done;
      const text =
        typeof done === 'function' ? done(before, editor.context()) : done;
      // While another tab owns the document nothing here reaches disk. The
      // warning is posted once, when the other tab appears — and then every
      // successful edit used to overwrite it with its own cheerful sentence, so
      // the user kept editing work that would vanish on reload. Repeat it.
      const blocked = get().saveDisabledReason;
      if (text) set({ status: blocked ? `${text} · ${blocked}` : text });
      else if (blocked) set({ status: blocked });
      return true;
    },

    endGesture: () => editor.endCoalesce(),

    copyClip: () => {
      const entry = copyEntry(editor.project, editor.selectedClipId);
      if (!entry) {
        set({ status: '복사할 클립을 먼저 골라 주세요.' });
        return false;
      }
      editor.setClipboard(entry);
      set({
        hasClipboard: true,
        status: '클립을 복사했어요 · 재생 위치를 옮긴 뒤 붙여넣으세요.',
      });
      return true;
    },

    cutClip: () => {
      if (!get().copyClip()) return false;
      // Cut is copy + the delete we already have, so the two can never disagree
      // about what "remove this clip" means.
      if (!get().run('clip.deleteRipple')) {
        set({ status: '클립을 복사했어요 · 지우지는 못했어요.' });
        return false;
      }
      set({ status: '클립을 잘라냈어요 · 재생 위치에서 붙여넣을 수 있어요.' });
      return true;
    },

    undo: () => {
      if (get().isExporting) {
        set({
          status: '내보내는 중에는 편집할 수 없어요. 먼저 취소해 주세요.',
        });
        return;
      }
      if (!editor.undo()) return;
      afterDocumentChange();
    },

    redo: () => {
      if (get().isExporting) {
        set({
          status: '내보내는 중에는 편집할 수 없어요. 먼저 취소해 주세요.',
        });
        return;
      }
      if (!editor.redo()) return;
      afterDocumentChange();
    },

    saveVersion: (label) => {
      const clean = label.trim() || '이름 없는 기록';
      const now = Date.now();
      versions = [
        ...versions,
        {
          id: nextVersionId(),
          kind: 'manual',
          label: clean,
          ts: now,
          project: editor.project,
        },
      ];
      lastSnapshotTs = now;
      editsSinceSnapshot = 0;
      set({ versions: [...versions], status: `기록했어요: ${clean}` });
      scheduleSave();
    },

    restoreVersion: (versionId) => {
      if (get().isExporting) {
        set({
          status: '내보내는 중에는 되돌아갈 수 없어요. 먼저 취소해 주세요.',
        });
        return;
      }
      const target = versions.find((v) => v.id === versionId);
      if (!target) return;
      // Back up what you have first, so restoring can never lose current work.
      const now = Date.now();
      versions = [
        ...versions,
        {
          id: nextVersionId(),
          kind: 'manual',
          label: '되돌아가기 직전 상태',
          ts: now,
          project: editor.project,
        },
      ];
      editor.restoreProject(target.project);
      set((s) => ({
        ...snapshot(),
        versions: [...versions],
        // Playback must stop and re-cue: the document under it just changed.
        stopSignal: s.stopSignal + 1,
        seekVersion: s.seekVersion + 1,
        status: `되돌아갔어요: ${target.label ?? '자동 기록'} · 실수였다면 Ctrl+Z`,
      }));
      scheduleSave();
    },

    deleteVersion: (versionId) => {
      const target = versions.find((v) => v.id === versionId);
      versions = versions.filter((v) => v.id !== versionId);
      set({
        versions: [...versions],
        status: target
          ? `기록을 지웠어요: ${target.label ?? '자동 기록'}`
          : '기록을 지웠어요.',
      });
      scheduleSave();
    },

    setPlayhead: (frame) => {
      editor.setPlayhead(frame);
      set({ playhead: editor.playhead });
    },

    seekTo: (frame) => {
      editor.setPlayhead(frame);
      set((s) => ({
        playhead: editor.playhead,
        seekVersion: s.seekVersion + 1,
      }));
    },

    select: (clipId) => {
      editor.select(clipId);
      set({ selectedClipId: editor.selectedClipId });
    },

    overlay: 'none',
    setOverlay: (overlay) => set({ overlay }),

    setPlaying: (isPlaying) => set({ isPlaying }),
    setExporting: (isExporting) => set({ isExporting }),
    setStatus: (status) => set({ status }),
  };
});

if (typeof window !== 'undefined') {
  // Last-chance save: a debounce timer can still be pending when the tab goes
  // away. `visibilitychange` covers mobile/background kills that never fire
  // `pagehide`.
  const flush = () => {
    if (saveBlocked) return;
    if (saveTimer) clearTimeout(saveTimer);
    const result = repository.save(editor.project, versions, generation);
    if (result.ok) generation += 1;
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });

  // Another tab saved: stop writing so we cannot clobber work we never saw.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    saveBlocked = true;
    useStore.setState({
      saveDisabledReason:
        '다른 탭에서 같은 프로젝트를 편집하고 있어요. 이 탭의 변경은 저장되지 않아요.',
      status:
        '다른 탭에서 같은 프로젝트를 편집하고 있어요. 이 탭의 변경은 저장되지 않아요.',
    });
  });
}
