# 레포 분석 메모 — 2026-09-09

사용자 요청으로 앞선 대화의 분석 결과를 영속 보관한다.
**이 문서는 당시 코드에 대한 분석 기록이며, 현재 코드의 재검증 결과가 아니다.**
저장 시점에 STATUS.md가 전환 효과 완료 및 E7 item 3 오디오 볼륨으로 갱신된 것을
확인했다. 아래 발견 사항을 수정하기 전 최신 코드에서 다시 확인해야 한다.
현재 진행 상태는 [STATUS.md](STATUS.md)를 따른다.

## 프로젝트 구조와 당시 구현 상태

framewright는 기본 편집부터 자막·MP4 내보내기까지 구현된 브라우저 영상 편집기 MVP다.

| 영역 | 구성 및 역할 |
|---|---|
| 화면 | React 18 + TypeScript + Vite. 미디어 목록, 미리보기, 타임라인, 자막 패널 |
| 상태 연결 | Zustand의 projectStore가 편집 엔진과 UI·자동 저장을 연결 |
| 편집 엔진 | 명령과 역방향 패치로 편집·Undo/Redo 처리 |
| 시간 모델 | 정수 프레임, 유리수 FPS, 반열린 범위 `[in, out)` |
| 미디어 | mp4box로 컨테이너 분석, WebCodecs로 디코딩·인코딩, WebAudio로 음성 재생 |
| 저장 | 프로젝트·버전은 localStorage, 원본 미디어는 OPFS |
| 출력 | 프레임별 출력 계획을 실행해 H.264 영상과 지원되는 경우 AAC 음성을 MP4로 출력 |

분할·리플 삭제·트림·이동·스냅·빈 구간 제거·복사/붙여넣기·단축키 설정·명령 팔레트·
타임라인 확대·썸네일·파형·자막이 구현되어 있었다.
당시 서버·인증·기기 간 동기화는 구현되어 있지 않았다.

근거: [package.json](../package.json), [App.tsx](../src/App.tsx),
[Editor](../src/engine/command.ts), [시간 모델](../src/engine/time.ts),
[편집 명령](../src/engine/commands.ts), [자막 명령](../src/engine/subtitleCommands.ts),
[미디어 연결](../src/ui/media.ts), [프로젝트 저장](../src/engine/storage.ts),
[미디어 저장](../src/engine/mediaStore.ts), [제품 맥락](HANDOVER.md).
링크는 현재 파일을 가리키므로 당시 코드와 달라질 수 있다.

평가: 화면과 편집 로직의 분리, 공통 시간 계산, 과거 오류를 재현하는 테스트가 강점이다.
재생 루프는 [Preview.tsx](../src/ui/Preview.tsx), 저장·편집 연결은
[projectStore.ts](../src/store/projectStore.ts)에 집중되어 있어 기능 확장 시 책임 관리가 필요하다.

## 주요 발견 사항

### 1. 높음 — 새로고침 후 버전 기록 ID 중복: 당시 재현 확인

`projectStore.ts`가 `versionCounter = versions.length`로 초기화했다.
삭제·자동 정리 후 기록 개수와 기존 ID의 최대 번호가 달라지면 ID를 재사용할 수 있다.

실제 TypeScript 모듈을 메모리에서 변환해 실행하고 가짜 localStorage를 주입했다.
`ver_2`, `ver_3` 두 기록을 로드한 뒤 `saveVersion('new')`를 실행한 결과:

```text
Version IDs after reload and save: [ 'ver_2', 'ver_3', 'ver_3' ]
Labels after deleting ver_3: [ 'second' ]
```

`deleteVersion('ver_3')`가 두 기록을 함께 삭제하는 것을 확인했다.
복원도 `find`로 ID를 찾으므로 중복 시 잘못된 기록을 선택할 수 있고 React key도 중복된다.
근거: [projectStore.ts](../src/store/projectStore.ts)의 `versionCounter`, `nextVersionId`,
`restoreVersion`, `deleteVersion`; [VersionPanel.tsx](../src/ui/VersionPanel.tsx).

권장: 기존 ID와 충돌하지 않는 카운터를 복구하거나 별도로 영속화한다.
삭제·자동 정리 → 새로고침 → 기록 추가 → 복원·삭제 회귀 테스트가 필요하다.

### 2. 중간 — 내보내기 초기 실패 시 인코더 정리 누락: 당시 코드 검토

인코더 생성·설정과 `encodeAudioTrack` 호출이 `cleanup()`을 호출하는
`try/finally`보다 먼저 실행됐다. 오디오 인코딩 오류·취소 등 이 구간의 예외는
인코더 `close()`를 건너뛰는 구조였다. 브라우저에서 누수량을 측정한 것은 아니다.
근거: [exporter.ts](../src/engine/exporter.ts)의 인코더 초기화, `encodeAudioTrack`, `cleanup`.

권장: 자원을 생성하는 단계부터 정리 범위에 포함하고 초기 실패·취소 경로를 검증한다.

### 3. 중간 — 저장 데이터 내부 구조 검증 부족: 당시 재현 확인

`looksLikeProject`는 배열 존재 여부 등을 확인하지만 트랙 내부, FPS,
프레임 범위 등의 불변 조건은 검증하지 않았다. 다음 입력의 `deserialize` 결과가
null이 아닌 것을 확인했다.

```json
{"schemaVersion":2,"project":{"tracks":[null],"assets":[],"timeline":{},"nextId":-1}}
```

손상된 저장값이 후속 트랙 순회 및 화면 초기화 오류로 이어질 수 있다.
근거: [persistence.ts](../src/engine/persistence.ts)의 `looksLikeProject`, `deserialize`;
[timeline.ts](../src/engine/timeline.ts)의 `videoTrack`, `timelineDuration`.

권장: 저장 데이터 경계에서 내부 구조와 수치 범위를 검증하고 손상 데이터 복구 경로를 마련한다.

### 4. 중간 — 다른 화면비에서 자막 미리보기와 출력 불일치: 기존 기술 부채

미리보기는 타임라인 크기의 자막 캔버스를 원본 영상 표시 영역에 맞추고,
출력은 원본을 타임라인 크기의 화면에 레터박스로 배치했다.
원본과 타임라인 화면비가 다르면 자막의 상대 위치·비율이 어긋날 수 있다.
이번 분석에서 별도 시각 재현은 하지 않았다.
근거: [Preview.tsx](../src/ui/Preview.tsx), [exporter.ts](../src/engine/exporter.ts),
[CLAUDE.md](../CLAUDE.md)의 Known tech debt.

### 5. 문서와 구현 상태 불일치

당시 [README.md](../README.md)는 트림·클립보드·버전 기록을 구현 예정으로,
[TESTING.md](TESTING.md)는 오디오 파이프라인이 없다고 기술했지만 실제 구현은 존재했다.
현재 기능 판단에는 코드와 최신 STATUS.md를 우선 참고한다.

## 당시 실제 검증 결과

- `npm.cmd run verify`: 성공. 참조 검사, 구조 규칙 검사, TypeScript 검사 통과.
- Vitest: **26개 파일, 398개 테스트 통과**.
- Playwright Chromium: **90개 테스트 통과**, 스킵 없음. 가져오기·내보내기도 실행됨.
- `npm.cmd run build`: 성공. JS 447.99 kB, gzip 132.32 kB.
- PowerShell에서 `npm`은 `npm.ps1` 실행 정책 오류가 발생해 `npm.cmd`를 사용했다.
- 버전 ID 및 역직렬화 재현은 메모리 저장소를 사용했으며 사용자 브라우저 저장값을 변경하지 않았다.
- 분석 중 소스 수정 및 Git 쓰기 작업은 하지 않았다. 빌드·테스트 산출물은 생성되었다.
- 실사용 Chrome 시각 QA, 장시간·대용량 미디어 부하 검증, 출력 프레임 골든 비교는 이번 분석 범위에 포함되지 않았다.
- 이 수치는 앞선 분석 실행 결과다. 이후 변경된 코드에 대한 새 테스트 결과로 인용하지 않는다.

## 당시 권장 순서와 후속 사용법

**버전 ID 중복 → 내보내기 자원 정리 → 저장 데이터 검증 → 자막 화면비 일치 → 전환 효과 확장.**

이는 당시 분석에 따른 권고다. 저장 시점에는 전환 효과가 완료되었다고 최신 STATUS에
기록되어 있으므로 전환 효과 구현을 다시 시작하지 않는다.
새 작업에서는 발견 사항이 여전히 존재하는지 확인하고 필요한 회귀 테스트부터 추가한다.
사용자는 분석 결과 저장을 요청했으며, 이번 요청으로 코드 수정을 지시한 것은 아니다.
