// framewright — audio scheduling (pure).
// Turns the timeline into a list of "play this part of this source, at this
// offset from now" instructions. Cuts, gaps and mid-timeline starts all fall out
// of the same arithmetic, and it is testable without WebAudio.
//
// A fade (ADR-0012) is a gain ramp on the same frames the picture blends on,
// and a dissolve at a cut lets the neighbour's sound run on — the previous
// clip's overhang under a fade-in, the next clip's pre-roll under a fade-out —
// exactly as far as `fades.ts` lets its picture.

import type { Project } from './types';
import { clipLength, videoTrack } from './timeline';
import { frameToSec } from './time';
import { effectiveFades, fadePartner } from './fades';
import { clipLevel } from './volume';

/** Gain at a moment, seconds from playback start (may be negative: a ramp
 *  that began before playback did). Linear between points, flat outside. */
export interface GainPoint {
  atSec: number;
  value: number;
}

export interface AudioSegment {
  clipId: string;
  assetId: string;
  /** Seconds from playback start at which this segment begins. */
  whenSec: number;
  /** Seconds into the source asset where this segment begins. */
  offsetSec: number;
  durationSec: number;
  /** Absent means unity gain throughout. */
  gain?: GainPoint[];
}

/**
 * Segments to schedule when playback starts at `startFrame`.
 * Audio follows the video track (A/V are linked for now), so a cut in the video
 * cuts the audio identically and a gap stays silent.
 */
export function buildAudioSchedule(
  project: Project,
  startFrame: number,
): AudioSegment[] {
  const fps = project.timeline.fps;
  const segments: AudioSegment[] = [];
  const clips = videoTrack(project).clips;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const len = clipLength(clip);
    const start = clip.startFrame;
    const end = start + len;
    const { fadeIn, fadeOut } = effectiveFades(clip);
    // A muted clip (or one at 0%) has no segment at all — not even an
    // overhang under a neighbour's fade, which is that neighbour's cue to
    // dissolve from silence (ADR-0013).
    const level = clipLevel(clip);
    if (level <= 0) continue;

    // The segment in timeline frames, before the playback start is applied.
    let segStart = start;
    let segIn = clip.inFrame;
    let segLen = len;
    const points: { frame: number; value: number }[] = [];

    if (fadeIn > 0) {
      points.push(
        { frame: start, value: 0 },
        { frame: start + fadeIn, value: 1 },
      );
    } else {
      // The previous clip fades out INTO this one: its picture pre-rolls
      // under that fade, and so does its sound — as much of it as the file
      // has before the in-point. The ramp is on the picture's frames either
      // way, so a short pre-roll starts mid-ramp rather than late.
      const prev = clips[i - 1];
      const n = prev ? effectiveFades(prev).fadeOut : 0;
      const theirs = n > 0 ? fadePartner(project, prev.id, 'out') : null;
      if (theirs?.kind === 'clip' && theirs.clipId === clip.id) {
        const preroll = Math.min(n, clip.inFrame);
        segStart -= preroll;
        segIn -= preroll;
        segLen += preroll;
        // The ramp runs over the frames the sound actually has, not the
        // picture's full fade: a ramp anchored at `start - n` would put the
        // first audible sample at (n - preroll) / n — a pop, not a fade.
        // With no pre-roll at all the sound starts at the cut, at full,
        // which is what the picture shows there too.
        if (preroll > 0) {
          points.push(
            { frame: start - preroll, value: 0 },
            { frame: start, value: 1 },
          );
        }
      }
    }

    if (fadeOut > 0) {
      points.push({ frame: end - fadeOut, value: 1 }, { frame: end, value: 0 });
    } else {
      // The next clip fades in over this one's overhang. The file may run out
      // before the fade does; the player clamps to the buffer, and the picture
      // holds its last frame the same way.
      const next = clips[i + 1];
      const n = next ? effectiveFades(next).fadeIn : 0;
      const theirs = n > 0 ? fadePartner(project, next.id, 'in') : null;
      if (theirs?.kind === 'clip' && theirs.clipId === clip.id) {
        segLen += n;
        points.push({ frame: end, value: 1 }, { frame: end + n, value: 0 });
      }
    }

    const segEnd = segStart + segLen;
    if (segEnd <= startFrame) continue; // entirely in the past

    // How far into this segment playback begins (0 unless it straddles the start).
    const skip = Math.max(0, startFrame - segStart);
    const remaining = segLen - skip;
    if (remaining <= 0) continue;

    // The level scales every ramp point, so a fade on a quiet clip still
    // ends at the clip's level, and the overhang a neighbour dissolves over
    // runs at THIS clip's level (`gainAt` holds the first value before the
    // first point). With no ramp, one point at the segment's start is a
    // flat gain throughout — in the past when playback joins later, like a
    // fade's points, and scheduled the same way.
    if (level !== 1) {
      if (points.length === 0) points.push({ frame: segStart, value: 1 });
      for (const p of points) p.value *= level;
    }

    segments.push({
      clipId: clip.id,
      assetId: clip.assetId,
      whenSec: frameToSec(segStart + skip - startFrame, fps),
      offsetSec: frameToSec(segIn + skip, fps),
      durationSec: frameToSec(remaining, fps),
      ...(points.length
        ? {
            gain: points.map((p) => ({
              atSec: frameToSec(p.frame - startFrame, fps),
              value: p.value,
            })),
          }
        : {}),
    });
  }

  return segments;
}

/** The ramp's value at `sec`. Unity when there is no ramp. */
export function gainAt(points: GainPoint[] | undefined, sec: number): number {
  if (!points || points.length === 0) return 1;
  if (sec <= points[0].atSec) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (sec <= b.atSec) {
      const span = b.atSec - a.atSec;
      if (span <= 0) return b.value;
      return a.value + ((b.value - a.value) * (sec - a.atSec)) / span;
    }
  }
  return points[points.length - 1].value;
}

/** The two calls an `AudioParam` needs for a ramp — typed as a shape so the
 *  scheduling can be checked in Node with a fake. */
export interface RampParam {
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
}

/**
 * Put the ramp on a parameter, with `t0` the audio-clock time of playback
 * start. A point in the past is not scheduled (the clock will not go back);
 * instead the parameter STARTS at the value the ramp has already reached, so
 * a fade joined halfway through is halfway through rather than restarting.
 */
export function scheduleGain(
  param: RampParam,
  points: GainPoint[] | undefined,
  t0: number,
): void {
  if (!points || points.length === 0) return;
  param.setValueAtTime(gainAt(points, 0), t0);
  for (const p of points) {
    if (p.atSec > 0) param.linearRampToValueAtTime(p.value, t0 + p.atSec);
  }
}
