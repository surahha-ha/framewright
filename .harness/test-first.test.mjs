/**
 * 골격 2 가드의 테스트.
 *
 * 여기서 보는 것도 **판정 구조**다 — 경계표 내용은 프로젝트 설정에서 오므로 합성 설정으로 한다.
 * 파일시스템은 io 로 주입해 실제 디스크 없이 판정 경로 전부를 돈다.
 *
 * 실행: node --test skeletons/test-first.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, findTest, evaluate, audit, statusOf, extractFilePath, rootSwapOf, runAudit } from './test-first.mjs';

/** 합성 설정 — 실제 프로젝트 경계표가 아니라 구조를 보기 위한 최소값. */
const cfg = {
  testFirst: {
    enabled: true,
    grandfather: true,
    scopes: [
      { decision: 'deny', pattern: /^src\/engine\/.*\.ts$/, what: '순수 계산' },
      { decision: 'ask', pattern: /^src\/utils\/.*\.ts$/, what: '계산·래퍼 혼재' },
    ],
    exempt: [/(^|\/)__tests__\//, /\.(test|spec)\.[cm]?[jt]sx?$/, /\.(md|json)$/],
    testLookup: {
      dirs: ['__tests__', '.'],
      pattern: '^{base}[\\w.\\-]*\\.(test|spec)\\.[cm]?[jt]sx?$',
    },
    offEnv: 'HARNESS_TEST_FIRST',
  },
};

/** 합성 파일시스템 — files: 존재하는 파일 경로 집합, dirs: 디렉토리 → 파일명 목록. */
function fakeIo({ files = [], dirs = {} } = {}) {
  return {
    fileExists: (rel) => files.includes(rel.replace(/\\/g, '/')),
    listDir: (dir) => dirs[dir.replace(/\\/g, '/')] ?? null,
  };
}

// ── classify ────────────────────────────────────────────────────────────────

test('경계 안 파일을 경계표의 판정으로 분류한다', () => {
  assert.equal(classify('src/engine/calc.ts', cfg.testFirst).decision, 'deny');
  assert.equal(classify('src/utils/fmt.ts', cfg.testFirst).decision, 'ask');
});

test('경계 밖 파일은 null — 판정 대상이 아니다', () => {
  assert.equal(classify('src/views/Page.vue', cfg.testFirst), null);
});

test('⭐ 테스트 파일 자신은 항상 exempt — Red 를 못 쓰면 가드가 자기모순이다', () => {
  assert.equal(classify('src/engine/calc.test.ts', cfg.testFirst), 'exempt');
  assert.equal(classify('src/engine/__tests__/calc.spec.ts', cfg.testFirst), 'exempt');
});

test('역슬래시 경로도 같은 판정을 받는다 — OS 표기 차이로 규칙이 새면 안 된다', () => {
  assert.equal(classify('src\\engine\\calc.ts', cfg.testFirst).decision, 'deny');
});

test('deny 와 ask 에 모두 걸리면 deny 가 이긴다', () => {
  const tf = {
    scopes: [
      { decision: 'ask', pattern: /^src\// },
      { decision: 'deny', pattern: /^src\/engine\// },
    ],
  };
  assert.equal(classify('src/engine/a.ts', tf).decision, 'deny');
});

// ── findTest ────────────────────────────────────────────────────────────────

test('탐색 규칙의 디렉토리 순서대로 대응 테스트를 찾는다', () => {
  const io = fakeIo({ dirs: { 'src/engine/__tests__': ['calc.test.ts'] } });
  assert.equal(findTest('src/engine/calc.ts', cfg.testFirst, io).found, 'src/engine/__tests__/calc.test.ts');
});

test('같은 디렉토리의 테스트도 찾는다 ({base} 치환)', () => {
  const io = fakeIo({ dirs: { 'src/engine': ['calc.ts', 'calc.spec.ts'] } });
  assert.equal(findTest('src/engine/calc.ts', cfg.testFirst, io).found, 'src/engine/calc.spec.ts');
});

test('파일명에 정규식 특수문자가 있어도 오판정하지 않는다 — {base} 는 이스케이프된다', () => {
  // 'calc.util' 의 '.' 이 와일드카드로 풀리면 'calcXutil.test.ts' 같은 무관한 파일이 걸린다.
  const io = fakeIo({ dirs: { src: ['calcXutil.test.ts'] } });
  assert.equal(findTest('src/calc.util.ts', { testLookup: cfg.testFirst.testLookup }, io).found, null);
});

test('탐색 디렉토리가 없으면 오류가 아니라 "없음" 이다 — 배치 전제를 강요하지 않는다', () => {
  assert.equal(findTest('src/engine/calc.ts', cfg.testFirst, fakeIo()).found, null);
});

// ── findTest · 테스트 루트 치환 (testLookup.rootSwap) ────────────────────────

/** 소스 루트와 테스트 루트가 갈린 트리의 합성 설정 — Java 관습(Foo.java ↔ FooTest.java). */
const javaLookup = (rootSwap, extra = {}) => ({
  testLookup: { dirs: ['.'], pattern: '^{base}(Test|Tests|IT)\\.java$', rootSwap, ...extra },
});

test('⭐ 소스 루트 접두를 테스트 루트로 바꾼 디렉토리에서 찾는다 — 깊이가 달라도 한 쌍으로 덮는다', () => {
  const tf = javaLookup([{ from: 'src/main/java/', to: 'src/test/java/' }]);
  const io = fakeIo({
    dirs: {
      'src/test/java/a/b': ['FooTest.java'],
      'src/test/java/a/b/c/d': ['BarIT.java'],
    },
  });
  assert.deepEqual(findTest('src/main/java/a/b/Foo.java', tf, io), { found: 'src/test/java/a/b/FooTest.java' });
  assert.deepEqual(findTest('src/main/java/a/b/c/d/Bar.java', tf, io), { found: 'src/test/java/a/b/c/d/BarIT.java' });
});

test('치환한 쪽에도 테스트가 없으면 "없음" 이고, 옮겨 간 디렉토리를 함께 돌려준다', () => {
  const tf = javaLookup([{ from: 'src/main/java/', to: 'src/test/java/' }]);
  const io = fakeIo({ dirs: { 'src/test/java/a/b': ['OtherTest.java'] } });
  assert.deepEqual(findTest('src/main/java/a/b/Foo.java', tf, io), { found: null, swapped: 'src/test/java/a/b' });
});

test('접두가 어느 쌍에도 안 걸리면 치환하지 않는다 — 결과에 swapped 가 없다', () => {
  const tf = javaLookup([{ from: 'src/main/java/', to: 'src/test/java/' }]);
  const io = fakeIo({ dirs: { 'src/test/java/a': ['FooTest.java'] } });
  assert.deepEqual(findTest('lib/a/Foo.java', tf, io), { found: null });
});

test('접두는 디렉토리 경계로만 맞춘다 — from 끝의 / 가 빠져도 이웃 디렉토리를 삼키지 않는다', () => {
  const tf = javaLookup([{ from: 'src/main/java', to: 'src/test/java' }]);
  const io = fakeIo({ dirs: { 'src/test/java/a': ['FooTest.java'], 'src/test/javaX/a': ['FooTest.java'] } });
  assert.deepEqual(findTest('src/main/javaX/a/Foo.java', tf, io), { found: null });
  assert.deepEqual(findTest('src/main/java/a/Foo.java', tf, io), { found: 'src/test/java/a/FooTest.java' });
});

test('소스 루트 바로 아래 파일도 치환된다 (하위 디렉토리 없음)', () => {
  const tf = javaLookup([{ from: 'src/main/java/', to: 'src/test/java/' }]);
  const io = fakeIo({ dirs: { 'src/test/java': ['AppTest.java'] } });
  assert.deepEqual(findTest('src/main/java/App.java', tf, io), { found: 'src/test/java/AppTest.java' });
});

test('역슬래시 경로·역슬래시 슬롯·앞의 ./ 도 같은 판정을 받는다', () => {
  const tf = javaLookup([{ from: '.\\src\\main\\java\\', to: './src/test/java' }]);
  const io = fakeIo({ dirs: { 'src/test/java/a/b': ['FooTest.java'] } });
  assert.deepEqual(findTest('src\\main\\java\\a\\b\\Foo.java', tf, io), { found: 'src/test/java/a/b/FooTest.java' });
});

test('여러 쌍은 첫 일치가 이긴다 — 순서가 곧 우선순위다', () => {
  const tf = javaLookup([
    { from: 'src/main/java/a/', to: 'src/it/java/a/' },
    { from: 'src/main/java/', to: 'src/test/java/' },
  ]);
  const io = fakeIo({
    dirs: { 'src/it/java/a/b': ['FooIT.java'], 'src/test/java/a/b': ['FooTest.java'], 'src/test/java/z': ['BarTest.java'] },
  });
  assert.deepEqual(findTest('src/main/java/a/b/Foo.java', tf, io), { found: 'src/it/java/a/b/FooIT.java' });
  // 첫 쌍에 안 걸리는 경로는 다음 쌍으로 간다.
  assert.deepEqual(findTest('src/main/java/z/Bar.java', tf, io), { found: 'src/test/java/z/BarTest.java' });
});

test('여러 쌍 중 하나만 걸리면 그 쌍만 본다 — 두 번째 소스 루트(코틀린)도 같은 슬롯으로 덮는다', () => {
  const tf = javaLookup(
    [
      { from: 'src/main/java/', to: 'src/test/java/' },
      { from: 'src/main/kotlin/', to: 'src/test/kotlin/' },
    ],
    { pattern: '^{base}Test\\.(java|kt)$' },
  );
  const io = fakeIo({ dirs: { 'src/test/kotlin/a': ['FooTest.kt'], 'src/test/java/a': ['FooTest.java'] } });
  assert.deepEqual(findTest('src/main/kotlin/a/Foo.kt', tf, io), { found: 'src/test/kotlin/a/FooTest.kt' });
});

test('치환한 디렉토리에도 dirs 와 이름 규칙이 같은 규칙으로 붙는다 (접미사·하위 디렉토리 결합)', () => {
  const tf = {
    testLookup: {
      dirs: ['__tests__', '.'],
      pattern: '^{base}[\\w.\\-]*\\.(test|spec)\\.[cm]?[jt]sx?$',
      rootSwap: [{ from: 'src/', to: 'test/' }],
    },
  };
  const io = fakeIo({ dirs: { 'test/engine/__tests__': ['calc.unit.test.ts'] } });
  assert.deepEqual(findTest('src/engine/calc.ts', tf, io), { found: 'test/engine/__tests__/calc.unit.test.ts' });
  // 이름 규칙에 안 맞는 파일은 치환한 쪽에 있어도 대응 테스트가 아니다.
  const miss = fakeIo({ dirs: { 'test/engine': ['calculator.ts', 'rate.test.ts'] } });
  assert.deepEqual(findTest('src/engine/calc.ts', tf, miss), { found: null, swapped: 'test/engine' });
});

test('원래 자리의 테스트가 치환한 자리보다 먼저다 — 종전 탐색이 앞, 치환은 그 뒤에 덧붙는다', () => {
  const tf = javaLookup([{ from: 'src/main/java/', to: 'src/test/java/' }]);
  const io = fakeIo({ dirs: { 'src/main/java/a': ['FooTest.java'], 'src/test/java/a': ['FooTest.java'] } });
  assert.deepEqual(findTest('src/main/java/a/Foo.java', tf, io), { found: 'src/main/java/a/FooTest.java' });
});

test('⭐ rootSwap 미설정·빈 배열이면 종전과 같은 판정이다 — 결과 객체까지 같다', () => {
  const io = fakeIo({ dirs: { 'src/engine/__tests__': ['calc.test.ts'] } });
  const plain = cfg.testFirst;
  const empty = { ...plain, testLookup: { ...plain.testLookup, rootSwap: [] } };
  const nul = { ...plain, testLookup: { ...plain.testLookup, rootSwap: null } };
  for (const p of ['src/engine/calc.ts', 'src/engine/rate.ts', 'calc.ts']) {
    assert.deepEqual(findTest(p, empty, io), findTest(p, plain, io));
    assert.deepEqual(findTest(p, nul, io), findTest(p, plain, io));
  }
  assert.deepEqual(findTest('src/engine/rate.ts', plain, io), { found: null });
});

test('⭐ 잘못 채운 슬롯은 조용히 무시하지 않는다 — 판정 불가(error)로 드러낸다', () => {
  const io = fakeIo({ dirs: { 'src/test/java/a': ['FooTest.java'] } });
  const cases = [
    [{ from: 'src/main/java/' }, /rootSwap\[0\]\.to — 문자열이 아닙니다/],
    ['src/main/java/', /rootSwap\[0\] — 객체가 아닙니다/],
    [{ from: '/abs/src/', to: 'src/test/' }, /rootSwap\[0\]\.from — 절대경로/],
    [{ from: 'C:\\repo\\src', to: 'src/test/' }, /rootSwap\[0\]\.from — 절대경로/],
    [{ from: '../other/src/', to: 'src/test/' }, /rootSwap\[0\]\.from — '\.\.'/],
    [{ from: './', to: 'src/test/' }, /rootSwap\[0\]\.from — 비어 있습니다/],
  ];
  for (const [item, re] of cases) {
    const r = findTest('src/main/java/a/Foo.java', javaLookup([item]), io);
    assert.match(r.error, re);
  }
  const notArray = findTest('src/main/java/a/Foo.java', javaLookup({ from: 'a/', to: 'b/' }), io);
  assert.match(notArray.error, /rootSwap — 배열이 아닙니다/);
});

test('rootSwapOf — 정상 쌍은 정규화해 남기고, 못 읽은 항목은 위치와 사유로 남긴다', () => {
  assert.deepEqual(rootSwapOf(undefined), { pairs: [], rejected: [] });
  assert.deepEqual(rootSwapOf({}), { pairs: [], rejected: [] });
  const r = rootSwapOf({ rootSwap: [{ from: 'src\\main\\java', to: './src/test/java/' }, { from: 1, to: 'x/' }] });
  assert.deepEqual(r.pairs, [{ from: 'src/main/java/', to: 'src/test/java/' }]);
  assert.deepEqual(r.rejected, ['rootSwap[1].from — 문자열이 아닙니다 (받은 값: number)']);
});

test('evaluate — 치환으로 찾으면 통과, 못 찾으면 복구 경로에 테스트 루트 쪽 기준을 함께 적는다', () => {
  const c = {
    testFirst: {
      enabled: true,
      scopes: [{ decision: 'deny', pattern: /^src\/main\/java\/.*\.java$/, what: '도메인' }],
      ...javaLookup([{ from: 'src/main/java/', to: 'src/test/java/' }]),
    },
  };
  const hasTest = fakeIo({ dirs: { 'src/test/java/a/b': ['FooTest.java'] } });
  assert.equal(evaluate('src/main/java/a/b/Foo.java', c, hasTest), null);
  const hit = evaluate('src/main/java/a/b/Foo.java', c, fakeIo());
  assert.equal(hit.decision, 'deny');
  assert.match(hit.recover, /테스트 루트 쪽은 src\/test\/java\/a\/b 기준/);
});

test('⭐ evaluate — rootSwap 미설정이면 복구 문구가 종전과 한 글자도 다르지 않다', () => {
  const hit = evaluate('src/engine/calc.ts', cfg, fakeIo());
  assert.equal(
    hit.recover,
    'Red 를 먼저 쓰세요 — __tests__·. 에 테스트 파일을 만들어 실패를 확인한 뒤 이 파일을 작성합니다. ' +
      '이 파일이 왜 대상인지 의문이면 harness.config.mjs 의 testFirst.scopes(경계표)를 보고, 표가 틀렸으면 표를 고치세요.',
  );
});

test('⭐ 슬롯이 깨지면 evaluate 는 막지도 통과로 세지도 않고, runAudit 은 거짓 0 대신 실패한다', () => {
  const bad = {
    testFirst: {
      enabled: true,
      scopes: [{ decision: 'deny', pattern: /^src\/main\/java\//, what: '도메인' }],
      ...javaLookup([{ from: '', to: 'src/test/java/' }]),
    },
  };
  assert.equal(evaluate('src/main/java/a/Foo.java', bad, fakeIo()), null);
  assert.throws(() => runAudit('.', bad), /testLookup\.rootSwap 을 읽지 못했습니다 — rootSwap\[0\]\.from — 비어 있습니다/);
});

// ── evaluate ────────────────────────────────────────────────────────────────

test('신규 파일이 deny 경계 안이고 테스트가 없으면 deny', () => {
  const hit = evaluate('src/engine/calc.ts', cfg, fakeIo());
  assert.equal(hit.decision, 'deny');
  assert.match(hit.recover, /Red 를 먼저/);
});

test('⭐ 복구 경로가 경계표 위치를 알려준다 — 표를 고칠 수 있어야 가드가 안 꺼진다', () => {
  const hit = evaluate('src/engine/calc.ts', cfg, fakeIo());
  assert.match(hit.recover, /testFirst\.scopes/);
});

test('대응 테스트가 있으면 통과한다', () => {
  const io = fakeIo({ dirs: { 'src/engine/__tests__': ['calc.test.ts'] } });
  assert.equal(evaluate('src/engine/calc.ts', cfg, io), null);
});

test('⭐ 유예(grandfather) — 이미 있던 파일은 테스트가 없어도 통과한다', () => {
  const io = fakeIo({ files: ['src/engine/calc.ts'] });
  assert.equal(evaluate('src/engine/calc.ts', cfg, io), null);
});

test('grandfather:false 면 기존 파일도 판정한다', () => {
  const c = { testFirst: { ...cfg.testFirst, grandfather: false } };
  const io = fakeIo({ files: ['src/engine/calc.ts'] });
  assert.equal(evaluate('src/engine/calc.ts', c, io).decision, 'deny');
});

test('ask 경계는 ask 로 판정한다', () => {
  assert.equal(evaluate('src/utils/fmt.ts', cfg, fakeIo()).decision, 'ask');
});

test('경계 밖·면제 파일은 판정하지 않는다', () => {
  assert.equal(evaluate('src/views/Page.vue', cfg, fakeIo()), null);
  assert.equal(evaluate('src/engine/calc.test.ts', cfg, fakeIo()), null);
});

test('enabled 가 true 가 아니면 아무것도 판정하지 않는다 — 기본값은 꺼짐이다', () => {
  const c = { testFirst: { ...cfg.testFirst, enabled: false } };
  assert.equal(evaluate('src/engine/calc.ts', c, fakeIo()), null);
  assert.equal(evaluate('src/engine/calc.ts', {}, fakeIo()), null);
});

test('탐색 규칙이 깨지면 조용히 deny 하지 않는다 — 판정 불가는 통과시키되 보이게 남긴다', () => {
  const c = {
    testFirst: { ...cfg.testFirst, testLookup: { dirs: ['.'], pattern: '^{base}[' } },
  };
  assert.equal(evaluate('src/engine/calc.ts', c, fakeIo()), null);
});

// ── audit ───────────────────────────────────────────────────────────────────

test('--audit 은 경계 안인데 테스트 없는 파일을 센다', () => {
  const files = [
    'src/engine/calc.ts', // deny · 테스트 없음
    'src/engine/rate.ts', // deny · 테스트 있음
    'src/utils/fmt.ts', // ask · 테스트 없음
    'src/views/Page.vue', // 경계 밖
    'src/engine/calc.test.ts', // 면제
  ];
  const io = fakeIo({ dirs: { 'src/engine/__tests__': ['rate.test.ts'] } });
  const a = audit(files, cfg, io);
  assert.equal(a.total, 5);
  assert.equal(a.inScope, 3);
  assert.deepEqual(
    a.missing.map((m) => m.path),
    ['src/engine/calc.ts', 'src/utils/fmt.ts'],
  );
});

test('⭐ --audit 은 enabled:false 여도 센다 — 켜기 전에 세는 것이 목적이다', () => {
  const c = { testFirst: { ...cfg.testFirst, enabled: false } };
  const a = audit(['src/engine/calc.ts'], c, fakeIo());
  assert.equal(a.missing.length, 1);
});

test('⭐ --audit 은 유예를 무시한다 — 기존 위반 수가 곧 유예의 근거다', () => {
  const io = fakeIo({ files: ['src/engine/calc.ts'] });
  const a = audit(['src/engine/calc.ts'], cfg, io);
  assert.equal(a.missing.length, 1);
});

// ── statusOf ────────────────────────────────────────────────────────────────

test('⭐ 경계가 0개면 active 가 아니라 empty 다 — 거짓 활성은 미설치보다 나쁘다', () => {
  assert.equal(statusOf({ testFirst: { enabled: true, scopes: [] } }).state, 'empty');
});

test('enabled:false 는 off — 기본 상태다', () => {
  assert.equal(statusOf(cfg && { testFirst: { ...cfg.testFirst, enabled: false } }).state, 'off');
  assert.equal(statusOf(undefined).state, 'off');
});

test('⭐ 탈출구 환경변수가 설정돼 있으면 escaped — 켜 두고 잊은 상태를 보이게 한다', () => {
  const s = statusOf(cfg, { HARNESS_TEST_FIRST: '1' });
  assert.equal(s.state, 'escaped');
  assert.equal(s.offEnv, 'HARNESS_TEST_FIRST');
});

test('경계가 있고 탈출구가 비어 있으면 active — deny/ask 수를 보고한다', () => {
  const s = statusOf(cfg, {});
  assert.equal(s.state, 'active');
  assert.equal(s.deny, 1);
  assert.equal(s.ask, 1);
});

// ── extractFilePath ─────────────────────────────────────────────────────────

test('훅 입력 JSON 에서 대상 파일 경로를 꺼낸다', () => {
  assert.equal(extractFilePath('{"tool_input":{"file_path":"src/a.ts"}}'), 'src/a.ts');
});

test('경로가 없거나 JSON 이 아니면 null — 임의 텍스트에서 경로를 추정하지 않는다', () => {
  assert.equal(extractFilePath('{"tool_input":{"command":"ls"}}'), null);
  assert.equal(extractFilePath('그냥 텍스트'), null);
});
