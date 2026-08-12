// framewright — timeline queries (pure).
// Clip ranges are HALF-OPEN [in, out): a clip occupies timeline frames
// [startFrame, startFrame + length). This one convention is what keeps cuts
// from gaining or losing a frame.

import type { Clip, Project, Track } from './types';

export function clipLength(clip: Clip): number {
  return clip.outFrame - clip.inFrame;
}

export function videoTrack(project: Project): Track {
  const t = project.tracks.find((tr) => tr.type === 'video');
  if (!t) throw new Error('project has no video track');
  return t;
}

/** Last frame end across all tracks (exclusive) — i.e. the timeline length. */
export function timelineDuration(project: Project): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const c of track.clips) {
      const e = c.startFrame + clipLength(c);
      if (e > end) end = e;
    }
  }
  return end;
}

/**
 * Length of the VIDEO track only. Export renders from the video track, so its
 * duration must come from the same place — otherwise a longer audio/text track
 * would append trailing black frames to the file.
 */
export function videoDuration(project: Project): number {
  let end = 0;
  for (const c of videoTrack(project).clips) {
    const e = c.startFrame + clipLength(c);
    if (e > end) end = e;
  }
  return end;
}

/** How many frames of source media an asset has, at the timeline's rate. */
export function sourceFrames(project: Project, assetId: string): number | null {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset?.meta.durationSec) return null;
  const { num, den } = project.timeline.fps;
  return Math.max(1, Math.round((asset.meta.durationSec * num) / den));
}

/**
 * Snap to the nearest interesting frame (a neighbour's edge, the playhead, 0)
 * when it is within `threshold`. Editing by hand is imprecise; snapping is what
 * makes "butt this clip up against that one" possible with a mouse.
 */
export function snapFrame(
  value: number,
  targets: number[],
  threshold: number,
): number {
  let best = value;
  let bestDistance = threshold + 1;
  for (const t of targets) {
    const d = Math.abs(t - value);
    if (d <= threshold && d < bestDistance) {
      bestDistance = d;
      best = t;
    }
  }
  return best;
}

export interface Resolved {
  trackId: string;
  clip: Clip;
  index: number;
  /** frame within the (conformed) source media */
  sourceFrame: number;
}

/** Which clip (if any) covers this timeline frame, and where in its source. */
export function resolveAt(project: Project, frame: number): Resolved | null {
  const track = videoTrack(project);
  for (let i = 0; i < track.clips.length; i++) {
    const c = track.clips[i];
    const start = c.startFrame;
    const end = start + clipLength(c); // exclusive
    if (frame >= start && frame < end) {
      return {
        trackId: track.id,
        clip: c,
        index: i,
        sourceFrame: c.inFrame + (frame - start),
      };
    }
  }
  return null;
}
