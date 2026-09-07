/**
 * framewright 하네스 설정 — 골격의 슬롯이 모이는 단 하나의 파일.
 * 원본 골격: surahha-ha/harness-agent (`skeletons/` → `.harness/`, `harness.config.example.mjs` → 이 파일).
 *
 * 비워 둔 슬롯은 "아직 안 정함" 이지 "해당 없음" 이 아니다. 해당 없음이면 `null` 을 명시한다.
 * 판별 질문은 원본 `harness.config.example.mjs` 의 주석에 있다 — 여기서는 답만 적는다.
 *
 * 겹침 확인(bootstrap ⓪, 2026-09-07):
 *   - Bash/PowerShell 실행 전·후 훅 = 없었음 → 골격 1(danger-guard)이 빈 자리를 채운다.
 *   - Stop 훅 = scripts/hook-gate.mjs(refs→guardrails→typecheck→unit, 레드면 종료 거부) → 골격의
 *     turn-end.mjs 는 기록만 하므로 나란히 건다. 게이트 거부로 Stop 이 한 턴에 여러 번 와도 리포트는
 *     turn 단위로 모은다.
 *   - test-first 게이트 = 없음(hook-gate 는 테스트 실행이지 존재 검사가 아님) → 게이트는 끄고
 *     `auditOnStop` 만 켜서 시계열(v2 검증 축)만 얻는다.
 */

export default {
  project: {
    name: 'framewright — WebCodecs 기반 브라우저 비디오 편집기 (단일 저장소)',
    repos: {
      self: '.',
      // 한쪽만 고치면 런타임에 깨지는 상대 저장소 없음.
      peers: [],
    },
  },

  /** 종료코드만으로 통과/실패를 판정할 수 있는 명령 — 파이프 없음(package.json scripts 그대로). */
  commands: {
    build: 'npm run build',
    unitTest: 'npm test',
    e2e: 'npm run e2e',
    lint: 'npm run format:check',
  },

  /** 1인 프로젝트 — 잘못하면 수습하는 사람 = 저장소 소유자 본인. */
  approvals: {
    destructive: '본인(저장소 소유자)',
    spec: '본인(저장소 소유자)',
    release: '본인(저장소 소유자)',
  },

  /** ── 골격 1: 위험 명령 가드 ───────────────────────────────────────────── */
  dangerGuard: {
    enabled: true,

    /**
     * deny — 5분 안에 원상복구할 수단이 없거나, 틀려도 그 자리에서 티가 안 나는 것.
     * 패턴은 명령이 시작될 수 있는 자리(행 첫머리 · `;` `&&` `|` `(` 뒤)에서만 본다 —
     * 같은 문자열이 커밋 메시지·검색 패턴·이 파일 안에 있으면 통과해야 한다.
     */
    deny: [
      {
        id: 'no-force-push',
        pattern:
          /(^|[;&|(]\s*)git\s+push\b[^;&|]*\s(--force\b|-f\b|--force-with-lease\b)/,
        why: '원격 이력을 덮어씁니다 — 공개 저장소(GitHub)의 이력은 5분 안에 되돌릴 수 없습니다.',
        recover:
          '되돌리려면 revert 커밋으로 앞으로 나아가세요. 정말 이력을 다시 써야 하면 사람이 직접 실행합니다.',
      },
      {
        id: 'no-piped-gate',
        pattern:
          /(^|[;&|(]\s*)npm\s+(test|run\s+(verify|typecheck|typecheck:engine|e2e|e2e:\w+|build|check:\w+|format:check))\b[^|;&]*\|/,
        why: '검증 명령의 출력을 파이프로 넘기면 종료코드가 파이프 끝 명령의 것이 되어 실패가 통과로 보입니다 — 조용히 틀린 채 다음 작업의 입력이 됩니다.',
        recover:
          '파이프 없이 그대로 실행하고 결과 줄을 읽으세요. 출력이 길면 파일로 리다이렉션한 뒤 종료코드를 따로 확인합니다.',
      },
    ],

    /**
     * ask — 정규 절차인데 무언가 사라지거나, CLAUDE.md 가 "먼저 알리고 기다리라" 고 정한 것.
     * CLAUDE.md: "Announce before any git operation and wait. This is the one hard stop."
     */
    ask: [
      {
        id: 'git-discard-worktree',
        pattern:
          /(^|[;&|(]\s*)git\s+(reset\s+--hard\b|clean\s+-[a-zA-Z]*f|checkout\s+--\s|restore\b(?![^;&|]*--staged))/,
        why: '커밋되지 않은 작업이 사라집니다.',
        recover: '남길 게 있으면 stash 하거나 브랜치를 만든 뒤 진행하세요.',
      },
      {
        id: 'announce-git-write',
        pattern:
          /(^|[;&|(]\s*)git\s+(commit|push|rebase|merge|tag|branch\s+-[dD])\b/,
        why: 'CLAUDE.md 규칙 — git 조작은 실행 전에 알리고 소유자의 답을 기다립니다(유일한 하드 스톱).',
        recover:
          '무엇을 커밋·푸시할지 먼저 보고하고 승인 뒤 실행하세요. 조회(status·log·diff)는 자유입니다.',
      },
    ],

    /** 공유 자원 없음 — 브라우저 로컬 앱, 원격 DB·공유 환경에 닿는 명령이 없다. */
    shared: {
      targetPattern: null,
      writePattern: null,
      why: '공유 환경에 쓰기를 실행합니다.',
      recover:
        '실행 전 승인을 받으세요. 조회·검증만이라면 그대로 진행해도 됩니다.',
    },

    /** 검증 전용 프로브 — 아무것도 막지 않는 표식. `echo HARNESS-PROBE-FW-4c1e` 로 발동을 잰다. */
    probe: {
      token: 'HARNESS-PROBE-FW-4c1e',
    },
  },

  /** ── v2: 위임 승격 — ask 실발동이 쌓인 뒤 실측으로 채운다. 셋 다 채우기 전에는 후보 판정 없음. */
  promotion: {
    n: null,
    immediateSeconds: null,
    spreadDays: null,
  },

  /** ── 골격 2: 경계표 기반 test-first 가드 ──────────────────────────────── */
  testFirst: {
    // 게이트는 끈다 — Stop 훅(hook-gate)이 테스트 실행을 이미 강제하고, 존재 검사까지 겹쳐 켜지 않는다.
    enabled: false,
    // 턴 종료마다 선실측 audit 을 남긴다(v2 검증 축 대체 경로). 경계표가 있으니 셀 것이 있다.
    auditOnStop: true,
    grandfather: true,

    /**
     * 경계표의 SSOT = CLAUDE.md "TDD" 절: engine 로직은 test-first(red→green), 디코딩·재생·내보내기처럼
     * WebCodecs 에 닿아 Node 에서 못 도는 것은 e2e 로 덮는다. 후자는 아래 exempt 로 뺀다.
     */
    scopes: [
      {
        decision: 'deny',
        pattern: /^src\/engine\/.*\.ts$/,
        what: 'CLAUDE.md TDD 절 — engine 은 순수 계산, Vitest spec 이 곧 스펙',
      },
    ],

    exempt: [
      /(^|\/)__tests__\//,
      /\.(test|spec)\.[cm]?[jt]sx?$/,
      /\.d\.ts$/,
      /\.(md|json|ya?ml|xml|html|css|svg|sql|csv|txt)$/,
      // 타입 선언만 있는 파일 — 실행 로직 없음
      /^src\/engine\/types\.ts$/,
      // WebCodecs·WebAudio 경계 — CLAUDE.md 가 e2e 로 덮으라고 정한 영역 (Node 에 없음).
      // 2026-09-07 선실측 표본 대조: exporter(VideoEncoder·AudioData) · audioPlayer(AudioContext) 가 이쪽.
      /^src\/engine\/(decoder|player|exporter|audioPlayer)\.ts$/,
    ],

    /** 테스트는 대상 파일 옆에 `{base}.test.ts` 로 둔다 (src/engine 실측). */
    testLookup: {
      dirs: ['.', '__tests__'],
      pattern: '^{base}[\\w.\\-]*\\.(test|spec)\\.[cm]?[jt]sx?$',
    },

    offEnv: 'HARNESS_TEST_FIRST',
  },

  /** ── 골격 4: 드리프트 감시 — 사본↔원본 축 (harness-agent 가 같은 부모 폴더에 있다) ── */
  drift: {
    mirrors: [
      { a: '.harness', b: '../harness-agent/skeletons', compare: 'content' },
    ],
    approvedDifferences: [
      {
        path: 'log.jsonl',
        why: '설치처 계측 로그 — 런타임 산출물이라 원본 골격에는 없다(.gitignore)',
      },
      {
        path: 'promotions.jsonl',
        why: '설치처 승격 레코드 — 런타임 산출물이라 원본 골격에는 없다(.gitignore)',
      },
    ],
  },

  /** ── 골격 5: 문서 규약 게이트 ─────────────────────────────────────────── */
  docs: {
    // 틀리면 다음 세션이 잘못 출발하는 문서 — SessionStart 훅이 STATUS.md 를 읽는다.
    always: ['CLAUDE.md', 'docs/STATUS.md', 'docs/HANDOVER.md'],
    // 시점 박제 — 낡아도 되는 곳.
    archive: ['docs/research'],
  },

  /** ── 골격 6: 품질 사이클 ──────────────────────────────────────────────── */
  qualityCycle: {
    lightPath: {
      enabled: true,
      disqualifiers: [
        '계약이 바뀐다 (외부에 노출되는 입출력·엔드포인트·스키마·이벤트)',
        '되돌리기가 커밋 하나로 끝나지 않는다',
        '공유 자원에 닿는다',
        '조건 분기나 권한 판정을 바꾼다 (한 줄이어도 해당)',
        '제품 결정이 걸려 있다',
        '판단이 서지 않는다',
      ],
    },
    flakiness: [],
  },
};
