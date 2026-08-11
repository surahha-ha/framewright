// framewright — keyboard shortcuts.
// Keys map to COMMAND IDS (not behaviour), so remapping later is just data.
import { useEffect } from 'react';
import { editor, useStore } from '../store/projectStore';

const DEFAULT_KEYMAP: Record<string, string> = {
  c: 'clip.split',
  delete: 'clip.deleteRipple',
  backspace: 'clip.deleteRipple',
};

function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
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
        e.preventDefault();
        window.dispatchEvent(new Event(TOGGLE_PLAY_EVENT));
        return;
      }
      if (key === 'arrowleft' || key === 'arrowright') {
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
