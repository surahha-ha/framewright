/**
 * 턴 시작 훅의 테스트 (docs/16 §5.4 · 결정 이력 2026-09-30(3)).
 *
 * 여기서 지키는 계약: **stdout 에 아무것도 쓰지 않는다**(UserPromptSubmit 훅의 stdout 은 모델 문맥에
 * 덧붙는다 — 계측이 개입이 되면 안 된다), **항상 0 으로 끝난다**(종료코드 2 는 프롬프트를 막는다 —
 * fail-open), **프롬프트 원문은 싣지 않는다**(개인정보·용량 — 완료 알림인지의 분류 하나만 싣는다).
 *
 * 실행: node --test skeletons/turn-start.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { turnStartEventFrom, GATE } from './turn-start.mjs';
import { readLog, logEvent } from './lib/log.mjs';

const HOOK = fileURLToPath(new URL('./turn-start.mjs', import.meta.url));
const run = (root, stdin, args = []) =>
  spawnSync(process.execPath, [HOOK, ...args], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_ROOT: root, CLAUDE_PROJECT_DIR: '' },
  });
const fresh = () => mkdtempSync(path.join(tmpdir(), 'harness-start-'));
// 실측(2.1.285) UserPromptSubmit 페이로드의 키: session_id · transcript_path · cwd · prompt_id · permission_mode ·
// hook_event_name · prompt. 서브에이전트 안에서는 발화하지 않았다(agent_id 붙은 UserPromptSubmit 0).
const payload = (o = {}) =>
  JSON.stringify({
    session_id: 's-1',
    transcript_path: '/home/someone/.claude/projects/x/s-1.jsonl',
    cwd: '/home/someone/work',
    prompt_id: 'p-1',
    permission_mode: 'default',
    hook_event_name: 'UserPromptSubmit',
    prompt: '이 파일 고쳐줘 /home/someone/secret-project',
    ...o,
  });

test('⭐ UserPromptSubmit 페이로드 → turn-start 이벤트: session·turn 만 싣고 프롬프트 원문·경로는 싣지 않는다', () => {
  const ev = turnStartEventFrom(payload());
  assert.deepEqual(ev, { session: 's-1', turn: 'p-1', event: 'turn-start', gate: GATE });
  const s = JSON.stringify(ev);
  assert.ok(!s.includes('secret-project'), '프롬프트 원문은 로그 대상이 아니다');
  assert.ok(!s.includes('someone'), '경로(사용자명)도 싣지 않는다');
});

test('⭐ 백그라운드 서브 완료 알림으로 시작한 턴은 origin 분류 하나만 싣는다 — 알림 본문은 싣지 않는다', () => {
  // 실측: 완료 알림 턴에도 UserPromptSubmit 이 새 prompt_id 로 발화하고, 프롬프트가 <task-notification> 으로 시작한다.
  const ev = turnStartEventFrom(
    payload({ prompt_id: 'p-2', prompt: '<task-notification>\n<task-id>af1b</task-id>\n<output-file>C:\\x</output-file>' }),
  );
  assert.deepEqual(ev, { session: 's-1', turn: 'p-2', event: 'turn-start', gate: GATE, origin: 'task-notification' });
  assert.ok(!JSON.stringify(ev).includes('af1b'));
  // 사람이 그 태그를 문장 중간에 인용한 것은 알림이 아니다 — 맨 앞(공백 뒤)만 본다.
  const quoted = turnStartEventFrom(payload({ prompt: '이거 봐 <task-notification> 왜 떠?' }));
  assert.equal('origin' in quoted, false);
});

test('prompt_id 가 없어도 이벤트는 만든다 — 빠진 turn 은 계약 검사가 위반으로 드러내야 한다', () => {
  assert.deepEqual(turnStartEventFrom(JSON.stringify({ session_id: 's-1', prompt: 'x' })), {
    session: 's-1',
    event: 'turn-start',
    gate: GATE,
  });
});

test('페이로드가 JSON 이 아니거나 객체가 아니면 null — 없는 사실은 적지 않는다', () => {
  assert.equal(turnStartEventFrom(''), null);
  assert.equal(turnStartEventFrom('{broken'), null);
  assert.equal(turnStartEventFrom('"str"'), null);
});

test('⭐ 훅 경로 — stdout 은 비어 있고(문맥 주입 금지) 종료코드 0, 로그에 turn-start 한 줄', () => {
  const root = fresh();
  const r = run(root, payload());
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', 'UserPromptSubmit 의 stdout 은 모델 문맥에 들어간다 — 한 글자도 쓰지 않는다');
  const { events } = readLog(root);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'turn-start');
  assert.equal(events[0].turn, 'p-1');
  assert.ok(!JSON.stringify(events[0]).includes('secret-project'));
});

test('⭐ 깨진 페이로드여도 종료코드 0 · stdout 비어 있음 — 계측이 프롬프트를 막지 않는다', () => {
  const root = fresh();
  const r = run(root, '{broken');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(readLog(root).events.length, 0);
  assert.match(r.stderr, /turn-start/);
});

test('--status — turn-start 가 없으면 1(미연결), 있으면 0', () => {
  const root = fresh();
  assert.equal(run(root, '', ['--status']).status, 1);
  logEvent({ session: 's-1', turn: 'p-1', event: 'turn-start', gate: GATE }, root);
  const r = run(root, '', ['--status']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /turn-start 이벤트 1건/);
});
