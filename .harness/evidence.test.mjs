/**
 * 골격 6 첫 조각 — 「완료 전 증거 확인」 의 테스트 (docs/01 §6 · docs/13 §2 `evidence`).
 *
 * 여기서 지키는 계약:
 *   ① **변경 유형별 필수 증거** — 이 턴에 바뀐 것의 유형마다 슬롯이 정한 실행 증거가 있어야 충족이다.
 *   ② **마지막 변경 뒤 실행** — 증거 실행의 시작이 마지막 변경보다 **뒤**여야 한다. 편집 뒤 재실행 안 한 실행은 증거가 아니다.
 *   ③ **로그에는 식별자만** — 명령 원문·파일 경로는 어디에도 실리지 않는다(docs/13 §3).
 *   ④ **잘못 채운 슬롯은 "끄기" 가 아니다** — 못 읽은 항목은 통째로 판정에서 빠지고 그 수와 이유가 보인다.
 *
 * 값은 전부 합성이다(번역 규율 §5-3).
 *
 * 실행: node --test skeletons/evidence.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GATE,
  evidenceSlot,
  evidenceEventsFromPost,
  turnStartMs,
  judge,
  scanChanged,
  shouldBlock,
  blockReason,
  evidenceAuditEvent,
  statusLines,
  SCAN_TIMEOUT_MS,
} from './lib/evidence.mjs';
import { readLog, logEvent } from './lib/log.mjs';

/** 합성 슬롯 — 구조를 보기 위한 최소값. 파일로 남는 유형 하나, 명령으로만 드러나는 유형 하나. */
const cfg = (over = {}) => ({
  qualityCycle: {
    evidence: {
      types: [
        {
          id: 'code',
          what: '계산 코드',
          files: [/^src\/.*\.js$/],
          evidence: [
            { id: 'unit', pattern: /(^|[;&|(]\s*)run-tests\b/, what: '단위 테스트 실행' },
            { id: 'lint', pattern: /(^|[;&|(]\s*)run-lint\b/, what: '린트 실행' },
          ],
        },
        {
          id: 'tree',
          what: '작업 트리 조작',
          changeCommands: [/(^|[;&|(]\s*)tree-tool\s+add\b/],
          evidence: [{ id: 'list', pattern: /(^|[;&|(]\s*)tree-tool\s+list\b/, what: '작업 트리 목록 확인' }],
        },
      ],
      ...over,
    },
  },
});
const slot = (over) => evidenceSlot(cfg(over));

const T0 = Date.parse('2026-01-10T06:00:00.000Z'); // 턴 시작
const at = (sec) => T0 + sec * 1000;
const iso = (sec) => new Date(at(sec)).toISOString();
const file = (p, sec) => ({ path: p, mtimeMs: at(sec) });
const ran = (sec, change, run, extra = {}) => ({
  ts: iso(sec),
  event: 'evidence',
  gate: GATE,
  change,
  ...(run ? { run } : {}),
  ...extra,
});
const statusOfReq = (verdict, typeId, evId) =>
  verdict.types.find((t) => t.id === typeId).requires.find((r) => r.id === evId).status;

// ── 슬롯 ──────────────────────────────────────────────────────────────────────

test('슬롯이 없거나 유형이 비어 있으면 "아직 안 정함" — 아무것도 판정하지 않는다', () => {
  assert.equal(evidenceSlot(undefined).configured, false);
  assert.equal(evidenceSlot({}).configured, false);
  assert.equal(evidenceSlot({ qualityCycle: { evidence: null } }).configured, false);
  assert.equal(evidenceSlot({ qualityCycle: { evidence: { types: [] } } }).configured, false);
});

test('⭐ 기본 동작은 관찰이다 — mode 를 안 적으면 차단하지 않는다', () => {
  const s = slot();
  assert.equal(s.configured, true);
  assert.equal(s.mode, 'observe');
  assert.equal(s.types.length, 2);
  assert.deepEqual(s.rejected, []);
});

test('mode: block 은 적어야만 켜진다', () => {
  assert.equal(slot({ mode: 'block' }).mode, 'block');
});

test('⭐ 잘못 적힌 mode 는 차단으로 추측하지 않고, 조용히 넘어가지도 않는다 — 관찰로 두고 못 읽었다고 말한다', () => {
  const s = slot({ mode: 'blok' });
  assert.equal(s.mode, 'observe');
  assert.equal(s.rejected.length, 1);
  assert.match(s.rejected[0], /mode/);
});

test('⭐ 잘못 채운 유형은 통째로 판정에서 빠지고 이유가 남는다 — 나머지 유형은 그대로 돈다', () => {
  const ok = { id: 'ok', files: [/^a\//], evidence: [{ id: 'e', pattern: /^go\b/ }] };
  const bad = [
    { files: [/^a\//], evidence: [{ id: 'e', pattern: /^go\b/ }] }, //                 id 없음
    { id: 'has space', files: [/^a\//], evidence: [{ id: 'e', pattern: /^go\b/ }] }, // id 가 식별자 꼴이 아님
    { id: 'ok', files: [/^b\//], evidence: [{ id: 'e', pattern: /^go\b/ }] }, //        id 중복
    { id: 'no-trigger', evidence: [{ id: 'e', pattern: /^go\b/ }] }, //                 files·changeCommands 둘 다 없음
    { id: 'no-evidence', files: [/^a\//] }, //                                          필수 증거 없음
    { id: 'empty-evidence', files: [/^a\//], evidence: [] },
    { id: 'broken-file', files: ['['], evidence: [{ id: 'e', pattern: /^go\b/ }] }, //  깨진 패턴
    { id: 'broken-ev', files: [/^a\//], evidence: [{ id: 'e', pattern: '[' }] },
    { id: 'ev-no-id', files: [/^a\//], evidence: [{ pattern: /^go\b/ }] },
    { id: 'ev-dup', files: [/^a\//], evidence: [{ id: 'e', pattern: /^go\b/ }, { id: 'e', pattern: /^x\b/ }] },
    'not-an-object',
  ];
  const s = evidenceSlot({ qualityCycle: { evidence: { types: [ok, ...bad] } } });
  assert.equal(s.configured, true);
  assert.deepEqual(s.types.map((t) => t.id), ['ok']);
  assert.equal(s.rejected.length, bad.length);
  // 이유는 제 자리(몇 번째 항목)와 제 필드를 가리켜야 한다 — 개수만 맞고 엉뚱한 이유면 고칠 곳을 못 찾는다.
  const why = [
    /id 가 없거나/,
    /id 가 없거나/,
    /id 가 앞 항목과 겹칩니다/,
    /files 와 changeCommands 가 모두 비어/,
    /evidence 가 비어/,
    /evidence 가 비어/,
    /files 에 읽을 수 없는 패턴/,
    /evidence\[0\] 의 pattern/,
    /evidence\[0\] 의 id/,
    /evidence\[1\] 의 id 가 같은 유형 안에서 겹칩니다/,
    /객체가 아닙니다/,
  ];
  s.rejected.forEach((reason, i) => {
    assert.ok(reason.startsWith(`types[${i + 1}] — `), `${i}번째 이유의 자리: ${reason}`);
    assert.match(reason, why[i]);
  });
});

test('⭐ 배열이어야 할 자리에 다른 것을 적으면 조용히 버리지 않는다 — 그 유형을 빼고 어느 필드인지 말한다', () => {
  const ev = [{ id: 'e', pattern: /^go\b/ }];
  const s = evidenceSlot({
    qualityCycle: {
      evidence: {
        types: [
          // files 를 정규식 하나로 적었다. 조용히 버리면 changeCommands 만 남은 "절반만 읽은 유형" 이 된다.
          { id: 'one-regex', files: /^a\//, changeCommands: [/^make-change\b/], evidence: ev },
          { id: 'one-command', files: [/^a\//], changeCommands: /^make-change\b/, evidence: ev },
          { id: 'one-evidence', files: [/^a\//], evidence: ev[0] },
          { id: 'ok', files: [/^a\//], evidence: ev },
        ],
      },
    },
  });
  assert.deepEqual(s.types.map((t) => t.id), ['ok']);
  assert.equal(s.rejected.length, 3);
  assert.match(s.rejected[0], /^types\[0\] — files .*배열/);
  assert.match(s.rejected[1], /^types\[1\] — changeCommands .*배열/);
  assert.match(s.rejected[2], /^types\[2\] — evidence .*배열/);
});

test('⭐ types 나 슬롯 자체를 잘못된 꼴로 적어도 "꺼짐" 이 아니다 — 설정됐는데 못 읽었다고 드러난다', () => {
  const type = { id: 'code', files: [/^a\//], evidence: [{ id: 'e', pattern: /^go\b/ }] };
  const typesAsObject = evidenceSlot({ qualityCycle: { evidence: { types: type } } });
  assert.equal(typesAsObject.configured, true);
  assert.deepEqual(typesAsObject.types, []);
  assert.equal(typesAsObject.rejected.length, 1);
  assert.match(typesAsObject.rejected[0], /^types — .*배열/);
  // 유형 목록을 슬롯 자리에 바로 적었다 · 슬롯 자리에 글자를 적었다.
  for (const wrong of [[type], 'observe']) {
    const s = evidenceSlot({ qualityCycle: { evidence: wrong } });
    assert.equal(s.configured, true);
    assert.deepEqual(s.types, []);
    assert.equal(s.rejected.length, 1);
    assert.match(s.rejected[0], /객체/);
  }
  // 비워 둔 것(아직 안 정함)은 여전히 꺼짐이다 — 못 읽음과 섞지 않는다.
  assert.equal(evidenceSlot({ qualityCycle: { evidence: { mode: 'block' } } }).configured, false);
  assert.equal(evidenceSlot({ qualityCycle: { evidence: { types: null } } }).configured, false);
  assert.equal(evidenceSlot({ qualityCycle: { evidence: false } }).configured, false);
});

test('스캔 제한 시간 — 안 적으면 기본값, 적으면 그 값, 못 읽는 값이면 기본값으로 두고 못 읽었다고 말한다', () => {
  assert.equal(slot().scanTimeoutMs, SCAN_TIMEOUT_MS);
  assert.deepEqual(slot().rejected, []);
  assert.equal(slot({ scanTimeoutMs: 1200 }).scanTimeoutMs, 1200);
  for (const bad of [0, -1, '3000', Number.NaN, Infinity]) {
    const s = slot({ scanTimeoutMs: bad });
    assert.equal(s.scanTimeoutMs, SCAN_TIMEOUT_MS);
    assert.equal(s.rejected.length, 1);
    assert.match(s.rejected[0], /^scanTimeoutMs — /);
    assert.equal(s.types.length, 2, '제한 시간을 못 읽어도 유형 판정은 그대로 돈다');
  }
});

test('⭐ 전부 잘못 채워도 "꺼짐" 이 아니다 — 설정은 됐는데 판정할 유형이 0 이라고 드러난다', () => {
  const s = evidenceSlot({ qualityCycle: { evidence: { types: [{ id: 'x' }] } } });
  assert.equal(s.configured, true);
  assert.equal(s.types.length, 0);
  assert.equal(s.rejected.length, 1);
});

test('못 읽은 이유에는 자리(몇 번째 항목)와 필드 이름만 있고 값은 없다', () => {
  const s = evidenceSlot({
    qualityCycle: { evidence: { types: [{ id: 'secret-type', files: ['[secret-path'], evidence: [{ id: 'e', pattern: /^go\b/ }] }] } },
  });
  assert.equal(s.rejected.length, 1);
  assert.match(s.rejected[0], /types\[0\]/);
  assert.ok(!s.rejected[0].includes('secret-path'), '패턴 원문을 이유에 옮기지 않는다');
});

// ── 실행 후 훅 — 명령을 슬롯에 대고 분류해 식별자만 남긴다 ─────────────────────────────

const post = (command, over = {}) =>
  JSON.stringify({
    session_id: 's-1',
    prompt_id: 'p-1',
    tool_use_id: 'c-1',
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { stdout: '', stderr: '', interrupted: false },
    ...over,
  });

test('⭐ 증거 명령이 실행되면 (유형, 증거) 식별자만 실은 evidence 이벤트가 나온다 — 원문은 없다', () => {
  const evs = evidenceEventsFromPost(post('cd /somewhere/private && run-tests --filter secret-case'), slot());
  assert.deepEqual(evs, [
    { session: 's-1', turn: 'p-1', call: 'c-1', event: 'evidence', gate: GATE, change: 'code', run: 'unit' },
  ]);
  const text = JSON.stringify(evs);
  assert.ok(!text.includes('private') && !text.includes('secret-case'), '명령 원문은 로그 대상이 아니다');
});

test('변경을 만드는 명령(파일로 안 남는 변경)은 run 없이 change 만 실린다', () => {
  assert.deepEqual(evidenceEventsFromPost(post('tree-tool add ../x'), slot()), [
    { session: 's-1', turn: 'p-1', call: 'c-1', event: 'evidence', gate: GATE, change: 'tree' },
  ]);
});

test('한 명령이 여러 증거·유형에 걸리면 각각 한 줄씩 나온다', () => {
  const evs = evidenceEventsFromPost(post('run-lint && run-tests; tree-tool list'), slot());
  assert.deepEqual(
    evs.map((e) => `${e.change}:${e.run ?? ''}`),
    ['code:unit', 'code:lint', 'tree:list'],
  );
});

test('슬롯에 걸리지 않는 명령은 아무것도 남기지 않는다', () => {
  assert.deepEqual(evidenceEventsFromPost(post('git status'), slot()), []);
  // 명령 위치에 고정한 패턴이면 인용 속 같은 문자열은 증거가 아니다 — 패턴 작성자의 몫임을 픽스처로 보인다.
  assert.deepEqual(evidenceEventsFromPost(post('note "run-tests passed"'), slot()), []);
});

test('⭐ 중단된 실행은 증거가 아니다 — 다만 변경을 만드는 명령은 중단돼도 변경으로 남긴다', () => {
  const interrupted = { tool_response: { stdout: '', stderr: '', interrupted: true } };
  assert.deepEqual(evidenceEventsFromPost(post('run-tests', interrupted), slot()), []);
  assert.equal(evidenceEventsFromPost(post('tree-tool add ../x', interrupted), slot()).length, 1);
});

test('페이로드가 JSON 이 아니거나 명령이 없으면 남기지 않는다 — 원문 전체를 훑어 추정하지 않는다', () => {
  assert.deepEqual(evidenceEventsFromPost('run-tests', slot()), []);
  assert.deepEqual(evidenceEventsFromPost(JSON.stringify({ tool_input: {} }), slot()), []);
  assert.deepEqual(evidenceEventsFromPost(post('run-tests'), evidenceSlot({})), []);
});

test('서브에이전트 안에서 실행된 증거에는 agent 가 실린다', () => {
  const [ev] = evidenceEventsFromPost(post('run-tests', { agent_id: 'abc123' }), slot());
  assert.equal(ev.agent, 'abc123');
});

test('⭐ g·y 플래그가 붙은 패턴도 매번 처음부터 맞춘다 — 앞 판정의 위치가 다음 파일·명령을 건너뛰게 하지 않는다', () => {
  const stateful = evidenceSlot({
    qualityCycle: {
      evidence: {
        types: [
          {
            id: 'code',
            files: [/^src\//g],
            changeCommands: [/^make-change\b/y],
            evidence: [{ id: 'unit', pattern: /^run-tests\b/g }],
          },
        ],
      },
    },
  });
  assert.deepEqual(stateful.rejected, []);
  // 30초에 실행한 뒤 50초에 둘째 파일을 고쳤다. 둘째 파일을 건너뛰면 그 실행이 충족으로 읽힌다(느슨한 쪽 거짓).
  const v = judge({
    slot: stateful,
    files: [{ path: 'src/a.js', mtimeMs: Date.parse('2026-01-10T06:00:10.000Z') }, { path: 'src/b.js', mtimeMs: Date.parse('2026-01-10T06:00:50.000Z') }],
    events: [{ ts: '2026-01-10T06:00:30.000Z', event: 'evidence', gate: GATE, change: 'code', run: 'unit' }],
    sinceMs: Date.parse('2026-01-10T06:00:00.000Z'),
  });
  assert.deepEqual(v.counts, { types: 1, required: 1, fresh: 0, stale: 1, missing: 0 });
  // 같은 명령을 연달아 분류해도 매번 같은 결과다.
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(evidenceEventsFromPost(post('run-tests'), stateful).map((e) => `${e.change}:${e.run ?? ''}`), ['code:unit']);
    assert.deepEqual(evidenceEventsFromPost(post('make-change now'), stateful).map((e) => `${e.change}:${e.run ?? ''}`), ['code:']);
  }
});

// ── 판정 ──────────────────────────────────────────────────────────────────────

test('이 턴에 유형에 드는 변경이 없으면 필요한 증거도 없다', () => {
  const v = judge({ slot: slot(), files: [file('docs/readme.txt', 10)], events: [], sinceMs: T0 });
  assert.deepEqual(v.counts, { types: 0, required: 0, fresh: 0, stale: 0, missing: 0 });
  assert.deepEqual(v.types, []);
});

test('⭐ 유형에 드는 변경이 있는데 증거 실행이 없으면 "증거 없음" 이다', () => {
  const v = judge({ slot: slot(), files: [file('src/calc.js', 10)], events: [], sinceMs: T0 });
  assert.deepEqual(v.counts, { types: 1, required: 2, fresh: 0, stale: 0, missing: 2 });
  assert.equal(statusOfReq(v, 'code', 'unit'), 'missing');
});

test('⭐ 마지막 변경 뒤에 실행된 증거만 충족이다 — 변경 앞의 실행은 "편집 뒤 미실행"', () => {
  const files = [file('src/calc.js', 30)];
  const before = judge({ slot: slot(), files, events: [ran(20, 'code', 'unit'), ran(21, 'code', 'lint')], sinceMs: T0 });
  assert.deepEqual(before.counts, { types: 1, required: 2, fresh: 0, stale: 2, missing: 0 });
  const after = judge({ slot: slot(), files, events: [ran(40, 'code', 'unit'), ran(41, 'code', 'lint')], sinceMs: T0 });
  assert.deepEqual(after.counts, { types: 1, required: 2, fresh: 2, stale: 0, missing: 0 });
});

test('⭐ 편집 → 실행 → 다시 편집 이면 그 실행은 증거가 아니다 — 재실행 안 한 그린', () => {
  const v = judge({
    slot: slot(),
    files: [file('src/calc.js', 10), file('src/other.js', 50)], // 마지막 변경은 50초
    events: [ran(30, 'code', 'unit'), ran(60, 'code', 'lint')],
    sinceMs: T0,
  });
  assert.equal(statusOfReq(v, 'code', 'unit'), 'stale');
  assert.equal(statusOfReq(v, 'code', 'lint'), 'fresh');
  assert.deepEqual(v.counts, { types: 1, required: 2, fresh: 1, stale: 1, missing: 0 });
});

test('같은 증거를 여러 번 돌렸으면 가장 늦은 실행으로 판정한다', () => {
  const v = judge({
    slot: slot(),
    files: [file('src/calc.js', 30)],
    events: [ran(20, 'code', 'unit'), ran(45, 'code', 'unit'), ran(46, 'code', 'lint')],
    sinceMs: T0,
  });
  assert.equal(statusOfReq(v, 'code', 'unit'), 'fresh');
});

test('⭐ 변경과 같은 시각의 실행은 "뒤" 가 아니다', () => {
  const v = judge({ slot: slot(), files: [file('src/calc.js', 30)], events: [ran(30, 'code', 'unit')], sinceMs: T0 });
  assert.equal(statusOfReq(v, 'code', 'unit'), 'stale');
});

test('⭐ 실행의 시각은 시작 시각이다 — 같은 호출의 실행 전 기록이 있으면 그 시각으로 잰다', () => {
  // 20초에 시작해 40초에 끝난 실행 도중(30초)에 편집이 있었다. 끝난 시각으로 재면 "뒤" 로 보이지만 그 실행은 편집 전 상태를 봤다.
  const events = [
    { ts: iso(20), event: 'pass', gate: 'danger-guard', cmdPrefix: 'run-tests', call: 'c-9' },
    ran(40, 'code', 'unit', { call: 'c-9' }),
  ];
  const v = judge({ slot: slot(), files: [file('src/calc.js', 30)], events, sinceMs: T0 });
  assert.equal(statusOfReq(v, 'code', 'unit'), 'stale');
  // 실행 전 기록이 없으면(호출 식별자 없음) 실행 후 시각으로 잰다 — 한계로 적어 둔 근사다.
  const noCall = judge({ slot: slot(), files: [file('src/calc.js', 30)], events: [ran(40, 'code', 'unit')], sinceMs: T0 });
  assert.equal(statusOfReq(noCall, 'code', 'unit'), 'fresh');
});

test('실행 전 기록이 발동(fire — 사람이 승인한 ask)이어도 그 시각이 실행의 시작이다', () => {
  const events = [
    { ts: iso(20), event: 'fire', gate: 'danger-guard', decision: 'ask', rule: 'confirm-run', cmdPrefix: 'run-tests', call: 'c-7' },
    ran(40, 'code', 'unit', { call: 'c-7' }),
  ];
  const v = judge({ slot: slot(), files: [file('src/calc.js', 30)], events, sinceMs: T0 });
  assert.equal(statusOfReq(v, 'code', 'unit'), 'stale');
});

test('⭐ 명령으로만 드러나는 변경 — 변경 명령 뒤에 확인 명령이 있어야 충족이다', () => {
  const none = judge({ slot: slot(), files: [], events: [ran(10, 'tree')], sinceMs: T0 });
  assert.deepEqual(none.counts, { types: 1, required: 1, fresh: 0, stale: 0, missing: 1 });
  const stale = judge({ slot: slot(), files: [], events: [ran(10, 'tree', 'list'), ran(20, 'tree')], sinceMs: T0 });
  assert.equal(statusOfReq(stale, 'tree', 'list'), 'stale');
  const fresh = judge({ slot: slot(), files: [], events: [ran(20, 'tree'), ran(30, 'tree', 'list')], sinceMs: T0 });
  assert.equal(statusOfReq(fresh, 'tree', 'list'), 'fresh');
});

test('증거 명령만 돌고 변경이 없으면 그 유형은 판정 대상이 아니다', () => {
  const v = judge({ slot: slot(), files: [], events: [ran(10, 'tree', 'list'), ran(11, 'code', 'unit')], sinceMs: T0 });
  assert.equal(v.counts.types, 0);
});

test('⭐ 다른 유형의 증거는 이 유형의 증거가 아니다 — 증거 id 가 같아도 유형이 다르면 따로 센다', () => {
  const v = judge({ slot: slot(), files: [file('src/calc.js', 10)], events: [ran(20, 'tree', 'list')], sinceMs: T0 });
  assert.deepEqual(v.counts, { types: 1, required: 2, fresh: 0, stale: 0, missing: 2 });
  // 두 유형이 같은 이름('check')의 증거를 각자 다른 명령으로 요구한다. 한쪽의 실행이 다른 쪽을 충족시키면 안 된다.
  const twin = evidenceSlot({
    qualityCycle: {
      evidence: {
        types: [
          { id: 'app', files: [/^app\//], evidence: [{ id: 'check', pattern: /^check-app\b/ }] },
          { id: 'conf', files: [/^conf\//], evidence: [{ id: 'check', pattern: /^check-conf\b/ }] },
        ],
      },
    },
  });
  const w = judge({ slot: twin, files: [file('app/a', 10), file('conf/b', 10)], events: [ran(20, 'app', 'check')], sinceMs: T0 });
  assert.equal(statusOfReq(w, 'app', 'check'), 'fresh');
  assert.equal(statusOfReq(w, 'conf', 'check'), 'missing');
});

test('⭐ 서브에이전트가 돌린 증거도 인정한다 — 증거는 누가 돌렸는가가 아니라 작업 트리의 사실이다', () => {
  const v = judge({
    slot: slot(),
    files: [file('src/calc.js', 10)],
    events: [ran(20, 'code', 'unit', { agent: 'abc123' }), ran(21, 'code', 'lint', { agent: 'abc123' })],
    sinceMs: T0,
  });
  assert.deepEqual(v.counts, { types: 1, required: 2, fresh: 2, stale: 0, missing: 0 });
});

test('턴 시작 이전의 실행·변경 명령은 이 턴의 것이 아니다', () => {
  const v = judge({
    slot: slot(),
    files: [file('src/calc.js', 10)],
    events: [ran(-30, 'code', 'unit'), ran(-20, 'tree')],
    sinceMs: T0,
  });
  assert.equal(statusOfReq(v, 'code', 'unit'), 'missing');
  assert.equal(v.types.some((t) => t.id === 'tree'), false);
});

test('판정 결과에는 파일 경로가 실리지 않는다 — 유형·증거의 식별자와 설명뿐', () => {
  const v = judge({ slot: slot(), files: [file('src/very-private-name.js', 10)], events: [], sinceMs: T0 });
  assert.ok(!JSON.stringify(v).includes('very-private-name'));
});

// ── 턴 시작 시각 ───────────────────────────────────────────────────────────────

test('턴 시작 시각 — turn-start 이벤트가 있으면 그것, 없으면 그 턴의 가장 이른 이벤트, 둘 다 없으면 모른다(null)', () => {
  const events = [
    { ts: iso(5), event: 'pass', gate: 'danger-guard', cmdPrefix: 'x', turn: 'p-1' },
    { ts: iso(0), event: 'turn-start', gate: 'turn-start', turn: 'p-1' },
    { ts: iso(7), event: 'pass', gate: 'danger-guard', cmdPrefix: 'x', turn: 'p-2' },
    { ts: iso(9), event: 'pass', gate: 'danger-guard', cmdPrefix: 'x', turn: 'p-2' },
  ];
  assert.equal(turnStartMs(events, 'p-1'), at(0));
  assert.equal(turnStartMs(events, 'p-2'), at(7));
  assert.equal(turnStartMs(events, 'p-3'), null);
  assert.equal(turnStartMs(events, undefined), null);
});

test('⭐ 턴 종료 훅이 스스로 남긴 기록(stop · audit)은 턴의 시작이 아니다 — 그것뿐이면 시작을 모른다', () => {
  // 턴 종료 훅은 stop 을 먼저 적고 판정한다. 그 stop 을 "가장 이른 이벤트" 로 읽으면 턴 시작이 지금이 되어,
  // 시작을 모르는 턴이 "바뀐 것 없음" 으로 둔갑한다.
  const own = [
    { ts: iso(90), event: 'stop', gate: 'turn-end', turn: 'p-1' },
    { ts: iso(90), event: 'audit', gate: 'test-first', turn: 'p-1', total: 1, inScope: 1, missing: 0, deny: 0, ask: 0 },
  ];
  assert.equal(turnStartMs(own, 'p-1'), null);
  const withShell = [...own, { ts: iso(95), event: 'pass', gate: 'danger-guard', cmdPrefix: 'x', turn: 'p-1' }];
  assert.equal(turnStartMs(withShell, 'p-1'), at(95));
});

test('서브에이전트 안에서 온 turn-start 는 턴의 시작으로 삼지 않는다 — 메인의 것이 없으면 가장 이른 이벤트로 물러난다', () => {
  const events = [
    { ts: iso(5), event: 'pass', gate: 'danger-guard', cmdPrefix: 'x', turn: 'p-1' },
    { ts: iso(8), event: 'turn-start', gate: 'turn-start', turn: 'p-1', agent: 'abc123' },
  ];
  assert.equal(turnStartMs(events, 'p-1'), at(5));
});

// ── 차단 판단 · 복구 경로 ─────────────────────────────────────────────────────────

const unmet = () => judge({ slot: slot(), files: [file('src/calc.js', 30)], events: [ran(20, 'code', 'unit')], sinceMs: T0 });
const someRun = [ran(-100, 'code', 'unit')];

test('⭐ 관찰 모드는 미충족이어도 막지 않는다', () => {
  assert.equal(shouldBlock({ slot: slot(), verdict: unmet(), stopHookActive: false, events: someRun }).block, false);
});

test('⭐ 차단 모드 — 미충족이면 막는다 · 충족이면 막지 않는다', () => {
  const s = slot({ mode: 'block' });
  assert.equal(shouldBlock({ slot: s, verdict: unmet(), stopHookActive: false, events: someRun }).block, true);
  const met = judge({ slot: s, files: [file('src/calc.js', 30)], events: [ran(40, 'code', 'unit'), ran(41, 'code', 'lint')], sinceMs: T0 });
  assert.equal(shouldBlock({ slot: s, verdict: met, stopHookActive: false, events: someRun }).block, false);
});

test('⭐ 차단은 턴당 한 번이다 — 이미 한 번 막은 뒤(stop_hook_active)에는 다시 막지 않는다', () => {
  const r = shouldBlock({ slot: slot({ mode: 'block' }), verdict: unmet(), stopHookActive: true, events: someRun });
  assert.equal(r.block, false);
});

const heldAt = (turn, blocked = 1) => ({
  ts: iso(50), event: 'audit', gate: GATE, turn, types: 1, required: 2, fresh: 0, stale: 1, missing: 1, rejected: 0, blocked,
});

test('⭐ 턴당 한 번은 로그로도 지킨다 — 같은 턴에 이미 보류한 기록이 있으면 stop_hook_active 가 없어도 다시 막지 않는다', () => {
  const s = slot({ mode: 'block' });
  const ask = (events) => shouldBlock({ slot: s, verdict: unmet(), stopHookActive: false, events, turn: 'p-1' }).block;
  assert.equal(ask([...someRun, heldAt('p-1')]), false);
  // 다른 턴의 보류는 이 턴을 면제하지 않는다 · 보류하지 않은 판정 기록(blocked 0)은 보류가 아니다.
  assert.equal(ask([...someRun, heldAt('p-0')]), true);
  assert.equal(ask([...someRun, heldAt('p-1', 0)]), true);
});

test('⭐ 증거 실행이 한 번도 관찰된 적 없으면 막지 않는다 — 실행 후 훅이 연결됐는지 알 수 없다', () => {
  const r = shouldBlock({ slot: slot({ mode: 'block' }), verdict: unmet(), stopHookActive: false, events: [] });
  assert.equal(r.block, false);
  assert.match(r.withheld, /연결/);
});

test('⭐ 차단 사유는 무엇이 없는지 · 무엇을 하면 통과하는지 · 표가 틀렸으면 어디를 고치는지를 담는다', () => {
  const reason = blockReason(unmet());
  assert.match(reason, /계산 코드/);
  assert.match(reason, /단위 테스트 실행/);
  assert.match(reason, /마지막 변경 뒤에 실행되지 않았습니다/); // unit — 편집 앞의 실행
  assert.match(reason, /이 턴에 실행된 적이 없습니다/); // lint — 증거 없음
  assert.match(reason, /다시 실행/);
  assert.match(reason, /qualityCycle\.evidence\.types/);
});

test('판정 기록(audit)은 수치만 싣는다 — stop 과 같은 session·turn, 유형 이름·경로는 없다', () => {
  const ev = evidenceAuditEvent({ session: 's-1', turn: 'p-1', event: 'stop', gate: 'turn-end' }, unmet(), slot({ mode: 'blok' }), true);
  assert.deepEqual(ev, {
    session: 's-1',
    turn: 'p-1',
    event: 'audit',
    gate: GATE,
    types: 1,
    required: 2,
    fresh: 0,
    stale: 1,
    missing: 1,
    rejected: 1,
    blocked: 1,
  });
});

// ── 작업 트리 스캔 — 이 턴에 바뀐 파일과 그 시각 (git + mtime) ────────────────────────────

const git = (root, ...args) =>
  spawnSync('git', ['-c', 'user.name=dev', '-c', 'user.email=dev@example.com', ...args], { cwd: root, encoding: 'utf8' });
const touch = (root, rel, ms, body = 'x\n') => {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, body, 'utf8');
  utimesSync(p, ms / 1000, ms / 1000);
};
function repo() {
  const root = mkdtempSync(path.join(tmpdir(), 'harness-evidence-'));
  git(root, 'init', '-q');
  return root;
}

test('⭐ 스캔 — 턴 시작 뒤에 고친 추적 파일과 새 파일만 잡는다(이전 턴에 고친 채 남은 파일은 이 턴의 변경이 아니다)', () => {
  const root = repo();
  const now = Date.now();
  const since = now - 60_000;
  touch(root, 'src/old.js', now - 600_000);
  touch(root, 'src/edited.js', now - 600_000);
  touch(root, 'src/gone.js', now - 600_000);
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'base', '--date', new Date(now - 500_000).toISOString());
  touch(root, 'src/old.js', now - 300_000, 'edited last turn\n'); // 이전 턴에 고치고 커밋 안 함
  touch(root, 'src/edited.js', now - 30_000, 'edited this turn\n');
  touch(root, 'src/new file.js', now - 20_000); // 공백 든 새 파일
  rmSync(path.join(root, 'src/gone.js')); // 삭제는 시각이 없다 — 잡지 않는다(한계)
  const found = scanChanged(root, since).sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(found.map((f) => f.path), ['src/edited.js', 'src/new file.js']);
  assert.ok(Math.abs(found[0].mtimeMs - (now - 30_000)) < 2000);
});

test('⭐ 스캔 — 이 턴에 고치고 커밋까지 한 파일도 잡는다(커밋하면 작업 트리는 깨끗해진다)', () => {
  const root = repo();
  const now = Date.now();
  touch(root, 'src/a.js', now - 600_000);
  git(root, 'add', '.');
  const base = spawnSync('git', ['-c', 'user.name=dev', '-c', 'user.email=dev@example.com', 'commit', '-q', '-m', 'base'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: new Date(now - 500_000).toISOString() },
  });
  assert.equal(base.status, 0);
  touch(root, 'src/a.js', now - 30_000, 'edited this turn\n');
  git(root, 'commit', '-q', '-am', 'this turn');
  assert.deepEqual(scanChanged(root, now - 60_000).map((f) => f.path), ['src/a.js']);
  // 같은 저장소라도 그 커밋보다 뒤를 턴 시작으로 잡으면 아무것도 없다.
  assert.deepEqual(scanChanged(root, now + 60_000), []);
});

test('스캔 — 하네스 로그 자신은 변경으로 세지 않는다(모든 훅이 덧붙이는 파일이라 항상 가장 새것이다)', () => {
  const root = repo();
  logEvent({ event: 'stop', gate: 'turn-end', turn: 't' }, root);
  touch(root, 'src/a.js', Date.now() - 1000);
  assert.deepEqual(scanChanged(root, Date.now() - 60_000).map((f) => f.path), ['src/a.js']);
});

test('⭐ 스캔 — 프로젝트 루트가 저장소의 하위 디렉토리여도 경로는 프로젝트 루트 기준이다(루트 밖 변경은 관할이 아니다)', () => {
  const top = repo();
  const root = path.join(top, 'pkg');
  const now = Date.now();
  touch(top, 'pkg/src/a.js', now - 1000);
  touch(top, 'other/b.js', now - 1000);
  assert.deepEqual(scanChanged(root, now - 60_000).map((f) => f.path), ['src/a.js']);
});

test('스캔 — git 저장소가 아니면 던진다(호출부가 판정 없이 넘어간다 — 빈 목록으로 둔갑하지 않는다)', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'harness-evidence-nogit-'));
  assert.throws(() => scanChanged(root, Date.now() - 1000));
});

/** 커밋 시각을 지정해 커밋한다 — `git log --since` 는 커밋 시각으로 거른다. */
const commitAt = (root, ms, message) => {
  const r = spawnSync('git', ['-c', 'user.name=dev', '-c', 'user.email=dev@example.com', 'commit', '-q', '-m', message], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: new Date(ms).toISOString() },
  });
  assert.equal(r.status, 0, r.stderr);
};
const setMtime = (root, rel, ms) => utimesSync(path.join(root, rel), ms / 1000, ms / 1000);

test('⭐ 스캔 — 깨끗한 트리에서 다시 쓰이기만 한 파일은 이 턴의 변경이 아니다(턴 시작 전 커밋은 후보가 아니다 — 브랜치 전환·받아오기는 놓치는 쪽)', () => {
  const root = repo();
  const now = Date.now();
  touch(root, 'src/a.js', now - 600_000);
  git(root, 'add', '.');
  commitAt(root, now - 500_000, 'base');
  // 내용은 그대로이고 수정 시각만 이 턴 안이다 — 브랜치 전환·받아오기가 파일을 다시 쓴 뒤의 모양.
  setMtime(root, 'src/a.js', now - 30_000);
  assert.deepEqual(scanChanged(root, now - 60_000), []);
});

test('스캔 — 이름 바꾸기의 "원래 경로" 필드를 변경 항목으로 읽지 않는다', () => {
  const root = repo();
  const now = Date.now();
  touch(root, 'ab/keep.js', now - 600_000, 'one\n');
  touch(root, 'keep.js', now - 600_000, 'two\n');
  git(root, 'add', '.');
  commitAt(root, now - 500_000, 'base');
  // 상태 출력은 "R  moved.js" 다음 필드에 원래 경로(ab/keep.js)를 준다. 그 필드를 항목으로 읽으면 앞 세 글자를
  // 잘라 'keep.js' 가 되고, 마침 수정 시각이 새것인(내용은 그대로인) 무관한 파일이 변경으로 잡힌다.
  assert.equal(git(root, 'mv', 'ab/keep.js', 'moved.js').status, 0);
  setMtime(root, 'moved.js', now - 600_000);
  setMtime(root, 'keep.js', now - 30_000);
  assert.deepEqual(scanChanged(root, now - 60_000), []);
});

test('스캔 — 이름이 점 둘로 시작하는 루트의 파일은 루트 밖이 아니다', () => {
  const root = repo();
  const now = Date.now();
  touch(root, '..notes.js', now - 1000);
  touch(root, 'src/a.js', now - 1000);
  assert.deepEqual(scanChanged(root, now - 60_000).map((f) => f.path).sort(), ['..notes.js', 'src/a.js']);
});

test('⭐ 스캔 — git 이 제한 시간 안에 답하지 않으면 기다리지 않고 던진다(느린 git 이 턴 종료 훅을 붙잡지 않는다)', (t) => {
  const root = repo();
  // 상태 조회 때마다 6초짜리 훅을 돌게 해 git 을 느리게 만든다.
  git(root, 'config', 'core.fsmonitor', 'sleep 6 #');
  touch(root, 'src/a.js', Date.now() - 1000);
  // 환경 확인 — 시험 대상 코드와 무관하게, 이 저장소의 git 이 실제로 느린가. 아니면 이 테스트는 아무것도 증명하지 못한다.
  const probe = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', timeout: 1500 });
  if (!probe.error || probe.error.code !== 'ETIMEDOUT') {
    t.skip('이 환경의 git 은 이 방법으로 느려지지 않는다 — 제한 시간을 검증하지 못했다');
    return;
  }
  const started = Date.now();
  let thrown = null;
  try {
    scanChanged(root, Date.now() - 60_000, { timeoutMs: 400 });
  } catch (e) {
    thrown = e;
  }
  const elapsed = Date.now() - started;
  assert.ok(thrown, `제한 시간(400ms)을 넘겨도 던지지 않았다 — ${elapsed}ms 뒤에 값을 돌려줬다`);
  assert.match(thrown.message, /제한 시간/);
  assert.ok(elapsed < 4000, `제한 시간 뒤에도 ${elapsed}ms 를 붙잡혀 있었다`);
});

// ── 활성 확인 줄 — "설정됨" 과 "동작함" 을 가른다 ─────────────────────────────────────

test('⭐ 활성 확인 줄 — 꺼짐 · 못 읽음 · 관찰 0 을 서로 다른 말로 가른다', () => {
  const off = statusLines(evidenceSlot({}), []);
  assert.equal(off.length, 1);
  assert.match(off[0], /^\[done-evidence\] 꺼짐 — qualityCycle\.evidence\.types 가 비어 있습니다/);

  const unread = statusLines(evidenceSlot({ qualityCycle: { evidence: { types: [{ id: 'x' }] } } }), []);
  assert.match(unread[0], /^\[done-evidence\] 설정됨 · 읽을 수 있는 유형 0/);
  assert.ok(unread.some((l) => /못 읽은 항목: types\[0\] — /.test(l)), '무엇을 못 읽었는지 내역이 보인다');

  const idle = statusLines(slot(), []);
  assert.match(idle[0], /^\[done-evidence\] 설정됨\(관찰\) — 유형 2 · 필수 증거 3 · 증거 실행 관찰 0건 · 턴 종료 판정 0건$/);
  assert.ok(idle.some((l) => /증거 실행 관찰 0 — 실행 후 훅/.test(l)));
  assert.ok(idle.some((l) => /턴 종료 판정 0 — 턴 종료 훅/.test(l)));
  assert.ok(idle.some((l) => /턴 시작 관찰 0 — .*첫 셸 명령 앞의 편집/.test(l)), '턴 시작 훅이 없으면 판정이 과소임을 말한다');
});

test('활성 확인 줄 — 증거 실행·턴 종료 판정·턴 시작이 다 관찰된 곳에서는 경고 줄이 없다', () => {
  const events = [
    { ts: iso(0), event: 'turn-start', gate: 'turn-start', turn: 'p-1' },
    ran(10, 'code', 'unit'),
    ran(11, 'tree'), // 변경만 남긴 기록은 증거 실행이 아니다
    heldAt('p-1', 0),
  ];
  const lines = statusLines(slot({ mode: 'block' }), events);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[done-evidence\] 설정됨\(차단\) — 유형 2 · 필수 증거 3 · 증거 실행 관찰 1건 · 턴 종료 판정 1건\(최근 2026-01-10T06:00:50Z\)$/);
});

// ── 실행 후 훅 경로 — 기존 배선(danger-guard.mjs --post) 그대로 ──────────────────────────

const GUARD = fileURLToPath(new URL('./danger-guard.mjs', import.meta.url));
const SLOT_SOURCE = `export default {
  dangerGuard: { enabled: true, ask: [{ id: 'confirm-wipe', pattern: /\\bwipe-all\\b/, why: 'w' }] },
  qualityCycle: { evidence: { types: [
    { id: 'code', what: '계산 코드', files: [/^src\\/.*\\.js$/],
      evidence: [{ id: 'unit', pattern: /(^|[;&|(]\\s*)run-tests\\b/, what: '단위 테스트 실행' }] },
  ] } },
};
`;
function site(source = SLOT_SOURCE) {
  const root = repo();
  writeFileSync(path.join(root, 'harness.config.mjs'), source, 'utf8');
  return root;
}
const runPost = (root, stdin) =>
  spawnSync(process.execPath, [GUARD, '--post'], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_ROOT: root, CLAUDE_PROJECT_DIR: '' },
  });

test('⭐ 실행 후 훅 — 증거 명령이면 evidence 한 줄이 남고, stdout 은 비어 있고, 원문은 로그에 없다', () => {
  const root = site();
  const r = runPost(root, post('cd /somewhere/private && run-tests'));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const { events } = readLog(root);
  assert.equal(events.length, 1);
  const { ts, ...rest } = events[0];
  assert.ok(ts);
  assert.deepEqual(rest, { session: 's-1', turn: 'p-1', call: 'c-1', event: 'evidence', gate: GATE, change: 'code', run: 'unit' });
});

test('실행 후 훅 — 증거와 무관한 명령은 종전대로 아무것도 남기지 않고, ask 규칙의 after 기록은 그대로다', () => {
  const root = site();
  runPost(root, post('git status'));
  assert.deepEqual(readLog(root).events, []);
  runPost(root, post('wipe-all'));
  assert.deepEqual(readLog(root).events.map((e) => e.event), ['after']);
});

test('실행 후 훅 — 증거 슬롯이 없는 설정에서는 종전과 똑같이 돈다', () => {
  const root = site(`export default { dangerGuard: { enabled: true } };\n`);
  const r = runPost(root, post('run-tests'));
  assert.equal(r.status, 0);
  assert.deepEqual(readLog(root).events, []);
});
