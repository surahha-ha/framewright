// framewright — audio scheduling (pure).
// Turns the timeline into a list of "play this part of this source, at this
// offset from now" instructions. Cuts, gaps and mid-timeline starts all fall out
// of the same arithmetic, and it is testable without WebAudio.

import type { Project } from './types';
import { clipLength, videoTrack } from './timeline';
import { frameToSec } from './time';

export interface AudioSegment {
  clipId: string;
  assetId: string;
  /** Seconds from playback start at which this segment begins. */
  whenSec: number;
  /** Seconds into the source asset where this segment begins. */
  offsetSec: number;
  durationSec: number;
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

  for (const clip of videoTrack(project).clips) {
    const len = clipLength(clip);
    const clipEnd = clip.startFrame + len;
    if (clipEnd <= startFrame) continue; // entirely in the past

    // How far into this clip playback begins (0 unless it straddles the start).
    const skip = Math.max(0, startFrame - clip.startFrame);
    const remaining = len - skip;
    if (remaining <= 0) continue;

    segments.push({
      clipId: clip.id,
      assetId: clip.assetId,
      whenSec: frameToSec(clip.startFrame + skip - startFrame, fps),
      offsetSec: frameToSec(clip.inFrame + skip, fps),
      durationSec: frameToSec(remaining, fps),
    });
  }

  return segments;
}
