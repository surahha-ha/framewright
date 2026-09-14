# STATUS — the live handoff

**This file is the handoff.** It is rewritten at the end of every unit of work,
by whoever did the work, before they report anything to the owner.

Write it for a reader with **zero memory of any conversation**. No "as
discussed", no "the fix we talked about", no pronoun pointing at chat history.
If it is not in a file in this repo, it does not exist — chat context dies, the
repo does not.

<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->

**Last verified:** 2026-09-14 01:22 UTC — `npm run verify` **GREEN**

- unit 562 passed · e2e 110 passed

<!-- VERIFY:END -->

## Where we are

### Codex hooks integration (2026-09-14) — in the tree, not yet committed

The owner is moving implementation to Codex from here. A Codex session
adapter was added: `scripts/codex-hooks.mjs` (SessionStart, PreToolUse,
PostToolUse, Stop), the non-overwriting installer
`scripts/install-codex-hooks.mjs` (`npm run setup:codex`), the contract
tests `scripts/codex-hooks.test.mjs` (`npm run test:hooks`, 9 tests, now a
step of `verify`), the installed `.codex/hooks.json`, and
`docs/CODEX_HOOKS.md` (behaviour, activation, limits). `.claude/` and
`.harness/` are untouched. **Runtime activation is separate from the
files:** the four hook commands must be reviewed and trusted in Codex's
`/hooks` in a fresh project session, and the project itself trusted.
Nothing has confirmed that yet.

**What Codex reads and does not read (checked against the Codex source
on 2026-09-14, CLI 0.154.0 on this PC):**

- Codex loads `AGENTS.md` (or `AGENTS.override.md`) from the repo root,
  never `CLAUDE.md`, unless `.codex/config.toml` sets
  `project_doc_fallback_filenames = ["CLAUDE.md"]`. The budget is
  `project_doc_max_bytes` = 32 768 by default; `CLAUDE.md` is 38 223 bytes,
  so even as a fallback its tail (the "Known tech debt" list) would be cut.
  **There is no `AGENTS.md` yet.**
- The persona subagents in `.claude/agents/*.md` (Claude frontmatter:
  `tools`, `model`) have no Codex reader. Codex roles are
  `.codex/agents/<name>.toml` with `name`, `description`,
  `developer_instructions`, `model`, enabled by `[agents]` in config.
- The slash commands in `.claude/commands/*.md` (`/adr`, `/handoff`,
  `/new-command`, `$ARGUMENTS`) have no Codex reader. The nearest Codex
  shape is a skill: `.codex/skills/<name>/SKILL.md` with `name` and
  `description` frontmatter (also `.agents/skills/`).
- The docs name Claude-only tools by name: `CLAUDE.md` ("Task tool",
  `list_connected_browsers`), `docs/TESTING.md` §Visual QA and
  `docs/HANDOVER.md` (Claude in Chrome). Codex has no Claude in Chrome;
  the visual pass is "skip and say so" there, as the docs already allow.
- Codex's hook contract has no `permissionDecision: "ask"`, so the Bash
  danger guard (force-push, pipe-into-verify, git writes) is not wired for
  Codex. The "announce before any git operation" rule holds by text only.

**The red gate of 2026-09-14 00:34 UTC is diagnosed and fixed.** The
failure at `e2e/frame.spec.ts:110` (세로 chosen, canvas still 320×180)
was a race in the spec, not the product: the frame command sets the status
sentence synchronously, but the canvas is resized inside the next
`paint()`, which `pump()` reaches only after `decodeAtSec` resolves. The
spec read the size once, right after the sentence; on a slow run the
decode had not landed. Reproduced once on the `chrome` project (the
`chromium` run beside it passed), then every `canvasSize` assertion in
that spec became `expect.poll` with a comment saying why. The whole spec
then passed 16/16 (four cases × two projects × `--repeat-each=2`), and
the full gate stamped GREEN above.

### Product work

**E8's first item, the shorts reframe, is committed as `10050d3`**
(2026-09-11, with the owner's approval, after the persona round and a
visual pass in the owner's Chrome) on top of `0a06c7d` (E7 complete),
and **pushed on 2026-09-14** with the owner's approval: `origin/main` =
`845bfa4` (the docs commit after it). The thirteen edited and seven new
files are listed below.

### What is new (ADR-0015)

- **`src/engine/frame.ts`** (new, 7 unit tests) — `FrameShape`
  가로 16:9 / 세로 9:16 / 정사각 1:1; `frameShapeOf` (which preset a box is,
  within 1%, or null for a 4:3 project); `frameSize` (the SHORT side keeps
  its pixel count, nearest even: 1280×720 → 720×1280, 640×480 → 854×480;
  the presets are each other's inverse); `frameText`, `sizeText`;
  `describeFrame` with two hints — "비는 클립을 고르고 화면 채우기를 누르면
  꽉 차요" when a clip no longer covers the box, "크게 확대된 클립은 화면
  원래대로로 되돌릴 수 있어요" when a clip is zoomed past what the new
  box needs.
- **`src/engine/frameCommands.ts`** (new, 7 dispatcher tests) —
  `frame.landscape` / `frame.portrait` / `frame.square` ("가로 / 세로 /
  정사각 영상으로 바꾸기"), generated from `FRAME_SHAPES` like the nudges;
  each one `setTimeline` op with the fps kept and the old box as inverse;
  `hidden` (palette rows, no toolbar button, no default key); refused on an
  empty project ("영상을 먼저 넣어 주세요." — the first import sets the box
  and would overwrite a choice) and for the current shape ("지금 가로
  영상이에요."). **Nothing on any clip is rewritten**; `frameHints(project)`
  reads the AFTER document for the sentence.
- **`src/engine/picture.ts`** — `emptySides` / `clipEmptySides` (which
  sides of the box are black, GEOMETRIC from `pictureRect`, 1px epsilon),
  `emptySidesText` ("화면 위아래가 비어요", "화면 양옆이 비어요", "화면
  왼쪽이 비어요", "화면 위아래와 오른쪽이 비어요" — one sentence shape,
  이/가 and 과/와 by the last syllable), `coversBox` now takes sizes
  (`(srcW, srcH, boxW, boxH, t)`), `fillZoom` / `clipFillZoom` (the
  smallest 10% notch that covers the box: 320% for 16:9 in 9:16, 240% for
  4:3, 180% in a square; capped at 400%). Unit 22 tests in `picture.test.ts`.
- **`src/engine/pictureCommands.ts`** — `clip.pictureFill` ("화면
  채우기", `⛶`, hidden, palette row, panel button between 화면 돌리기 and
  화면 원래대로): sets `zoom` to `clipFillZoom`, keeps the pan. Sentences:
  "화면을 320%로 확대해 꽉 채웠어요." / "…로 확대했어요 · 옮겨 둔 위치
  때문에 화면 왼쪽이 비어요" / at the cap "…400%까지 확대했어요 · 더는 키울
  수 없어 화면 위아래가 비어요". Disabled reasons, three-way: "화면이 이미
  꽉 차 있어요." / "확대는 충분해요 · 위치를 가운데로 옮기면 꽉 차요." (the
  same zoom CENTRED would cover) / "더는 키울 수 없어요 · 화면 위아래가
  비어요" (it would not). `PICTURE_COMMANDS` order: rotate, fill, reset,
  zoom, pan — the palette's "화면" filter now lists three rows.
- **`src/ui/FramePicker.tsx`** (new) — a `role="radiogroup"` "영상 모양" on
  the preview's title row: three `role="radio"` buttons (accessible name
  "세로 영상으로 바꾸기", drawn 세로), `aria-checked` on the current shape
  which is NEVER `aria-disabled` (choosing it again says which shape it
  is), the others `aria-disabled` only before the first import; one Tab
  stop, arrows move focus AND choose (native radio behaviour; a focused
  button owns its arrows in `useShortcuts.controlOwnsKey`, so the playhead
  does not move); `#frame-size` "320×180" is every radio's
  `aria-describedby`. Dispatches through `canRun` / `perform` / `whyNot`
  from `ui/actions.ts`, not `CommandButton` (which is a toggle, not a
  radio).
- **`src/ui/Preview.tsx`** — the title row is `.panel-title.preview-title`
  with the picker. Nothing else: `paint()` already sized the canvas from
  `timeline.width/height` on every call and the subtitle overlay is placed
  by a `ResizeObserver`, so both followed the box with no change.
- **`src/ui/ClipPanel.tsx`** — `#clip-picture-note` is
  `${summary || '찍은 그대로 보여요'} · ${emptySidesText}`: "찍은 그대로
  보여요 · 화면 위아래가 비어요" for a 16:9 clip in a 9:16 box, "90° 회전 ·
  화면 양옆이 비어요" for a turn (that debt entry is closed for the panel;
  the turn's own STATUS sentence still says nothing). The 화면 채우기
  button; the hint paragraph.
- **`src/styles.css`** — `.stage` background is `var(--bg)`, NOT `#000`,
  and `.stage-picture` carries a 1px `box-shadow` edge: black inside the
  line is in the file, the room outside is not (the novice reviewer's
  blocker: a portrait box in a landscape stage on a black stage made the
  box's bars and the stage's margins one frame, and the fill looked like a
  no-op). `.preview-title`, `.frame-picker` (hover, `focus-visible`,
  `aria-checked` ring).
- **Tests** — unit 541 → 562; e2e 106 → 110: `e2e/frame.spec.ts` (세로 →
  180×320 canvas, black rows at the top, note, 세로 위치 max 15, fill →
  320% and the top row has picture, two undos, redo + 가로 → the
  over-zoom hint; disabled reasons before import and for the current
  shape, arrows choose and do not seek, the palette's "영상으로" rows with
  the unavailable one last, 정사각 → 180×180; a subtitle's overlay
  re-aligned over a portrait picture at 180×320; a portrait export whose
  `stsd` entry says 180×320); `e2e/picture.spec.ts` updated (the turn's
  note gains "· 화면 양옆이 비어요", the palette lists three 화면 rows).
- **Docs** — ADR-0015 (+ README row); `docs/HANDOVER.md` progress (E8
  first item); `docs/TESTING.md` contract rows (`.frame-picker`,
  `.stage-picture` size, the stage's ground, the three picture buttons,
  `clip-picture-note`'s new meaning); `CLAUDE.md` debt (two entries
  rewritten, six added — see below).

### Decisions a future session would otherwise get wrong

1. **The box is `timeline.width × height` and nothing else.** The first
   import sets it (`Editor.importAsset`), the three frame commands change
   it, and the preview canvas, the export, `pictureRect` / `panLimits` and
   the subtitle layout all read it. A 9:16 output is that one number
   taking another value — no second size anywhere.
2. **A box change rewrites nothing on any clip.** A pan the new box cannot
   show is READ at the new limit and shown there (the sound ceiling's
   rule); a zoom that the new box no longer needs stays and the sentence
   says so. Undo is one step. Do not add per-clip rewriting to
   `frame.*` — say it in the sentence instead.
3. **Pixel size keeps the short side.** 720p stood up is 720×1280, not
   1080×1920; no upscaling. `frameSize` rounds to the NEAREST even (854,
   not 852) and is deliberately not `evenDimensions` (which floors an
   integer the document already holds).
4. **`clip.pictureFill` is zoom only, pan kept.** Not a reset; the user's
   framing is theirs. The three-way disabled reason is decided by asking
   whether the same zoom centred would cover the box.
5. **The picker is a radiogroup, not toggle buttons.** The checked radio is
   never `aria-disabled`; "pressed, dimmed" was the a11y reviewer's
   objection to the first version (CommandButton with `pressed`).
6. **The stage is not black.** `.stage` is `var(--bg)`; the box's own
   black is the only black. Any future "black on screen" reasoning must
   keep that line.
7. **`emptySides` is the one answer to "is a side black".** `coversBox`
   is its emptiness. Do not reason from zoom and pan alone again.

### What the persona round found

Four reviewers on the diff (QA, a11y, novice, guardrail). **Fixed in this
tree:** the stage's black = the box's black (novice, blocker → `--bg` +
edge, e2e asserts both); the fill's disabled reason blaming the position
of a centred picture at the 400% cap (QA, major → three-way reason, two
unit cases); a clip filled for 세로 taken back to 가로 crops silently
(novice, major → the over-zoom hint, unit + e2e); the fill hint pointing at
a panel that is not on screen with no clip selected (novice, major → "비는
클립을 고르고 …"); no `focus-visible` rule on the picker (a11y, major);
pressed + disabled on one button (a11y, major → radiogroup, arrows, one Tab
stop); the pixel size not described to the radios (a11y, minor →
`aria-describedby`); `even()` vs `evenDimensions` unremarked and "frame"
vs the time unit (guardrail, minor → comments). **Recorded as debt in
`CLAUDE.md`:** the hint does not name the clip; a box change re-announces
nothing per clip; 화면 원래대로 puts the clip back, not the box; the
export sentence's "90 frames"; filling is per clip; a 4:3 project has no
preset.

### What the gate found

`npm run handoff` stamped the block above (unit 562 · e2e 110, 0 skipped —
this machine's bundled Chromium has H.264, so every import spec ran).
Before the persona fixes the same gate read unit 561 · e2e 110.

### What the browser found

Visual QA ran in the owner's Chrome (deviceId `da2a0786-…`, approved
2026-09-11; loopback confirmed by `netstat`; the tab reported
`visibility: hidden` and about half the screenshots timed out — the MCP
tab group also vanished once and was recreated, as on 2026-09-10) on the
project the browser had kept (seven clips of the fixture, two subtitles),
against the dev server already up on 9990.

- The picker sits at the right end of the 프리뷰 title row: 가로 · 세로 ·
  정사각 and "320×180", legible at 12px, the checked one ringed teal.
- 세로: the canvas is 180×320, the stage's ground is the app's blue-grey
  with the box's own black bars above and below the strip and a hairline
  around the box — the three are told apart at a glance. Status "세로
  영상(9:16 · 180×320)으로 바꿨어요 · 비는 클립을 고르고 화면 채우기를
  누르면 꽉 차요.", note "찍은 그대로 보여요 · 화면 위아래가 비어요", the
  세로 위치 slider ends at 15 with its sentence. The box survived a reload
  (the tab was recreated mid-pass): the document holds it.
- 화면 채우기 on the first clip: 확대 320%, the box full of the middle
  third of the bars, note "화면 320%", the fill button dimmed. **The three
  picture buttons wrap to two rows** at the sidebar's width (화면 돌리기 ·
  화면 채우기 / 화면 원래대로) — legible, not pretty; no assertion.
- A drag of ~85px right: "화면을 옮겼어요 (오른쪽으로 18%).", the burnt-in
  timecode came into view at the top-left, the strip's pill read 🔍✥.
  **The slider's handle sat at 20 while its readout said 18%** — the drag
  stores a whole percent and the slider's step is 5. Pre-existing since
  E7; recorded in `CLAUDE.md` debt.
- 내보내기: "내보내기 완료 · 91 frames · 3.03s · 오디오 포함";
  `Untitled.mp4` (155KB) landed in the owner's Downloads and its `stsd`
  entry reads 180×320 (checked on disk). **That file is the owner's to
  delete.**
- The pass ended with the fill and the pan undone (Ctrl+Z) and 가로
  pressed, so the owner's document is 320×180 with seven clips and no
  picture marks, as it was. **Two "자동 저장" snapshots from the pass
  (10:26, 10:29 on 2026-09-11) hold the portrait / filled states**;
  deleting them is the owner's call, as before.

**Not seen:** playback of a portrait project (the tab was hidden), the
picker at a narrow window (`e2e/narrow-layout.spec.ts` did not gain a
case), a phone-shot file rather than the colour-bar fixture.

## Next single step

**Commit the tree as it stands** (the Codex hooks files, the
`frame.spec.ts` polling fix, this file) — the owner must approve the
commit first. Then, before the first Codex unit, give Codex what it
reads: an `AGENTS.md` at the repo root (the rules of `CLAUDE.md`, under
32 KiB, with the debt list left in `CLAUDE.md` and pointed at), and
either `.codex/agents/*.toml` for the three tester personas and the
reviewer or a decision to run persona review from Claude only. Trust the
hooks in `/hooks` in a fresh Codex session and confirm the handoff prints.

**Then E9, silence auto-cut, in Codex** — chosen over E8's second item
(style presets) because E9 is engine-first: silence detection over
decoded PCM is a pure function (Vitest in Node, TDD), and the cut is
existing splits plus ripple deletes folded into one undo step. E8-2
still waits on the product call below (does 세로 imply 채우기). Settle
one rule with the owner before E9 starts: what counts as silent (a level
threshold and a minimum length) — the same open question the waveform's
"이 부분은 조용해요" debt entry records.

## Blocked / needs the owner

1. **Commit approval** for the uncommitted tree (see "Next single step").
   The push of `10050d3` + `845bfa4` is done.
2. **Two auto snapshots and one file** from the visual pass: 자동 저장
   10:26 / 10:29 (2026-09-11) in the browser's 이전 상태, and
   `Downloads/Untitled.mp4`. Delete or keep.
3. **Product calls surfaced by this unit:** should 세로 imply 채우기 for
   every clip (today: per clip, deliberately, ADR-0015 "Consequences");
   should the box change be reachable from the toolbar or only the
   preview row and the palette; should a 4:3 preset exist.
4. **Unchanged from E7:** playback and an export with a transformed clip
   watched; the sound unit's listening list; the auto snapshots from the
   2026-09-10 visual passes in the browser's 이전 상태; the turn's own
   STATUS sentence (the panel note says the black now, the sentence does
   not); the fade-edge heading, zoom's real-pixel count, the fade mark
   over bright footage, the dip through black at a double fade, the
   quiet-source waveform, the AWS deployment direction.
