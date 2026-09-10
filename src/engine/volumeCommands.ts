// framewright — the sound commands (ADR-0013).
//
// Two commands, because they are two different kinds of thing. `clip.mute`
// is a switch: from a key, a button or the palette it flips the selected
// clip (or the one named) between heard and not heard, and keeps the level
// for when the sound comes back. `clip.volume` sets a level and needs one,
// so it has no palette row and no key — the panel's slider is its only
// caller, and each notch of a drag goes through here so the sentence and the
// undo step are the command's, not the slider's.

import type { Command, EditorCtx } from './commands';
import { locateClip } from './timeline';
import { clipLevel, describeMute, describeVolume, roundVolume } from './volume';

export interface MuteArgs {
  /** The selected clip when absent. */
  clipId?: string;
}

export interface VolumeArgs {
  /** The selected clip when absent. */
  clipId?: string;
  /** Linear gain, 1 = as recorded. Clamped and rounded to a percent. */
  volume: number;
}

const PICK_FIRST = '클립을 먼저 골라 주세요.';

export const muteCommand: Command<MuteArgs | undefined> = {
  id: 'clip.mute',
  label: '소리 끄기',
  icon: '🔇',
  defaultKey: 'm',
  // The panel and the palette; the toolbar is already a row of edits.
  hidden: true,
  done(before, _after, args) {
    const found = locateClip(
      before.project,
      (args as MuteArgs | undefined)?.clipId ?? before.selectedClipId,
    );
    return found ? describeMute(!found.clip.muted) : '';
  },
  disabledReason: () => PICK_FIRST,
  canRun(ctx, args) {
    return locateClip(ctx.project, args?.clipId ?? ctx.selectedClipId) !== null;
  },
  run(ctx, args) {
    const found = locateClip(ctx.project, args?.clipId ?? ctx.selectedClipId);
    if (!found) throw new Error('clip.mute: no clip');
    const { clip, track } = found;
    return {
      forward: [
        {
          kind: 'updateClip',
          trackId: track.id,
          clipId: clip.id,
          // `true` or absent — never `false`, so a clip that was never
          // muted and one that was muted and unmuted are the same document.
          changes: { muted: clip.muted ? undefined : true },
        },
      ],
      inverse: [
        {
          kind: 'updateClip',
          trackId: track.id,
          clipId: clip.id,
          changes: { muted: clip.muted },
        },
      ],
    };
  },
};

function decide(ctx: EditorCtx, args: VolumeArgs | undefined) {
  if (!args || !Number.isFinite(args.volume)) return null;
  const found = locateClip(ctx.project, args.clipId ?? ctx.selectedClipId);
  if (!found) return null;
  const current = roundVolume(found.clip.volume ?? 1);
  const next = roundVolume(args.volume);
  if (next === current) return null;
  return { ...found, current, next };
}

export const volumeCommand: Command<VolumeArgs | undefined> = {
  id: 'clip.volume',
  label: '소리 크기 조절',
  icon: '🔉',
  hidden: true,
  requiresArgs: true,
  done(before, _after, args) {
    const d = decide(before, args as VolumeArgs | undefined);
    return d ? describeVolume(d.current, d.next) : '';
  },
  disabledReason: () => PICK_FIRST,
  canRun(ctx, args) {
    return decide(ctx, args) !== null;
  },
  run(ctx, args) {
    const d = decide(ctx, args);
    if (!d) throw new Error('clip.volume: nothing to change');
    return {
      forward: [
        {
          kind: 'updateClip',
          trackId: d.track.id,
          clipId: d.clip.id,
          // As recorded is no field at all, like a hard cut is no fade.
          changes: { volume: d.next === 1 ? undefined : d.next },
        },
      ],
      inverse: [
        {
          kind: 'updateClip',
          trackId: d.track.id,
          clipId: d.clip.id,
          changes: { volume: d.clip.volume },
        },
      ],
    };
  },
};

export const VOLUME_COMMANDS: Command<any>[] = [muteCommand, volumeCommand];

/** Re-exported so a caller that has the commands has the level too. */
export { clipLevel };
