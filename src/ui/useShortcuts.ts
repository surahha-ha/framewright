// framewright — keyboard shortcuts.
//
// Keys map to ACTION IDS (a command or an app action), never to behaviour, and
// the map itself is data the user can edit (`keymapStore`). Nothing in this file
// knows what any particular key does.
//
// Two properties are structural rather than remembered:
//  - `c` and `mod+c` are different chords, so a single-key binding can never
//    fire with a modifier held. Ctrl+C used to split the clip and Ctrl+W used to
//    trim it on the way to closing the tab, where the pagehide flush then
//    persisted the edit.
//  - A control that owns a key keeps it: Space activates the focused button,
//    the ruler and a range input keep their arrows.
import { useEffect, useMemo } from 'react';
import { useStore } from '../store/projectStore';
import { chordOf, resolveKeymap, type ResolvedKeymap } from '../engine/keymap';
import { bindables, perform, repeats, whyNot } from './actions';
import { useKeymapStore } from './keymapStore';

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
    t.getAttribute?.('role') === 'button'
  );
}

const ARROWS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown']);

/**
 * Does the focused control own this key itself? Only ever true for UNMODIFIED
 * keys: `Alt`+← is a timeline nudge even while a clip button has focus, which is
 * exactly the case where the user is aiming at that clip.
 *
 * `role="slider"` is deliberately not treated as activatable: the playhead does
 * nothing with Space, and swallowing it made play/pause dead while the timeline
 * had focus. The ruler stops propagation for the arrows it does handle.
 */
function controlOwnsKey(target: EventTarget | null, chord: string): boolean {
  if (chord === 'space' || chord === 'enter') return isActivatable(target);
  if (ARROWS.has(chord) || chord === 'home' || chord === 'end') {
    return isActivatable(target) || target instanceof HTMLInputElement;
  }
  return false;
}

/** Copying selected text is not an editing shortcut. */
function hasTextSelection(): boolean {
  return !!globalThis.getSelection?.()?.toString();
}

/** The live keymap: defaults from the registry, overridden by the user. */
export function useResolvedKeymap(): ResolvedKeymap {
  const overrides = useKeymapStore((s) => s.overrides);
  return useMemo(() => resolveKeymap(bindables(), overrides), [overrides]);
}

export function useShortcuts() {
  const setStatus = useStore((s) => s.setStatus);
  const keymap = useResolvedKeymap();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      const chord = chordOf(e);
      if (!chord) return;
      // A modal owns the keyboard while it is open; it handles its own keys.
      if (useStore.getState().overlay !== 'none') return;
      if (controlOwnsKey(e.target, chord)) return;
      if (chord === 'mod+c' && hasTextSelection()) return;

      const id = keymap.byChord.get(chord);
      if (!id) return;
      // Holding a key must not fire an action dozens of times a second. Only the
      // ones that MEAN "again" repeat: nudging a clip, stepping the playhead.
      // Held `Ctrl+V` used to stack a paste per repeat, each its own undo entry.
      if (e.repeat && !repeats(id)) {
        e.preventDefault();
        return;
      }

      if (perform(id)) {
        e.preventDefault();
        return;
      }
      // Leave the browser its key when we could not use it, but still say why:
      // a shortcut that silently does nothing is indistinguishable from a broken
      // one — especially for a screen reader user, who has no greyed-out button.
      //
      // `whyNot` covers both refusals: the command was not runnable at all, or
      // it ran into a wall (a nudge against the clip next door). An export in
      // progress has already said its own, better sentence.
      if (!useStore.getState().isExporting) setStatus(whyNot(id));
    }
    // Any key release ends the current coalescing gesture, so the next hold of a
    // nudge key starts its own undo entry instead of folding into the last one.
    //
    // `blur` matters as much as `keyup`: the default nudge binding is Alt+arrow,
    // and Alt+Tab takes the window away before the release ever reaches us. The
    // gesture would then still be "open" minutes later, and the next nudge of
    // the same clip would fold into an undo entry from before the interruption.
    const endGesture = () => useStore.getState().endGesture();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', endGesture);
    window.addEventListener('blur', endGesture);
    document.addEventListener('visibilitychange', endGesture);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', endGesture);
      window.removeEventListener('blur', endGesture);
      document.removeEventListener('visibilitychange', endGesture);
    };
  }, [keymap, setStatus]);
}
