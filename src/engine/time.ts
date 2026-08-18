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

const STANDARD_RATES: Rational[] = [
  { num: 24000, den: 1001 }, // 23.976
  { num: 24, den: 1 },
  FPS_25,
  FPS_2997,
  FPS_30,
  { num: 50, den: 1 },
  FPS_5994,
  FPS_60,
];

/**
 * Snap a measured frame rate to the nearest standard RATIONAL rate.
 * Measured 29.97 must become 30000/1001 — storing 29.97 as a float is exactly
 * how an hour of footage drifts by seconds.
 */
export function nearestStandardFps(measured: number): Rational {
  if (!isFinite(measured) || measured <= 0) return FPS_30;
  let best = STANDARD_RATES[0];
  let bestDiff = Infinity;
  for (const r of STANDARD_RATES) {
    const diff = Math.abs(fpsToNumber(r) - measured);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  // Within 1% of a standard rate -> snap; otherwise keep the measured value
  // as an exact rational (e.g. an unusual screen-recording rate).
  if (bestDiff / measured <= 0.01) return best;
  return { num: Math.round(measured * 1000), den: 1000 };
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

/** container timescale units -> microseconds (WebCodecs timestamps). */
export function timescaleToUs(value: number, timescale: number): number {
  return Math.round((value * 1e6) / timescale);
}

/** container timescale units -> seconds. */
export function timescaleToSec(value: number, timescale: number): number {
  return value / timescale;
}

/** seconds -> container timescale units (the inverse of timescaleToSec). */
export function secToTimescale(sec: number, timescale: number): number {
  return Math.round(sec * timescale);
}

/** seconds -> microseconds (WebCodecs timestamps). */
export function secToUs(sec: number): number {
  return Math.round(sec * 1e6);
}

/** seconds -> audio sample index (cut audio on sample boundaries). */
export function secToSample(sec: number, sampleRate: number): number {
  return Math.round(sec * sampleRate);
}

/**
 * Format a frame count as m:ss (h:mm:ss past an hour) — how far along, not
 * which frame.
 *
 * The ruler needs this and `formatTimecode` cannot give it. mm:ss:ff is read as
 * hours:minutes:seconds by anyone who has not been told otherwise, and a ruler
 * is a whole row of them at once: a three-second clip labelled up to `00:02:25`
 * reads as two and a half MINUTES. The two formats answer different questions —
 * this one "where am I in the video", `formatTimecode` "which frame is this" —
 * and only the second one needs frames in it.
 */
export function formatClock(frame: number, fps: Rational): string {
  const total = Math.max(0, Math.round(frameToSec(frame, fps)));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
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
