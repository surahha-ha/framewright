// framewright — keyboard shortcuts.
// Keys map to COMMAND IDS (not behaviour), so remapping later is just data.
import { useEffect } from 'react';
import { editor, useStore } from '../store/projectStore';

/**
 * Derived from the registry, so adding a command with a `defaultKey` binds it
 * everywhere at once (ADR-0003) instead of drifting out of sync with the toolbar.
 * `extras` are the aliases a keyboard has but a command declaration does not.
 */
function defaultKeymap(): Record<string, string> {
  const map: Record<string, string> = { backspace: 'clip.deleteRipple' };
  for (const cmd of editor.commands()) {
    if (cmd.defaultKey) map[cmd.defaultKey.toLowerCase()] = cmd.id;
  }
  return map;
}

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'password',
  'email',
  'url',
  'tel',
  'number',
  'date',
  'time',
]);

/** Typing a version name must not cut the video — but a range slider is not
 *  typing, and swallowing shortcuts there silently broke play/split/delete. */
function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  if (t.tagName === 'TEXTAREA') return true;
  if (t.tagName === 'INPUT') {
    const type = (t as HTMLInputElement).type?.toLowerCase() ?? 'text';
    return TEXT_INPUT_TYPES.has(type);
  }
  return false;
}

/** Space and Enter belong to the focused control, not to the global shortcut.
 *  `role="slider"` is deliberately NOT here: the playhead does nothing with
 *  Space, and swallowing it made play/pause dead while the timeline had focus.
 *  The ruler stops propagation for the arrows it does handle. */
function isActivatable(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return (
    tag === 'BUTTON' ||
    tag === 'A' ||
    tag === 'SELECT' ||
    t.getAttribute?.('role') === 'button'
  );
}

/** Play/pause lives in Preview; the shortcut asks for it via a DOM event. */
export const TOGGLE_PLAY_EVENT = 'framewright:togglePlay';

export function useShortcuts() {
  const run = useStore((s) => s.run);
  const setStatus = useStore((s) => s.setStatus);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const seekTo = useStore((s) => s.seekTo);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (key === ' ') {
        // Let the focused button handle its own activation.
        if (isActivatable(e.target) || e.repeat) return;
        e.preventDefault();
        window.dispatchEvent(new Event(TOGGLE_PLAY_EVENT));
        return;
      }
      if (key === 'arrowleft' || key === 'arrowright') {
        // The timeline slider and range input move themselves.
        if (isActivatable(e.target) || e.target instanceof HTMLInputElement) {
          return;
        }
        if (mod || e.altKey) return; // leave browser/OS navigation alone
        e.preventDefault();
        seekTo(editor.playhead + (key === 'arrowright' ? 1 : -1));
        return;
      }
      // Single-key bindings must NEVER fire with a modifier held. Without this,
      // Ctrl+C split the clip, Ctrl+W trimmed it and then closed the tab (the
      // pagehide flush persisting the edit), and Ctrl+Q trimmed the head.
      if (mod || e.altKey) return;
      const commandId = defaultKeymap()[key];
      if (!commandId) return;
      e.preventDefault();
      if (run(commandId)) return;
      // A shortcut that silently does nothing is indistinguishable from a broken
      // key — especially for a screen reader user, who has no greyed-out button.
      const cmd = editor.commands().find((c) => c.id === commandId);
      setStatus(
        cmd?.disabledReason?.({
          project: editor.project,
          playhead: editor.playhead,
          selectedClipId: editor.selectedClipId,
        }) ?? '지금은 쓸 수 없어요.',
      );
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, undo, redo, seekTo, setStatus]);
}
