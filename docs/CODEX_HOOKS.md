# Framewright의 Codex hooks

공식 문서: [Hooks](https://learn.chatgpt.com/docs/hooks). 2026-09-14 검토.
이 PC에서 확인한 CLI는 `codex-cli 0.154.0`이다.

## 분석과 적용 범위

Hooks는 세션 시작, 도구 실행 전후, 답변 종료 같은 시점에 실행되는 자동화다.
설정은 프로젝트의 `.codex/hooks.json`에 두고, 실행 코드는
`scripts/codex-hooks.mjs`에서 관리한다. 설정 생성 원본은
`scripts/install-codex-hooks.mjs`이다.

| 이벤트         | 이 저장소에서 하는 일                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `SessionStart` | 시작·재개·초기화·컨텍스트 압축 후 기존 handoff 스크립트로 STATUS 안내를 전달                                             |
| `PreToolUse`   | `apply_patch`, `Edit`, `Write`의 보호 파일·저장소 밖 대상 편집을 차단하고, `Bash`의 보호 파일 쓰기·이동·삭제 명령을 거부 |
| `PostToolUse`  | 편집한 파일을 Prettier로 정리한 뒤 guardrails와 references를 순서대로 검사                                               |
| `Stop`         | references → guardrails → hook 테스트 → TypeScript → Vitest 검사                                                         |

보호 파일 목록과 판정은 `scripts/protected-paths.mjs` 하나가 원천이다. Claude의
`scripts/hook-protect.mjs`·`scripts/hook-format.mjs`는 같은 handler를 부르는
얇은 껍데기이고, Claude의 셸 가드(`harness.config.mjs`의 `dangerGuard.deny`)도
같은 모듈의 규칙을 가져다 쓴다. 두 에이전트의 규칙이 서로 어긋날 자리가 없다.
단 "저장소 밖 편집 차단"은 Codex에만 적용한다(`confine`). Codex는 cwd 상대경로
패치를 쓰므로 `../`·junction 탈출을 막아야 하지만, Claude는 메모리 디렉터리
(`~/.claude/projects/<slug>/memory/`)·작업 임시 폴더·짝 저장소처럼 저장소 밖에
정상적으로 쓴다. Claude 껍데기는 `confine: false`로 부르되 보호 이름 규칙은
전체 경로에 그대로 적용해 `~/.npmrc`·`~/.claude/settings.json`은 계속 막는다.
보호 대상: lockfile, `.env*`, `.envrc`, `.npmrc`, `*.pem`·`*.key`, `.git`,
`.claude/settings*.json`, `.codex/hooks.json`·`config.toml`, 실행되는 Prettier
설정(`prettier.config.*`, `.prettierrc.*js`). npm 패키지를 추가하지 않으며
Node, Git, 이미 설치된 Prettier·TypeScript·Vitest를 사용한다.

## 호환성을 위해 바꾼 부분

- Codex의 `apply_patch`는 `tool_input.command`에 여러 파일의 패치를 담는다.
  기존 Claude hook의 `file_path`만 검사하면 누락되므로 추가·수정·삭제·이동
  대상 모두 읽는다. 경로 정규화와 기존 부모의 실제 경로를 확인한다. 실제 경로는
  `realpathSync.native`로 구해 Windows 8.3 짧은 이름(`PACKAG~2.JSO`)도 긴 이름으로
  풀리며, 끝에 점·공백이 붙거나 `:`가 든 이름은 Windows에서 다른 파일로 해석될
  수 있어 거부한다.
- 작업 폴더는 항상 저장소 루트라고 가정할 수 없다. 실행 명령에서 Git 루트를
  구하고, 검사 프로세스는 그 루트를 기준으로 실행한다. Windows에서도 같은
  Node 명령을 사용하며 `npm.ps1` 실행 정책 변경이 필요 없다. Git이 없거나 그
  루트에 handler가 없으면 런처는 exit 2로 닫힌다 — exit 1은 Codex가 비차단
  오류로 보고 편집을 진행시키기 때문이다. 중첩 저장소 안에서 작업하면 그
  저장소의 루트를 얻어 편집이 전부 막히므로, 그때는 바깥 저장소에서 연다.
- 같은 이벤트의 handler들은 동시에 실행될 수 있다. 포맷과 정적 검사는 하나의
  handler 안에 순서대로 배치했다. 편집 파일명을 셸 명령에 삽입하지 않는다.
- `Stop`은 JSON을 반환한다. 첫 실패는 수정을 요청하고, 이미 Stop이 이어서
  실행시킨 턴에서도 실패하면 `systemMessage`로 알리고 종료를 허용한다.
  성공으로 바꾸거나 검증 스탬프를 쓰지는 않는다. 각 검사는 최대 45초다.
- 기존 danger-guard의 `permissionDecision: "ask"`는 현재 Codex에서 지원되지
  않는다. 따라서 harness 계측과 ask 규칙은 연결하지 않고 Codex의 기본 권한·승인
  절차를 그대로 쓴다. 다만 보호 파일에 대한 셸 쓰기는 `deny`로 막는다 — Codex는
  셸 도구를 hook payload에서 `Bash`로 부르고 `tool_input.command`에 문자열을
  준다. 규칙은 직접 파일 조작(rm·mv·cp·리다이렉션·PowerShell 쓰기 cmdlet·
  `git checkout --` 등)만 보는 거친 그물이며, `npm install`이 lockfile을 다시
  쓰는 정상 경로는 막지 않는다.

## 설치와 활성화

설정을 미리 보려면:

```powershell
node scripts/install-codex-hooks.mjs
```

설치하려면:

```powershell
npm.cmd run setup:codex
```

기존 `.codex/hooks.json`이 다른 내용이거나 `config.toml`에 inline hooks가
있으면 설치기는 덮어쓰지 않고 중단한다. 같은 설정의 재설치는 아무것도 바꾸지
않는다. macOS/Linux에서는 `npm run setup:codex`를 사용한다.

설치 후 프로젝트를 Codex에서 다시 열고, CLI의 `/hooks`에서 이 프로젝트의
네 hook 명령을 검토하고 신뢰한다. 프로젝트 자체도 신뢰되어야 한다.
공식 문서상 새로 추가되거나 정의가 변경된 비관리 hook은 신뢰 등록 전에는
건너뛴다. 파일 설치·스크립트 테스트 통과와 런타임 활성화는 별개다.
신뢰 우회 옵션이나 신뢰 기록의 직접 수정은 사용하지 않는다.

활성화 확인: 새 세션에 Framewright handoff가 표시되는지, 일반 파일 편집 후
포맷·검사가 실행되는지 확인한다. `/hooks`에서 해당 hook을 개별 비활성화할
수 있다. 다른 위치나 플러그인의 hook도 함께 실행될 수 있으므로 중복도 확인한다.

## Hooks 밖에서 Codex가 읽는 것

Hooks는 실행 시점의 자동화일 뿐이고, 규칙과 역할은 별도 파일로 읽힌다.
2026-09-14에 Codex 소스로 확인한 사실이다.

- **`AGENTS.md`(저장소 루트)** — Codex는 `AGENTS.md`(또는
  `AGENTS.override.md`)만 자동으로 읽고 `CLAUDE.md`는 읽지 않는다. 기본
  예산은 32 KiB(`project_doc_max_bytes`)라 38 KiB인 `CLAUDE.md`를 fallback
  으로 걸어도 끝부분이 잘린다. 그래서 `AGENTS.md`는 `CLAUDE.md`의 규칙
  부분을 Codex에 맞게 옮긴 쌍둥이 파일이고, 「Known tech debt」 목록은
  `CLAUDE.md`에만 둔다. 규칙이 바뀌면 두 파일을 함께 고친다.
- **`.codex/agents/*.toml`** — `.claude/agents/*.md`의 여섯 페르소나를 Codex
  역할 형식(`name`, `description`, `developer_instructions`)으로 옮긴 것.
  Claude 쪽의 `tools: Read, Grep, Glob` 같은 도구 제한은 Codex 역할에
  없으므로 "편집하지 말고 보고하라"를 지시문에 직접 적었다.
- **`.codex/skills/*/SKILL.md`** — `.claude/commands/`의 `/adr`, `/handoff`,
  `/new-command`. Codex에는 `$ARGUMENTS` 방식의 커맨드가 없어 스킬로
  옮겼고, 인자는 사용자의 요청 문장에서 읽는다.
- **`.codex/config.toml`** — `[agents]` 블록만 있다. hooks는 여기 넣지
  않는다(설치기가 inline hooks가 있으면 중단한다).

시각 QA는 Claude in Chrome이 아니라 dev-browser로 한다. 규칙은
`docs/TESTING.md` 「Visual QA」에 있고 게이트(`npm run verify`)는 바뀌지
않는다.

## 검증과 한계

```powershell
npm.cmd run test:hooks
npm.cmd run verify
```

Hook 테스트는 패치 경로, 보호 대상과 그 닮은꼴, junction을 통한 외부 경로,
Windows 8.3 짧은 이름과 모호한 철자, 셸 쓰기 명령의 거부와 읽기 명령의 통과,
입력 오류, 공백·한글·셸 문자가 있는 파일의 포맷, 삭제·무시 파일, Stop의 종료
제한, 검사 프로세스 오류, Claude 껍데기의 fail-closed, 하위 폴더에서의 실제
설정 명령 실행, handler를 찾지 못한 런처의 exit 2를 검사한다.

파일 보호와 자동 포맷은 설정된 편집 도구에 적용하고, 셸 가드는 직접 파일
조작 명령만 본다. 스크립트 언어(`python -c`, `node -e`)나 MCP를 통한 파일
변경까지 감시하는 보안 경계는 아니다. PostToolUse 실패는 이미 끝난 편집을
되돌리지 않는다. Hook 자체의 런타임 실패·외부 timeout은 검증 통과를 뜻하지
않으므로 표시되는 실패를 확인해야 한다.

Stop 검사는 질문만 하는 턴에서도 실행되며 E2E를 포함하지 않는다. 완성 판단은
E2E가 포함된 `npm run verify` 결과로 한다. 기존 제품 테스트 실패가 있으면
hooks 테스트 결과와 나누어 `docs/STATUS.md`에 기록한다.
