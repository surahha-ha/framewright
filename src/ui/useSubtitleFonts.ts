// framewright — the faces a document names, brought to the page (ADR-0018,
// amended 2026-09-16), as a hook for the preview.
//
// Two askers, one loader (`ui/fonts.ts`, memoised per face):
//
// - THE DOCUMENT. Whatever faces its subtitles name are fetched the moment
//   the document is on screen — a reopened project on load, a version
//   restore, an edit that first names a face — quietly: the words are not
//   under the playhead yet, so there is nothing on screen to explain. This
//   closes the window in which a reopened document drew its words in the
//   system face until playback reached them (ADR-0018 "Consequences",
//   before the amendment).
// - THE PLAYHEAD. When the frame under it names a face still in flight from
//   the document's ask, the preview says so ("받는 중이에요") and then how
//   it ended, because the swap from the system face mid-subtitle is
//   otherwise a silent change of shape; a face that FAILED is said once,
//   when the words first reach it. The panel's own choice asks and speaks
//   for itself (`SubtitlePanel.chooseFont`) and is left alone here.
//
// The overlay redraws when any face lands: the returned `fontsVersion`.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/projectStore';
import type { Project, SubtitleFont } from '../engine/types';
import type { SubtitleFrame } from '../engine/subtitleRender';
import {
  FONT_ARRIVED,
  FONT_FAILED,
  FONT_FETCHING,
  knownFont,
} from '../engine/fonts';
import { browserFonts, fontState, subscribeFonts } from './fonts';

/** The faces the document's subtitles name, once each, in first-use
 *  order — as a string, so an effect can key on it. */
function facesNamed(project: Project): string {
  const out: SubtitleFont[] = [];
  for (const s of project.subtitles) {
    const face = knownFont(s.font);
    if (face && !out.includes(face)) out.push(face);
  }
  return out.join(' ');
}

export function useSubtitleFonts(
  project: Project,
  frame: SubtitleFrame | null,
  setStatus: (s: string) => void,
): number {
  const [fontsVersion, fontArrived] = useState(0);
  useEffect(() => subscribeFonts(() => fontArrived((n) => n + 1)), []);

  // The document's ask: every named face nobody has asked for yet, without
  // a sentence. The faces the panel's choice asked for are already in
  // flight (`fontState` set) and are skipped, so its sentences stay its own.
  const quietRef = useRef(new Set<SubtitleFont>());
  const named = facesNamed(project);
  useEffect(() => {
    if (!named) return;
    for (const face of named.split(' ') as SubtitleFont[]) {
      if (fontState(face) !== undefined) continue;
      quietRef.current.add(face);
      void browserFonts.load(face);
    }
  }, [named]);

  // The playhead's sentence, for a face the document asked for quietly.
  const wantedFont = knownFont(frame?.font);
  const wantedRef = useRef(wantedFont);
  wantedRef.current = wantedFont;
  const saidFailedRef = useRef(new Set<SubtitleFont>());
  useEffect(() => {
    if (!wantedFont || browserFonts.ready(wantedFont)) return;
    const state = fontState(wantedFont);
    if (state === 'failed') {
      // Once per face: playback through several subtitles in a face that
      // did not come must not say the same failure on each of them.
      if (saidFailedRef.current.has(wantedFont)) return;
      saidFailedRef.current.add(wantedFont);
      setStatus(FONT_FAILED(wantedFont));
      return;
    }
    // In flight from the panel's own choice: it said, and will say, its
    // own sentences.
    if (state === 'loading' && !quietRef.current.has(wantedFont)) return;
    quietRef.current.add(wantedFont);
    const said = FONT_FETCHING(wantedFont);
    setStatus(said);
    void browserFonts.load(wantedFont).then((ok) => {
      // Said only while the words under the playhead still want the face
      // AND the status line still shows the wait — an edit made meanwhile
      // has a newer sentence there, and a fetch settling late must not
      // bury it (QA review). A failure skipped here is not marked as said,
      // so the words reaching that face again say it then.
      if (wantedRef.current !== wantedFont) return;
      if (useStore.getState().status !== said) return;
      if (!ok) saidFailedRef.current.add(wantedFont);
      setStatus(ok ? FONT_ARRIVED(wantedFont) : FONT_FAILED(wantedFont));
    });
  }, [wantedFont, setStatus]);

  return fontsVersion;
}
