# Framewright의 Codex hooks

공식 문서: [Hooks](https://learn.chatgpt.com/docs/hooks). 2026-09-14 검토.
이 PC에서 확인한 CLI는 `codex-cli 0.154.0`이다.

## 분석과 적용 범위

Hooks는 세션 시작, 도구 실행 전후, 답변 종료 같은 시점에 실행되는 자동화다.
설정은 프로젝트의 `.codex/hooks.json`에 두고, 실행 코드는
`scripts/codex-hooks.mjs`에서 관리한다. 설정 생성 원본은
`scripts/install-codex-hooks.mjs`이다.

| 이벤트         | 이 저장소에서 하는 일                                                              |
| -------------- | ---------------------------------------------------------------------------------- |
| `SessionStart` | 시작·재개·초기화·컨텍스트 압축 후 기존 handoff 스크립트로 STATUS 안내를 전달       |
| `PreToolUse`   | `apply_patch`, `Edit`, `Write`의 lockfile·`.env`·`.git`·저장소 밖 대상 편집을 차단 |
| `PostToolUse`  | 편집한 파일을 Prettier로 정리한 뒤 guardrails와 references를 순서대로 검사         |
| `Stop`         | references → guardrails → hook 테스트 → TypeScript → Vitest 검사                   |

기존 `.claude/`와 `.harness/` 코드는 변경하지 않는다. npm 패키지를 추가하지
않으며 Node, Git, 이미 설치된 Prettier·TypeScript·Vitest를 사용한다.

## 호환성을 위해 바꾼 부분

- Codex의 `apply_patch`는 `tool_input.command`에 여러 파일의 패치를 담는다.
  기존 Claude hook의 `file_path`만 검사하면 누락되므로 추가·수정·삭제·이동
  대상 모두 읽는다. 경로 정규화와 기존 부모의 실제 경로를 확인한다.
- 작업 폴더는 항상 저장소 루트라고 가정할 수 없다. 실행 명령에서 Git 루트를
  구하고, 검사 프로세스는 그 루트를 기준으로 실행한다. Windows에서도 같은
  Node 명령을 사용하며 `npm.ps1` 실행 정책 변경이 필요 없다.
- 같은 이벤트의 handler들은 동시에 실행될 수 있다. 포맷과 정적 검사는 하나의
  handler 안에 순서대로 배치했다. 편집 파일명을 셸 명령에 삽입하지 않는다.
- `Stop`은 JSON을 반환한다. 첫 실패는 수정을 요청하고, 이미 Stop이 이어서
  실행시킨 턴에서도 실패하면 `systemMessage`로 알리고 종료를 허용한다.
  성공으로 바꾸거나 검증 스탬프를 쓰지는 않는다. 각 검사는 최대 45초다.
- 기존 danger-guard의 `permissionDecision: "ask"`는 현재 Codex에서 지원되지
  않는다. 따라서 이 설치에는 Bash 가드와 harness 계측을 연결하지 않았다.
  Codex의 기본 권한·승인 절차를 그대로 사용한다.

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

## 검증과 한계

```powershell
npm.cmd run test:hooks
npm.cmd run verify
```

Hook 테스트는 패치 경로, 보호 대상, junction을 통한 외부 경로, 입력 오류,
공백·한글·셸 문자가 있는 파일의 포맷, 삭제·무시 파일, Stop의 종료 제한,
검사 프로세스 오류, 하위 폴더에서의 실제 설정 명령 실행을 검사한다.

파일 보호와 자동 포맷은 설정된 편집 도구에만 적용한다. Bash/PowerShell이나
MCP를 통한 파일 변경까지 감시하는 보안 경계는 아니다. PostToolUse 실패는
이미 끝난 편집을 되돌리지 않는다. Hook 자체의 런타임 실패·외부 timeout은
검증 통과를 뜻하지 않으므로 표시되는 실패를 확인해야 한다.

Stop 검사는 질문만 하는 턴에서도 실행되며 E2E를 포함하지 않는다. 완성 판단은
E2E가 포함된 `npm run verify` 결과로 한다. 기존 제품 테스트 실패가 있으면
hooks 테스트 결과와 나누어 `docs/STATUS.md`에 기록한다.
