# STATUS — the live handoff

**This file is the handoff.** It is rewritten at the end of every unit of work,
by whoever did the work, before they report anything to the owner.

Write it for a reader with **zero memory of any conversation**. No "as
discussed", no "the fix we talked about", no pronoun pointing at chat history.
If it is not in a file in this repo, it does not exist — chat context dies, the
repo does not.

<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->

**Last verified:** 2026-09-15 04:11 UTC — `npm run verify` **GREEN**

- unit 646 passed · e2e 124 passed

<!-- VERIFY:END -->

## Where we are

### E9, silence auto-cut, is committed and pushed (`a313567`, 2026-09-14)

One press, 조용한 부분 없애기, finds every pause of 0.5 s or more in the
footage (peak under -40 dBFS on the waveform's own 128-sample buckets),
keeps 0.2 s on each side, and removes the rest as ONE undo step; muted
clips are skipped. The rule and the why are ADR-0016; the record of the
work, step by step, is "E9 progress" / "E9 issues" further down; what the
persona round left is in CLAUDE.md "Known tech debt". The unit was built
in Claude Code after the Codex session stalled before writing code (the
owner's call, 14:10 KST), committed with the owner's approval and pushed
(`origin/main` = `a313567`, 15:10 KST).

**After it, one docs-only unit (this tree): the driver question.** The
owner asked whether Claude Code's visual pass could move to dev-browser.
Measured and answered no — decision 2 below and `docs/TESTING.md`
"Visual QA" hold the evidence. That unit is committed as `91795d8`, not
yet pushed.

**`91795d8` was pushed on 2026-09-15 with the owner's approval;
`origin/main` = `91795d8`.**

### E8-2a, 예능 자막, is BUILT and in the tree, uncommitted (2026-09-15)

"Style presets" had no definition anywhere in the repo; the owner gave
one on 2026-09-15 (예능 자막, see "Next single step" for the layers) and
its first layer was built the same day in Claude Code: a subtitle's look
(기본 / 강조 / 외침), place (아래 / 가운데 / 위, stored as box fractions
for the drag to come) and effect (바로 / 서서히 / 톡 / 올라오기), as
optional fields on the subtitle, one `SubtitleFrame` per frame for both
the export plan and the preview, three arg-taking commands, three
radiogroups in the subtitle panel. ADR-0017 is the contract; "E8-2a
progress" / "E8-2a issues" below are the record, step by step; the
persona round's leftovers are in CLAUDE.md "Known tech debt". The gate
stamped above is this tree's handoff run (unit 646 · e2e 124). New files:
`src/engine/subtitleStyle.ts` (+test), `e2e/subtitle-style.spec.ts`,
`docs/adr/0017-a-subtitle-has-a-look-a-place-a-way-in.md`. Changed:
`types.ts`, `subtitles.ts`, `subtitleRender.ts`, `subtitleCommands.ts`,
`exportPlan.ts`, `compose.ts`, `ops.ts` (their tests), `ui/Preview.tsx`,
`ui/SubtitlePanel.tsx`, `styles.css`, `docs/TESTING.md`, `docs/adr/README.md`,
CLAUDE.md's debt list, `docs/HANDOVER.md`, `README.md`, this file. The
owner asked for the E8-2 plan docs and this build to go in ONE commit.
The visual pass in the owner's Chrome is done (step 9 of "E8-2a
progress"; one finding, fixed, with an assertion). **Not yet done: the
commit itself.** Also in the tree, NOT part of this unit: the owner's own edits to `AGENTS.md`,
`CLAUDE.md` (the ui-ux-guide mapping bullet only; the debt entries are
this unit's) and `docs/UX.md`, left for them to commit.

### Moving implementation to Codex (2026-09-14)

The owner is implementing the next units in Codex, not Claude Code. Two
commits and one uncommitted tree carry that move.

**Committed and pushed as `f5f2512`:** the Codex session adapter
`scripts/codex-hooks.mjs` (SessionStart, PreToolUse, PostToolUse, Stop),
the non-overwriting installer `scripts/install-codex-hooks.mjs`
(`npm run setup:codex`), the contract tests `scripts/codex-hooks.test.mjs`
(`npm run test:hooks`, 9 tests, a step of `verify`), the installed
`.codex/hooks.json`, `docs/CODEX_HOOKS.md`, and the `frame.spec.ts`
polling fix described below. `.claude/` and `.harness/` are untouched.

**In the tree, not yet committed — what Codex reads (this unit):**

- **`AGENTS.md`** (new, 12.9 KB, budget 32 KiB) — the Codex twin of
  `CLAUDE.md`: the same golden rules, loop, handoff and definition of done,
  with the Claude-only parts rewritten (hooks → `.codex/hooks.json`, "Task
  tool" → `spawn_agent` with the roles below, Claude in Chrome →
  dev-browser, the Bash guard's three rules stated as discipline because
  Codex hooks cannot "ask"). The **"Known tech debt" list stays only in
  `CLAUDE.md`** and `AGENTS.md` points at it. Rule: when a rule changes,
  change both files.
- **`.codex/agents/*.toml`** (6 new) — `tester-qa`, `tester-a11y`,
  `tester-novice`, `framewright-reviewer`, `test-writer`, `export-qc`, the
  same text as `.claude/agents/*.md` in Codex's role format (`name`,
  `description`, `developer_instructions`). Claude's `tools:` restriction
  has no equivalent, so "you review; you do not edit" is in each
  instruction, and the reviewers are told to read the debt list first.
- **`.codex/skills/{adr,handoff,new-command}/SKILL.md`** (3 new) — the
  three slash commands as skills; the argument comes from the request
  sentence (no `$ARGUMENTS` in Codex).
- **`.codex/config.toml`** (new) — `[agents] enabled = true` and comments;
  no hooks in it (the installer refuses inline hooks).
- **Docs:** `docs/TESTING.md` "Visual QA" now names the driver per
  session (Claude Code → Claude in Chrome, Codex → dev-browser attach
  mode) with three rules common to both (confirm which browser, leave the
  document as found and name the 자동 저장 snapshots, every finding ships
  an assertion); `docs/HANDOVER.md` "different machine" adds the
  dev-browser daemon and the `/hooks` trust step; `docs/CODEX_HOOKS.md`
  gains "Hooks 밖에서 Codex가 읽는 것"; `README.md` and `CLAUDE.md` point
  at `AGENTS.md`.

**Verified with the Codex CLI (0.154.0), not only by reading:** `codex
debug prompt-input` in this repo shows `AGENTS.md`'s text in the
model-visible prompt and the three skills listed under skill root `r0 =
.codex/skills`; `codex doctor` loads config without error; no agent-role
warning is emitted. **Not verified:** that the six roles are offered by
`spawn_agent` — that is visible only in a live Codex session (the
`prompt-input` dump does not include tool schemas). **Also not yet done:**
trusting the four hook commands in `/hooks` in a fresh Codex session; until
then no hook runs there.

**Decisions made with the owner on 2026-09-14:**

1. The gate is Playwright in both tools and is never replaced by a
   browser driver.
2. Visual QA in Codex is dev-browser (Playwright underneath). The
   intended **attach mode** on the owner's real Chrome was tried on
   2026-09-14 afternoon and hung (details in `docs/TESTING.md` "Visual
   QA"): raw CDP attaches to that Chrome instantly, dev-browser's
   `connectOverCDP` never returns. Until that is fixed upstream or
   worked around, the Codex pass runs in **launch mode** (dev-browser's
   own Chrome 145, H.264 OK, fresh profile) and says so. **Claude Code
   keeps Claude in Chrome** — the owner asked whether dev-browser could
   replace it there; the answer after measuring is no for now, because
   Claude in Chrome is the only driver that reaches the owner's real
   profile (the whole point of the layer), and dev-browser's launch mode
   would be a second, weaker driver.
3. E9 (silence auto-cut) goes before E8-2 (style presets): E9 is
   engine-first and testable in Node, E8-2 still waits on a product call.

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

**ONE commit of E8-2a with the owner's approval, then plan E8-2b.** The
build is done, the gate is green, the persona round and the visual pass
in the owner's Chrome are done (see "Where we are" and "E8-2a progress").
The commit: the E8-2a code + ADR-0017 + the E8-2 plan docs (this file,
`docs/HANDOVER.md`, `README.md`) as ONE commit — the owner's call on
2026-09-15; leave `AGENTS.md`, `docs/UX.md`, CLAUDE.md's ui-ux-guide
bullet (the owner's; stage `CLAUDE.md` by hunk) and the two stray logs
out. After that: **E8-2b, 캘리그라피 글꼴** (plan it first, in this file,
the E8-2a plan's shape: which two or three Korean display faces, their
licences and sizes, how they load before an export, a fourth column in
`SUBTITLE_LOOKS` or a separate `font` field).

Housekeeping, closed on 2026-09-15: `91795d8` pushed; the chrome://inspect
toggle is OFF (port 9222 has no listener, the dev-browser daemon is dead).
Still open: the owner's own uncommitted edits to `AGENTS.md`, `CLAUDE.md`
(one bullet) and `docs/UX.md`, theirs to commit.

### What "style presets" means — defined by the owner on 2026-09-15

The epic list of 2026-08-12 (`4f154ef`, HANDOVER) said only "E8 (style
presets, shorts reframe)"; the conversation that produced those two words
was never written down and is gone. The owner defined it on 2026-09-15:
**예능 자막** — the caption style of Korean variety shows: words that are
styled, placed anywhere on the picture (not only along the bottom), and
that come and go with an effect. It is not shorts-only. The owner's END
goal is dragging a subtitle to any spot on the picture; images and
stickers are wanted too, later.

Sized against today's code (one `Subtitle` shape, one fixed look, one draw
path `compose.ts` shared by preview and export), it splits into layers of
very different cost. Order and boundaries, decided:

| Unit      | What                                                                                                           | Size                |
| --------- | -------------------------------------------------------------------------------------------------------------- | ------------------- |
| **E8-2a** | 자막 모양 · 자리 · 효과 — three named looks, three places, three enter/exit effects, as fields on the subtitle | one unit (this one) |
| E8-2b     | 캘리그라피 글꼴 — two or three bundled Korean display faces, loaded before export                              | one unit            |
| E8-2c     | 자막을 화면 아무 데나 끌어다 놓기 — free placement by dragging on the stage; the owner's end goal              | one unit            |
| E10       | 이미지·스티커 — a new kind of thing on the timeline (import, store, overlay lane, drag, export)                | an epic; backlog    |

E8-2a's data is shaped so that E8-2c adds only a gesture: a subtitle's place
is stored as fractions of the box from day one (the same convention as a
clip's `panX` / `panY`, ADR-0014), and the three place presets just write
three values of it.

### E8-2a execution plan — 예능 자막: 모양, 자리, 효과

**Decided by the owner (2026-09-15), do not re-open in this unit:**

- One kind of subtitle. Looks, places and effects are optional fields on
  `Subtitle`; there is no second "title / caption" list. (Two lists would
  double the panel, the lane and the commands for one first-time user's
  benefit; ADR-0011's single list stays.)
- The place is stored as box fractions, ready for the drag in E8-2c.
- Fonts wait for E8-2b; images are E10.

**Rule table — the contract the tests assert:**

| Rule                       | Value                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fields on `Subtitle`       | `look?: 'bold' \| 'shout'` · `posX?: number` · `posY?: number` · `effect?: 'fade' \| 'pop' \| 'rise'`. All optional; **absent = today's subtitle exactly** (white on a pill, bottom stack, no effect), so schema stays 2 and `upgradeProject` is untouched — the same convention as a clip's `zoom` / `panX` (ADR-0014).                                                           |
| Looks (3)                  | 기본 (absent): today's white ink on the 62% black pill. 강조 (`bold`): yellow ink, black outline, no pill, font 1.4× 기본. 외침 (`shout`): white ink, thicker black outline, font 1.8× 기본, weight 800. Exact colours, outline widths and sizes are one table `SUBTITLE_LOOKS` in `subtitleRender.ts`, all relative to the picture's height like the font is today.               |
| Places (3 presets)         | `posX` / `posY` name the CENTRE of the text block as a fraction of the box. 아래 = both absent (today's bottom-margin stack, unchanged to the pixel). 가운데 = `posY` 0.5. 위 = `posY` 0.15. `posX` 0.5 in all three. Any value in [0, 1] is legal (E8-2c writes arbitrary ones); the block is **clamped inside the box at draw time**, so no stored value puts words off-screen.  |
| Effects (3 + none)         | 바로 (absent): as today. 서서히 (`fade`): alpha 0 → 1. 톡 (`pop`): scale 0.6 → 1 about the block's centre, ease-out. 올라오기 (`rise`): translate from +6% of the box height, ease-out. The same effect runs at both edges, mirrored (in, then out).                                                                                                                               |
| Effect length              | `EFFECT_SEC = 0.25`, an engine constant, rounded to frames through `time.ts`; **capped at half the subtitle's length** so the way in and the way out never overlap. A one-frame subtitle is simply shown.                                                                                                                                                                          |
| Per-frame progress         | `subtitlePhase(sub, frame, fps)` → `t` in [0, 1]: `enter = (frame - start + 1) / n`, `exit = (end - frame) / n`, `t = min(1, enter, exit)`. The first frame and the last frame show `1 / n` (something is visible on every frame the subtitle owns; `[start, end)` half-open as everywhere). Pure, in the engine, unit-tested at both edges, the middle, and the cap.              |
| One draw for both surfaces | `drawSubtitle(ctx, frame: SubtitleFrame, width, height)` with `SubtitleFrame = { text, look, posX, posY, effect, t }`, built by ONE function `subtitleFrameAt(project, frame)` that the export plan and the preview both call. `ExportFrame.subtitle` becomes a `SubtitleFrame                                                                                                     | null` (today a string). ADR-0011's "one answer per frame" holds. |
| Layout                     | `layoutSubtitle` takes the look and the place. Lines stack about the anchor (a two-line block centred at `posY` has one line above and one below it); the 아래 case is bit-for-bit today's arithmetic, asserted by the existing tests staying green untouched.                                                                                                                     |
| Commands                   | Three, in `subtitleCommands.ts`, each an `updateSubtitle` op with the exact inverse and one undo step: `subtitle.setLook` 자막 모양 고르기, `subtitle.setPlace` 자막 자리 고르기, `subtitle.setEffect` 자막 효과 고르기. Arg-taking (`requiresArgs`, hidden from the palette like `subtitle.setText`); `canRun` false with no subtitle selected or when the choice is already set. |
| Sentences                  | Each names the choice: "자막 모양을 강조로 바꿨어요.", "자막 자리를 위로 옮겼어요.", "자막 효과를 서서히로 바꿨어요.", and the 기본 / 아래 / 바로 forms "자막 모양을 기본으로 되돌렸어요." etc. Vocabulary test: no label is, or contains, another label (UX.md).                                                                                                                  |
| Panel                      | `SubtitlePanel` gains three radiogroups under one `<h3>` 꾸미기: 모양 (기본 / 강조 / 외침), 자리 (아래 / 가운데 / 위), 효과 (바로 / 서서히 / 톡 / 올라오기) — the `FramePicker` pattern (`role="radiogroup"`, `aria-checked`, arrow keys within a group, a refused press says why). The draft text in the field previews in the chosen look live.                                  |
| Split and paste carry      | `splitSubtitleAt`'s tail copies every field, not only `text` (today it copies only `text`; that is the first red test). A paste that splits a styled subtitle leaves two styled halves.                                                                                                                                                                                            |
| Hold frames                | A `HOLD` in the export plan still cannot carry a subtitle that has ended (ADR-0011); the phase is computed from the timeline frame, never from the held picture.                                                                                                                                                                                                                   |

Why these values, for the ADR: three looks because a first-time user
picks from a row, not from a colour wheel (UX.md "Simple"); yellow +
outline is what every Korean variety caption reaches for first; three
places because the panel is a row of radios and the drag (E8-2c) is where
"anywhere" lives; 0.25 s because a caption effect longer than that reads
as a title card; the cap at half the length because a 0.5 s subtitle with
a 0.25 s way in and a 0.25 s way out would never be fully shown; box
fractions for the place because the pan already speaks that language and
the export must not depend on the preview's pixel size.

**Shape of the work, in order:**

1. `src/engine/subtitleRender.ts` (test-first, fake measurer): the
   `SUBTITLE_LOOKS` table; `layoutSubtitle(text, box, measure, look, place)`
   with the anchored stack and the edge clamp; `drawSubtitle` taking a
   `SubtitleFrame` and applying the effect through `save` / `translate` /
   `scale` / `globalAlpha` / `restore` so the caller's state is untouched;
   an outline drawn with `strokeText` under `fillText`. Cases: 아래 is
   today's layout to the pixel; 가운데 with one and with three lines;
   위 with a block taller than the room above (clamped down, never off
   the top); `posX` 0 and 1 (clamped in); the 강조 font is 1.4× 기본.
2. `src/engine/subtitles.ts`: `subtitlePhase`, `effectFrames(fps, sub)`,
   `subtitleFrameAt(project, frame)`; `splitSubtitleAt` carries the fields.
   Cases: first / last / middle frame; the cap on a short subtitle; a
   one-frame subtitle → `t = 1`; 29.97 fps rounding; absent effect → `t`
   is 1 on every frame.
3. `exportPlan.ts` / `exporter.ts` / `compose.ts`: the plan carries the
   `SubtitleFrame`; `compose.test.ts` asserts a held frame after the
   subtitle's end has none. `ui/Preview.tsx` builds the same frame (with
   the draft text substituted while typing) and calls the same draw.
4. Commands: the three above, registered, with `describeSubtitleEdit`
   sentences and `vocabulary.test.ts` green.
5. UI: `SubtitlePanel` radiogroups; a refused press states the reason
   (no subtitle selected → "자막을 먼저 고르세요."). No toolbar button, no
   default key, no chip mark on the lane in this unit.
6. e2e `e2e/subtitle-style.spec.ts`, on `sample-h264.mp4`: pick 위 and
   assert the overlay canvas has ink in its top band and none in the
   bottom band (sample pixels through `page.evaluate`); pick 강조 and
   assert the sampled ink is not white; pick 서서히 and assert the alpha
   sampled at the subtitle's first frame is below the alpha at its middle
   frame; one `Ctrl+Z` per choice restores it; the fields survive a
   reload; an export of a styled subtitle has every frame (the frame-count
   invariant, `ExportButton`'s sentence).
7. ADR-0017 "A subtitle has a look, a place and a way in": the fields, why
   box fractions (the drag to come), why three of each, the effect length
   and its cap, `SubtitleFrame` as the one answer per frame.
8. Persona round (tester-qa on the phase at the edges, the cap, split and
   paste carrying the fields, the held frame; tester-novice on the words
   기본 / 강조 / 외침 / 톡 / 올라오기 and the sentences; tester-a11y on the
   three radiogroups, focus after a choice, what a screen reader hears when
   a look changes), fix blockers, `npm run verify`, visual pass in the
   owner's Chrome (confirm the deviceId first — CLAUDE.md global rule),
   `npm run handoff`, one commit with the owner's approval.

**Out of scope for this unit:** fonts (E8-2b), dragging the words on the
stage (E8-2c), images and stickers (E10), per-word or karaoke styling,
custom colours or sizes, the effect length in the UI, a mark on the
subtitle chip for a styled subtitle, palette rows per choice (the three
commands are arg-taking and hidden, like `subtitle.setText`; whether nine
visible rows belong in the palette is the owner's call, recorded as debt).

**How progress and issues are reported:** the same way as E9 — a
"### E8-2a progress" section directly under this plan with one line per
step (step number, gate result at that point, anything off-plan), written
before moving on; a "### E8-2a issues" section under it with every decision
the plan did not settle, every persona finding by tier and what was done,
every test that had to change and why, and a red gate written as red. Stop
before the commit: after `npm run handoff` and this file rewritten, show
the commit message and wait for the owner's approval. One commit.

### E8-2a progress

Built in Claude Code on 2026-09-15 (KST), the plan's steps in order:

1. **Engine, test-first — done.** `src/engine/subtitleStyle.ts` (new:
   the vocabulary, `placeOf` / `placeFields`, `effectFrames`,
   `subtitlePhase`, `subtitleFrameOf` / `subtitleFrameAt`, the sentences
   and `toward` for 로/으로) with 15 tests; `subtitleRender.ts` gained
   `SUBTITLE_LOOKS`, a look and a place on `layoutSubtitle`, `layoutBounds`,
   `effectState`, and `drawSubtitle(ctx, SubtitleFrame, w, h)` with 16 new
   tests (the plain layout is asserted equal to the pixel to the old one);
   `types.ts` the four optional fields; `splitSubtitleAt` carries them
   (its red test first). Unit at this point: 616 passed.
2. **Plan and preview — done.** `ExportFrame.subtitle` is a
   `SubtitleFrame | null`; `composeFrame` takes it; `Preview.tsx` builds
   the same frame (draft words substituted) keyed by its JSON. `compose.test`
   pins "a plain subtitle is the same calls as before, no save" and "an
   effect sits inside save/restore, alpha back to 1".
3. **Commands — done.** `subtitle.setLook` / `setPlace` / `setEffect`,
   arg-taking, one `updateSubtitle` op each, inverse writes the absent
   field back as `undefined`; the JSON of the document after undo equals
   the original. `vocabulary.test` green.
4. **UI — done.** `SubtitlePanel` has `<h3>` 꾸미기 and three `Choices`
   radiogroups (the `FramePicker` pattern); `.subtitle-choice` shares the
   picker's button rules in `styles.css`.
5. **e2e — done.** `e2e/subtitle-style.spec.ts`, 8 tests × 2 browsers:
   rows and defaults, 위 → ink in the top band + undo, 강조 → yellow ink
   - back, 서서히 → first frame's alpha under half the middle's, the
     already-chosen radio's sentence, arrows choose and never move the
     playhead, reload survival, export of a styled subtitle = 90 frames.
     First run 14/16: the sentence said "톡로"; fixed in the engine
     (`toward`), unit-tested, rerun green.
6. **ADR-0017 — written**; index row added; `docs/TESTING.md` DOM
   contract rows for the radiogroups and the overlay pixels.
7. **Full gate before the personas: GREEN** (unit 645 · e2e 124, the new
   spec 8 × 2 browsers included).
8. **Persona round — done** (tester-qa, tester-a11y, tester-novice,
   framewright-reviewer, in parallel). One blocker, fixed; the majors
   below fixed or in CLAUDE.md "Known tech debt"; gate re-run after the
   fixes (the stamp at the top of this file is that run).
9. **Visual pass in the owner's Chrome — done** (the owner named
   `da2a0786-…`; Claude in Chrome on the live dev server at 9990, the
   owner's own autosaved project: 7 clips, 3 subtitles). Selected 자막 1
   ("걸침", 10–24) and tried 강조 (yellow ink, black outline, readable
   over the colour bars), 위 (top band), 외침 + 가운데 (white, thick
   outline, centred), 톡 with the playhead on frame 10 (the words visibly
   small on the first frame). **One finding, fixed:** the 효과 row's four
   radios did not fit beside the word at sidebar width and the whole
   group dropped under it, so that row alone read label-above; the group
   now shrinks and wraps inside itself (`styles.css`), the word aligns
   with the first line, and `e2e/subtitle-style.spec.ts` asserts the three
   groups share a left edge. Five edits undone with Ctrl+Z; the persisted
   project JSON was compared to a snapshot taken before the pass and is
   identical. Tab closed. The gate re-ran after the CSS and spec change
   (the stamp at the top).

### E8-2a issues

- **Blocker (reviewer, also QA as a major): `updateSubtitle` did not drop
  `undefined` fields.** `updateClip` runs `dropUndefined` for exactly this
  case and the subtitle op never had to until this unit's inverses wrote
  `{ look: undefined }`. The live document then carried an own key
  holding `undefined` — invisible to `JSON.stringify` (which is what the
  test compared) and to `toEqual`. Fixed in `ops.ts` (one line, same
  comment as the clip's); the test now asserts with `toStrictEqual` and
  `Object.keys`, and was seen RED without the fix (2 failed) and GREEN
  with it.
- **Major (novice, a11y): the effect is invisible on most frames, and the
  one line that says what 톡 IS was mouse-only.** The effect's sentence
  now carries the hint ("자막 효과를 톡으로 바꿨어요 · 작았다가 톡 커지며
  나타나요."), each radio's hint is also its `aria-describedby` (an
  `sr-only` span), and the panel's hint paragraph says the effect shows
  when the subtitle comes and goes, play to see it. The rest of the
  novice's point — nothing parks the playhead on the subtitle or previews
  the motion — is a debt entry.
- **Minor (QA): a test named "paste splits a styled subtitle" dispatched
  `clip.split`.** Replaced by a real `clip.paste` through the dispatcher
  on a styled straddling subtitle (both halves keep every field, undo
  puts one back, `toStrictEqual`) plus a correctly named split test;
  `threeClips` hoisted to module scope for it.
- **Minor (reviewer): `SUBTITLE_COMMANDS` was a literal plus a `push`.**
  One literal at the bottom now.
- **Minors kept as debt** (CLAUDE.md): the effect cap on a short subtitle
  is silent; one sub-heading for four panel sections; checked radios are
  colour-only (shared rule with `FramePicker`); undo inside a radiogroup
  leaves focus off the Tab stop; the palette lacks the nine choices; the
  second radiogroup copy; `Preview`'s JSON frame key; 꾸미기 as an
  umbrella for 자리.
- **Decided by the plan's author, not the plan:** the time arithmetic
  lives in a new module `subtitleStyle.ts` rather than in `subtitles.ts`
  (the plan allowed either); the looks table lives in `subtitleRender.ts`
  as planned. The 바로 sentence is "자막 효과를 없앴어요 · 바로 나타나요."
  (the plan's "바로로 바꿨어요" does not read).
- **Caught by the e2e, fixed in the engine:** "톡로" — the 로/으로
  particle now follows the last syllable (`toward`).
- **The place radios show nothing checked** when `posX`/`posY` are values
  no preset names (only reachable by a future drag, or a hand-edited
  document). Deliberate: the first radio is then the Tab stop.
- **One `git stash` / `stash pop` on `src/engine/ops.ts`** was used to
  show the strict test red without the fix; the tree came back as it was
  (`git status` unchanged). No other git write.

- **Decided by the plan's author, not the plan:** the time arithmetic
  lives in a new module `subtitleStyle.ts` rather than in `subtitles.ts`
  (the plan allowed either); the looks table lives in `subtitleRender.ts`
  as planned. The 바로 sentence is "자막 효과를 없앴어요 · 바로 나타나요."
  (the plan's "바로로 바꿨어요" does not read).
- **Caught by the e2e, fixed in the engine:** "톡로" — the 로/으로
  particle now follows the last syllable (`toward`).
- **The place radios show nothing checked** when `posX`/`posY` are values
  no preset names (only reachable by a future drag, or a hand-edited
  document). Deliberate: the first radio is then the Tab stop.

### E9 execution plan — silence auto-cut (done; kept as the record)

**What counts as silent — decided by the owner on 2026-09-14.** These are
the rule; do not re-derive them, and do not add a relative (per-clip)
threshold in this unit.

| Rule                 | Value                                                                          |
| -------------------- | ------------------------------------------------------------------------------ |
| Level                | peak below **-40 dBFS** (linear 0.01), absolute, not relative to the clip      |
| Measure              | the 128-sample **peak buckets** the waveform already builds — no RMS in v1     |
| Minimum length       | a run of quiet buckets **≥ 0.5 s** counts; shorter runs are left alone         |
| Padding              | keep **0.2 s** on each side of the run, rounded UP to whole frames             |
| Nothing to cut       | if the run minus both paddings is under 0.1 s, do not cut it                   |
| Where the rule lives | three named constants in the engine module; not exposed in the UI in this unit |

Why these values, for the ADR: -40 dBFS sits below a quiet room's floor
(-50 to -60) and below most phone footage's floor (~-45), and above what
jump-cut tools use (-28 to -30), which clip breaths and word endings; 0.5 s
is the minimum nearly every tool uses; 0.2 s of padding is what stops the
most common complaint, a clipped consonant; peak instead of RMS because
the data is already there and the 0.5 s minimum absorbs a click.

**Shape of the work, in order:**

1. `src/engine/silence.ts` (new, test-first): `silentRuns(peaks, sampleRate,
fps, …)` → frame ranges `[in, out)` on the SOURCE, applying the four rules
   above; then `silenceCuts(project, runs)` → the list of split points and
   the ranges to ripple-delete, expressed in existing commands. Pure, no
   DOM, no decoding. Adversarial cases: a run at the very start / end of a
   clip, a run spanning a split, 29.97 fps rounding, a clip with no audio
   track (nothing to cut), a muted clip (decide in the ADR whether mute
   means "skip"), padding that meets in the middle.
2. One command, `timeline.cutSilence` ("조용한 부분 없애기" — the same
   shape as "빈 곳 없애기"), registered like every other command: `canRun`
   (there is at least one clip whose peaks have arrived; until the peaks
   land the disabled reason says so), `run` → one patch made of the splits
   and ripple deletes, `invert` → the exact inverse, **one undo step**. The
   status sentence says how many places were cut and how much time went
   ("조용한 부분 3곳을 없앴어요 · 2.4초 짧아졌어요"); nothing found says so.
   Palette row and a toolbar button; no default key.
3. e2e: the fixture's silence (check what `e2e/fixtures/sample-h264.mp4`
   actually contains before assuming — if it has no silent run ≥ 0.5 s, add
   a fixture that does), the count in the status line, the total frame
   count after the cut equals before minus the removed ranges (frame-sum
   invariant), one Ctrl+Z restores everything, the disabled reason before
   the peaks arrive.
4. ADR-0016 records the rule table above and the mute decision.
5. Persona round (tester-qa on frame accuracy and the one-undo contract,
   tester-novice on the label and the sentence, tester-a11y on the button
   and the announcement), fix blockers, gate, visual pass through
   dev-browser if attached, `handoff`, commit only with approval.

**Out of scope for this unit:** exposing the three constants in the UI, an
RMS measure, a relative threshold, per-clip "이 부분은 조용해요" on the
waveform (the debt entry stays; it now has its rule).

**How progress and issues are reported (the owner asked for this).** The
Codex session's chat is not the record; this file is. So:

- Keep a section **"### E9 progress"** in this file, directly under this
  plan, and append one line per step as it finishes: the step number, the
  gate result at that point (`unit N · e2e M` or "not run"), and anything
  that did not go to plan. Write it BEFORE moving to the next step, so a
  session that dies mid-unit leaves the truth behind.
- Under it, **"### E9 issues"**: every decision made that the plan did not
  settle (the mute question, a fixture that had to be added, a rule that
  had to bend), every persona finding by tier with what was done about it,
  and every test that had to change with why. A red gate is written here
  as red, with what was ruled out.
- **Stop before the commit.** After `npm run handoff`, this file rewritten
  and the commit message shown, the unit pauses for two things in this
  order: a **review from a Claude Code session** (it reads this file and
  the diff, runs the gate, spawns the persona subagents in `.claude/agents/`
  and, if a Chrome is connected, does its own visual pass), then the
  owner's approval of the commit. Findings from that review are fixed in
  the same unit; the commit is one commit.

### E9 progress

**Done in Claude Code, not Codex (2026-09-14, afternoon KST).** The Codex
session got as far as reading the plan and restarting the baseline gate
(its notes: PowerShell refuses `npm.ps1`, use `npm.cmd`; `dev-browser`
fails on this PC with "Could not determine the home directory for the
embedded daemon runtime"); it wrote no code. The owner stopped it and had
the unit implemented here, with Claude in Chrome for the visual pass. The
plan's steps, in order, with the gate at each point:

1. **Engine** — `src/engine/silence.ts` (`silentRuns` / `silencePlan` /
   `silencePatch`, four constants), test-first in `silence.test.ts`
   (29 specs: edges of the file, a partial last bucket, a run a clip is
   trimmed into, a run across a split, 29.97, the threshold as float32,
   a whole clip inside a run, subtitles, the exact inverse). `time.ts`
   gained `sampleToFrame` (integer arithmetic, `'ceil' | 'floor'`) and
   `secondsText` (which `fadeSecondsText` now delegates to). Gate at this
   point: refs · typecheck · unit 607 green, e2e not run.
2. **Command** — `timeline.cutSilence` in `silenceCommand.ts` (label
   조용한 부분 없애기, icon ⏭, no key, registered after
   `timeline.closeGaps` so the toolbar shows it there). The peaks reach it
   through `EditorCtx.peaks` (`editor.setPeaksSource`, wired once in
   `App.tsx` from `ui/waveform.peaksFor`); `Toolbar` and `CommandPalette`
   re-render when peaks land (`subscribeWaveforms`, `mediaVersion`).
   `silenceCommand.test.ts`: 12 specs (three reasons + the all-muted one,
   the sentence, one undo step, playhead clamp, selection pruning).
3. **e2e** — `e2e/silence.spec.ts`, 6 cases, on a NEW fixture
   `e2e/fixtures/sample-silence.mp4` (see issues). Full gate after this
   step: **unit 607 · e2e 115 · exit 0** (14:35 KST).
4. **ADR-0016** written; `docs/adr/README.md` and `docs/TESTING.md` (a
   contract row for the button, the fixture note) updated.
5. **Persona round** (tester-qa, tester-a11y, tester-novice,
   framewright-reviewer, in parallel, after the green gate): no blocker.
   Fixed in this unit: the QA major (stale palette row, below), two
   wording majors from the novice (the sentence now says 앞뒤 0.2초씩은
   남겨 뒀어요; the all-muted reason now says what to do). Everything
   else is in CLAUDE.md "Known tech debt" under the ADR-0016 entries.
   **Visual pass in the owner's Chrome** (`da2a0786-…`, confirmed by the
   owner): the button sits after 빈 곳 없애기 without wrapping at 1512px,
   flips to enabled once the peaks land, the cut of the fixture made two
   clips (181 → 153 frames, 0.93초), the strip's wave shows the pause
   gone, the sentence reads correctly, and two Ctrl+Z put the owner's own
   7-clip project back exactly. No new visual defect. The gate below is
   the `npm run handoff` run after the persona fixes.

### E9 issues

- **The fixture had to be made.** `sample-h264.mp4` is a steady tone
  (peak 0.13 for its whole 3 s — measured through the app's own decode),
  so it has no pause. There is no ffmpeg on this PC. `sample-silence.mp4`
  is that file's pictures with tone · 1.4 s of digital silence (0.9–2.3
  s) · tone, produced by swapping the decoded audio through
  `setAudioBuffer` and running the app's export. Decoded back, the pause
  measures 0.901–2.299 s and the cut is [34, 62) = 28 frames; the e2e
  allows ±1 frame per edge for another decoder.
- **Mute decision (ADR-0016):** a muted clip is skipped, not judged;
  `volume` and the fades are ignored — the rule is about the file as
  recorded. Codex had proposed the same.
- **The palette's rows went stale** (QA persona, major): `CommandPalette`
  computed its rows on `[query, keymap]` only, so a palette opened before
  the peaks landed showed 조용한 부분 없애기 as a dead end until the query
  was retyped. Pre-existing memo shape, first observable here. Fixed with
  a `peaksVersion` bump from `subscribeWaveforms` (+ `mediaVersion`), and
  guarded by the e2e "a palette row opened while the sound is still being
  read wakes up when it lands", which was run red without the fix and
  green with it.
- **Wording changed after the persona round**, and the tests' expected
  strings with it (one line each, nothing else): the done sentence gained
  " · 앞뒤 0.2초씩은 남겨 뒀어요" (novice: 없앴어요 while a beat of every
  pause remains read as half-worked) and, when clips were skipped, " ·
  잠시 뒤 다시 누르면 찾아요"; the all-muted reason is now "소리를 끈 클립은
  건너뛰어요 · 소리를 다시 켜면 그 클립의 조용한 부분도 찾아요".
- **"Before the peaks arrive" is not asserted in e2e.** The window
  between the file landing and its peaks is a few hundred ms in the gate
  browser, so the reason "소리를 아직 읽는 중이에요" is pinned in the unit
  spec only; the e2e asserts the two deterministic reasons (nothing
  imported, no pause) and the enabled state.
- **The transport readout says the LAST frame, not the count** (`0 / 89`
  for 90 frames). The e2e helper adds one; worth knowing before the next
  spec reads it.
- **Stray files** at the root, untracked and not part of this unit:
  `debug.log` (Chrome audio warnings) and `e9-baseline.log` (Codex's
  UTF-16 verify output). Delete or ignore; not committed.

## Blocked / needs the owner

1. **Commit approval for E8-2a + the E8-2 plan docs, as ONE commit** (the
   owner's call on 2026-09-15). The visual pass is done. The owner's own
   uncommitted edits to `AGENTS.md`, `CLAUDE.md` (the ui-ux-guide bullet)
   and `docs/UX.md` stay theirs to commit — they are in the same files
   as this unit's changes to `CLAUDE.md` (debt entries), so the commit
   must stage `CLAUDE.md` by hunk, or the owner commits theirs first.
2. **The visual pass's trace in the owner's Chrome:** nothing left in the
   document (verified identical); the timeline view was zoomed once by a
   mis-aimed click (view state, not the document) and the playhead was
   left on frame 10.
3. **Two auto snapshots and one file** from the visual pass: 자동 저장
   10:26 / 10:29 (2026-09-11) in the browser's 이전 상태, and
   `Downloads/Untitled.mp4`. Delete or keep.
4. **Product calls still open from the reframe unit (E8-2 no longer waits
   on them):** should 세로 imply 채우기 for every clip (today: per clip,
   deliberately, ADR-0015 "Consequences"); should the box change be
   reachable from the toolbar or only the preview row and the palette;
   should a 4:3 preset exist.
5. **Unchanged from E7:** playback and an export with a transformed clip
   watched; the sound unit's listening list; the auto snapshots from the
   2026-09-10 visual passes in the browser's 이전 상태; the turn's own
   STATUS sentence (the panel note says the black now, the sentence does
   not); the fade-edge heading, zoom's real-pixel count, the fade mark
   over bright footage, the dip through black at a double fade, the
   quiet-source waveform, the AWS deployment direction.
