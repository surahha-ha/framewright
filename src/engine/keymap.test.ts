import { describe, it, expect } from 'vitest';
import {
  chordOf,
  formatChord,
  parseChord,
  reservedReason,
  resolveKeymap,
} from './keymap';

describe('chordOf', () => {
  it('canonicalises modifiers into one fixed order', () => {
    // The same physical press must produce the same string every time, whatever
    // order the flags happen to be read in.
    expect(chordOf({ key: 'ArrowLeft', altKey: true, shiftKey: true })).toBe(
      'alt+shift+arrowleft',
    );
    expect(
      chordOf({
        key: 'ArrowLeft',
        shiftKey: true,
        altKey: true,
        ctrlKey: true,
      }),
    ).toBe('mod+alt+shift+arrowleft');
  });

  it('treats Ctrl and Cmd as the same modifier', () => {
    expect(chordOf({ key: 'k', ctrlKey: true })).toBe('mod+k');
    expect(chordOf({ key: 'k', metaKey: true })).toBe('mod+k');
  });

  it('is empty for a modifier pressed on its own', () => {
    // Holding Alt to reach Alt+← must not itself look like a binding.
    expect(chordOf({ key: 'Alt', altKey: true })).toBe('');
    expect(chordOf({ key: 'Control', ctrlKey: true })).toBe('');
  });

  it('names the space bar, which reports itself as " "', () => {
    expect(chordOf({ key: ' ' })).toBe('space');
  });

  it('keeps a bare key bare — a single-key binding must not fire with a modifier', () => {
    // This is the Ctrl+C-splits-the-clip bug, made structural: `c` and `mod+c`
    // are different chords, so one can never match the other.
    expect(chordOf({ key: 'c' })).toBe('c');
    expect(chordOf({ key: 'c', ctrlKey: true })).toBe('mod+c');
  });
});

describe('parseChord', () => {
  it('accepts what a human writes and returns the canonical form', () => {
    expect(parseChord('Alt+Shift+ArrowLeft')).toBe('alt+shift+arrowleft');
    expect(parseChord('Ctrl+K')).toBe('mod+k');
    expect(parseChord('Cmd+K')).toBe('mod+k');
    expect(parseChord('Meta+K')).toBe('mod+k');
    expect(parseChord(' delete ')).toBe('delete');
  });

  it('rejects a chord with no key of its own', () => {
    expect(parseChord('Ctrl+')).toBeNull();
    expect(parseChord('Alt')).toBeNull();
    expect(parseChord('')).toBeNull();
  });
});

describe('formatChord', () => {
  it('shows arrows as arrows and modifiers in words', () => {
    expect(formatChord('alt+shift+arrowleft')).toBe('Alt+Shift+←');
    expect(formatChord('mod+k')).toBe('Ctrl+K');
    expect(formatChord('space')).toBe('Space');
  });

  it('uses Mac symbols when asked', () => {
    expect(formatChord('mod+k', true)).toBe('⌘K');
    expect(formatChord('mod+shift+z', true)).toBe('⌘⇧Z');
  });

  it('says so when nothing is bound', () => {
    expect(formatChord(null)).toBe('없음');
  });
});

describe('reservedReason', () => {
  it('refuses the keys the browser and the page need to stay usable', () => {
    expect(reservedReason('tab')).not.toBeNull();
    expect(reservedReason('escape')).not.toBeNull();
    expect(reservedReason('f5')).not.toBeNull();
    expect(reservedReason('mod+r')).not.toBeNull();
  });

  it('refuses the keys a focused control takes for itself', () => {
    // Bound to one of these, an action works on the page and is silently dead
    // whenever a button has focus. Refusing beats "works sometimes".
    expect(reservedReason('space')).not.toBeNull();
    expect(reservedReason('enter')).not.toBeNull();
    expect(reservedReason('arrowleft')).not.toBeNull();
  });

  it('allows an ordinary binding', () => {
    expect(reservedReason('mod+k')).toBeNull();
    // The same key WITH a modifier is a different chord, and nobody owns it.
    expect(reservedReason('alt+arrowleft')).toBeNull();
    expect(reservedReason('mod+enter')).toBeNull();
  });
});

const BINDABLES = [
  { id: 'clip.split', defaultKey: 'c' },
  { id: 'clip.copy', defaultKey: 'mod+c' },
  { id: 'app.undo', defaultKey: 'mod+z' },
];

describe('resolveKeymap', () => {
  it('binds every default when there are no overrides', () => {
    const map = resolveKeymap(BINDABLES);
    expect(map.byChord.get('c')).toBe('clip.split');
    expect(map.byAction.get('app.undo')).toBe('mod+z');
    expect(map.conflicts).toEqual([]);
  });

  it('lets an override replace a default, freeing the old chord', () => {
    const map = resolveKeymap(BINDABLES, { 'clip.split': 'mod+b' });
    expect(map.byAction.get('clip.split')).toBe('mod+b');
    expect(map.byChord.has('c')).toBe(false);
    expect(map.byChord.get('mod+b')).toBe('clip.split');
  });

  it('unbinds an action when its override is null', () => {
    const map = resolveKeymap(BINDABLES, { 'clip.split': null });
    expect(map.byAction.has('clip.split')).toBe(false);
    expect(map.byChord.has('c')).toBe(false);
  });

  it('normalises a stored override written by a human', () => {
    const map = resolveKeymap(BINDABLES, { 'clip.split': 'Ctrl+B' });
    expect(map.byAction.get('clip.split')).toBe('mod+b');
  });

  it('reports a collision instead of silently picking one', () => {
    // Two actions on one chord is a state the UI must be able to show. Dropping
    // one quietly is how a user ends up with a key that does nothing.
    const map = resolveKeymap(BINDABLES, { 'app.undo': 'c' });
    expect(map.conflicts).toEqual([
      { chord: 'c', actionIds: ['app.undo', 'clip.split'] },
    ]);
    // The override wins; the default it displaced is left unbound, not hidden.
    expect(map.byChord.get('c')).toBe('app.undo');
    expect(map.byAction.has('clip.split')).toBe(false);
  });

  it('ignores an override for an action that no longer exists', () => {
    // A stored keymap outlives the build that wrote it.
    const map = resolveKeymap(BINDABLES, { 'clip.gone': 'mod+g' });
    expect(map.byChord.has('mod+g')).toBe(false);
    expect(map.conflicts).toEqual([]);
  });

  it('drops an unparseable override rather than throwing', () => {
    const map = resolveKeymap(BINDABLES, { 'clip.split': 'Ctrl+' });
    expect(map.byAction.get('clip.split')).toBe('c');
  });
});
