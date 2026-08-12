// framewright — copy/paste placement (pure).
//
// The clipboard holds a piece of MEDIA ("frames 5–15 of a.mp4"), never a
// position: where a pasted clip lands is decided at paste time, from the
// playhead and what is already on the track.
//
// Placement rules, in one place because they are the whole design of paste:
//
//  1. A paste never splits, overwrites or drops anything. If the playhead is
//     inside a clip, the insert point moves to that clip's nearer edge (ties go
//     to the end — "after the thing I am looking at"), and the UI says so.
//  2. If the free space at the insert point is big enough, the clip simply lands
//     there. A gap the user made is a place to put things, not an error.
//  3. Otherwise later clips move right by exactly the amount the space falls
//     short — no more. Spacing the user chose elsewhere on the track survives.
//
// Rule 3 is a push on an EXPLICIT command, which is a different thing from the
// magnetic mode ADR-0006 rejected: nothing reflows unless you ask it to.

import { clipLength, videoTrack } from './timeline';
import type { Project } from './types';

export interface ClipboardEntry {
  assetId: string;
  inFrame: number;
  /** Exclusive — ranges are half-open [in, out). */
  outFrame: number;
}

export function entryLength(entry: ClipboardEntry): number {
  return entry.outFrame - entry.inFrame;
}

/** What copying a clip puts on the clipboard. Null when the clip is gone. */
export function copyEntry(
  project: Project,
  clipId: string | null,
): ClipboardEntry | null {
  if (!clipId) return null;
  const clip = videoTrack(project).clips.find((c) => c.id === clipId);
  if (!clip) return null;
  return {
    assetId: clip.assetId,
    inFrame: clip.inFrame,
    outFrame: clip.outFrame,
  };
}

export interface PastePlan {
  /** Timeline frame the pasted clip starts on. */
  startFrame: number;
  /** How far every clip starting at or after `startFrame` moves right. */
  pushBy: number;
  /** Whether the insert point had to leave the playhead, and which way. */
  snapped: 'none' | 'start' | 'end';
}

export function pastePlan(
  project: Project,
  playhead: number,
  length: number,
): PastePlan {
  const clips = videoTrack(project).clips;

  // 1. An insert point that is never inside a clip.
  let startFrame = playhead;
  let snapped: PastePlan['snapped'] = 'none';
  for (const c of clips) {
    const end = c.startFrame + clipLength(c);
    if (playhead >= c.startFrame && playhead < end) {
      const toStart = playhead - c.startFrame;
      const toEnd = end - playhead;
      startFrame = toStart < toEnd ? c.startFrame : end;
      if (startFrame !== playhead) snapped = toStart < toEnd ? 'start' : 'end';
      break;
    }
  }

  // 2. How much room there is before the next clip begins.
  let free = Number.POSITIVE_INFINITY;
  for (const c of clips) {
    if (c.startFrame >= startFrame) {
      free = c.startFrame - startFrame;
      break;
    }
  }

  // 3. Push only by what the room falls short.
  const pushBy =
    free === Number.POSITIVE_INFINITY ? 0 : Math.max(0, length - free);
  return { startFrame, pushBy, snapped };
}

/** Where the pasted clip belongs in the track array, keeping it start-ordered. */
export function pasteIndex(project: Project, startFrame: number): number {
  const clips = videoTrack(project).clips;
  const i = clips.findIndex((c) => c.startFrame >= startFrame);
  return i < 0 ? clips.length : i;
}
