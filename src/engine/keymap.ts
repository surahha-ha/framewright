// framewright — the keymap: chords as DATA, resolved against the action list.
//
// Bindings used to be spelled out inside the components that handled them, which
// meant a user keymap could never reach them (see "Known tech debt" in
// CLAUDE.md). Here a chord is a canonical string, an action is an id, and the
// mapping between them is a value the UI can edit, store and reset.
//
// Two rules this module makes STRUCTURAL rather than remembered:
//  1. `c` and `mod+c` are different chords, so a single-key binding can never
//     fire with a modifier held. That bug (Ctrl+C splitting the clip) cannot
//     come back by forgetting a guard.
//  2. A modifier pressed on its own is not a chord at all, so holding Alt on the
//     way to Alt+← never looks like a binding.

/** Just enough of a KeyboardEvent to name a chord — keeps this Node-testable. */
export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** `mod` is Ctrl on Windows/Linux and Cmd on macOS — one binding for both. */
const MODIFIER_KEYS = new Set([
  'control',
  'ctrl',
  'shift',
  'alt',
  'option',
  'meta',
  'cmd',
  'command',
  'os',
  'capslock',
]);

const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
  del: 'delete',
  left: 'arrowleft',
  right: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
  return: 'enter',
  plus: '+',
};

export function normalizeKeyName(key: string): string {
  const k = key.toLowerCase();
  return KEY_ALIASES[k] ?? k;
}

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key.toLowerCase());
}

/** The canonical chord for a key press, or '' when it is not one. */
export function chordOf(e: KeyLike): string {
  const key = normalizeKeyName(e.key);
  if (!key || isModifierKey(key)) return '';
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

/** Parse what a human (or a stored keymap) wrote. Null when it is not a chord. */
export function parseChord(text: string | null | undefined): string | null {
  if (!text) return null;
  const parts = text
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  // "shift++" — a literal plus survives as its own part.
  if (parts.length === 0) return text.trim() === '+' ? '+' : null;

  let mod = false;
  let alt = false;
  let shift = false;
  let key: string | null = null;
  for (const part of parts) {
    if (part === 'mod' || part === 'ctrl' || part === 'control') mod = true;
    else if (part === 'cmd' || part === 'command' || part === 'meta')
      mod = true;
    else if (part === 'alt' || part === 'option') alt = true;
    else if (part === 'shift') shift = true;
    else key = normalizeKeyName(part);
  }
  if (!key) return null;
  const out: string[] = [];
  if (mod) out.push('mod');
  if (alt) out.push('alt');
  if (shift) out.push('shift');
  out.push(key);
  return out.join('+');
}

const KEY_LABELS: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  space: 'Space',
  escape: 'Esc',
  delete: 'Delete',
  backspace: 'Backspace',
  enter: 'Enter',
  home: 'Home',
  end: 'End',
};

/** How a chord is written on screen. Mac gets the symbols people expect. */
export function formatChord(
  chord: string | null | undefined,
  mac = false,
): string {
  if (!chord) return '없음';
  const parts = chord.split('+');
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  const label =
    KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : titleCase(key));
  if (mac) {
    return (
      (mods.has('mod') ? '⌘' : '') +
      (mods.has('alt') ? '⌥' : '') +
      (mods.has('shift') ? '⇧' : '') +
      label
    );
  }
  const out: string[] = [];
  if (mods.has('mod')) out.push('Ctrl');
  if (mods.has('alt')) out.push('Alt');
  if (mods.has('shift')) out.push('Shift');
  out.push(label);
  return out.join('+');
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Chords the page cannot give away. Tab and Escape are how a keyboard user gets
 * around and out of a dialog; the rest belong to the browser, and binding them
 * produces a shortcut that appears to be broken.
 */
const RESERVED: Record<string, string> = {
  tab: '탭 이동에 쓰는 키예요.',
  'shift+tab': '탭 이동에 쓰는 키예요.',
  escape: '창을 닫는 키예요.',
  // A focused button, link or slider takes these for itself, so a binding made
  // of one would work in some places and be silently dead in others — which is
  // worse than not being allowed. (They are still the DEFAULTS for play/pause
  // and the playhead steps: those are the actions that want to stand down while
  // a control has focus.)
  space: '버튼에 초점이 있을 때 그 버튼이 가져가는 키예요.',
  enter: '버튼에 초점이 있을 때 그 버튼이 가져가는 키예요.',
  arrowleft: '슬라이더와 버튼이 가져가는 키예요.',
  arrowright: '슬라이더와 버튼이 가져가는 키예요.',
  arrowup: '슬라이더와 버튼이 가져가는 키예요.',
  arrowdown: '슬라이더와 버튼이 가져가는 키예요.',
  home: '슬라이더가 가져가는 키예요.',
  end: '슬라이더가 가져가는 키예요.',
  f5: '브라우저 새로고침 키예요.',
  'mod+r': '브라우저 새로고침 키예요.',
  'mod+shift+r': '브라우저 새로고침 키예요.',
  f12: '브라우저 개발자 도구 키예요.',
  'mod+w': '브라우저 탭을 닫는 키예요.',
  'mod+t': '브라우저 탭을 여는 키예요.',
  'mod+n': '브라우저 창을 여는 키예요.',
};

/** Why this chord cannot be bound, or null when it can. */
export function reservedReason(chord: string | null): string | null {
  if (!chord) return null;
  return RESERVED[chord] ?? null;
}

export interface Bindable {
  id: string;
  /** Canonical or human-written; parsed either way. */
  defaultKey?: string;
}

export interface ResolvedKeymap {
  byChord: Map<string, string>;
  byAction: Map<string, string>;
  /** Chords more than one action asked for. The winner is listed first. */
  conflicts: { chord: string; actionIds: string[] }[];
}

/**
 * Turn defaults + the user's overrides into one lookup.
 *
 * An override beats a default; between two of the same kind the earlier action
 * in the list wins. The loser is left UNBOUND rather than quietly sharing the
 * chord — and every collision is reported, so the settings panel can say so
 * instead of leaving the user with a key that does nothing.
 */
export function resolveKeymap(
  bindables: Bindable[],
  overrides: Record<string, string | null> = {},
): ResolvedKeymap {
  const wanted: { id: string; chord: string; overridden: boolean }[] = [];
  for (const b of bindables) {
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, b.id);
    if (hasOverride) {
      const raw = overrides[b.id];
      if (raw === null) continue; // deliberately unbound
      const chord = parseChord(raw);
      if (chord) {
        wanted.push({ id: b.id, chord, overridden: true });
        continue;
      }
      // Unparseable (a hand-edited or outdated store): fall through to the default.
    }
    const fallback = parseChord(b.defaultKey);
    if (fallback) wanted.push({ id: b.id, chord: fallback, overridden: false });
  }

  const ranked = [
    ...wanted.filter((w) => w.overridden),
    ...wanted.filter((w) => !w.overridden),
  ];

  const byChord = new Map<string, string>();
  const byAction = new Map<string, string>();
  const claims = new Map<string, string[]>();
  for (const w of ranked) {
    const list = claims.get(w.chord);
    if (list) {
      list.push(w.id);
      continue;
    }
    claims.set(w.chord, [w.id]);
    byChord.set(w.chord, w.id);
    byAction.set(w.id, w.chord);
  }

  const conflicts = [...claims.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([chord, actionIds]) => ({ chord, actionIds }));

  return { byChord, byAction, conflicts };
}
