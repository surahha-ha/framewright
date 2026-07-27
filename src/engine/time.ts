// framewright — canonical time-model.
// THE single place that converts between frames, seconds, and audio samples.
// Never do inline time arithmetic elsewhere; import from here so preview and
// export always agree and float accumulation never drifts.

import type { Rational } from './types';

export const FPS_30: Rational = { num: 30, den: 1 };
export const FPS_2997: Rational = { num: 30000, den: 1001 };
export const FPS_25: Rational = { num: 25, den: 1 };
export const FPS_60: Rational = { num: 60, den: 1 };
export const FPS_5994: Rational = { num: 60000, den: 1001 };

export function fpsToNumber(fps: Rational): number {
  return fps.num / fps.den;
}

/** timeline frame -> seconds (exact rational math). */
export function frameToSec(frame: number, fps: Rational): number {
  return (frame * fps.den) / fps.num;
}

/** seconds -> timeline frame. One canonical rounding rule for the whole app. */
export function secToFrame(
  sec: number,
  fps: Rational,
  rounding: 'round' | 'floor' = 'round',
): number {
  const f = (sec * fps.num) / fps.den;
  return rounding === 'floor' ? Math.floor(f) : Math.round(f);
}

/** number of timeline frames that best represents a source duration. */
export function framesForDuration(durationSec: number, fps: Rational): number {
  return Math.max(1, Math.round((durationSec * fps.num) / fps.den));
}

/** seconds -> audio sample index (cut audio on sample boundaries). */
export function secToSample(sec: number, sampleRate: number): number {
  return Math.round(sec * sampleRate);
}

/** format a frame count as mm:ss:ff for UI. */
export function formatTimecode(frame: number, fps: Rational): string {
  const fpsN = Math.round(fpsToNumber(fps));
  const totalSec = Math.floor(frame / fpsN);
  const ff = frame % fpsN;
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(mm)}:${p(ss)}:${p(ff)}`;
}
