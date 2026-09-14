# STATUS — the live handoff

**This file is the handoff.** It is rewritten at the end of every unit of work,
by whoever did the work, before they report anything to the owner.

Write it for a reader with **zero memory of any conversation**. No "as
discussed", no "the fix we talked about", no pronoun pointing at chat history.
If it is not in a file in this repo, it does not exist — chat context dies, the
repo does not.

<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->

**Last verified:** 2026-09-14 02:14 UTC — `npm run verify` **GREEN**

- unit 562 passed · e2e 110 passed

<!-- VERIFY:END -->

## Where we are

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
2. Visual QA in Codex is dev-browser (Puppeteer underneath) in **attach
   mode** on the owner's real Chrome; not its isolated launch profile.
   Claude Code keeps Claude in Chrome; dev-browser is not added there —
   it would be a second driver on the same Chrome for nothing new.
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

**Commit the tree as it stands** (`AGENTS.md`, `.codex/agents/`,
`.codex/skills/`, `.codex/config.toml`, the five doc edits, this file) —
the owner must approve the commit first. Then open the repo in a fresh
Codex session: trust the project and the four hook commands in `/hooks`,
confirm the SessionStart handoff prints and that `spawn_agent` offers the
six roles. Install dev-browser (`npm install -g dev-browser`) if the
visual pass is wanted in that session.

**Then E9, silence auto-cut, in Codex** — chosen over E8's second item
(style presets) because E9 is engine-first: silence detection over
decoded PCM is a pure function (Vitest in Node, TDD), and the cut is
existing splits plus ripple deletes folded into one undo step. E8-2
still waits on the product call below (does 세로 imply 채우기).

### E9 execution plan — silence auto-cut

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

## Blocked / needs the owner

1. **Commit approval** for the uncommitted tree (see "Next single step").
   `10050d3`, `845bfa4` and `f5f2512` are pushed.
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
