#!/usr/bin/env node
/**
 * v2 계측 — 턴 시작 훅 (`docs/16-v2-completion-metric.md` §5.4 · 결정 이력 2026-09-30(3) · `docs/13` §2 `turn-start`).
 *
 * 에이전트 도구의 **UserPromptSubmit 훅**에 건다. 메인 세션에 프롬프트가 들어올 때마다 그 페이로드의
 * `prompt_id`(= 로그 `turn`)·`session_id`(= `session`)를 `turn-start` 이벤트 한 줄로 남긴다.
 * 이것이 **메인 턴이 있었다는 사실의 직접 관찰**이다 — 게이트 훅의 matcher 는 셸뿐이라, 메인이 셸을 쓰지 않고
 * 서브에이전트에 위임만 한 턴은 메인 게이트 이벤트가 0 이고, 그러면 리포트는 그 턴이 있었는지조차 몰랐다.
 *
 * 실측(도구 버전 2.1.285, 포그라운드·백그라운드 위임 각 1회):
 *   - 페이로드 키 = session_id · transcript_path · cwd · prompt_id · permission_mode · hook_event_name · prompt.
 *   - `prompt_id` 는 같은 턴의 PreToolUse·SubagentStart·서브 도구 이벤트·Stop 과 **같은 값**이다.
 *   - **서브에이전트 안에서는 발화하지 않는다**(agent_id 붙은 UserPromptSubmit 0건).
 *   - 백그라운드 서브의 **완료 알림으로 시작한 턴에도 발화한다**(새 prompt_id · 프롬프트가 `<task-notification>` 으로
 *     시작). 그래서 사람이 친 턴과 가르는 분류 하나(`origin: 'task-notification'`)만 싣는다.
 *
 * ⭐ 게이트가 아니다 — **fail-open.** 무엇도 막지 않고 **stdout 에 아무것도 쓰지 않는다**(UserPromptSubmit 훅의
 *    stdout 은 모델 문맥에 덧붙고, 종료코드 2 는 프롬프트를 막는다 — 계측이 개입이 되면 안 된다). 실패는 stderr 로만.
 * ⭐ **프롬프트 원문은 싣지 않는다**(개인정보·용량). 맨 앞이 알림 태그인지의 분류만 남긴다.
 * ⭐ 판정은 여기서 하지 않는다. 분모·중단 판정은 리포트(`metrics.mjs`)가 한다 — 이 파일은 있었던 사실만 적는다.
 *
 * 사용:
 *   (훅) stdin 으로 UserPromptSubmit 페이로드 JSON 을 받는다 — UserPromptSubmit 에 건다 (matcher 없음)
 *   node skeletons/turn-start.mjs --status   # 활성 확인 — 로그에 turn-start 이벤트가 몇 건·언제까지 있는가
 *
 * 종료코드: 0 항상(훅 경로) · --status 는 turn-start 이벤트가 있으면 0, 없으면 1(미연결 또는 연결 이전)
 */

import { readStdin } from './lib/config.mjs';
import { logEvent, readLog, logPath, extractContext } from './lib/log.mjs';

export const GATE = 'turn-start';

/** 완료 알림으로 시작한 턴의 분류 값 — 계약 어휘는 이 하나뿐이다(`metrics.mjs` 계약 검사). */
export const ORIGIN_TASK_NOTIFICATION = 'task-notification';

/**
 * UserPromptSubmit 페이로드 원문에서 `turn-start` 이벤트를 만든다. 순수 함수 — 이 함수를 테스트한다.
 * 페이로드를 못 읽으면 null(기록할 사실이 없다). `prompt_id` 가 없어도 이벤트는 만든다 — `turn` 이 빠진
 * `turn-start` 는 스키마 계약 검사에서 **위반**으로 드러나야 한다(`turn-end.mjs` 의 stop 과 같은 규약).
 * @param {string} raw
 * @returns {{event:'turn-start', gate:string, session?:string, turn?:string, agent?:string, origin?:string}|null}
 */
export function turnStartEventFrom(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const { session, turn, agent } = extractContext(raw);
  // 맨 앞(공백 뒤)만 본다 — 사람이 문장 중간에 태그를 인용한 것은 알림이 아니다.
  const notification =
    typeof parsed.prompt === 'string' && parsed.prompt.trimStart().startsWith('<task-notification');
  return {
    ...(session ? { session } : {}),
    ...(turn ? { turn } : {}),
    // 실측상 서브 안에서는 발화하지 않지만, 실리면 그대로 남겨 리포트가 메인 턴에서 뺄 수 있게 한다.
    ...(agent ? { agent } : {}),
    event: 'turn-start',
    gate: GATE,
    ...(notification ? { origin: ORIGIN_TASK_NOTIFICATION } : {}),
  };
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--status')) {
    const { events, broken } = readLog();
    const starts = events.filter((e) => e.event === 'turn-start');
    const last = starts[starts.length - 1];
    process.stdout.write(
      starts.length > 0
        ? `[turn-start] 활성 — turn-start 이벤트 ${starts.length}건 · 최근 ${String(last.ts).slice(0, 19)}Z` +
            `${broken > 0 ? ` · 깨진 줄 ${broken}` : ''}  로그: ${logPath()}\n`
        : `[turn-start] turn-start 이벤트 없음 — 훅이 연결되지 않았거나 연결 뒤 프롬프트가 들어온 적이 없습니다.\n` +
            `  리포트는 이 상태를 '턴 시작 미관찰' 로 표기하고 분모를 게이트 이벤트로 셉니다.` +
            ` UserPromptSubmit 훅에 이 파일을 걸고 대화형 세션에서 프롬프트를 하나 보내 보세요.  로그: ${logPath()}\n`,
    );
    process.exit(starts.length > 0 ? 0 : 1);
  }

  const ev = turnStartEventFrom(readStdin());
  if (!ev) {
    // 사실이 없으면 적지 않는다. 다만 조용히는 아니다 — 페이로드 형식이 바뀌면 여기서 보인다(stderr 만).
    process.stderr.write(`[turn-start] UserPromptSubmit 페이로드를 읽지 못했습니다 — 기록 없음 (프롬프트를 막지는 않습니다)\n`);
    process.exit(0);
  }
  logEvent(ev);
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('turn-start.mjs')) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`[turn-start] 훅이 동작하지 않았습니다: ${e.message} (프롬프트를 막지는 않습니다)\n`);
    process.exit(0);
  }
}
