// framewright — the fade commands (ADR-0012).
//
// Two commands, one per edge, and each does two things depending on how it is
// asked. From a button or a key (no arguments) it TOGGLES the selected clip's
// edge: on with the default length, off again. From the panel it SETS a
// length on a named clip (`frames: 0` turns it off). Both go through the same
// decision, so the sentence afterwards and the refusal beforehand agree.
//
// What the edge fades into is never an argument. `fades.ts` decides that from
// the neighbours, so the same button is a dissolve at a cut and a fade from
// black at the start of the video.

import type { Command, EditorCtx } from './commands';
import type { Clip } from './types';
import { locateClip } from './timeline';
import {
  defaultFadeFrames,
  describeFade,
  fadeLimit,
  type FadeEdge,
} from './fades';

export interface FadeArgs {
  /** The selected clip when absent. */
  clipId?: string;
  /** Frames; 0 turns the fade off. Absent toggles. */
  frames?: number;
}

const PICK_FIRST = '클립을 먼저 골라 주세요.';

interface Decision {
  clip: Clip;
  trackId: string;
  /** What is in the document now (0 when absent). */
  current: number;
  /** What the user asked for, before clamping. */
  asked: number;
  /** What will be written. */
  next: number;
}

function decide(
  ctx: EditorCtx,
  edge: FadeEdge,
  args: FadeArgs | undefined,
): Decision | null {
  const clipId = args?.clipId ?? ctx.selectedClipId;
  const found = locateClip(ctx.project, clipId);
  if (!found) return null;
  const { clip, track } = found;
  const field = edge === 'in' ? 'fadeIn' : 'fadeOut';
  const current = Math.max(0, clip[field] ?? 0);
  const limit = fadeLimit(clip, edge);
  const asked =
    args?.frames !== undefined
      ? Math.max(0, Math.round(args.frames))
      : current > 0
        ? 0
        : defaultFadeFrames(ctx.project.timeline.fps);
  const next = Math.min(asked, limit);
  if (next === current) return null;
  return { clip, trackId: track.id, current, asked, next };
}

function fadeCommand(edge: FadeEdge): Command<FadeArgs | undefined> {
  const field = edge === 'in' ? 'fadeIn' : 'fadeOut';
  return {
    id: edge === 'in' ? 'clip.fadeIn' : 'clip.fadeOut',
    label: edge === 'in' ? '서서히 나타나기' : '서서히 사라지기',
    icon: edge === 'in' ? '◖' : '◗',
    // The panel is where these live; the toolbar is already a row of edits.
    hidden: true,
    done(before, _after, args) {
      // The same decision the run made, from the pre-run ctx and the same
      // arguments — the only way to know what was ASKED, which the finished
      // document cannot say when the clip was too short for it.
      const d = decide(before, edge, args as FadeArgs | undefined);
      return d
        ? describeFade(before.project, d.clip.id, edge, d.next, d.asked)
        : '';
    },
    disabledReason(ctx) {
      const found = locateClip(ctx.project, ctx.selectedClipId);
      if (!found) return PICK_FIRST;
      if (fadeLimit(found.clip, edge) === 0) {
        return edge === 'in'
          ? '뒷부분의 서서히 사라지기가 클립 전체를 쓰고 있어요. 그쪽을 줄이면 앞부분에도 자리가 생겨요.'
          : '앞부분의 서서히 나타나기가 클립 전체를 쓰고 있어요. 그쪽을 줄이면 뒷부분에도 자리가 생겨요.';
      }
      return '지금은 쓸 수 없어요.';
    },
    canRun(ctx, args) {
      return decide(ctx, edge, args) !== null;
    },
    run(ctx, args) {
      const d = decide(ctx, edge, args);
      if (!d) throw new Error(`${this.id}: nothing to change`);
      return {
        forward: [
          {
            kind: 'updateClip',
            trackId: d.trackId,
            clipId: d.clip.id,
            changes: { [field]: d.next > 0 ? d.next : undefined },
          },
        ],
        inverse: [
          {
            kind: 'updateClip',
            trackId: d.trackId,
            clipId: d.clip.id,
            changes: { [field]: d.clip[field] },
          },
        ],
      };
    },
  };
}

export const fadeInCommand = fadeCommand('in');
export const fadeOutCommand = fadeCommand('out');

export const FADE_COMMANDS: Command<any>[] = [fadeInCommand, fadeOutCommand];
