// framewright — a clip's sound level (pure). ADR-0013.
//
// Two fields on the clip, and the reason there are two: `volume` is how loud
// the clip is, `muted` is whether it is heard at all. Folding a mute into
// "volume 0" would forget the level the moment the sound came back, and a
// mute is the one audio edit almost everyone makes — it has to be a switch
// that goes both ways.
//
// The document keeps a LINEAR gain (1 is the file as recorded), because that
// is what the audio graph multiplies by and what the fade ramps already are.
// People read a percent; the conversion lives here, once, so the panel, the
// strip and the status line all say the same number for the same value.

import type { Clip } from './types';

/** Twice as loud as recorded is as far as the panel goes. Louder starts
 *  clipping in earnest, and a first-time user reaching for 400% has a
 *  recording problem the slider cannot fix. */
export const VOLUME_MAX = 2;

/** One notch of the slider: five percent. */
export const VOLUME_STEP_PERCENT = 5;

function clamp(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.min(VOLUME_MAX, Math.max(0, volume));
}

/** Round to a whole percent, so 0.35 stays 0.35 through a save and a
 *  comparison, and two ways of asking for the same level agree. */
export function roundVolume(volume: number): number {
  return Math.round(clamp(volume) * 100) / 100;
}

/** What the clip is heard at: 0 when muted, otherwise its volume, and the
 *  file as recorded when nothing is said. A document past the range the
 *  panel offers is read at the edge, never rewritten. */
export function clipLevel(clip: Pick<Clip, 'volume' | 'muted'>): number {
  if (clip.muted) return 0;
  return clamp(clip.volume ?? 1);
}

export function volumePercent(volume: number): number {
  return Math.round(clamp(volume) * 100);
}

export function percentToVolume(percent: number): number {
  if (!Number.isFinite(percent)) return 1;
  return roundVolume(percent / 100);
}

export function volumeText(volume: number): string {
  return `${volumePercent(volume)}%`;
}

/** What a level change did, for the status line. `from` and `to` are the
 *  levels either side of the edit. */
export function describeVolume(from: number, to: number): string {
  if (to === 1) return '소리를 원래 크기로 되돌렸어요.';
  if (to === 0) return `소리를 ${volumeText(to)}로 줄였어요 · 들리지 않아요.`;
  return to > from
    ? `소리를 ${volumeText(to)}로 키웠어요.`
    : `소리를 ${volumeText(to)}로 줄였어요.`;
}

export function describeMute(muted: boolean): string {
  return muted
    ? '소리를 껐어요 · 이 클립은 들리지 않아요.'
    : '소리를 다시 켰어요.';
}

/** The strip's words for a clip whose sound is not as recorded: the mark
 *  is decorative, this is what a screen reader gets. Empty when there is
 *  nothing to say. */
export function audioNoteText(clip: Pick<Clip, 'volume' | 'muted'>): string {
  if (clip.muted) return '소리 끔';
  const level = clipLevel(clip);
  return level === 1 ? '' : `소리 ${volumeText(level)}`;
}
