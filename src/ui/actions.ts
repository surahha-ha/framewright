// framewright — app actions: the things you can DO that are not document edits.
//
// An editor command changes the document and is undoable (ADR-0003). Undo
// itself, play/pause, moving the playhead, opening the palette and putting a
// clip on the clipboard are none of those — they produce no patch, so they
// cannot be commands without lying about what a command is.
//
// They are still bindable, still listable, still refusable with a reason, so
// they share the shape. The keymap, the palette and the toolbar treat a command
// and an action the same way; only the dispatcher knows the difference.

import { editor, useStore } from '../store/projectStore';
import { timelineDuration } from '../engine/timeline';
import { fitScale, zoomedScale, type Zoom } from '../engine/timelineView';
import type { Command } from '../engine/commands';

/** Play/pause lives in Preview; the action asks for it via a DOM event. */
export const TOGGLE_PLAY_EVENT = 'framewright:togglePlay';

export interface AppAction {
  id: string;
  label: string;
  icon?: string;
  defaultKey?: string;
  /** Where it goes in the toolbar: right after this command's button. Absent
   *  means it is not a toolbar button at all. */
  anchorAfter?: string;
  /** Kept out of the palette (an entry for "open the palette" is noise). */
  hiddenInPalette?: boolean;
  /** Holding the key means "again" (stepping the playhead), rather than one
   *  press meaning one thing (opening a dialog, pasting). */
  repeatable?: boolean;
  canRun(): boolean;
  perform(): void;
  disabledReason?(): string;
}

const store = () => useStore.getState();

/**
 * What the timeline is showing right now, in the engine's terms. The scroll
 * offset is deliberately absent: zoom anchors on the playhead (the frame the
 * user is looking at), so where the strip happens to be scrolled to does not
 * enter the arithmetic — and it lives in the DOM, where an action cannot see it.
 */
function timelineZoom(): Zoom {
  const total = timelineDuration(editor.project);
  const widthPx = store().timelineWidthPx;
  const scale = store().timelineScale;
  return { total, widthPx, scale: scale ?? fitScale(total, widthPx) };
}

/** Asked by `canRun` and answered by the same function that performs it, so a
 *  button can never offer a zoom that would land on the scale it already has. */
function canZoom(direction: 'in' | 'out'): boolean {
  const zoom = timelineZoom();
  if (zoom.total <= 0 || zoom.widthPx <= 0) return false;
  return zoomedScale(zoom, direction) !== zoom.scale;
}

export const APP_ACTIONS: AppAction[] = [
  {
    id: 'clip.copy',
    label: '복사',
    icon: '⧉',
    defaultKey: 'mod+c',
    anchorAfter: 'clip.deleteRipple',
    canRun: () => !!editor.selectedClipId,
    disabledReason: () => '복사할 클립을 먼저 골라 주세요.',
    perform: () => {
      store().copyClip();
    },
  },
  {
    id: 'clip.cut',
    label: '잘라내기',
    // ✂, not ✁. 잘라내기 + Ctrl+X + scissors is what every OS teaches, so this
    // is the one control that gets to keep the word AND the glyph; `clip.split`
    // gave the scissors back and took ◫. See src/engine/vocabulary.test.ts.
    icon: '✂',
    defaultKey: 'mod+x',
    anchorAfter: 'clip.deleteRipple',
    canRun: () => !!editor.selectedClipId,
    disabledReason: () => '잘라낼 클립을 먼저 골라 주세요.',
    perform: () => {
      store().cutClip();
    },
  },
  {
    id: 'app.undo',
    label: '되돌리기',
    icon: '↩',
    defaultKey: 'mod+z',
    canRun: () => editor.canUndo(),
    disabledReason: () => '아직 되돌릴 편집이 없어요.',
    perform: () => store().undo(),
  },
  {
    id: 'app.redo',
    label: '다시 실행',
    icon: '↪',
    defaultKey: 'mod+shift+z',
    canRun: () => editor.canRedo(),
    disabledReason: () => '다시 실행할 편집이 없어요.',
    perform: () => store().redo(),
  },
  {
    id: 'app.playPause',
    label: '재생 / 멈춤',
    icon: '▶',
    defaultKey: 'space',
    canRun: () => timelineDuration(editor.project) > 0,
    disabledReason: () => '먼저 영상을 불러오세요.',
    perform: () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(TOGGLE_PLAY_EVENT));
      }
    },
  },
  {
    id: 'playhead.prev',
    label: '한 프레임 뒤로',
    icon: '◂',
    defaultKey: 'arrowleft',
    repeatable: true,
    canRun: () => timelineDuration(editor.project) > 0,
    disabledReason: () => '먼저 영상을 불러오세요.',
    perform: () => store().seekTo(editor.playhead - 1),
  },
  {
    id: 'playhead.next',
    label: '한 프레임 앞으로',
    icon: '▸',
    defaultKey: 'arrowright',
    repeatable: true,
    canRun: () => timelineDuration(editor.project) > 0,
    disabledReason: () => '먼저 영상을 불러오세요.',
    perform: () => store().seekTo(editor.playhead + 1),
  },
  // The three view actions. They change nothing about the document, which is
  // why they are actions and not commands — and why "크게 보기" says 보기: a
  // first-time user must not read 작게 as "make the clip shorter".
  {
    id: 'view.zoomIn',
    label: '크게 보기',
    icon: '⊕',
    defaultKey: '=',
    canRun: () => canZoom('in'),
    disabledReason: () =>
      timelineDuration(editor.project) > 0
        ? '한 프레임까지 크게 봤어요. 더 크게는 안 돼요.'
        : '먼저 영상을 불러오세요.',
    perform: () => {
      store().setTimelineScale(zoomedScale(timelineZoom(), 'in'));
      // Said out loud, because zoom has no other feedback for someone who
      // cannot see the strip redraw.
      store().setStatus(
        '타임라인을 크게 봤어요 · 재생 위치를 가운데에 뒀어요.',
      );
    },
  },
  {
    id: 'view.zoomOut',
    label: '작게 보기',
    icon: '⊖',
    defaultKey: '-',
    canRun: () => canZoom('out'),
    disabledReason: () =>
      timelineDuration(editor.project) > 0
        ? '전체가 다 보이고 있어요. 더 작게는 안 돼요.'
        : '먼저 영상을 불러오세요.',
    perform: () => {
      const zoom = timelineZoom();
      const next = zoomedScale(zoom, 'out');
      // Landing on the fitted scale means FITTED, not "a number that happens to
      // equal it today". Storing the number looks identical on screen and then
      // stops following the document: the next edit that lengthens the timeline
      // would push its own tail off the strip, while this button had just said
      // 전체가 다 보이고 있어요.
      const fit = fitScale(zoom.total, zoom.widthPx);
      store().setTimelineScale(next <= fit ? null : next);
      store().setStatus(
        '타임라인을 작게 봤어요 · 재생 위치를 가운데에 뒀어요.',
      );
    },
  },
  {
    id: 'view.zoomFit',
    label: '전체 보기',
    icon: '⤢',
    defaultKey: '\\',
    canRun: () => store().timelineScale !== null,
    disabledReason: () => '전체가 다 보이고 있어요.',
    // Back to "no scale of its own": the strip follows the document's length
    // again, so a later edit that lengthens it keeps everything on screen.
    perform: () => {
      store().setTimelineScale(null);
      store().setStatus('타임라인 전체가 보이게 맞췄어요.');
    },
  },
  {
    id: 'app.palette',
    label: '명령 찾기',
    icon: '⌘',
    defaultKey: 'mod+k',
    hiddenInPalette: true,
    canRun: () => true,
    perform: () => store().setOverlay('palette'),
  },
  {
    id: 'app.shortcuts',
    label: '단축키 설정',
    icon: '⌨',
    canRun: () => true,
    perform: () => store().setOverlay('shortcuts'),
  },
];

export function findAction(id: string): AppAction | undefined {
  return APP_ACTIONS.find((a) => a.id === id);
}

/** Everything a key can be bound to, in the order the settings panel lists it. */
export function bindables(): { id: string; defaultKey?: string }[] {
  return [
    ...editor.commands().map((c) => ({ id: c.id, defaultKey: c.defaultKey })),
    ...APP_ACTIONS.map((a) => ({ id: a.id, defaultKey: a.defaultKey })),
  ];
}

export interface Entry {
  id: string;
  label: string;
  icon?: string;
  /** True for editor commands, false for app actions. */
  isCommand: boolean;
  /** Needs drag arguments — no button, no palette row, but still bindable. */
  requiresArgs: boolean;
  hiddenInToolbar: boolean;
  hiddenInPalette: boolean;
}

/**
 * One list the palette and the settings panel can both walk.
 *
 * Order matters: the six one-frame nudges are real commands, but a person
 * opening the palette to find "복사" should not have to scroll past them, so
 * everything with a button comes first and the keyboard-only commands last.
 */
export function entries(): Entry[] {
  const commands: Entry[] = editor.commands().map((c: Command<any>) => ({
    id: c.id,
    label: c.label,
    icon: c.icon,
    isCommand: true,
    requiresArgs: !!c.requiresArgs,
    hiddenInToolbar: !!c.hidden,
    hiddenInPalette: !!c.requiresArgs,
  }));
  const actions: Entry[] = APP_ACTIONS.map((a) => ({
    id: a.id,
    label: a.label,
    icon: a.icon,
    isCommand: false,
    requiresArgs: false,
    hiddenInToolbar: !a.anchorAfter,
    hiddenInPalette: !!a.hiddenInPalette,
  }));
  return [
    ...commands.filter((c) => !c.hiddenInToolbar),
    ...actions,
    ...commands.filter((c) => c.hiddenInToolbar),
  ];
}

/** Does holding the key mean "do it again"? Everything else fires once a press. */
export function repeats(id: string): boolean {
  const action = findAction(id);
  if (action) return !!action.repeatable;
  return !!editor.commands().find((c) => c.id === id)?.repeatable;
}

/** Can this id run right now? Commands ask the registry, actions ask themselves. */
export function canRun(id: string): boolean {
  const action = findAction(id);
  if (action) return action.canRun();
  return editor.canRun(id);
}

/** Why not, in words. Never empty: silence is what makes a control feel broken. */
export function whyNot(id: string): string {
  const action = findAction(id);
  if (action) return action.disabledReason?.() ?? '지금은 쓸 수 없어요.';
  const cmd = editor.commands().find((c) => c.id === id);
  return cmd?.disabledReason?.(editor.context()) ?? '지금은 쓸 수 없어요.';
}

/**
 * Run a command or an action by id. Returns whether it actually did something —
 * announcing an edit that was refused is how a UI teaches people not to trust it.
 */
export function perform(id: string): boolean {
  const action = findAction(id);
  if (action) {
    if (!action.canRun()) return false;
    action.perform();
    return true;
  }
  const cmd = editor.commands().find((c) => c.id === id);
  // A held nudge key is one gesture, so it is one undo entry — the same promise
  // the drag path makes. The key is passed on EVERY press, including the first;
  // releasing any key ends the gesture, so the next hold starts a fresh entry.
  const coalesceKey = cmd?.repeatable
    ? `${id}:${editor.selectedClipId ?? ''}`
    : undefined;
  return store().run(id, undefined, coalesceKey);
}
