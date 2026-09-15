// framewright — loading a subtitle face in the browser (ADR-0018).
//
// The one place `FontFace` and `document.fonts` are touched. A face is
// fetched from the app's own origin the first time something asks for it —
// the panel on the choice, the preview when a reopened document names one,
// the export before its first frame — and never at app start. Each face
// loads once: a second `load` while the first is in flight returns the
// same promise. `load` never throws; a failure resolves false and the
// caller draws the fallback stack. Subscribers hear every change of state,
// which is how the preview redraws the moment a face lands.

import {
  SUBTITLE_FONT_FILES,
  knownFont,
  type FontLoader,
} from '../engine/fonts';
import type { SubtitleFont } from '../engine/types';

type State = 'loading' | 'ready' | 'failed';
const state = new Map<SubtitleFont, State>();
const pending = new Map<SubtitleFont, Promise<boolean>>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function subscribeFonts(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function fontState(font: SubtitleFont): State | undefined {
  return state.get(font);
}

export const browserFonts: FontLoader = {
  ready: (font) => state.get(font) === 'ready',
  load(font) {
    if (state.get(font) === 'ready') return Promise.resolve(true);
    const inFlight = pending.get(font);
    if (inFlight) return inFlight;
    const run = (async () => {
      try {
        if (typeof FontFace === 'undefined' || typeof document === 'undefined')
          return false;
        // A face this build does not know has no file to fetch.
        if (!knownFont(font)) return false;
        const { family, file } = SUBTITLE_FONT_FILES[font];
        state.set(font, 'loading');
        notify();
        const face = new FontFace(family, `url(${file})`);
        await face.load();
        document.fonts.add(face);
        state.set(font, 'ready');
        return true;
      } catch {
        state.set(font, 'failed');
        return false;
      } finally {
        pending.delete(font);
        notify();
      }
    })();
    pending.set(font, run);
    return run;
  },
};
