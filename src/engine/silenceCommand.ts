// framewright — 조용한 부분 없애기 (ADR-0016).
//
// One command, the same shape as 빈 곳 없애기: no arguments, one press, one
// patch, one undo step. It can only run when there is a cut to make, and the
// reason it cannot is one of three — nothing imported, the sound not read
// yet, or nothing quiet for long enough — because a button that will not say
// what it is waiting for is indistinguishable from a broken one.
//
// The peaks come from the editor context (`ctx.peaks`), not from arguments:
// a toolbar button, a palette row and a key all call `perform(id)` with
// nothing else, and `canRun` has to answer for all of them with what the
// app has measured so far.

import type { Command, EditorCtx } from './commands';
import { secondsText } from './time';
import { videoTrack } from './timeline';
import {
  SILENCE_MIN_SEC,
  SILENCE_PAD_SEC,
  silencePatch,
  silencePlan,
  type PeaksSource,
  type SilencePlan,
} from './silence';

const NO_PEAKS: PeaksSource = () => null;

/** The plan for this context. Cheap: `silentRuns` is memoised per pyramid,
 *  so a render asking `canRun` pays one pass over the clips, not the peaks. */
function planOf(ctx: EditorCtx): SilencePlan {
  return silencePlan(ctx.project, ctx.peaks ?? NO_PEAKS);
}

export const cutSilenceCommand: Command = {
  id: 'timeline.cutSilence',
  label: '조용한 부분 없애기',
  // Skip forward: the quiet goes and the sound after it comes sooner.
  icon: '⏭',
  done(before) {
    const plan = planOf(before);
    const fps = before.project.timeline.fps;
    // 없앴어요 is the verb, and a beat of each pause is still there on
    // purpose (the padding) — say so, or the short hitch left at every cut
    // reads as the button having half worked.
    const base = `조용한 부분 ${plan.cuts.length}곳을 없앴어요 · ${secondsText(plan.removedFrames, fps)} 짧아졌어요 · 앞뒤 ${SILENCE_PAD_SEC}초씩은 남겨 뒀어요`;
    // A clip whose sound is still being read was skipped, not judged — and
    // pressing again once it lands will find its pauses too.
    return plan.unread > 0
      ? `${base} · 소리를 아직 읽는 중인 클립은 건너뛰었어요 · 잠시 뒤 다시 누르면 찾아요.`
      : `${base}.`;
  },
  disabledReason(ctx) {
    if (videoTrack(ctx.project).clips.length === 0) {
      return '먼저 영상을 불러오세요.';
    }
    const plan = planOf(ctx);
    if (plan.read === 0 && plan.unread === 0) {
      return '소리를 끈 클립은 건너뛰어요 · 소리를 다시 켜면 그 클립의 조용한 부분도 찾아요.';
    }
    if (plan.unread > 0) {
      return '소리를 아직 읽는 중이에요 · 잠시 뒤 다시 눌러 주세요.';
    }
    return `${SILENCE_MIN_SEC}초 넘게 조용한 부분이 없어요.`;
  },
  canRun(ctx) {
    return planOf(ctx).cuts.length > 0;
  },
  run(ctx) {
    return silencePatch(ctx.project, planOf(ctx));
  },
};
