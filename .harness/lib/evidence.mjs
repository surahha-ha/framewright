/**
 * 골격 6 — 품질 사이클의 첫 코드 조각: **완료 전 증거 확인** (`docs/01-skeletons.md` §6 · `docs/13` §2 `evidence`).
 *
 * 턴이 "끝났다" 고 하기 전에 두 가지를 기계로 본다.
 *   ① **변경 유형별 필수 증거** — 이 턴에 바뀐 것의 유형마다, 슬롯이 정한 실행 증거가 있는가.
 *   ② **마지막 변경 뒤 실행** — 그 증거 실행이 마지막 변경보다 **뒤**에 시작됐는가.
 *      편집 뒤에 다시 돌리지 않은 실행은 지금 상태의 증거가 아니다.
 *
 * 유형도 증거도 이 파일에 없다. 전부 `harness.config.mjs` 의 `qualityCycle.evidence` 에서 온다 — 이 파일은
 * **판정 구조**만 갖는다.
 *
 * ⭐ 새 훅을 걸지 않는다. 이미 걸려 있는 두 실행 지점이 이 파일을 부른다.
 *    · 실행 후 훅(`danger-guard.mjs --post`) — 실행된 명령을 슬롯 패턴에 대고 분류해 **식별자만** 남긴다(`evidence` 이벤트).
 *    · 턴 종료 훅(`turn-end.mjs`) — 작업 트리를 훑어 판정하고 수치만 남긴다(`audit` · gate `done-evidence`).
 * ⭐ 파일 편집 이벤트는 로그에 없다(게이트 훅의 matcher 는 셸뿐이다). 그래서 "마지막 변경 시각" 은 편집 도구를
 *    관찰하지 않고 **턴 종료 시점의 작업 트리**에서 읽는다 — git 이 변경됐다고 하는 파일의 수정 시각(mtime).
 *    편집 도구·셸·서브에이전트 어느 길로 고쳤든 같은 자로 재진다.
 * ⭐ 기본은 **관찰**이다(`mode` 생략 = `observe`). 아무것도 막지 않고 리포트 줄에만 얹힌다. 막기는 `mode: 'block'`
 *    을 적었을 때만, 턴당 한 번.
 *
 * ⚠️ 한계 — 이 판정이 말하는 것은 "증거 명령이 마지막 변경 뒤에 **실행됐다**" 까지다.
 *    · **그린이었는지는 모른다.** 종료코드는 훅 페이로드에 없다(`docs/16` §5.1 실측). 실행 ≠ 통과.
 *    · **충분한지는 모른다.** 그 증거가 바뀐 곳을 실제로 덮는지, 빠진 상태 조합이 없는지는 보지 않는다.
 *    · 작업 트리 밖의 변경(대화로만 건넨 산출물 · 다른 저장소 · 외부에 게시한 것 · 데이터)은 보이지 않는다.
 *    · 삭제는 시각이 없어 잡지 않는다. 브랜치 전환·받아오기·병합처럼 **깨끗한 트리에서 파일을 다시 쓰는 조작은
 *      변경으로 세지 않는다**(놓치는 쪽) — 후보가 "git 이 변경됐다고 하는 파일 + 턴 시작 뒤의 (병합 아닌) 커밋이
 *      건드린 파일" 이라, 다시 쓰이기만 한 파일은 수정 시각이 새것이어도 후보에 오르지 않는다.
 *    · 턴 시작 훅이 없으면 턴의 시작을 첫 셸 명령으로 잡는다 — 그 앞의 편집은 보이지 않는다(놓치는 쪽).
 *    · 한 호출에 "변경 && 증거" 를 이으면 실행의 시작이 변경보다 앞으로 재져 "편집 뒤 미실행" 이 된다(엄격한 쪽).
 *    · 패턴 판정이라 인용부호·메시지 안의 같은 문자열도 걸린다 — 패턴을 명령 위치에 고정하는 것은 슬롯을 쓰는 쪽의 몫이다.
 */

import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { compile, CONFIG_NAME } from './config.mjs';
import { extractContext, LOG_DIR } from './log.mjs';

export const GATE = 'done-evidence';

/** 슬롯 이름 — 메시지가 "어디를 고치면 되는가" 를 가리킬 때 쓴다. */
export const SLOT_PATH = 'qualityCycle.evidence';

/** 유형·증거 식별자의 꼴. 로그에는 이것만 실린다 — 원문이 식별자 자리에 섞여 들어올 틈을 꼴로 막는다. */
export const EVIDENCE_ID = /^[A-Za-z][\w.-]*$/;

const MODES = ['observe', 'block'];

/**
 * 작업 트리 스캔(git 호출 전부를 합친 것)의 제한 시간 기본값(ms). 슬롯의 `scanTimeoutMs` 로 바꾼다.
 * 환경의 훅 타임아웃보다 **짧아야** 한다 — 훅이 먼저 죽으면 판정 불가조차 기록하지 못한다.
 */
export const SCAN_TIMEOUT_MS = 5000;

const isId = (v) => typeof v === 'string' && EVIDENCE_ID.test(v);

/**
 * 패턴이 문자열에 걸리는가. `g`·`y` 플래그가 붙은 정규식은 `test` 가 앞 호출의 위치(`lastIndex`)를 기억해
 * 다음 파일·명령을 건너뛴다 — 매번 처음부터 맞춘다. 슬롯 패턴은 전부 이 함수로만 댄다.
 */
const hit = (re, s) => {
  re.lastIndex = 0;
  return re.test(s);
};

/** 패턴 목록을 정규식으로. 하나라도 깨졌으면 null — 절반만 읽은 목록으로 판정하지 않는다. */
function compileAll(list) {
  const out = [];
  for (const p of list) {
    const c = compile(p);
    if (c.error) return null;
    out.push(c.re);
  }
  return out;
}

/**
 * 슬롯을 읽는다. 순수 함수 — 이 함수 자체를 테스트한다.
 *
 * ⭐ **잘못 채운 항목을 "끄기" 로 읽지 않는다.** 못 읽은 유형은 **통째로** 판정에서 빼고 이유를 돌려준다 —
 *    절반만 읽은 유형(증거 하나가 빠진 채)으로 "충족" 을 내면 오차가 느슨한 쪽으로 난다.
 *    이유에는 자리(몇 번째 항목)와 필드 이름만 담는다. 값은 옮기지 않는다.
 * ⭐ 못 읽은 `mode` 는 차단으로 추측하지 않는다 — 관찰로 두고 못 읽었다고 말한다.
 * ⭐ "꺼짐"(`configured: false`)은 **비워 둔 것**뿐이다 — 슬롯이 없음 · `types` 가 없거나 빈 배열. 무언가 적었는데
 *    꼴이 틀린 것(슬롯이 객체가 아님 · `types` 가 배열이 아님 · 배열이어야 할 필드에 다른 것)은 "설정됐는데 못 읽음" 이다.
 *
 * @returns {{
 *   configured: boolean,
 *   mode: 'observe'|'block',
 *   scanTimeoutMs: number,
 *   types: {id:string, what:string, files:RegExp[], changeCommands:RegExp[], evidence:{id:string, what:string, re:RegExp}[]}[],
 *   rejected: string[]
 * }}
 */
export function evidenceSlot(config) {
  const raw = config && config.qualityCycle && config.qualityCycle.evidence;
  const off = { configured: false, mode: 'observe', scanTimeoutMs: SCAN_TIMEOUT_MS, types: [], rejected: [] };
  if (!raw) return off;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...off, configured: true, rejected: [`${SLOT_PATH} — 객체가 아닙니다 ({ mode, types } 꼴이어야 합니다)`] };
  }
  if (raw.types === undefined || raw.types === null) return off;
  if (!Array.isArray(raw.types)) {
    return { ...off, configured: true, rejected: ['types — 배열이 아닙니다 (유형 객체의 배열이어야 합니다)'] };
  }
  const list = raw.types;
  if (list.length === 0) return off;

  const rejected = [];
  let mode = 'observe';
  if (raw.mode !== undefined && raw.mode !== null) {
    if (MODES.includes(raw.mode)) mode = raw.mode;
    else rejected.push(`mode — 알 수 없는 값입니다 (${MODES.join(' | ')} 중 하나). 관찰로 동작합니다`);
  }
  let scanTimeoutMs = SCAN_TIMEOUT_MS;
  if (raw.scanTimeoutMs !== undefined && raw.scanTimeoutMs !== null) {
    if (typeof raw.scanTimeoutMs === 'number' && Number.isFinite(raw.scanTimeoutMs) && raw.scanTimeoutMs > 0) {
      scanTimeoutMs = raw.scanTimeoutMs;
    } else {
      rejected.push(`scanTimeoutMs — 0 보다 큰 수(ms)가 아닙니다. 기본값(${SCAN_TIMEOUT_MS})으로 동작합니다`);
    }
  }

  const types = [];
  const seen = new Set();
  /** 적지 않은 목록은 빈 목록이다. 적었는데 배열이 아니면 null — 조용히 빈 목록으로 읽지 않는다. */
  const listOf = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : null);
  list.forEach((t, i) => {
    const where = `types[${i}]`;
    const reject = (why) => rejected.push(`${where} — ${why}`);
    if (!t || typeof t !== 'object') return reject('객체가 아닙니다');
    if (!isId(t.id)) return reject('id 가 없거나 식별자 꼴이 아닙니다 (영문자로 시작 · 영숫자 . _ - 만)');
    if (seen.has(t.id)) return reject('id 가 앞 항목과 겹칩니다');
    const fileList = listOf(t.files);
    if (!fileList) return reject('files 가 배열이 아닙니다 (패턴 하나여도 [ ] 로 감쌉니다)');
    const commandList = listOf(t.changeCommands);
    if (!commandList) return reject('changeCommands 가 배열이 아닙니다 (패턴 하나여도 [ ] 로 감쌉니다)');
    if (fileList.length + commandList.length === 0) {
      return reject('files 와 changeCommands 가 모두 비어 있습니다 — 무엇이 바뀌면 이 유형인지 알 수 없습니다');
    }
    const files = compileAll(fileList);
    if (!files) return reject('files 에 읽을 수 없는 패턴이 있습니다 (정규식 리터럴을 권합니다)');
    const changeCommands = compileAll(commandList);
    if (!changeCommands) return reject('changeCommands 에 읽을 수 없는 패턴이 있습니다 (정규식 리터럴을 권합니다)');
    const evList = listOf(t.evidence);
    if (!evList) return reject('evidence 가 배열이 아닙니다 (증거 하나여도 [ ] 로 감쌉니다)');
    if (evList.length === 0) return reject('evidence 가 비어 있습니다 — 필수 증거가 없는 유형은 판정할 것이 없습니다');
    const evidence = [];
    const evSeen = new Set();
    for (const [j, e] of evList.entries()) {
      const at = `evidence[${j}]`;
      if (!e || typeof e !== 'object' || !isId(e.id)) return reject(`${at} 의 id 가 없거나 식별자 꼴이 아닙니다`);
      if (evSeen.has(e.id)) return reject(`${at} 의 id 가 같은 유형 안에서 겹칩니다`);
      const c = compile(e.pattern);
      if (c.error) return reject(`${at} 의 pattern 을 읽을 수 없습니다 (정규식 리터럴을 권합니다)`);
      evSeen.add(e.id);
      evidence.push({ id: e.id, what: typeof e.what === 'string' && e.what.trim() ? e.what.trim() : e.id, re: c.re });
    }
    seen.add(t.id);
    types.push({
      id: t.id,
      what: typeof t.what === 'string' && t.what.trim() ? t.what.trim() : t.id,
      files,
      changeCommands,
      evidence,
    });
  });

  return { configured: true, mode, scanTimeoutMs, types, rejected };
}

/**
 * 실행 후 훅 페이로드 한 건에서 `evidence` 이벤트들을 만든다. 순수 함수.
 *
 * 분류는 **여기서(명령 원문이 보이는 유일한 자리)** 하고, 로그에는 유형·증거의 **식별자만** 남긴다 —
 * 원문을 저장하지 않는다(`docs/13` §3). 접두사 정규화(`cmdPrefix`)로는 이 분류를 할 수 없다:
 * 디렉토리 이동을 앞세운 명령이 전부 같은 접두사로 뭉친다.
 *
 * - 유형의 `changeCommands` 에 걸리면 `{ change }` — 파일로 남지 않는 변경을 만든 명령이 실행됐다.
 * - 유형의 `evidence[].pattern` 에 걸리면 `{ change, run }` — 그 유형의 증거가 실행됐다.
 *   중단된 실행(`tool_response.interrupted`)은 증거로 남기지 않는다. 변경 쪽은 중단돼도 남긴다(이미 바꿨을 수 있다).
 * - 페이로드를 못 읽으면 빈 배열 — 원문 전체를 훑어 추정하지 않는다(가드와 달리 놓치는 쪽이 안전한 자리다).
 *
 * @param {string} raw 실행 후 훅 stdin 원문
 * @param {ReturnType<typeof evidenceSlot>} slot
 * @returns {object[]}
 */
export function evidenceEventsFromPost(raw, slot) {
  if (!slot || slot.types.length === 0) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const command = parsed?.tool_input?.command;
  if (typeof command !== 'string' || !command.trim()) return [];
  const interrupted = parsed?.tool_response?.interrupted === true;
  const context = extractContext(raw);
  const base = { ...context, event: 'evidence', gate: GATE };
  const out = [];
  for (const t of slot.types) {
    if (t.changeCommands.some((re) => hit(re, command))) out.push({ ...base, change: t.id });
    if (interrupted) continue;
    for (const e of t.evidence) if (hit(e.re, command)) out.push({ ...base, change: t.id, run: e.id });
  }
  return out;
}

/**
 * 그 턴이 시작된 시각(ms). 순수 함수.
 * 턴 시작 이벤트(`turn-start`)가 있으면 그것, 없으면 그 턴의 가장 이른 이벤트. 둘 다 없으면 null —
 * 턴의 시작을 모르면 "이 턴에 바뀐 것" 을 가를 수 없고, 그때는 판정하지 않는다(추정하지 않는다).
 *
 * ⭐ 턴 종료 훅이 스스로 남기는 기록(`stop` · `audit`)은 "가장 이른 이벤트" 후보가 아니다 — 턴의 끝에 적히는 것이고,
 *    턴 종료 훅은 stop 을 판정보다 먼저 적는다. 그것을 시작으로 읽으면 턴 시작이 "지금" 이 된다.
 * ⚠️ 폴백(가장 이른 이벤트)은 사실상 그 턴의 **첫 셸 명령** 시각이다 — 그 앞의 편집은 보이지 않는다(한계).
 */
export function turnStartMs(events, turn) {
  if (!turn) return null;
  let earliest = null;
  for (const e of events) {
    if (!e || e.turn !== turn) continue;
    const ms = Date.parse(e.ts);
    if (!Number.isFinite(ms)) continue;
    if (e.event === 'turn-start' && !e.agent) return ms;
    if (e.event === 'stop' || e.event === 'audit') continue;
    if (earliest === null || ms < earliest) earliest = ms;
  }
  return earliest;
}

/**
 * 판정. 순수 함수 — 이 함수 자체를 테스트한다.
 *
 * 유형이 "이 턴에 바뀌었다" = 바뀐 파일 중 `files` 에 걸리는 것이 있거나, 턴 시작 뒤에 `changeCommands` 명령이 실행됐다.
 * 그 유형의 **마지막 변경 시각** = 걸린 파일의 수정 시각과 변경 명령의 시각 중 가장 늦은 것.
 * 필수 증거마다: 턴 시작 뒤 실행이 없으면 `missing` · 가장 늦은 실행의 **시작**이 마지막 변경보다 뒤면 `fresh` · 아니면 `stale`.
 *
 * ⭐ 실행의 시각은 **시작 시각**으로 잰다 — 도는 동안 편집이 끼어들면 그 실행은 편집 전 상태를 본 것이다.
 *    실행 후 훅은 끝난 시각에 기록하므로, 같은 호출(`call`)의 실행 전 기록(`pass`·`fire`)이 있으면 그 시각을 쓴다.
 *    없으면 실행 후 시각으로 잰다(근사 — 느슨한 쪽 오차라 한계에 적는다).
 * ⭐ 누가 돌렸는지(메인·서브에이전트·다른 세션)는 가리지 않는다. 증거는 **작업 트리에 대한 사실**이다 —
 *    마지막 변경 뒤에 그 명령이 이 트리에서 실행됐는가. 위임만 하는 메인의 턴이 전부 "증거 없음" 이 되지 않게 한다.
 *
 * @param {{
 *   slot: ReturnType<typeof evidenceSlot>,
 *   files: {path:string, mtimeMs:number}[],   // 이 턴에 바뀐 파일 (`scanChanged` 의 산출)
 *   events: object[],                          // 로그 이벤트
 *   sinceMs: number                            // 턴 시작 시각
 * }} input
 * @returns {{
 *   types: {id:string, what:string, requires:{id:string, what:string, status:'fresh'|'stale'|'missing'}[]}[],
 *   counts: {types:number, required:number, fresh:number, stale:number, missing:number}
 * }}
 */
export function judge({ slot, files, events, sinceMs }) {
  const startByCall = new Map(); // call → 실행 전 기록의 시각
  for (const e of events) {
    if (!e || !e.call || (e.event !== 'pass' && e.event !== 'fire')) continue;
    const ms = Date.parse(e.ts);
    if (Number.isFinite(ms)) startByCall.set(e.call, ms);
  }
  const changedAt = new Map(); // 유형 id → 가장 늦은 변경 명령 시각
  const ranAt = new Map(); // `${유형 id}\n${증거 id}` → 가장 늦은 실행 시작 시각
  const later = (map, key, ms) => {
    if (!map.has(key) || ms > map.get(key)) map.set(key, ms);
  };
  for (const e of events) {
    if (!e || e.event !== 'evidence' || e.gate !== GATE || typeof e.change !== 'string') continue;
    const ms = Date.parse(e.ts);
    if (!Number.isFinite(ms) || ms < sinceMs) continue;
    if (typeof e.run === 'string') {
      const started = e.call && startByCall.has(e.call) ? startByCall.get(e.call) : ms;
      later(ranAt, `${e.change}\n${e.run}`, started);
    } else {
      later(changedAt, e.change, ms);
    }
  }

  const verdict = { types: [], counts: { types: 0, required: 0, fresh: 0, stale: 0, missing: 0 } };
  for (const t of slot.types) {
    let lastChange = changedAt.has(t.id) ? changedAt.get(t.id) : null;
    for (const f of files) {
      if (!t.files.some((re) => hit(re, f.path))) continue;
      if (lastChange === null || f.mtimeMs > lastChange) lastChange = f.mtimeMs;
    }
    if (lastChange === null) continue; // 이 턴에 이 유형의 변경이 없다 — 필요한 증거도 없다
    const requires = t.evidence.map((e) => {
      const started = ranAt.get(`${t.id}\n${e.id}`);
      const status = started === undefined ? 'missing' : started > lastChange ? 'fresh' : 'stale';
      verdict.counts[status]++;
      return { id: e.id, what: e.what, status };
    });
    verdict.counts.types++;
    verdict.counts.required += requires.length;
    verdict.types.push({ id: t.id, what: t.what, requires });
  }
  return verdict;
}

/**
 * 막을 것인가. 순수 함수.
 *
 * 막는 조건은 넷이 전부 참일 때뿐이다 — ①슬롯이 `mode: 'block'` ②미충족이 있다 ③이 턴에서 아직 막은 적이 없다
 * (턴당 한 번. 두 번째에는 사정을 보고에 적고 끝내게 둔다) ④증거 실행이 로그에 한 번이라도
 * 관찰됐다. ④가 없으면 실행 후 훅이 연결됐는지 알 수 없고, 연결이 안 된 곳에서 막으면 모든 턴이 막힌다
 * (설정 ≠ 연결). 그때는 막지 않고 이유를 돌려준다.
 *
 * ⭐ ③은 **둘 중 하나만 성립해도** 막지 않는다 — 환경이 준 `stop_hook_active`, 또는 로그에 남은 같은 턴의 보류 기록
 *    (`audit` · gate `done-evidence` · `blocked` 1). 환경의 필드 하나에만 기대면 그 필드가 오지 않는 곳에서 같은 턴이
 *    끝없이 보류된다. 보류 기록은 이 훅이 스스로 남기는 것이라 환경에 기대지 않는다.
 *
 * @param {{slot: object, verdict: object, stopHookActive: boolean, events: object[], turn?: string}} input
 * @returns {{block: boolean, withheld?: string}}
 */
export function shouldBlock({ slot, verdict, stopHookActive, events, turn }) {
  if (!slot || slot.mode !== 'block') return { block: false };
  if (verdict.counts.stale + verdict.counts.missing === 0) return { block: false };
  if (stopHookActive) return { block: false };
  const heldBefore =
    Boolean(turn) &&
    events.some((e) => e && e.event === 'audit' && e.gate === GATE && e.turn === turn && !e.agent && e.blocked > 0);
  if (heldBefore) return { block: false };
  const observed = events.some((e) => e && e.event === 'evidence' && e.gate === GATE && typeof e.run === 'string');
  if (!observed) {
    return {
      block: false,
      withheld:
        '증거 실행이 로그에 한 번도 관찰되지 않아 막지 않았습니다 — 실행 후 훅(danger-guard.mjs --post)의 연결을 확인하세요(설정 ≠ 연결)',
    };
  }
  return { block: true };
}

/**
 * 차단 사유. 순수 함수 — 문자열만 돌려준다.
 * 게이트 출력 계약(골격 공통 규약 6)의 넷을 담는다 — 판정(완료 보류) · 이유(무엇이 없나) · 다음 행동 · 복구 경로
 * (권하는 길 하나를 앞에, 표가 틀린 경우의 길을 뒤에). 파일 경로·명령 원문은 담지 않는다.
 */
export function blockReason(verdict) {
  const lines = ['완료 보류 — 이 턴에서 바뀐 것에 필요한 실행 증거가 모자랍니다.'];
  for (const t of verdict.types) {
    for (const r of t.requires) {
      if (r.status === 'fresh') continue;
      lines.push(
        `· ${t.what}: ${r.what} — ` +
          (r.status === 'stale' ? '마지막 변경 뒤에 실행되지 않았습니다(편집 뒤 미실행).' : '이 턴에 실행된 적이 없습니다.'),
      );
    }
  }
  lines.push(
    '→ 위 증거를 지금(마지막 변경 뒤에) 다시 실행하고 그 결과로 완료를 보고하세요. ' +
      '실행할 수 없는 사정이 있으면 실행하지 못했다는 사실과 이유를 보고에 적으세요 — 이 확인은 턴당 한 번만 막습니다.',
    `→ 이 변경이 왜 그 유형인지 의문이면 ${CONFIG_NAME} 의 ${SLOT_PATH}.types 를 보고, 표가 틀렸으면 표를 고치세요.`,
  );
  return lines.join('\n');
}

/**
 * 턴 종료 판정의 기록 — `audit` 이벤트(gate `done-evidence`). 순수 함수.
 * 수치만 싣는다(`docs/13` §3 — audit 은 수치 스냅샷). 유형 이름·파일 경로는 싣지 않는다.
 * `rejected` = 못 읽어 판정에서 뺀 슬롯 항목 수 · `blocked` = 이 판정으로 완료를 보류했는가(0|1).
 */
export function evidenceAuditEvent(stopEvent, verdict, slot, blocked) {
  return {
    ...(stopEvent.session ? { session: stopEvent.session } : {}),
    ...(stopEvent.turn ? { turn: stopEvent.turn } : {}),
    event: 'audit',
    gate: GATE,
    types: verdict.counts.types,
    required: verdict.counts.required,
    fresh: verdict.counts.fresh,
    stale: verdict.counts.stale,
    missing: verdict.counts.missing,
    rejected: slot.rejected.length,
    blocked: blocked ? 1 : 0,
  };
}

/**
 * 판정하지 **못한** 턴의 기록 — 작업 트리를 읽지 못했다(git 이 제한 시간 안에 답하지 않음 · git 저장소가 아님 등). 순수 함수.
 * 유형 수·충족 수를 0 으로 적지 않는다 — 0 은 "이 턴에 유형에 드는 변경이 없었다" 는 **잰 결과**이고, 못 잰 것과 다르다.
 * `failed: 1` 과 못 읽은 슬롯 항목 수만 싣는다. 리포트가 이것을 "판정 불가" 로 따로 센다.
 */
export function evidenceUnjudgedEvent(stopEvent, slot) {
  return {
    ...(stopEvent.session ? { session: stopEvent.session } : {}),
    ...(stopEvent.turn ? { turn: stopEvent.turn } : {}),
    event: 'audit',
    gate: GATE,
    failed: 1,
    rejected: slot.rejected.length,
    blocked: 0,
  };
}

/** 경로 표기를 '/' 로 통일한다 — 슬롯 패턴이 OS 마다 갈리면 유형이 조용히 안 걸린다. */
const norm = (p) => String(p).replace(/\\/g, '/');

/** 하네스가 스스로 덧붙이는 기록 파일(로그·승격 레코드) — 모든 훅이 쓰므로 언제나 가장 새것이다. 변경으로 세지 않는다. */
const isOwnRecord = (rel) => rel.startsWith(`${LOG_DIR}/`) && rel.endsWith('.jsonl') && !rel.slice(LOG_DIR.length + 1).includes('/');

/**
 * git 을 한 번 부른다. `deadline`(epoch ms)까지 남은 시간만 기다린다 — 넘기면 던진다(빈 결과로 둔갑시키지 않는다).
 * 느리거나 멈춘 git 이 턴 종료 훅을 환경의 훅 타임아웃까지 붙잡지 않게 하려는 것이다.
 */
function git(root, args, deadline) {
  const left = deadline - Date.now();
  const timedOut = () => new Error('git 이 제한 시간 안에 답하지 않았습니다 (qualityCycle.evidence.scanTimeoutMs)');
  if (left <= 0) throw timedOut();
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      timeout: left,
      windowsHide: true,
    });
  } catch (e) {
    if (e && e.code === 'ETIMEDOUT') throw timedOut();
    throw e;
  }
}

/**
 * 이 턴에 바뀐 파일과 그 수정 시각을 작업 트리에서 읽는다 (I/O).
 *
 * 후보 = git 이 변경됐다고 하는 파일(수정·추가·미추적) + 턴 시작 뒤에 만들어진 커밋이 건드린 파일
 * (이 턴에 고치고 커밋까지 하면 작업 트리는 깨끗해진다). 그중 **수정 시각이 턴 시작 이후**인 것만 남긴다 —
 * 이전 턴에 고친 채 커밋하지 않은 파일은 이 턴의 변경이 아니다.
 *
 * ⚠️ 삭제된 파일은 시각이 없어 빠진다. 무시 목록(.gitignore)의 파일과 저장소 밖은 보이지 않는다.
 *    깨끗한 트리에서 다시 쓰이기만 한 파일(브랜치 전환·받아오기·병합)은 후보가 아니라 빠진다 — 병합 커밋은
 *    `git log --name-only` 가 파일을 내지 않는다.
 *    git 저장소가 아니거나 git 이 제한 시간(`timeoutMs` — git 호출 전부를 합친 것) 안에 답하지 않으면 던진다 —
 *    빈 목록으로 둔갑시키지 않는다(호출부가 판정 불가로 넘어간다).
 *
 * @param {string} root 프로젝트 루트
 * @param {number} sinceMs 턴 시작 시각
 * @param {{timeoutMs?: number}} [opts]
 * @returns {{path:string, mtimeMs:number}[]} 경로는 프로젝트 루트 기준 · '/' 표기
 */
export function scanChanged(root, sinceMs, { timeoutMs = SCAN_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  const candidates = new Set();
  // -z: 공백·비ASCII 경로가 인용되지 않는다. 이름 바꾸기(R·C)는 다음 필드가 원래 경로라 건너뛴다.
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], deadline).split('\0');
  for (let i = 0; i < status.length; i++) {
    const entry = status[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    candidates.add(entry.slice(3));
    if (xy.includes('R') || xy.includes('C')) i++;
  }
  try {
    const since = new Date(sinceMs).toISOString();
    const committed = git(root, ['log', `--since=${since}`, '--name-only', '--pretty=format:', '-z'], deadline);
    for (const p of committed.split(/[\0\n]/)) if (p) candidates.add(p);
  } catch (e) {
    // 제한 시간을 넘긴 것은 삼키지 않는다 — 커밋 쪽 후보를 못 읽은 채 "덜 읽은 목록" 으로 판정하지 않는다.
    if (Date.now() >= deadline) throw e;
    // 그 밖(커밋이 하나도 없는 저장소 등) — 커밋 쪽 후보가 없을 뿐이다. 작업 트리 쪽은 위에서 이미 읽었다.
  }

  // git 은 경로를 **저장소 최상위 기준**으로 준다. 프로젝트 루트가 그 하위 디렉토리면 그대로 붙였을 때 전부
  // "없는 파일" 이 되어 조용히 빈 목록이 된다 — 최상위까지의 상대 경로(cdup)를 거쳐 프로젝트 루트 기준으로 바꾼다.
  const cdup = git(root, ['rev-parse', '--show-cdup'], deadline).trim();
  const found = [];
  for (const raw of candidates) {
    const abs = path.join(root, cdup, raw);
    const rel = norm(path.relative(root, abs));
    // 프로젝트 루트 밖 — 슬롯의 관할이 아니다. ('..' 로 시작하는 **이름**의 루트 파일은 밖이 아니다 — 디렉토리 '..' 만 가린다.)
    if (!rel || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) continue;
    if (isOwnRecord(rel)) continue;
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue; // 삭제됨 — 시각이 없다
    }
    if (!st.isFile()) continue;
    if (st.mtimeMs >= sinceMs) found.push({ path: rel, mtimeMs: st.mtimeMs });
  }
  return found;
}

/**
 * 활성 확인 줄(들). 순수 함수 — 문자열 배열.
 * "설정됨" 과 "동작함" 을 가른다(골격 공통 규약 4): 슬롯이 읽히는가 · 증거 실행이 관찰된 적 있는가(실행 후 훅 연결) ·
 * 턴 종료 판정이 남은 적 있는가(턴 종료 훅 연결).
 */
export function statusLines(slot, events) {
  if (!slot.configured) {
    return [
      `[${GATE}] 꺼짐 — ${SLOT_PATH}.types 가 비어 있습니다 (아직 안 정함 — 아무것도 판정하지 않습니다)`,
    ];
  }
  const lines = [];
  const required = slot.types.reduce((n, t) => n + t.evidence.length, 0);
  const runs = events.filter((e) => e.event === 'evidence' && e.gate === GATE && typeof e.run === 'string').length;
  const audits = events.filter((e) => e.event === 'audit' && e.gate === GATE);
  const last = audits[audits.length - 1];
  lines.push(
    slot.types.length > 0
      ? `[${GATE}] 설정됨(${slot.mode === 'block' ? '차단' : '관찰'}) — 유형 ${slot.types.length} · 필수 증거 ${required}` +
          ` · 증거 실행 관찰 ${runs}건 · 턴 종료 판정 ${audits.length}건` +
          (last ? `(최근 ${String(last.ts).slice(0, 19)}Z)` : '')
      : `[${GATE}] 설정됨 · 읽을 수 있는 유형 0 — 아무것도 판정하지 않습니다 ('꺼짐' 이 아니라 '못 읽음' 입니다)`,
  );
  if (slot.types.length > 0 && runs === 0) {
    lines.push(
      `  증거 실행 관찰 0 — 실행 후 훅(danger-guard.mjs --post)이 연결됐는지, 패턴이 실제 명령에 걸리는지 확인하세요. 이 상태에서는 차단 모드여도 막지 않습니다.`,
    );
  }
  if (slot.types.length > 0 && audits.length === 0) {
    lines.push(`  턴 종료 판정 0 — 턴 종료 훅(turn-end.mjs)이 연결된 뒤 끝난 턴이 아직 없습니다.`);
  }
  if (slot.types.length > 0 && !events.some((e) => e.event === 'turn-start')) {
    lines.push(
      `  턴 시작 관찰 0 — 턴 시작 훅(turn-start.mjs)이 없으면 턴의 시작을 첫 셸 명령으로 잡습니다. 첫 셸 명령 앞의 편집은 보이지 않습니다(판정이 과소).`,
    );
  }
  for (const why of slot.rejected) lines.push(`  ⚠️ 못 읽은 항목: ${why}`);
  return lines;
}
