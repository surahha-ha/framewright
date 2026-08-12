// framewright — keyboard shortcuts.
// Keys map to COMMAND IDS (not behaviour), so remapping later is just data.
import { useEffect } from 'react';
import { editor, useStore } from '../store/projectStore';

const DEFAULT_KEYMAP: Record<string, string> = {
  c: 'clip.split',
  delete: 'clip.deleteRipple',
  backspace: 'clip.deleteRipple',
};

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

/** Space and Enter belong to the focused control, not to the global shortcut. */
function isActivatable(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return (
    tag === 'BUTTON' ||
    tag === 'A' ||
    tag === 'SELECT' ||
    t.getAttribute?.('role') === 'button' ||
    t.getAttribute?.('role') === 'slider'
  );
}

/** Play/pause lives in Preview; the shortcut asks for it via a DOM event. */
export const TOGGLE_PLAY_EVENT = 'framewright:togglePlay';

export function useShortcuts() {
  const run = useStore((s) => s.run);
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
      const commandId = DEFAULT_KEYMAP[key];
      if (commandId) {
        e.preventDefault();
        run(commandId);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, undo, redo, seekTo]);
}
