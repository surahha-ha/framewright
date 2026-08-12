// framewright — the user's keymap overrides, and nothing else.
//
// Deliberately its own store with its own storage key: a keymap belongs to the
// person, not to the project. Restoring an old version of a document must not
// hand back the shortcuts they had that day.

import { create } from 'zustand';
import { parseChord } from '../engine/keymap';

const STORAGE_KEY = 'framewright.keymap.v1';

/** `null` means "deliberately unbound", which is different from "no override". */
export type Overrides = Record<string, string | null>;

function load(): Overrides {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // `typeof [] === 'object'`, and an array would turn into overrides keyed by
    // "0", "1", … — junk that never matches an action and never goes away.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    const out: Overrides = {};
    for (const [id, value] of Object.entries(parsed as Overrides)) {
      if (value === null) out[id] = null;
      else if (typeof value === 'string') {
        const chord = parseChord(value);
        if (chord) out[id] = chord;
      }
    }
    return out;
  } catch {
    // A private-mode browser or a hand-broken value must cost the defaults, not
    // the whole editor.
    return {};
  }
}

function save(overrides: Overrides): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* nothing to do: the keymap simply will not survive this session */
  }
}

interface KeymapState {
  overrides: Overrides;
  /** `null` unbinds the action; a chord rebinds it. */
  setBinding: (actionId: string, chord: string | null) => void;
  /** Forget the override, so the action goes back to its default key. */
  clearBinding: (actionId: string) => void;
  resetAll: () => void;
}

export const useKeymapStore = create<KeymapState>((set, get) => ({
  overrides: load(),

  setBinding: (actionId, chord) => {
    const next = { ...get().overrides, [actionId]: chord };
    save(next);
    set({ overrides: next });
  },

  clearBinding: (actionId) => {
    const next = { ...get().overrides };
    delete next[actionId];
    save(next);
    set({ overrides: next });
  },

  resetAll: () => {
    save({});
    set({ overrides: {} });
  },
}));
