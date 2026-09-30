/**
 * 턴 종료 훅의 테스트 (docs/16 §5 기준 3).
 *
 * 여기서 지키는 계약: **stdout 에 아무것도 쓰지 않는다**(Stop 훅의 stdout 은 종료를 막는 프로토콜 —
 * 계측이 개입이 되면 안 된다), **항상 0 으로 끝난다**(fail-open), **열쇠가 빠진 stop 도 기록된다**
 * (조용히 버리면 "훅 안 돎" 과 "환경이 열쇠를 안 줌" 이 똑같이 보인다).
 *
 * 실행: node --test skeletons/turn-end.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopEventFrom, GATE } from './turn-end.mjs';
import { readLog, logEvent } from './lib/log.mjs';

const HOOK = fileURLToPath(new URL('./turn-end.mjs', import.meta.url));
const run = (root, stdin, args = []) =>
  spawnSync(process.execPath, [HOOK, ...args], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_ROOT: root, CLAUDE_PROJECT_DIR: '' },
  });
const fresh = () => mkdtempSync(path.join(tmpdir(), 'harness-stop-'));
const payload = (o = {}) =>
  JSON.stringify({
    session_id: 's-1',
    prompt_id: 'p-1',
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'done',
    ...o,
  });

test('⭐ Stop 페이로드 → stop 이벤트: session·turn 만 싣고 그 외(마지막 메시지 등)는 싣지 않는다', () => {
  assert.deepEqual(stopEventFrom(payload()), { session: 's-1', turn: 'p-1', event: 'stop', gate: GATE });
  const ev = stopEventFrom(payload({ last_assistant_message: '/home/someone/secret' }));
  assert.ok(!JSON.stringify(ev).includes('secret'), '대화 내용은 로그 대상이 아니다');
});

test('⭐ prompt_id 가 없어도 이벤트는 만든다 — 빠진 turn 은 계약 검사가 위반으로 드러내야 한다', () => {
  assert.deepEqual(stopEventFrom(JSON.stringify({ session_id: 's-1' })), { session: 's-1', event: 'stop', gate: GATE });
});

test('⭐ 서브에이전트 안에서 온 페이로드(SubagentStop 에 잘못 건 경우)면 stop 에 agent 가 실린다 — 리포트가 메인 판정에서 뺄 수 있게', () => {
  assert.deepEqual(stopEventFrom(payload({ hook_event_name: 'SubagentStop', agent_id: 'abc123' })), {
    session: 's-1',
    turn: 'p-1',
    agent: 'abc123',
    event: 'stop',
    gate: GATE,
  });
});

test('페이로드가 JSON 이 아니거나 객체가 아니면 null — 없는 사실은 적지 않는다', () => {
  assert.equal(stopEventFrom(''), null);
  assert.equal(stopEventFrom('{broken'), null);
  assert.equal(stopEventFrom('"just a string"'), null);
  assert.equal(stopEventFrom('null'), null);
});

test('⭐ 훅 경로 — 로그에 한 줄 append, stdout 은 비어 있고, 종료코드 0', () => {
  const root = fresh();
  const r = run(root, payload());
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', 'Stop 훅의 stdout 은 종료를 막는 프로토콜이다 — 계측은 아무것도 쓰지 않는다');
  const { events, broken } = readLog(root);
  assert.equal(broken, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'stop');
  assert.equal(events[0].gate, GATE);
  assert.equal(events[0].turn, 'p-1');
  assert.equal(events[0].session, 's-1');
  assert.ok(events[0].ts);
});

test('⭐ 깨진 페이로드에도 종료코드 0 — stderr 로만 알리고 기록은 없다 (fail-open)', () => {
  const root = fresh();
  const r = run(root, '{broken');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /읽지 못했습니다/);
  assert.equal(existsSync(path.join(root, '.harness', 'log.jsonl')), false);
});

test('--status: stop 이벤트가 없으면 "관찰 없음" 으로 1, 있으면 건수·최근 시각으로 0', () => {
  const root = fresh();
  const none = run(root, '', ['--status']);
  assert.equal(none.status, 1);
  assert.match(none.stdout, /관찰 없음/);
  logEvent({ event: 'stop', gate: GATE, session: 's', turn: 't' }, root);
  const some = run(root, '', ['--status']);
  assert.equal(some.status, 0);
  assert.match(some.stdout, /활성 — stop 이벤트 1건/);
});

// ── 검증 축 대체 경로 — auditOnStop (docs/16 §5 기준 4) ──────────────────────────────
// 여기서 지키는 계약: **스위치는 enabled 가 아니라 auditOnStop 하나**(이중 게이트·거짓 활성 없이 시계열만),
// **audit 은 stop 과 같은 식별자를 싣는다**, **꺼져 있으면 audit 을 남기지 않는다**(미수집은 미수집으로).

import { writeFileSync, mkdirSync } from 'node:fs';
import { auditOnStop, auditEventFrom } from './turn-end.mjs';

/** 합성 설치처 — 경계 안 파일 하나(테스트 없음)를 가진 git 저장소 + 설정. */
function siteWith(config) {
  const root = fresh();
  mkdirSync(path.join(root, 'src', 'engine'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'engine', 'calc.ts'), 'export const x = 1;\n', 'utf8');
  writeFileSync(
    path.join(root, 'harness.config.mjs'),
    `export default ${JSON.stringify(config).replace('"__SCOPE__"', '/^src\\/engine\\/.*\\.ts$/')};\n`,
    'utf8',
  );
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '.'], { cwd: root });
  return root;
}
const cfg = (auditOnStopFlag) => ({
  testFirst: {
    enabled: false,
    auditOnStop: auditOnStopFlag,
    scopes: [{ decision: 'deny', pattern: '__SCOPE__', what: '계산' }],
    exempt: [],
  },
});

test('⭐ 스위치는 testFirst.auditOnStop 하나다 — enabled 는 보지 않는다', () => {
  assert.equal(auditOnStop({ testFirst: { enabled: true } }), false);
  assert.equal(auditOnStop({ testFirst: { enabled: false, auditOnStop: true } }), true);
  assert.equal(auditOnStop({}), false);
  assert.equal(auditOnStop(null), false);
});

test('audit 이벤트는 stop 과 같은 session·turn 을 싣고 수치는 --audit 과 같은 다섯 개다', () => {
  const ev = auditEventFrom(
    { session: 's-1', turn: 'p-1', event: 'stop', gate: GATE },
    { total: 10, inScope: 3, missing: 2, deny: 1, ask: 1, list: [{ path: 'x' }] },
  );
  assert.deepEqual(ev, { session: 's-1', turn: 'p-1', event: 'audit', gate: 'test-first', total: 10, inScope: 3, missing: 2, deny: 1, ask: 1 });
  assert.ok(!('list' in ev), '파일 목록(경로 원문)은 로그에 싣지 않는다');
});

test('서브에이전트의 stop 에서 나온 audit 은 같은 agent 를 싣는다 — 메인 검증 축의 시계열에 섞이지 않게', () => {
  const nums = { total: 10, inScope: 3, missing: 2, deny: 1, ask: 1 };
  const sub = auditEventFrom({ session: 's-1', turn: 'p-1', agent: 'abc123', event: 'stop', gate: GATE }, nums);
  assert.equal(sub.agent, 'abc123');
  const main = auditEventFrom({ session: 's-1', turn: 'p-1', event: 'stop', gate: GATE }, nums);
  assert.equal('agent' in main, false);
});

test('⭐ 훅 경로 — auditOnStop:true 면 stop 뒤에 turn 이 실린 audit 이 한 줄 더 남는다', () => {
  const root = siteWith(cfg(true));
  const r = run(root, payload());
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const { events } = readLog(root);
  assert.deepEqual(events.map((e) => e.event), ['stop', 'audit']);
  const a = events[1];
  assert.equal(a.gate, 'test-first');
  assert.equal(a.turn, 'p-1');
  assert.equal(a.session, 's-1');
  assert.equal(a.inScope, 1);
  assert.equal(a.missing, 1);
});

test('⭐ auditOnStop 이 꺼져 있으면 stop 만 남는다 — 검증 축은 미수집으로 남는 것이 정직하다', () => {
  const root = siteWith(cfg(false));
  run(root, payload());
  assert.deepEqual(readLog(root).events.map((e) => e.event), ['stop']);
});

test('설정이 없어도 stop 은 남고 종료코드 0 — 선실측은 있으면 하는 것이지 조건이 아니다', () => {
  const root = fresh();
  const r = run(root, payload());
  assert.equal(r.status, 0);
  assert.deepEqual(readLog(root).events.map((e) => e.event), ['stop']);
});

// ── 골격 6 「완료 전 증거 확인」 — 턴 종료 시점의 판정 (docs/01 §6) ──────────────────────────────
// 여기서 지키는 계약: **기본(관찰)은 stdout 에 아무것도 쓰지 않는다**(기존 계약 그대로 — 미충족이어도 막지 않는다),
// **판정은 수치만 남긴다**, **차단은 mode: 'block' 을 적었을 때만 · 턴당 한 번 · 막은 Stop 은 stop 으로 적지 않는다**
// (턴이 끝나지 않았다), **판정 실패는 stop 기록을 막지 않는다**(fail-open).

import { utimesSync } from 'node:fs';

const EV_GATE = 'done-evidence';
const evConfig = (mode, extra = '', timeoutMs = undefined) => `export default {
  ${extra}
  qualityCycle: { evidence: { ${mode ? `mode: '${mode}',` : ''} ${timeoutMs ? `scanTimeoutMs: ${timeoutMs},` : ''} types: [
    { id: 'code', what: '계산 코드', files: [/^src\\/.*\\.js$/],
      evidence: [{ id: 'unit', pattern: /(^|[;&|(]\\s*)run-tests\\b/, what: '단위 테스트 실행' }] },
  ] } },
};
`;
/**
 * 합성 설치처 — 증거 슬롯이 채워진 git 저장소. 턴 p-1 이 60초 전에 시작했고 30초 전에 src/calc.js 를 고쳤다.
 * `ranAgo`(초)를 주면 그만큼 전에 증거(unit)가 실행된 것으로 적는다 — 40 이면 편집 앞, 10 이면 편집 뒤.
 * `firstShellAgo`(초)는 턴 시작 기록 대신 그 턴의 첫 셸 명령만 남긴다(턴 시작 훅이 없는 설치처).
 * `slowGit`(초)은 상태 조회 때마다 그만큼 걸리는 훅을 돌게 해 git 을 느리게 만든다 · `timeoutMs` 는 스캔 제한 시간.
 */
function evSite({ mode, ranAgo, git = true, start = true, extra = '', firstShellAgo, slowGit, timeoutMs } = {}) {
  const root = fresh();
  const now = Date.now();
  if (git) spawnSync('git', ['init', '-q'], { cwd: root });
  if (slowGit) spawnSync('git', ['config', 'core.fsmonitor', `sleep ${slowGit} #`], { cwd: root });
  writeFileSync(path.join(root, 'harness.config.mjs'), evConfig(mode, extra, timeoutMs), 'utf8');
  mkdirSync(path.join(root, 'src'), { recursive: true });
  const target = path.join(root, 'src', 'calc.js');
  writeFileSync(target, 'export const x = 1;\n', 'utf8');
  utimesSync(target, (now - 30_000) / 1000, (now - 30_000) / 1000);
  if (start) {
    logEvent({ ts: new Date(now - 60_000).toISOString(), event: 'turn-start', gate: 'turn-start', session: 's-1', turn: 'p-1' }, root);
  }
  if (firstShellAgo !== undefined) {
    logEvent(
      { ts: new Date(now - firstShellAgo * 1000).toISOString(), event: 'pass', gate: 'danger-guard', cmdPrefix: 'ls', session: 's-1', turn: 'p-1' },
      root,
    );
  }
  if (ranAgo !== undefined) {
    logEvent(
      { ts: new Date(now - ranAgo * 1000).toISOString(), event: 'evidence', gate: EV_GATE, session: 's-1', turn: 'p-1', change: 'code', run: 'unit' },
      root,
    );
  }
  return root;
}
const evAudit = (root) => readLog(root).events.filter((e) => e.event === 'audit' && e.gate === EV_GATE);
const numbers = ({ types, required, fresh: f, stale, missing, rejected, blocked }) => ({ types, required, fresh: f, stale, missing, rejected, blocked });

test('⭐ 증거(관찰) — 바뀐 유형에 증거 실행이 없으면 "증거 없음" 으로 남고, stdout 은 비어 있고, stop 도 그대로 남는다', () => {
  const root = evSite();
  const r = run(root, payload());
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', '관찰 모드는 미충족이어도 아무것도 막지 않는다');
  const { events } = readLog(root);
  assert.deepEqual(events.map((e) => e.event), ['turn-start', 'stop', 'audit']);
  const [a] = evAudit(root);
  assert.equal(a.turn, 'p-1');
  assert.equal(a.session, 's-1');
  assert.deepEqual(numbers(a), { types: 1, required: 1, fresh: 0, stale: 0, missing: 1, rejected: 0, blocked: 0 });
});

test('⭐ 증거(관찰) — 편집 앞의 실행은 "편집 뒤 미실행", 편집 뒤의 실행은 충족이다', () => {
  const stale = evSite({ ranAgo: 40 });
  assert.equal(run(stale, payload()).stdout, '');
  assert.deepEqual(numbers(evAudit(stale)[0]), { types: 1, required: 1, fresh: 0, stale: 1, missing: 0, rejected: 0, blocked: 0 });
  const met = evSite({ ranAgo: 10 });
  run(met, payload());
  assert.deepEqual(numbers(evAudit(met)[0]), { types: 1, required: 1, fresh: 1, stale: 0, missing: 0, rejected: 0, blocked: 0 });
});

test('⭐ 증거(차단) — 미충족이면 Stop 을 막고 사유를 돌려주며, 그 Stop 은 stop 으로 적지 않는다(턴이 끝나지 않았다)', () => {
  const root = evSite({ mode: 'block', ranAgo: 40 });
  const r = run(root, payload());
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /계산 코드: 단위 테스트 실행 — 마지막 변경 뒤에 실행되지 않았습니다/);
  assert.match(out.reason, /qualityCycle\.evidence\.types/);
  assert.deepEqual(readLog(root).events.map((e) => e.event), ['turn-start', 'evidence', 'audit']);
  assert.deepEqual(numbers(evAudit(root)[0]), { types: 1, required: 1, fresh: 0, stale: 1, missing: 0, rejected: 0, blocked: 1 });
});

test('⭐ 증거(차단) — 한 번 막은 뒤의 Stop(stop_hook_active)은 다시 막지 않고 stop 을 적는다 — 턴당 한 번', () => {
  const root = evSite({ mode: 'block', ranAgo: 40 });
  const r = run(root, payload({ stop_hook_active: true }));
  assert.equal(r.stdout, '');
  assert.deepEqual(readLog(root).events.map((e) => e.event), ['turn-start', 'evidence', 'stop', 'audit']);
  assert.equal(evAudit(root)[0].blocked, 0);
  assert.equal(evAudit(root)[0].stale, 1);
});

test('⭐ 증거(차단) — 충족이면 막지 않는다', () => {
  const root = evSite({ mode: 'block', ranAgo: 10 });
  const r = run(root, payload());
  assert.equal(r.stdout, '');
  assert.deepEqual(readLog(root).events.map((e) => e.event), ['turn-start', 'evidence', 'stop', 'audit']);
});

test('⭐ 증거(차단) — 증거 실행이 로그에 한 번도 없으면 막지 않고 stderr 로 연결 확인을 알린다', () => {
  const root = evSite({ mode: 'block' });
  const r = run(root, payload());
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /연결/);
  assert.deepEqual(numbers(evAudit(root)[0]), { types: 1, required: 1, fresh: 0, stale: 0, missing: 1, rejected: 0, blocked: 0 });
  assert.ok(readLog(root).events.some((e) => e.event === 'stop'));
});

test('⭐ 증거 — 잘못 적힌 mode 는 차단으로 추측하지 않는다: 막지 않고, 못 읽은 수가 기록되고, stderr 로 알린다', () => {
  const root = evSite({ mode: 'blok', ranAgo: 40 });
  const r = run(root, payload());
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /mode/);
  assert.equal(evAudit(root)[0].rejected, 1);
  assert.equal(evAudit(root)[0].stale, 1);
});

test('증거 — 턴의 시작을 모르면(턴 시작·그 턴의 이벤트 모두 없음) 판정하지 않는다 — stop 은 남는다', () => {
  const root = evSite({ start: false });
  const r = run(root, payload());
  assert.equal(r.status, 0);
  assert.deepEqual(readLog(root).events.map((e) => e.event), ['stop']);
  assert.match(r.stderr, /턴의 시작/);
});

test('증거 — 서브에이전트의 Stop(잘못 건 경우)에서는 판정하지 않는다 — 완료 주장은 메인 턴의 것이다', () => {
  const root = evSite({ mode: 'block', ranAgo: 40 });
  const r = run(root, payload({ hook_event_name: 'SubagentStop', agent_id: 'abc123' }));
  assert.equal(r.stdout, '');
  assert.deepEqual(evAudit(root), []);
});

/** 판정하지 못한 턴의 기록 — 수치를 지어내지 않고 "못 했다" 만 싣는다. */
const UNJUDGED = { session: 's-1', turn: 'p-1', event: 'audit', gate: EV_GATE, failed: 1, rejected: 0, blocked: 0 };
const withoutTs = (events) => events.map(({ ts: _ts, ...rest }) => rest);

test('⭐ 증거 — git 저장소가 아니어도 stop 은 남고 종료코드 0 이다(fail-open) — 판정 불가로 기록되고 stderr 로 알린다', () => {
  const root = evSite({ git: false, mode: 'block', ranAgo: 40 });
  const r = run(root, payload());
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /done-evidence/);
  assert.deepEqual(readLog(root).events.map((e) => e.event), ['turn-start', 'evidence', 'stop', 'audit']);
  // 수치 0 으로 적으면 "바뀐 것이 없던 턴" 과 구별되지 않는다 — 못 쟀다는 사실만 남긴다.
  assert.deepEqual(withoutTs(evAudit(root)), [UNJUDGED]);
});

test('⭐ 증거(차단) — stop_hook_active 가 오지 않는 환경에서도 턴당 한 번이다: 같은 턴의 두 번째 Stop 은 막지 않고 stop 을 적는다', () => {
  const root = evSite({ mode: 'block', ranAgo: 40 });
  const noFlag = JSON.stringify({ session_id: 's-1', prompt_id: 'p-1', hook_event_name: 'Stop' });
  const first = run(root, noFlag);
  assert.equal(JSON.parse(first.stdout).decision, 'block');
  const second = run(root, noFlag);
  assert.equal(second.status, 0);
  assert.equal(second.stdout, '', '같은 턴을 두 번 보류하지 않는다');
  assert.deepEqual(readLog(root).events.map((e) => e.event), ['turn-start', 'evidence', 'audit', 'stop', 'audit']);
  assert.deepEqual(evAudit(root).map((a) => a.blocked), [1, 0]);
});

/**
 * 환경 확인 — 시험 대상 코드와 무관하게, `slowGit` 으로 만든 저장소의 git 이 실제로 느린가(한 번만 잰다).
 * 느려지지 않는 환경에서는 아래 두 테스트가 아무것도 증명하지 못하므로 건너뛰고 그렇게 말한다.
 */
let slowGitWorks;
function gitCanBeSlowed() {
  if (slowGitWorks === undefined) {
    const probe = spawnSync('git', ['status', '--porcelain'], { cwd: evSite({ slowGit: 6 }), encoding: 'utf8', timeout: 1500 });
    slowGitWorks = Boolean(probe.error && probe.error.code === 'ETIMEDOUT');
  }
  return slowGitWorks;
}
const SLOW_SKIP = '이 환경의 git 은 이 방법으로 느려지지 않는다 — 느린 git 에서의 동작을 검증하지 못했다';

test('⭐ 증거(관찰) — 작업 트리 스캔이 끝나기 전에 훅이 죽어도 stop 은 이미 남아 있다 — 느린 git 이 중단 축을 오염시키지 않는다', (t) => {
  if (!gitCanBeSlowed()) {
    t.skip(SLOW_SKIP);
    return;
  }
  const root = evSite({ slowGit: 6 });
  const r = spawnSync(process.execPath, [HOOK], {
    input: payload(),
    encoding: 'utf8',
    timeout: 2500, // 환경의 훅 타임아웃 노릇 — 스캔 도중에 훅을 죽인다
    env: { ...process.env, HARNESS_ROOT: root, CLAUDE_PROJECT_DIR: '' },
  });
  assert.equal(r.error && r.error.code, 'ETIMEDOUT', '훅이 스캔 도중에 죽어야 이 테스트가 순서를 증명한다');
  assert.deepEqual(readLog(root).events.map((e) => e.event), ['turn-start', 'stop']);
});

test('⭐ 증거(차단) — git 이 제한 시간 안에 답하지 않으면 막지 않고 끝낸다: stop 이 남고 판정 불가가 기록된다', (t) => {
  if (!gitCanBeSlowed()) {
    t.skip(SLOW_SKIP);
    return;
  }
  const root = evSite({ mode: 'block', ranAgo: 40, slowGit: 6, timeoutMs: 400 });
  const started = Date.now();
  const r = run(root, payload());
  const elapsed = Date.now() - started;
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', '못 잰 턴을 막지 않는다');
  assert.match(r.stderr, /제한 시간/);
  assert.deepEqual(readLog(root).events.map((e) => e.event), ['turn-start', 'evidence', 'stop', 'audit']);
  assert.deepEqual(withoutTs(evAudit(root)), [UNJUDGED]);
  assert.ok(elapsed < 5000, `제한 시간(400ms) 뒤에도 ${elapsed}ms 를 붙잡혀 있었다`);
});

test('증거 — 턴 시작 기록이 없으면 그 턴의 가장 이른 이벤트부터로 판정한다(턴 시작 훅이 없는 설치처의 폴백)', () => {
  const root = evSite({ start: false, firstShellAgo: 50 });
  const r = run(root, payload());
  assert.equal(r.status, 0);
  assert.deepEqual(readLog(root).events.map((e) => e.event), ['pass', 'stop', 'audit']);
  assert.deepEqual(numbers(evAudit(root)[0]), { types: 1, required: 1, fresh: 0, stale: 0, missing: 1, rejected: 0, blocked: 0 });
});

test('증거(차단) — 보류된 Stop 에서는 턴 종료 선실측도 남기지 않는다 — 턴이 끝나지 않았다', () => {
  const root = evSite({
    mode: 'block',
    ranAgo: 40,
    extra: `testFirst: { enabled: false, auditOnStop: true, scopes: [{ decision: 'deny', pattern: /^src\\/.*\\.js$/, what: '계산' }], exempt: [] },`,
  });
  spawnSync('git', ['add', '.'], { cwd: root });
  const r = run(root, payload());
  assert.equal(JSON.parse(r.stdout).decision, 'block');
  const { events } = readLog(root);
  assert.deepEqual(events.map((e) => `${e.event}:${e.gate}`), ['turn-start:turn-start', `evidence:${EV_GATE}`, `audit:${EV_GATE}`]);
});

test('증거 — 턴 종료 선실측(auditOnStop)과 함께 켜도 각자 한 줄씩 남는다', () => {
  const root = evSite({
    ranAgo: 10,
    extra: `testFirst: { enabled: false, auditOnStop: true, scopes: [{ decision: 'deny', pattern: /^src\\/.*\\.js$/, what: '계산' }], exempt: [] },`,
  });
  spawnSync('git', ['add', '.'], { cwd: root });
  run(root, payload());
  const audits = readLog(root).events.filter((e) => e.event === 'audit').map((e) => e.gate);
  assert.deepEqual(audits, ['test-first', EV_GATE]);
});

test('--status: 증거 슬롯의 상태가 함께 보인다 — 꺼짐과 설정됨을 가르고, 종료코드는 종전대로 stop 기준이다', () => {
  const off = fresh();
  writeFileSync(path.join(off, 'harness.config.mjs'), 'export default {};\n', 'utf8');
  const a = run(off, '', ['--status']);
  assert.equal(a.status, 1);
  assert.match(a.stdout, /\[done-evidence\] 꺼짐/);
  const on = evSite({ ranAgo: 10 });
  run(on, payload());
  const b = run(on, '', ['--status']);
  assert.equal(b.status, 0);
  assert.match(b.stdout, /\[done-evidence\] 설정됨\(관찰\) — 유형 1 · 필수 증거 1 · 증거 실행 관찰 1건 · 턴 종료 판정 1건/);
});
