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
