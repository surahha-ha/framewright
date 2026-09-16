# STATUS — the live handoff

**This file is the handoff.** It is rewritten at the end of every unit of work,
by whoever did the work, before they report anything to the owner.

Write it for a reader with **zero memory of any conversation**. No "as
discussed", no "the fix we talked about", no pronoun pointing at chat history.
If it is not in a file in this repo, it does not exist — chat context dies, the
repo does not.

<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->

**Last verified:** 2026-09-16 06:03 UTC — `npm run verify` **GREEN**

- unit 797 passed · e2e 142 passed

<!-- VERIFY:END -->

## Where we are

### E10 step 2, the image engine, is done and UNCOMMITTED (2026-09-16)

Everything an image is, as engine code with no screen: an image is its
own list on the document (`Project.images: StageImage[]`, ADR-0011's
argument applied — see row 2 of the plan below), it survives a save and
a reload (schema 2 → 3), it follows the footage through every ripple the
words follow, it has eight commands, and the export plan carries one
answer per frame for it. **Nothing is visible yet** — that is step 3
(media) and step 4 (the stage). The gate was re-run from scratch and
stamped by `npm run handoff` at the top of this file: **GREEN, unit 797
passed across 50 test files (was 692 across 43), e2e 142 passed
(unchanged).** The plan predicted "~60 new tests"; the real number is 105.

**New files** — `src/engine/spans.ts` (the timing arithmetic for any
`{ id, startFrame, endFrame }` span: `spanAt`, `locateSpan`, `spanPlan`,
`spanLimits`, `rippleSpans`, `splitSpanAt`, `spanDiffOps`),
`src/engine/images.ts` (span queries, the image's normal form, the centre
snap, `imageFrameAt`, `imagesInPlan`, the `ImageSource` seam and
`NO_IMAGES`, the sentences), `src/engine/imageRender.ts` (`imageRect`,
`drawImageFrame`, `ImageLayer`), `src/engine/imageCommands.ts` (the eight
commands: `image.import`, `image.add`, `image.remove`,
`image.setPosition`, `image.setSize`, `image.moveToPlayhead`,
`image.startToPlayhead`, `image.endToPlayhead`), and their specs
`spans.test.ts` (23), `images.test.ts` (32), `imageRender.test.ts` (8),
`imageCommands.test.ts` (24), plus `ops.test.ts` (5), `project.test.ts`
(2) and **`exporter.test.ts` (4) — the first Node test of `exportProject`
this repo has ever had.**

**Changed** — `types.ts` (`StageImage`, `ImageFrame`, `Project.images`),
`ops.ts` (`insertImage` / `removeImage` / `updateImage`, `dropUndefined`
on the update), `persistence.ts` (`CURRENT_SCHEMA` 2 → 3, `upgradeProject`
fills `images: []` into the live project and every version snapshot),
`project.ts`, `subtitles.ts` (**397 → 296 lines**, now thin delegates onto
`spans.ts`), `commands.ts` (the image diff beside the word diff at the
three ripple sites — `clip.deleteRipple`, `timeline.closeGaps`,
`clip.paste`), `silence.ts` (the fourth ripple site), `compose.ts`,
`exportPlan.ts` (`ExportFrame.image`), `exporter.ts` (the images phase
and `missingImages`), and the specs `compose.test.ts`,
`exportPlan.test.ts`, `persistence.test.ts`, `silence.test.ts`,
`mediaStore.test.ts` (one fixture gained `images: []`).

**`src/engine/subtitles.test.ts` is byte-for-byte identical to
`8f10d25`** (`git diff --exit-code` on it returns 0). That is the proof
the `spans.ts` delegation changed nothing: 28 tests written against the
subtitle functions still pass against functions that now do their
arithmetic somewhere else, and not one expectation was touched to make
them.

**Four design decisions a future session should not re-litigate:**

- **`composeFrame` gained an EIGHTH parameter, `image: ImageLayer | null
= null`, last and defaulted.** Because it is last and optional, **none
  of the 11 existing `compose.test.ts` calls had to change** — the two
  new ones pass it. A named options object would have rewritten every
  call site for no behaviour.
- **`ImageLayer.picture` is required-and-nullable** (`picture:
CanvasImageSource | null`), not optional. A caller that forgets the
  picture is a compile error; an optional field would have silently
  drawn a blank frame. `drawImageFrame` returns early on a null picture,
  which is the legitimate "the bitmap has not arrived yet" case.
- **`ExportResult.missingImages` holds file NAMES, not asset ids**, so
  `ExportButton` needs no lookup to write its sentence. This mirrors
  `missingFonts`, which already made that choice.
- **The image's normal form is its own, not the subtitle's**: whole
  percents; `0.5` stored ABSENT on both axes (absent means the centre);
  size `0.25` stored absent; and the centre is the only snap. An image
  at the bottom edge is `0.97`, not a preset — there are no image
  presets to snap to.

**`ImageBitmap` appears nowhere in `src/engine/**`** (grep-verified), so
golden rule 8 holds: `ImageSource` is the seam and `ui/images.ts` will be
the browser half. The bitmap has one owner, that cache — the exporter
closes no bitmap and `cleanup()` gained no image step.

**Persona round on the step-2 diff:** `framewright-reviewer` — 0
findings. `tester-qa` — 0 blockers, 1 major and 1 minor, both now
CLAUDE.md "Known tech debt" entries and both recorded under "E10 issues"
below. **`tester-a11y` and `tester-novice` were deliberately NOT run:
this unit puts nothing on screen, so neither persona has anything to
review. They belong to steps 4 and 5**, and running them here would have
produced findings about code that does not exist yet.

**Uncommitted:** the four new engine modules, their seven new specs, the
fifteen changed engine files and specs listed above, this file, and
`CLAUDE.md`'s debt list. The owner has not yet been asked for the commit
— that is the next single step. The owner's own edits (`AGENTS.md`,
`CLAUDE.md`'s ui-ux-guide bullet, `docs/UX.md`) and the two stray logs
(`debug.log`, `e9-baseline.log`) stay theirs.

### E10 step 1 is committed and pushed (`8f10d25`, 2026-09-16)

**`origin/main` = `8f10d25`.** The paragraph below was written before
the commit and is kept as the record; "uncommitted" in it is no longer
true of the unit's three source files.

`src/ui/useStageDrag.ts` (new, 163 lines) is the one hook for the stage's
two drags — `useStageDrag<T>({ press, move, release }) → { onPointerDown,
onPointerMove, onPointerUp, active }` — owning the drag ref, pointer
capture, the 3px threshold, the two `dragAxis` calls with the origin
rebase, and the up/cancel teardown. Two callers: the picture's pan in
`src/ui/Preview.tsx` (657 → 602 lines) and the words in
`src/ui/useWordsDrag.ts` (253 → 207). Zero behaviour change; proof:
`check:refs`, `typecheck`, unit 692/692, `npm run e2e:chrome` on
`e2e/subtitle-drag.spec.ts` (9) + `e2e/picture.spec.ts` (5) = 14/14, no
test edited. Personas on the diff: framewright-reviewer 0 findings;
tester-qa 0 blockers, 2 minors (no re-entrancy guard on `onPointerDown`,
`setPointerCapture` unguarded), both verified pre-existing in `39be4b4`
and carried into the hook unchanged on purpose — now the top entry of
CLAUDE.md "Known tech debt". The plan's targets "under 580 / under 200"
were missed by ~20 lines each because the pan's and the words' rationale
comments (the ADR-0006 / 0014 / 0019 references) were kept — accepted.
The three source files were committed with the owner's approval as
`8f10d25` and pushed the same day; `39be4b4` (E8-2d) is its parent.

### E8-2d, the E8-2 debt pass, is committed and pushed (`39be4b4`, 2026-09-16)

**Committed with the owner's approval and pushed the same morning;
`origin/main` = `39be4b4`.** The paragraph below was written before the
commit and is kept as the record; "uncommitted" in it is no longer true
of the unit's files — only the owner's own edits remain in the tree.

The owner decided on 2026-09-16: E8-2 debt first, then E10. The unit is
ten fixes to what the E8-2a/b/c persona rounds left, by the rule table in
"E8-2d execution plan" below; the record step by step is "E8-2d progress"
/ "E8-2d issues"; what the persona round left this time is in CLAUDE.md
"Known tech debt" (the seven entries at the top). Two contracts changed
and are recorded as dated amendments: ADR-0018 ("never at start" → every
face the document names is fetched, quietly, when the document opens)
and ADR-0019 (a stage drag stays attached to the pointer at the edge —
`engine/stageDrag.ts`). `Preview.tsx` went from 790 to 657 lines; the
words drag is `ui/useWordsDrag.ts`, the faces `ui/useSubtitleFonts.ts`.
Gate GREEN: unit 692 · e2e 142 (was 684 · 137). Personas: 0 blockers; 3
of 4 majors fixed in the same round, 1 (the export bar's jump back to 0%
at the audio phase) kept as debt with the reason. Visual pass in the
owner's Chrome (Browser 1, foreground tab, netstat-confirmed local): the
checked dot legible on all five radio rows, the 자리 row with nothing
checked off a preset and its sliders beneath, a two-leg drag past the
bottom edge and back landing at 위에서 80% with the sentence, one undo
back to 아래; no finding. **Uncommitted:** every file of the unit (see
"E8-2d progress" for the list) plus this file; the owner's own edits
(`AGENTS.md`, `CLAUDE.md`'s ui-ux-guide bullet, `docs/UX.md`) and the two
stray logs are still theirs.

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

### E8-2a, 예능 자막, is committed as `f7624ac` (2026-09-15), not yet pushed

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
progress"; one finding, fixed, with an assertion). **Committed as
`f7624ac` with the owner's approval (2026-09-15, 13:20 KST), 1 ahead of
`origin/main` = `91795d8`; the owner chose to push later.** This
paragraph and the two "Next single step" / "Blocked" passages that name
the commit were rewritten AFTER `f7624ac`, so they sit in the tree as a
docs-only change. Also in the tree, NOT part of this unit: the owner's own edits to `AGENTS.md`,
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

### E8-2b, 캘리그라피 글꼴, is committed and pushed (`5b56e41`, 2026-09-15)

Built in Claude Code on 2026-09-15 across two sessions: a subtitle's
face as its own field (`font?: 'brush' | 'pen' | 'black'`), three OFL
faces as the original TTFs under `public/fonts/` (7.6 MB, licence text
beside each), fetched from the app's own origin the first time a
subtitle picks one and never at start, drawn with the fallback until the
file lands, waited for by the export. ADR-0018 is the contract; "E8-2b
progress" / "E8-2b issues" under the plan below are the record; the
persona round's leftovers are the five newest entries in CLAUDE.md
"Known tech debt". The gate stamped above is this tree's handoff run.
New files: `src/engine/fonts.ts` (+test), `src/engine/abort.ts` (+test),
`src/ui/fonts.ts`, `e2e/subtitle-font.spec.ts`, `docs/FONTS.md`,
`docs/adr/0018-a-subtitle-has-a-face-fetched-when-chosen.md`,
`public/fonts/*`. Changed: `types.ts`, `subtitleRender.ts`,
`subtitleStyle.ts`, `subtitleCommands.ts` (+tests), `exporter.ts`,
`ui/ExportButton.tsx`, `ui/Preview.tsx`, `ui/SubtitlePanel.tsx`,
`docs/TESTING.md`, `docs/adr/README.md`, CLAUDE.md's debt list, this
file. **The visual pass in the owner's Chrome is done** (step 11 of
"E8-2b progress"); one finding, fixed with a unit and an e2e assertion.
**Committed with the owner's approval as `5b56e41`** (the whole unit in
one: code, the three font files with their licences, docs; `CLAUDE.md`
staged by hunk so the owner's ui-ux-guide bullet stayed out). This file
carries the post-commit rewrite of three passages (docs only), which can
ride along with whichever commit comes next. **Not pushed — ask first.**

### E8-2c, 자막 끌기, is committed and pushed (`12523cc`, 2026-09-15)

Built in Claude Code on the evening of 2026-09-15, right after E8-2b was
pushed: the words on the preview can be dragged anywhere (a press on the
drawn block selects the subtitle and drags it; the drop snaps within 3%
of a preset), two sliders 가로 자리 · 세로 자리 are the keyboard's route,
one sentence under them says where the words are, and every writer goes
through one normal form so a drop on a preset IS the preset. ADR-0019 is
the contract; "E8-2c progress" (9 steps) / "E8-2c issues" under the plan
below are the record; the persona round's leftovers are the eight newest
entries in CLAUDE.md "Known tech debt". The gate stamped above is this
tree's handoff run. New files: `src/engine/subtitlePosition.ts` (+test),
`src/ui/RangeRow.tsx` (moved out of `ClipPanel.tsx`),
`e2e/subtitle-drag.spec.ts`, `docs/adr/0019-the-words-are-dragged-on-the-stage.md`.
Changed: `subtitleCommands.ts` (+test), `subtitleStyle.ts` (+test),
`subtitleRender.ts` (+test), `ui/Preview.tsx`, `ui/SubtitlePanel.tsx`,
`ui/ClipPanel.tsx`, `styles.css`, `docs/TESTING.md`, `docs/adr/README.md`,
CLAUDE.md's debt list, this file. **Committed with the owner's approval
as `12523cc` and pushed the same evening** (ONE commit, the E8-2b
recipe: `CLAUDE.md` staged by hunk so the owner's ui-ux-guide bullet
stayed out). This file carries the post-commit rewrite of three passages
(docs only), which can ride along with whichever commit comes next.

## Next single step

**Announce the E10 step-2 commit and wait for the owner.** This is the
one hard stop in the loop: the work is done and the gate is green, and
nothing else happens until the owner says to commit. The tree is
uncommitted on top of `origin/main` = `8f10d25`.

**The commit recipe, which has now worked five times:**

1. Stage step 2's source and spec files — the four new engine modules
   (`src/engine/spans.ts`, `images.ts`, `imageRender.ts`,
   `imageCommands.ts`), the seven new specs (`spans.test.ts`,
   `images.test.ts`, `imageRender.test.ts`, `imageCommands.test.ts`,
   `ops.test.ts`, `project.test.ts`, `exporter.test.ts`), and the changed
   `types.ts`, `ops.ts`, `persistence.ts`, `project.ts`, `subtitles.ts`,
   `commands.ts`, `silence.ts`, `compose.ts`, `exportPlan.ts`,
   `exporter.ts` with their specs `compose.test.ts`, `exportPlan.test.ts`,
   `persistence.test.ts`, `silence.test.ts`, `mediaStore.test.ts`; plus
   `docs/STATUS.md`.
2. Stage `CLAUDE.md` **by hunk** — take the "Known tech debt" hunks and
   DROP the hunk containing `ui-ux-guide`, which is the owner's own
   uncommitted edit. As of this writing `git diff -U0 -- CLAUDE.md` shows
   exactly three hunks and the owner's is the first one, around line 226.
3. Leave `AGENTS.md`, `docs/UX.md`, `debug.log` and `e9-baseline.log`
   out. The first two are the owner's; the two logs are stray.
4. Write the Korean commit message with the **Write tool** into a file
   and commit with `git commit -F <file>`, so the Korean subject survives
   the shell. Never pass Korean through a shell redirection.
5. **Ask before pushing.**

**Then E10 step 3 — Media** (the plan's "Steps, in order" item 3, below).
Its ending state: a dropped PNG is an asset, stored in OPFS, restored
after a reload, and placed in the document — still invisible on screen
until step 4. What it touches:

- **`src/ui/images.ts` (new)** — the browser loader and cache:
  `createImageBitmap`, the bitmap cache, `subscribeImages`,
  `retainOnlyImages` (which `close()`s every bitmap it drops) and
  `releaseImage`. Those two are the ONLY callers of `close()`: the cache
  is the single owner of every bitmap, which is what lets the exporter
  never close one (golden rule 6; see the step-2 section above and row 9
  of the plan).
- **`src/ui/media.ts`** — one `isMediaReady(asset)` to replace the
  ad-hoc "is the media here" test, and `restoreSavedMedia` branching on
  `asset.kind`. Today it rebuilds every `File` as `'video/mp4'` and runs
  `demuxVideo`, so an image asset with an `opfsKey` would restore as
  "lost".
- **`src/ui/MediaBin.tsx`** — widen `accept` past `video/*`, add the
  image branch of `onFile` (record `meta.width` / `height`, persist the
  bytes by content hash, re-link by name like a video), and add the row
  and its button.
- **`src/App.tsx`** — `retainOnlyImages` alongside the four per-asset
  caches already freed when an asset leaves the document.
- **The three `missingMedia` sites** — `Preview.tsx`, `MediaBin.tsx` and
  `ExportButton.tsx` each call `getDecodeService` directly today; they go
  through `isMediaReady`, because an image asset has no decode service
  and would otherwise read as missing.
- **`src/ui/ExportButton.tsx`** — pass `images: browserImages` beside
  `fonts: browserFonts`, add the phase word 이미지 여는 중 for the
  `'images'` phase, and the ⚠ sentence for `missingImages`.

The owner decided the order on 2026-09-16: E8-2 debt first, then E10.
The full E10 plan is below, its four open questions are answered there,
and "E10 progress" / "E10 issues" under it are the step-by-step record.

**The E10 plan follows. The E8-2d plan after it is done; kept as the
record.**

### E10 execution plan — 이미지·스티커

**What this is.** The last item of the owner's 예능 자막 definition
("What 'style presets' means" below): an image (a PNG / JPEG / WebP
sticker, a logo) on the picture for a range of timeline frames, dragged
anywhere on the stage, sized by one slider, deleted, undone, exported.
It is a NEW KIND OF THING on the timeline — the third after clips and
subtitles — and the stage's THIRD drag after the picture's pan
(ADR-0014) and the words (ADR-0019). ADR-0019's amendment names that
third drag as the rule-of-three trigger for the DOM half the pan and
the words duplicate; so **step 1 of this unit is that extraction, on
the two callers that exist, with no behaviour change and the fourteen
existing stage e2e tests as the proof — before a line of image code.**
The rest mirrors the shape subtitles took (ADR-0011: its own list, its
own ops and commands, one draw for both surfaces, a lane, a panel), so
a reader who knows how a subtitle works knows how an image works.
ADR-0020 records the decisions. The MVP is deliberately small: no
rotation, no effect, no multi-select, no lane drag, one image on
screen at a time (see "Left as debt on purpose").

**Facts the plan stands on (measured 2026-09-16, tree at `39be4b4`,
gate unit 692 · e2e 142):**

- `ui/Preview.tsx` is 657 lines. The pan drag is lines 89–191:
  `panDragRef` (89–102: clipId, pointerId, originX/Y, panX/Y, zoom,
  width, height, limitX/Y, moved), `onStagePointerDown` (106–144: the
  words asked first at 111, press-to-choose at 118–122,
  `getBoundingClientRect` at 125, `setPointerCapture` at 143),
  `onStagePointerMove` (146–183: the 3px threshold 150–155, two
  `dragAxis` calls 160–175, origin rebase 176–177, `run('clip.pan', …,
'pan:<id>')` 178–182), `onStagePointerUp` (185–191: null the ref,
  `endGesture`). The overlay canvas is 596–602 (`.stage-subtitle`,
  `role="img"` named by its words); the `place()` effect that sizes it
  over the picture is 387–405; `missingMedia` at 193 is
  `project.assets.some((a) => !getDecodeService(a.id))`.
- `ui/useWordsDrag.ts` is 253 lines: `dragRef` 74–97 (the same ten
  fields plus `bottomCentreY`, `lastX/Y`, `chose`), `onPointerDown`
  149–175 (the hit test, `selectSubtitle`, `setPointerCapture`),
  `onPointerMove` 179–223 (hover when idle 181–187, threshold 188–193,
  two `dragAxis` calls 197–212, rebase 213–214, `run('subtitle.
setPosition', …, 'pos:<id>')` 217–221), `onPointerUp` 227–250 (the
  snap at the drop 234–242, the press-only sentence 243–247,
  `endGesture`). Only `engine/stageDrag.ts` (42 lines, `dragAxis`, 5
  tests including the no-extent / NaN contract "since E10's third
  drag will call it") is shared. Everything else in the two lists
  above is written twice.
- `engine/types.ts` (146 lines): `Asset.kind` is already `'video' |
'audio' | 'image'` (line 33) and nothing creates an `'image'`;
  `AssetMeta` has `width` / `height`; `Subtitle` is 116–135, `Project`
  137–146 with `subtitles: Subtitle[]`. `engine/ops.ts` (149): the
  three subtitle ops are 19–25, `dropUndefined` applies to
  `updateSubtitle`. `engine/persistence.ts`: `CURRENT_SCHEMA = 2` (line
  12), `upgradeProject` 64–68 fills `subtitles`. `engine/project.ts`
  (23) has no `images`.
- `engine/subtitles.ts` (397 lines, 28 tests): `subtitleAt` (25),
  `locateSubtitle` (33), `subtitlePlan` (48), `subtitleLimits` (74),
  `rippleSubtitles` (207–243), `splitSubtitleAt` (253–275),
  `subtitleDiffOps` (289–333). `rippleSubtitles` reads only
  `startFrame` / `endFrame` and spreads the rest — generic in all but
  its name; `splitSubtitleAt` mints `sub_<n>`; `subtitleDiffOps` emits
  the three subtitle op kinds. Four commands ripple the words with
  them: `clip.deleteRipple` (`commands.ts` 234–237), `timeline.
closeGaps` (429–432, 451), `clip.paste` (761–772) and the silence
  cut (`silence.ts` 332–335).
- `engine/subtitleCommands.ts` (628 lines, 35 tests): 14 commands
  (613–628); `edgeToPlayhead` (287–353) and `subtitleToPlayheadCommand`
  (361–408) are the keyboard's timing route; `setFieldCommand`
  (489–518) is subtitle-typed (`locateSubtitle`, `updateSubtitle`).
- `engine/exportPlan.ts` (101): `ExportFrame.subtitle: SubtitleFrame |
null` (23) from `subtitleFrameAt` (40) — one answer per frame for
  both surfaces. `engine/compose.ts` (101): `composeFrame(ctx, width,
height, primary, blend, subtitle, transform)` (78–101) draws black,
  the footage, the blend, then the words last (100); 11 tests with a
  fake context that records `drawImage`. `engine/exporter.ts` (392):
  the fonts phase 157–175 loads every face `fontsInPlan` names before
  frame 0 through the `FontLoader` seam (`engine/fonts.ts` 104–114,
  `NO_FONTS`; the browser half `ui/fonts.ts`, 70 lines) and reports
  `missingFonts`; `composeFrame` is called at 337–345 with
  `entry.subtitle`; `ui/ExportButton.tsx` (127) hands in
  `fonts: browserFonts` (38) and names the phases (41–50).
- `ui/MediaBin.tsx` (320): `accept="video/*"` (281); `onFile` (112–249)
  copies the bytes, `openSource` (demux), `persistMedia` → OPFS by
  content hash, re-links by name (149–186), else `editor.importAsset`
  (a hand-written patch, not a registry command — the ADR-0009 debt
  entry; it also inserts a clip and sets the timeline on the first
  import, `command.ts` 254–311); the asset rows (303–316) show 🎬 or ⚠
  by `getDecodeService`. `ui/media.ts` (258): `loadSavedMedia`
  (184–189) rebuilds a `File` typed `'video/mp4'`; `restoreSavedMedia`
  (215–248) → `attachFileToAsset` → `demuxVideo`, so an image asset
  with an `opfsKey` would restore as "lost". `getDecodeService` is the
  "media is here" test in three places: `Preview.tsx` 193,
  `MediaBin.tsx` 47, `ExportButton.tsx` 23. `App.tsx` 40–50 frees four
  per-asset caches (`retainOnly*`) when an asset leaves the document.
- Selection is two exclusive ids: `Editor.selectedClipId` /
  `selectedSubtitleId` (`command.ts` 13–18, `pruneSelection` 103–114,
  `selects` / `selectsSubtitle` 173–182), mirrored by
  `projectStore.ts` (513 lines; `selectSubtitle` 455–462) and read by
  `EditorCtx` (`commands.ts` 35–52). `ui/Timeline.tsx` (881): `contentPx`
  (234–245) grows for a subtitle past the video's end; `SubtitleLane`
  is mounted at 854–859. `ui/SubtitleLane.tsx` 377, `ui/SubtitlePanel.tsx`
  440, `ui/RangeRow.tsx` 53.
- `styles.css` (1491): `.stage canvas.stage-subtitle` 305–310 (absolute,
  `pointer-events: none`), `.stage.movable` 1394, `.stage.words` 1401.
  `docs/TESTING.md` (442): the DOM contract table is 329–385;
  `docs/adr/README.md` (48) lists 0001–0019.
- e2e that must stay green through step 1 and after: `e2e/subtitle-
drag.spec.ts` (341 lines, 9 tests) reads the ALPHA of `.stage-
subtitle` as its oracle (`inkBounds` 47–72) and relies on the hit
  order words → pan (187–214); `e2e/picture.spec.ts` (291 lines, 5
  tests) presses the picture's CENTRE to pan (243–290) — the default
  place an image would sit. `e2e/fixtures/` holds two mp4 and no image;
  Playwright's `setInputFiles` takes `{ name, mimeType, buffer }`, so
  the spec can carry a 2-colour PNG as a constant.

**The four open questions, answered.**

- **(a) Where an image lives — its own list, `Project.images:
StageImage[]`, exactly as ADR-0011 argued for subtitles.** A `Clip` is
  a window onto source frames (`assetId`, `inFrame`, `outFrame`) and
  every reader of `track.clips` — drag bounds, trim limits, the plan,
  the strips, the clipboard, `resolveAt` — reads those three; an image
  has an asset but no frames inside it. `{ id: 'img_<n>', assetId,
startFrame, endFrame (exclusive), posX?, posY?, size? }`, sorted by
  start, never overlapping (one on screen at a time, the subtitle's
  rule — a taste call, below). Not a taste call otherwise: it is the
  architecture the repo already chose once.
- **(b) How it comes in — the media bin's input, `accept="video/*,
image/*"`, the bytes kept in OPFS by the same content key, and ONE
  command `image.import` that adds the asset AND places the image at
  the playhead for 2 s in one undo step (import = place).** A dropped
  sticker that lands only in a list and then needs a second gesture is
  one step more than a first-time user expects; a subtitle appears on
  the press. Re-use is the row's own button 재생 위치에 넣기
  (`image.add { assetId }`). No paste in this unit (a paste target,
  a clipboard image type and a name for the asset are three more
  decisions). **Taste call for the owner: import = place, or bin then
  a button.**
- **(c) Where it draws — its own canvas `.stage-image` between the
  picture and the words; z-order picture < image < words, in the
  preview and in `composeFrame`.** The words' canvas is the subtitle
  e2e's pixel oracle and is `role="img"` named by its words; an image
  drawn there would change both. A caption stays readable over a
  sticker, which is the variety-show convention. The stage's hit test
  follows the draw order backwards: words → image → pan. **Taste call
  for the owner: words above images (recommended) or images above
  words.**
- **(d) What the export carries — `ExportFrame.image: ImageFrame |
null` per frame, built by `imageFrameAt` exactly as `subtitle` is
  by `subtitleFrameAt`; the exporter opens every bitmap the plan names
  BEFORE frame 0 (an 'images' phase, like the fonts phase) through an
  `ImageSource` seam (`engine/images.ts`, browser half `ui/images.ts`,
  the `FontLoader` shape), draws it through the same `imageRect` the
  preview hit-tests with, and reports the ones it could not open in
  `missingImages` (drawn as nothing, not counted as missing frames).**
  Not a taste call: one answer per frame is ADR-0011's rule.

**Owner's calls, taken as recommended until told otherwise (confirm at
the end of the unit):**

- One image on screen at a time — no overlap, the subtitle's rule.
- Import = place — a dropped image lands on the stage at the playhead
  for 2 s, in one undo step.
- Words draw above images.

**Step 1 — the stage drag as one hook.** `ui/useStageDrag.ts` (new):

```ts
type StageEvent = ReactPointerEvent<HTMLDivElement>;
export interface StagePress<T> {
  /** What the press landed on and what the release needs to know. */
  target: T;
  /** The value at press, fractions of the box, per axis. */
  base: { x: number; y: number };
  /** CSS px per whole box on each axis (the pan's is width × zoom). */
  size: { x: number; y: number };
  min: { x: number; y: number };
  max: { x: number; y: number };
}
export function useStageDrag<T>(spec: {
  /** The hit test. Null = not this drag's press (the caller may have
   *  selected something and said so; the next handler is asked). */
  press(e: StageEvent): StagePress<T> | null;
  /** Every move past the threshold: the caller's coalesced command
   *  (`run(cmd, args, key)`), clamped by `dragAxis` already. */
  move(target: T, value: { x: number; y: number }): void;
  /** The release or a cancel: the snapped last write when it moved,
   *  the press-only sentence when it did not. `endGesture` follows. */
  release(target: T, moved: boolean, last: { x: number; y: number }): void;
}): {
  onPointerDown(e: StageEvent): boolean;
  onPointerMove(e: StageEvent): boolean;
  onPointerUp(e: StageEvent): boolean;
  active: boolean;
};
```

The hook owns what is written twice today: the drag-state ref
(pointerId, origin, base, size, limits, last, moved), `button !== 0`,
`setPointerCapture`, the 3px threshold, the two `dragAxis` calls and
the origin rebase, the pointerId check on every event, the teardown on
up / cancel and `endGesture`. **Per caller stays:** the hit test and
what it needs to measure (the pan: the selected-clip check, the
press-to-choose sentence, the picture canvas's rect, `pictureTransform`,
`clipPanLimits`; the words: the cached layout, `drawnBounds`, the rest
centre as base, `selectSubtitle`, `bottomCentreY` in `target`; the
image: `imageRect` from the asset's recorded size, `selectImage`), the
limits (±`clipPanLimits` / [0, 1] / [0, 1]), the command and its
coalesce key (`clip.pan` · `pan:<id>`, `subtitle.setPosition` ·
`pos:<id>`, `image.setPosition` · `imgpos:<id>`), the snap at the drop
(`snapPosition` / none / the centre only), the press-only sentence
(none / "화면의 자막을 골랐어요 · 끌면 자리가 옮겨져요." / "화면의
이미지를 골랐어요 · 끌면 자리가 옮겨져요."), and the hover cursor
(`overWords` stays in `useWordsDrag`: an idle move is a hit test, not a
drag). `useWordsDrag` and the pan become two `useStageDrag` callers;
`Preview` keeps its one handler set and asks words, then image (step
4), then pan. Proof: `typecheck`, `check:refs`, and the 14 stage tests
in `subtitle-drag.spec.ts` + `picture.spec.ts` unchanged and green —
no new e2e, because no behaviour changes. `Preview.tsx` ends under
580 lines, `useWordsDrag.ts` under 200.

| #   | Debt entry / question                                                                          | Rule after this unit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Where                                                                                                                                                                                                                                                                                                                                                                                                     | Proof                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ADR-0019 amendment: the stage's third drag is the trigger to extract the DOM half              | **One stage drag, three callers.** Press-with-capture, the 3px threshold, `dragAxis` on both axes with the origin rebase, and the up/cancel teardown exist once, in `useStageDrag`; a caller supplies only its hit test, its limits, its command + key, its snap and its sentence (the signature above). Written first, on the two callers that exist, with zero behaviour change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `ui/useStageDrag.ts` (new); `ui/useWordsDrag.ts`, the pan in `ui/Preview.tsx`; later `ui/useImageDrag.ts`                                                                                                                                                                                                                                                                                                 | none new — typecheck, check:refs, the 14 existing stage e2e tests green before and after (a refactor's proof is the tests it does not change)                                                                                                                                                                                               |
| 2   | (a) where an image lives                                                                       | **An image is its own list, `Project.images`, never a clip** (ADR-0011's argument, applied). `StageImage { id 'img_<n>', assetId, startFrame, endFrame, posX?, posY?, size? }`; absent = the centre and a quarter of the box's width; sorted, non-overlapping, `[start, end)`. Three ops `insertImage / removeImage / updateImage` (with `dropUndefined`); schema 3, `upgradeProject` fills `images: []` into every project and version.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `engine/types.ts`, `engine/ops.ts`, `engine/persistence.ts`, `engine/project.ts`                                                                                                                                                                                                                                                                                                                          | unit: ops round-trip, `upgradeProject` on a schema-2 save and on a version snapshot, `deserialize` refuses schema 4                                                                                                                                                                                                                         |
| 3   | the timing arithmetic (`subtitleAt / Plan / Limits / ripple / split / diff`) is subtitle-typed | **Timing arithmetic exists once, for spans — a small shared span module, not a rename.** `engine/spans.ts`: `spanAt`, `locateSpan`, `spanPlan`, `spanLimits`, `rippleSpans`, `splitSpanAt(list, at, makeId)`, `spanDiffOps(before, after, ops)` over `{ id, startFrame, endFrame }`. Honestly: `subtitleAt` / `locateSubtitle` / `rippleSubtitles` are already generic over `{ id, startFrame, endFrame }`, but `spanPlan` / `spanLimits` take `(list, total, defaultLen)` instead of a `Project`, `splitSpanAt` takes a `makeId`, and `spanDiffOps` takes an op factory because the subtitle version hard-codes the `insertSubtitle / removeSubtitle / updateSubtitle` op kinds (`engine/ops.ts`). `subtitles.ts` keeps its names as thin calls into it, so no caller or sentence changes; the 28 `subtitles.test.ts` tests unchanged are the proof. Shared on the SECOND use, on purpose: the ripple algorithm carries the ordering invariants the repo already documents as drift-prone (split before ripple, redo-deterministic order, the `subtitles.ts` header comments), which is exactly what must not be copied — the `framewright-reviewer` persona confirmed this on 2026-09-16. **Images follow the footage exactly as the words do** (ripple delete, close gaps, paste with a split at the paste point, the silence cut). | `engine/spans.ts` (new, test-first); `engine/subtitles.ts`; `engine/images.ts` (new); `commands.ts` ×3, `silence.ts` (three lines each: the image diff beside the word diff)                                                                                                                                                                                                                              | unit: the 28 `subtitles.test.ts` tests UNCHANGED and green (the proof the delegation changed nothing); `spans.test.ts` for the generic edge cases; `images.test.ts` for plan / limits at the video's end and beside a neighbour; one ripple test per command with an image in the cut                                                       |
| 4   | (b) how an image is imported                                                                   | **An image is an asset like a video** — `Asset.kind: 'image'` (the union already admits it), `meta.width/height` recorded at import, the bytes in OPFS under the content key, swept and restored by the same code — **and its import is a registry command, not a hand-written patch:** `image.import { name, opfsKey?, width, height }` adds the asset and inserts the image at the playhead's `spanPlan` (2 s, `secToFrame`) in ONE undo step, ids `asset_<n>` / `img_<n+1>`, the inverse never rewinding `nextId` (the `importAsset` reason). `image.add { assetId }` places an imported one again. Refused with a sentence before any video ("먼저 영상을 불러오세요."), on a frame that has one ("이 자리에는 이미 이미지가 있어요 …"), and a file `createImageBitmap` cannot open changes and stores nothing ("이 파일은 이미지로 열 수 없어요."). A dropped image whose asset is missing after a reload re-links by name, like a video.                                                                                                                                                                                                                                                                                                                                                                                         | `engine/imageCommands.ts` (new); `ui/MediaBin.tsx` (accept, the branch in `onFile`, 🖼 rows with 재생 위치에 넣기); `ui/media.ts` (`restoreSavedMedia` branches on `kind`); `ui/images.ts` (new: `createImageBitmap`, the cache, `subscribeImages`, `retainOnlyImages` closing every bitmap, `releaseImage`); `App.tsx`; the three `missingMedia` sites through one `isMediaReady(asset)` in `ui/media.ts` | unit: `image.import` / `image.add` patches, ids, refusals; e2e: a PNG dropped on the bin makes one chip and ink on `.stage-image` at the centre, survives a reload with no ⚠, and `Ctrl+Z` once removes both the chip and the row                                                                                                           |
| 5   | (c) which layer, what z-order                                                                  | **One draw for both surfaces, under the words.** `engine/imageRender.ts`: `imageRect(frame, srcW, srcH, boxW, boxH)` — centre at `pos × box`, width `size × boxW`, height by the asset's aspect, nothing clamped (the centre is; an image may hang off the edge) — and `drawImageFrame`. `composeFrame` gains `image` after `transform` and draws it after the blend, before the words; the preview draws it on `.stage-image`, a third canvas placed over the picture by the same `place()`, `role="img"` "이미지: <name>" when showing, `aria-hidden` when blank, redrawn on the frame, the bitmap landing (`imagesVersion`), and the box's size. The hit test is `imageRect` from `meta.width/height`, so a press works before the bitmap arrives.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `engine/imageRender.ts` (new); `engine/compose.ts`; `ui/Preview.tsx`; `styles.css` (`.stage canvas.stage-image`, `.stage.image` cursor `grab`)                                                                                                                                                                                                                                                            | unit: `imageRect` (aspect, size, an off-edge centre), `compose.test.ts` order — image drawn after the blend and before the words, none when null; e2e: `.stage-subtitle` ink unchanged with an image on screen (the subtitle-drag oracle stays clean)                                                                                       |
| 6   | the stage's third drag                                                                         | **A press on the drawn image selects it and drags its centre** through `useStageDrag` — limits [0, 1], one command `image.setPosition { imageId, posX?, posY? }` under `imgpos:<id>` (whole percents, 0.5 stored as ABSENT on both axes — the image's normal form, in `images.ts`, not the subtitle's: an image at the bottom edge is 0.97, not the bottom stack), the drop snapped within `SNAP` of the centre only, the pointer attached at the edge; a press that only chose says "화면의 이미지를 골랐어요 · 끌면 자리가 옮겨져요."; hit order words → image → pan. The sentence: "이미지를 옮겼어요 · 왼쪽에서 32% · 위에서 70%." / "이미지를 가운데로 옮겼어요."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `ui/useImageDrag.ts` (new, ~80 lines: the third caller); `ui/Preview.tsx`; `engine/images.ts`, `engine/imageCommands.ts`; `command.ts` / `commands.ts` / `projectStore.ts` (`selectedImageId`, `selectImage`, `selectsImage`, `pruneSelection`)                                                                                                                                                           | unit: the normal form, the centre snap, `decidePosition`'s no-change refusal by value; e2e: a drag moves the ink by the drag and is one undo step; past the bottom edge and back a fifth lands at 위에서 80% (the `dragAxis` contract, third caller); a press on the words over an image drags the words; a press off both pans the picture |
| 7   | resize                                                                                         | **One slider, 크기, is the image's size** — `image.setSize { imageId, size }` under `size:<id>`, 5–100 step 5 (percent of the box's width), 25 when absent and 0.25 written back as absent; "이미지 크기를 40%로 바꿨어요." No handles on the stage in this unit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `engine/imageCommands.ts`; `ui/ImagePanel.tsx` (new: heading 이미지, the file name, 크기, 가로 자리 · 세로 자리 with `#image-position-note`, the timing line, three 재생 위치로 buttons, 이미지 지우기)                                                                                                                                                                                                   | unit: clamp, round, the no-change refusal; e2e: `End` on 크기 says 100% and the ink spans the box's width                                                                                                                                                                                                                                   |
| 8   | timing without a lane drag                                                                     | **An image is timed by the keyboard's route only, in this unit:** `image.moveToPlayhead / startToPlayhead / endToPlayhead` (the subtitle's `edgeToPlayhead` shape, a second copy — the sentences differ; see debt) on `ImageLane`'s chips (`.image-lane`, `.image`, `aria-label` "이미지 N, name, tc부터 길이 tc, N프레임", `aria-pressed`, Enter parks the playhead, Delete removes — the chip answers Delete itself, the subtitle's debt shape). `image.remove` on the selected image, in the panel and on the chip.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `ui/ImageLane.tsx` (new, ~150 lines: chips and focus-keeping, no drag); `ui/Timeline.tsx` (mount, `contentPx`, the hint's last sentence); `styles.css`                                                                                                                                                                                                                                                    | unit: the three commands' limits and refusals; e2e: 끝을 재생 위치로 lengthens the chip; Delete on the chip removes it and focus lands on the ruler                                                                                                                                                                                         |
| 9   | (d) the export                                                                                 | **The plan carries the image per frame; the exporter opens every bitmap the plan names before frame 0.** `ExportFrame.image: ImageFrame \| null` from `imageFrameAt`; `imagesInPlan(plan)` → `options.images?: ImageSource` (`{ ready, get, load }`, `NO_IMAGES` in Node) loaded one by one with `onProgress(i, n, 'images')` ("이미지 여는 중"), raced against the abort like a face; a bitmap that does not open is in `missingImages` and the frame draws no image — never a missing frame. The sentence: " ⚠ logo.png 이미지를 열지 못해 그리지 않았어요." **The bitmap has one owner, the `ui/images.ts` cache:** `ImageSource.get()` hands the exporter the same long-lived cached `ImageBitmap` the preview draws; the exporter never closes one and `cleanup()` gains no image step. A `load` that resolves after an export was aborted still lands in the cache (harmless) and is reclaimed by `retainOnlyImages` on the next document change, which `close()`s every bitmap it drops.                                                                                                                                                                                                                                                                                                                                        | `engine/exportPlan.ts`, `engine/images.ts`, `engine/exporter.ts`, `ui/ExportButton.tsx`                                                                                                                                                                                                                                                                                                                   | unit: `buildExportPlan` records the image on its frames and null outside `[start, end)`; `imagesInPlan` once per asset in first-use order; e2e: an export with an image has 90 frames and no ⚠ (the load path is e2e-only)                                                                                                                  |
| 10  | the record                                                                                     | **ADR-0020 — "An image is its own thing on the stage: under the words, dragged by the one stage drag"**; README row; TESTING.md contract rows (`.stage-image`, `.image-lane` / `.image`, heading 이미지, sliders 크기 / 가로 자리 / 세로 자리 as the image's when an image is selected, `#image-position-note`); CLAUDE.md debt: the two "third stage drag is the trigger" entries and the `Preview.tsx` size entry rewritten, the new round's findings added; HANDOVER's E10 line.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `docs/adr/0020-….md` (new), `docs/adr/README.md`, `docs/TESTING.md`, `CLAUDE.md`, `docs/HANDOVER.md`, this file                                                                                                                                                                                                                                                                                           | none (docs)                                                                                                                                                                                                                                                                                                                                 |

**Left as debt on purpose** (named in ADR-0020's Consequences and in
CLAUDE.md): rotation and flip; an effect on the way in (the subtitle's
서서히 / 톡 / 올라오기 — the `t` field and `effectState` would carry over
once someone asks); animation and animated GIF / WebP (drawn as their
first frame); **two images on one frame** (the non-overlap rule is the
subtitle's, and the owner's taste — overlap needs a z-order between
images, stacked chips and a top-most hit test, the multi-select
family); multi-select; **a drag on the image lane** (move / trim by the
chip, the THIRD timeline drag of the clip's and the subtitle's shape —
the trigger to extract that DOM half in its own unit, the way this one
extracts the stage's); resize by handles on the stage; snap to
anything but the centre, and guides; paste from the clipboard; a
sample of the image in its media-bin row; `selectedImageId` as a third
exclusive selection field (the third case of "one thing selected at a
time" — folding the three into one `selection` is a wide rename,
deferred to its own unit, "right before something risky"); `image.
*ToPlayhead` as the second copy of `edgeToPlayhead` (a shared span
command factory is the third-case trigger); Delete on a chip handled by
the chip (the subtitle's existing entry, now two instances); a huge
bitmap (a 6000px PNG is held at full size in memory and drawn scaled —
no downscale at import); an SVG without intrinsic size, which
`createImageBitmap` refuses (the refusal sentence covers it); an image
asset evicted from OPFS says 다시 선택 필요 like a video and re-links
by name only; `importAsset` (the video path) is still not a registry
command; the palette lists 이미지 넣기 only as the bin's row (the
command needs an asset); `clip.move` and the trims do not ripple
images, exactly as they do not ripple subtitles (ADR-0011's rule —
symmetric, not new); an undone `image.import` leaves the bytes in OPFS
until the sweep on the next open, which is ADR-0009's existing
behaviour for every asset.

**Steps, in order:**

1. **Done 2026-09-16** — `ui/useStageDrag.ts` 163 lines, `Preview.tsx`
   657 → 602, `useWordsDrag.ts` 253 → 207, the 14 stage e2e green on
   `e2e:chrome` with none edited, personas 0 blockers and 2 QA minors →
   CLAUDE.md debt; the "under 580 / under 200" targets missed by ~20
   lines each (rationale comments kept), accepted. As planned:
   **The extraction, no behaviour change.** `ui/useStageDrag.ts`
   written; the pan in `Preview.tsx` and `useWordsDrag.ts` rewritten
   onto it; `Preview.tsx` under 580 lines. `check:refs`, `typecheck`,
   `npm test`, then `npm run e2e:chrome -- subtitle-drag picture` — 14
   tests, all green, none edited. Ending state: two callers, one DOM
   half. **Step 1 ends by announcing the extraction as its own commit
   and waiting for the owner (the one hard stop), so that a context cut
   after it lands on a clean tree.**
2. **Engine, test-first.** `types` / `ops` / `persistence` (schema 3) /
   `project`; `engine/spans.ts` with `subtitles.ts` delegating (its 28
   tests untouched); `engine/images.ts` (span queries, the normal form,
   the centre snap, `imageFrameAt`, `imagesInPlan`, `ImageSource` +
   `NO_IMAGES`, the sentences); `engine/imageRender.ts`;
   `engine/imageCommands.ts` (8 commands: import, add, remove,
   setPosition, setSize, moveToPlayhead, startToPlayhead,
   endToPlayhead) registered in `BUILTIN_COMMANDS`; the image diff
   beside the word diff in the four ripple sites; `ExportFrame.image`;
   `composeFrame`'s eighth argument; the exporter's images phase and
   `missingImages`. Ending state: `npm test` green with ~60 new tests;
   nothing on screen yet.
3. **Media.** `ui/images.ts` (the browser loader and cache, bitmaps
   closed on release); `ui/media.ts` (`isMediaReady`, the restore
   branch by `kind`); `ui/MediaBin.tsx` (accept, the image branch of
   `onFile`, the row and its button); `App.tsx` (`retainOnlyImages`);
   the three `missingMedia` sites; `ExportButton` (`images:
browserImages`, the phase word, the ⚠ sentence). Ending state: a
   dropped PNG is an asset, stored, restored after a reload, and placed
   in the document — invisible until step 4.
4. **The stage.** `.stage-image` canvas and its draw effect in
   `Preview.tsx`; `ui/useImageDrag.ts` as the third `useStageDrag`
   caller; hit order words → image → pan; `selectedImageId` through
   `Editor`, `EditorCtx`, `Command.selectsImage`, the store; the cursor
   rule. Ending state: the image is seen, dragged, one undo step.
5. **The lane and the panel.** `ui/ImageLane.tsx` under the subtitle
   lane; `Timeline.tsx` mount + `contentPx` + one sentence in the hint;
   `ui/ImagePanel.tsx` beside `SubtitlePanel` in `App.tsx`; `styles.css`.
   Ending state: every rule in the table reachable by mouse and by
   keyboard.
6. **e2e `e2e/image.spec.ts`** (the PNG as a buffer constant): import →
   chip + ink at the centre; drag + sentence + one undo; the edge
   contract (80%); 크기 End; the sliders by keyboard; words over an
   image win the press, off both the pan; Delete on the chip; a reload
   keeps the image with no ⚠; an export has 90 frames and no ⚠.
   Ending state: `npm run e2e:chrome` green, the two older stage specs
   still untouched.
7. **Docs.** ADR-0020, README row, TESTING.md rows, CLAUDE.md debt,
   HANDOVER, "E10 progress" / "E10 issues" under this plan.
8. **Gate.** `npm run verify` green.
9. **Persona review**, four in parallel with the changed-file list and
   a focus each: `tester-qa` (ripple with an image across a cut, undo
   of an import, a reload mid-restore, the export with a lost bitmap),
   `tester-a11y` (the third `role="img"`, the lane's names, the panel's
   group, focus after Delete), `tester-novice` (import = place, the
   quarter-width default, 크기 as a word, the two 자리 rows now on
   screen for two things), `framewright-reviewer` (`useStageDrag`'s
   seam, `spans.ts` shared and not copied — its shape already confirmed
   on 2026-09-16 (row 3), the third selection id, bitmap lifetime:
   one owner, the `ui/images.ts` cache). Blockers fixed, gate again, the rest into
   "Known tech debt".
10. **Visual pass in Chrome** if one is connected (`list_connected_
browsers`; foreground tab): a PNG with transparency over footage at
    the centre, dragged to a corner, sized to 100%, a reload, the export
    played back; every finding ships with an assertion. Then `npm run
handoff`, this file rewritten, and ONE commit with the owner's
    approval by the recipe in "Next single step" (announce first).

**Files E10 adds (new):** `src/ui/useStageDrag.ts`, `src/engine/
spans.ts` (+test), `src/engine/images.ts` (+test), `src/engine/
imageRender.ts` (+test), `src/engine/imageCommands.ts` (+test),
`src/ui/images.ts`, `src/ui/useImageDrag.ts`, `src/ui/ImageLane.tsx`,
`src/ui/ImagePanel.tsx`, `e2e/image.spec.ts`, `docs/adr/0020-an-image-
is-its-own-thing-on-the-stage.md`.

**Files E10 touches (line counts today):** `src/ui/Preview.tsx` (657),
`src/ui/useWordsDrag.ts` (253), `src/engine/types.ts` (146),
`src/engine/ops.ts` (149), `src/engine/persistence.ts` (140),
`src/engine/project.ts` (23), `src/engine/subtitles.ts` (397),
`src/engine/commands.ts` (923), `src/engine/silence.ts`,
`src/engine/command.ts` (313), `src/engine/exportPlan.ts` (101),
`src/engine/compose.ts` (101), `src/engine/compose.test.ts` (its
positional `composeFrame` calls gain the `image` argument),
`src/engine/exporter.ts` (392),
`src/store/projectStore.ts` (513), `src/ui/MediaBin.tsx` (320),
`src/ui/media.ts` (258), `src/ui/ExportButton.tsx` (127),
`src/ui/Timeline.tsx` (881), `src/App.tsx` (95), `src/styles.css`
(1491), `docs/TESTING.md` (442), `docs/adr/README.md` (48), `CLAUDE.md`,
`docs/HANDOVER.md` (223), `docs/STATUS.md`; their tests
(`subtitles.test.ts` unchanged by design, `compose.test.ts` 11 → +2,
`exportPlan.test.ts` 12 → +2, `persistence.test.ts` 12 → +2).

**Golden-rule tensions, named so they are not found later:** (rule 9)
`useStageDrag` is the third case and is extracted — allowed; `spans.ts`
is a SECOND case and is shared anyway, because `rippleSubtitles`
/ `subtitleDiffOps` are already generic in everything but their names
and a copied ripple is the kind that drifts — the `framewright-reviewer`
persona confirmed on 2026-09-16 that sharing beats copying here; the
module is small and its shape is fixed in row 3; `selectedImageId` is the third
exclusive selection id and is NOT folded (a wide rename, its own unit).
(rule 8) `ImageBitmap` never enters `src/engine/**`: `ImageSource` is
the seam, `ui/images.ts` the browser half, the fonts' shape. (rule 6)
An `ImageBitmap` is not a `VideoFrame` but holds memory the same way,
and it has ONE owner, the `ui/images.ts` cache: `ImageSource.get()`
hands the exporter the same long-lived cached bitmap the preview
draws, the exporter never closes one and `cleanup()` gains no image
step; a `load` that resolves after an aborted export lands in the
cache (harmless) and is reclaimed by `retainOnlyImages` on the next
document change, which `close()`s every bitmap it drops — that and
`releaseImage` are the only callers of `close()`. (rule 4)
`image.import` mints `asset_<n>` / `img_<n+1>` from `nextId` and its
inverse does not rewind it, for `importAsset`'s reason. (rule 2)
`image.import` is a registry command where `importAsset` is not — the
new kind takes the right shape and the old debt stays named. (rule 7)
bitmaps are opened before frame 0, so the file and the screen agree.

### E10 progress

Built in Claude Code on 2026-09-16 (KST), the plan's steps in order.
**Steps 1 and 2 of 10 are done; steps 3–10 are not started.**

1. **The stage drag as one hook — done, committed and pushed as
   `8f10d25`.** `ui/useStageDrag.ts` 163 lines; `Preview.tsx` 657 → 602,
   `useWordsDrag.ts` 253 → 207; the 14 stage e2e tests green on
   `e2e:chrome` with none edited, which is a refactor's proof. Personas:
   0 blockers, 2 QA minors → CLAUDE.md debt. The "under 580 / under 200"
   targets were missed by ~20 lines each (the rationale comments were
   kept), accepted. The details are in "E10 step 1" near the top of this
   file.
2. **Engine, test-first — done, UNCOMMITTED.** `engine/spans.ts` first
   (row 3), with `subtitles.ts` delegating onto it and
   `subtitles.test.ts` byte-for-byte unchanged as the proof; then
   `types` / `ops` / `persistence` (schema 2 → 3) / `project` for
   `Project.images` (row 2); then `engine/images.ts`,
   `engine/imageRender.ts` and `engine/imageCommands.ts` with its eight
   commands (rows 4, 6, 7, 8); the image diff beside the word diff at
   all four ripple sites (`commands.ts` ×3 and `silence.ts`);
   `ExportFrame.image`, `composeFrame`'s eighth argument, the exporter's
   images phase and `missingImages` (row 9). `npm run verify` GREEN:
   unit **797** across 50 test files (was 692 across 43), e2e 142
   unchanged — **105 new tests** where the plan guessed ~60. Personas:
   `framewright-reviewer` 0 findings, `tester-qa` 0 blockers / 1 major /
   1 minor (below). Nothing is on screen yet, by design. The file list,
   the four design decisions and the reason two personas were skipped
   are in "E10 step 2" near the top of this file.
3. **Media — not started.** The next single step, after the step-2
   commit. See "Next single step" above for the file-by-file list.
4. **The stage — not started.**
5. **The lane and the panel — not started.**
6. **e2e `e2e/image.spec.ts` — not started.**
7. **Docs — partly done.** CLAUDE.md's debt list and this file's "E10
   progress" / "E10 issues" are written. **Still owed by the epic:
   ADR-0020** ("An image is its own thing on the stage: under the words,
   dragged by the one stage drag"), its row in `docs/adr/README.md`, the
   **README row**, the **`docs/TESTING.md` contract rows** (`.stage-image`,
   `.image-lane` / `.image`, the 이미지 heading, the sliders 크기 / 가로
   자리 / 세로 자리 as the image's when an image is selected,
   `#image-position-note`), and **`docs/HANDOVER.md`'s E10 line**. Those
   describe surfaces that do not exist until steps 4 and 5, which is why
   they are not written yet; they are step 7 of the plan and must not be
   dropped.
8. **Gate — green for what exists** (stamped at the top of this file).
   It is re-run at the end of every remaining step.
9. **Persona review — partly done.** The step-2 diff was reviewed by
   `framewright-reviewer` and `tester-qa`. **`tester-a11y` and
   `tester-novice` are still owed** and belong to steps 4 and 5, when
   there is a screen to review.
10. **Visual pass in Chrome — not started.** Step 10 of the plan.

### E10 issues

- **Major (QA), answered with a test rather than a behaviour change:**
  `image.setPosition` given only one axis erases the other — the omitted
  axis normalises to `undefined`, `dropUndefined` removes the key, and
  absent means the centre, so the image jumps to the middle on the axis
  the caller did not mention. This is `subtitle.setPosition`'s exact
  semantics and changing it would make the two commands disagree, so the
  behaviour stands and `imageCommands.test.ts` now pins it. The risk is
  real but it is a CALLER's risk, and the caller does not exist yet: the
  image panel's two sliders in step 5 must read the current value and
  pass both axes. Now a CLAUDE.md debt entry so step 5 cannot miss it.
- **Minor (QA), kept as debt:** `looksLikeProject` validates neither
  `subtitles` nor `images` element shape — it checks `tracks` / `assets`
  / `timeline` / `nextId` and nothing more, so a save holding
  `images: [{}]` reaches the live document unvalidated. Pre-existing for
  subtitles; images inherited it verbatim. In CLAUDE.md.
- **Two more debt entries added from this round, neither a persona
  finding:** `image.*ToPlayhead` is the second copy of `edgeToPlayhead`
  and brought a second `fieldOps` / `moveOps` / `edgeOps` with it
  (accepted by the plan on purpose — the sentences differ — and the
  third case is the trigger to share it); and `createProject` still
  writes a dead `schemaVersion: 1` on the document object, which has
  meant nothing since schema 2 because `serialize` always writes
  `CURRENT_SCHEMA` and `deserialize` reads only the envelope.
- **`Command.disabledReason` sees only `ctx`, never the args**, which is
  why `imageTimingReason` is a free function instead of a widened
  interface. Not a defect — a constraint step 4's selection wiring will
  meet, so it is written down rather than rediscovered.
- **The plan's test estimate was wrong by 75%** — "~60 new tests" against
  105 actual. The engine surface was bigger than the row table suggested
  once `spans.ts`'s generic edge cases and `imageCommands.ts`'s refusals
  each got their own test. Worth knowing for the remaining steps'
  estimates, not a problem in itself.
- **`exporter.ts` had never been unit-tested in Node before this unit.**
  `exporter.test.ts` (4 tests) is the first. The export path's coverage
  was e2e-only, which is exactly the gap CLAUDE.md's TDD section warns
  produced two shipped bugs; the images phase is covered in Node now,
  and the bitmap LOAD path remains e2e-only because it needs a browser.

### E8-2d execution plan — E8-2 부채 정리

**What this is.** Not a feature: the persona findings E8-2a/b/c left in
CLAUDE.md "Known tech debt" that are worth fixing before E10 adds a
third draggable thing to the stage. Two of them change a contract
(ADR-0018's "never at start", ADR-0019's drag arithmetic) and are
recorded as dated amendments to those ADRs, not new ADRs. Everything
else is a fix under the existing rules.

**Facts the plan stands on (measured 2026-09-16):** `Preview.tsx` is 790
lines; the words drag is lines 342–471 (`wordsDragRef`, `wordsUnder`,
`beginWordsDrag`, `moveWordsDrag`, `endWordsDrag`, `hoverWords`,
`overWords`) and the fonts effect 473–495. `moveWordsDrag` clamps
`baseX + dx / width` to [0, 1] and keeps the press as origin, so past
the edge the pointer runs ahead of the stored value; `clip.pan` clamps
inside the command (`within` → `roundPan`) with the same effect on the
picture. `subtitle.setLook / setPlace / setEffect / setFont` are four
copies of one ~20-line command shape around `fieldOps`. The `[aria-
checked='true']` rule in `styles.css` (shared by `FramePicker` and
`Choices`) is a teal border and inset ring only. The export's fonts
phase reports `onProgress(0, n, 'fonts')` once.

| #   | Debt entry (CLAUDE.md)                                        | Rule after this unit                                                                                                                                                                                                                                                                                                                                                                      | Where                                                                                   | Proof                                                                                                             |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | a words drag / a pan past the edge detaches from the pointer  | **The pointer stays attached at a limit.** On every move the value is clamped and, when it was, the drag's origin is moved so that the pointer and the clamped value coincide; dragging back moves at once. One pure helper, `dragAxis`, for both stage drags (ADR-0019 amended).                                                                                                         | `engine/stageDrag.ts` (new, test-first); `ui/useWordsDrag.ts`; the pan in `Preview.tsx` | unit (4); e2e: words dragged 0.4 past the left edge then back 0.1 have moved back 0.1; the same for the picture   |
| 2   | a reopened document's face is fetched only under the playhead | **A document's faces are fetched when the document is opened** — on load, on a version restore, and when an edit first names a face nobody asked for — silently; the playhead path keeps its sentences for a face still in flight, and says the failed sentence once when the words reach a face that did not come (ADR-0018 amended: "never at start" → "only what the document names"). | `ui/useSubtitleFonts.ts` (new, out of `Preview.tsx`)                                    | e2e: after a reload the face is fetched with no sentence, and Enter on the chip draws it at once; the failed path |
| 3   | the 자리 radios and the two sliders are not one group         | **One group named 자리** contains the radiogroup and the sliders: `Choices` takes children rendered inside its row, the row is `role="group"` labelled by the same word.                                                                                                                                                                                                                  | `ui/SubtitlePanel.tsx`                                                                  | e2e: `getByRole('group', { name: '자리' })` holds the radiogroup and both sliders                                 |
| 4   | `Preview.tsx` ~780 lines, the words drag the extraction       | **The words drag is a hook**, `useWordsDrag`, returning the three handlers (each answering whether it took the event) and `overWords`; the fonts effects are a second hook. The stage's handler set stays in `Preview` and calls both. `Preview.tsx` under 620 lines.                                                                                                                     | `ui/useWordsDrag.ts`, `ui/useSubtitleFonts.ts`                                          | typecheck, check:refs, the existing e2e                                                                           |
| 5   | the stage lays the subtitle out on every hover move           | **The layout is measured once per frame**, cached in the hook by frame identity, overlay size and `fontsVersion`; a hover move only tests a point against it.                                                                                                                                                                                                                             | `ui/useWordsDrag.ts`                                                                    | the existing hit-test e2e (an effect's first frame)                                                               |
| 6   | `setFont` is the fourth copy of the set-one-field shape       | **One factory**, `setFieldCommand({ id, label, current, changes, done })`, and the four commands are four calls to it. Behaviour identical — the existing unit tests are the proof and none changes.                                                                                                                                                                                      | `engine/subtitleCommands.ts`                                                            | unit: the existing `setLook / setPlace / setEffect / setFont` tests unchanged                                     |
| 7   | a checked radio differs by colour alone                       | **A checked radio carries a shape**: a small filled dot in its corner (`::before`, empty content so the name is unchanged), on the shared rule so `FramePicker` gets it too.                                                                                                                                                                                                              | `styles.css`                                                                            | e2e: the checked radio's `::before` has content, an unchecked one none                                            |
| 8   | the face hint leads with the product name                     | **The hint leads with what the face looks like**: "붓으로 쓴 글씨 · 나눔붓".                                                                                                                                                                                                                                                                                                              | `engine/fonts.ts`                                                                       | unit (`fonts.test.ts`, if it reads the hint)                                                                      |
| 9   | `FONT_FAILED` does not say the radio is the retry             | **The failed sentence names the way back**: "… 기본 글꼴로 보여요 · 글꼴에서 붓글씨를 다시 누르면 다시 받아요."                                                                                                                                                                                                                                                                           | `engine/fonts.ts`                                                                       | unit; the existing e2e (a substring)                                                                              |
| 10  | the export bar reads 0% through the fonts phase               | **One progress call per face** (`onProgress(i, n, 'fonts')` as each lands).                                                                                                                                                                                                                                                                                                               | `engine/exporter.ts`                                                                    | reads right; no new test (the phase is e2e-only)                                                                  |

**Left as debt on purpose** (design calls, the owner's): focus after a
stage drag (moving focus after a mouse gesture is focus theft unless the
owner wants it); the 세로 slider's 0 above the 위 preset and no snap on
the keyboard route; every slider step saying the whole sentence (the
shared `RangeRow` pattern); 자리 vs 위치; 꾸미기 as the umbrella; the
palette not listing the nine choices.

**Steps, in order:** (1) engine, test-first — `stageDrag.ts`, the
factory fold, the two sentences, the export progress; (2) the two hooks
out of `Preview.tsx`, the pan's attach, the panel's group, the CSS dot;
(3) e2e for rules 1, 2, 3, 7 and the rewrite of "a face named by a
reopened document is fetched for it" (its expectation flips: the face IS
fetched after the reload — a contract change, so a new assertion set,
not a loosened one); (4) ADR-0018 / ADR-0019 amendments, TESTING rows,
CLAUDE.md debt entries removed; (5) gate, four personas, visual pass if a
Chrome is connected, `npm run handoff`.

### E8-2d progress

Built in Claude Code on 2026-09-16 (KST), the plan's steps in order:

1. **Engine, test-first — done.** `src/engine/stageDrag.ts` (new,
   `dragAxis`; 5 tests including the no-extent / NaN contract for the
   third caller E10 will add); `setFieldCommand` in `subtitleCommands.ts`
   folding `setLook / setPlace / setEffect / setFont` (the existing 34
   command tests unchanged and green — the proof the behaviour is
   identical); `FONT_HINT` leads with the look ("붓으로 쓴 글씨 · 나눔붓")
   and `FONT_FAILED` names the way back ("… · 자막을 고른 뒤 글꼴에서 붓글씨
   단추를 다시 누르면 다시 받아요.", 2 tests in `fonts.test.ts`);
   `exporter.ts` reports the fonts phase per face; `decidePosition`
   compares both axes through the normal form (a hand-edited `posY` 0.99
   is the bottom, not a move; 1 test).
2. **UI — done.** `ui/useWordsDrag.ts` (the words drag out of `Preview`,
   the layout measured once per frame / overlay size / `fontsVersion`,
   `dragAxis` on both axes), `ui/useSubtitleFonts.ts` (the document's
   quiet fetch, the playhead's sentences, the failed sentence once per
   face, a settle that says nothing when the status line has moved on),
   the pan in `Preview.tsx` through `dragAxis` with `clipPanLimits`
   captured at press; `Choices` in `SubtitlePanel.tsx` takes children and
   is then `role="group"`, the 자리 row holding the sliders; the checked
   radio's `::before` dot and `.subtitle-choice.with-more` in
   `styles.css`. `Preview.tsx` 790 → 657 lines.
3. **E2e — done.** `subtitle-drag.spec.ts` +2 (a drag 0.3 past the bottom
   then back 0.2 lands at 80; the 자리 group holds the radiogroup, both
   sliders and the note, the sliders on their own line), `picture.spec.ts`
   +1 (the pan: 0.8 right stops at 50, back 0.2 lands at 30),
   `subtitle-style.spec.ts` +1 (the dot: `::before` content `""` on the
   checked radio, `none` on the others, the name unchanged; the 영상 모양
   picker too), `subtitle-font.spec.ts`: the reopened-document test
   rewritten for the amended contract (fetched after the reload with no
   sentence; Enter on the chip draws the face at once) and +1 for the
   failed reopen (the quiet fetch aborted; the sentence with the way back
   once the words reach it; the retry lands).
4. **Docs — done.** ADR-0018 and ADR-0019 "Amendment (2026-09-16)"
   sections; TESTING.md rows (글꼴, the words drag, group "자리", the dot)
   and the operational fact "A reload does not forget a web font";
   CLAUDE.md: ten debt entries removed or rewritten, seven added from
   this round.
5. **Gate, personas, visual — done.** `npm run verify` GREEN twice (before
   and after the persona fixes): unit 692 · e2e 142. Four personas, 0
   blockers, findings below. Visual pass in the owner's Chrome, no
   finding.

Files of the unit, for the commit: `src/engine/stageDrag.ts`,
`src/engine/stageDrag.test.ts`, `src/engine/subtitleCommands.ts`,
`src/engine/subtitleCommands.test.ts`, `src/engine/fonts.ts`,
`src/engine/fonts.test.ts`, `src/engine/exporter.ts`,
`src/ui/useWordsDrag.ts`, `src/ui/useSubtitleFonts.ts`,
`src/ui/Preview.tsx`, `src/ui/SubtitlePanel.tsx`, `src/styles.css`,
`e2e/subtitle-drag.spec.ts`, `e2e/picture.spec.ts`,
`e2e/subtitle-style.spec.ts`, `e2e/subtitle-font.spec.ts`,
`docs/adr/0018-…md`, `docs/adr/0019-…md`, `docs/TESTING.md`,
`docs/STATUS.md`, and `CLAUDE.md` minus the owner's ui-ux-guide hunk.

### E8-2d issues

- **Major (novice), fixed:** `FONT_FAILED`'s way back pointed at a 글꼴
  row that is not on screen when the sentence is said during playback
  (nothing selected, no panel). The sentence now starts with "자막을 고른
  뒤". Unit test and the e2e's full-sentence assertion updated.
- **Major (QA), fixed:** a font fetch settling late overwrote a newer
  status sentence from an unrelated edit made meanwhile. Both settles
  (`useSubtitleFonts`, `SubtitlePanel.fetchFace`) now say their sentence
  only while the status line still shows the wait they put there; a
  failure skipped that way is not marked as said, so the words reaching
  the face again say it then.
- **Minor (QA), fixed:** `dragAxis` had no contract for `size` 0 or a
  non-finite pointer (NaN would have poisoned the origin for the rest of
  the gesture). Guarded and tested, since E10's third drag will call it.
- **Minor (QA), fixed:** `decidePosition` compared `posY` raw, so a
  document with a hand-edited near-bottom value took an undo entry for a
  write that changed nothing on screen. Both axes now go through the
  normal form (unit test).
- **Major (novice), kept as debt with the reason:** the export bar now
  climbs through the fonts phase and then jumps back to 0% at the audio
  phase, where before it sat at 0% through both and the jump was
  invisible. The fonts fix is right; the audio phase starting from 0 is
  the pre-existing entry, rewritten to say the bar goes backwards once.
- **Major (a11y), kept as debt:** "받았어요" is never said after the fact
  for a user who moved on during the fetch. **Major (QA), kept as
  debt:** a words drag during playback goes blind once the playhead
  leaves the subtitle (E8-2c's locked-id design; stopping playback on a
  stage press is the lever). Both in CLAUDE.md's top entries.
- **Minors kept as debt (CLAUDE.md):** the group and its radiogroup
  sharing one name (unverified against a real AT); no `forced-colors`
  rule anywhere; the dot's size; a drag's limits frozen at the press
  (`R` mid-drag); a failed face's state carried across documents by the
  singleton loader.
- **A test assumption that was wrong, and a fact learned:** the failed
  reopen e2e first asserted the words return to the system face's ink
  after the aborted fetch; they did not — Chrome finds the typeface the
  previous document fetched by family name for the canvas even though
  the new `document.fonts` is empty. The test now proves the page's state
  from `document.fonts`; TESTING.md records the fact.
- **`Preview.tsx` landed at 657 lines, not under the plan's 620.** The
  pan drag and the overlay effects stayed; the pan is the next extraction
  (CLAUDE.md entry).
- **The owner's Chrome had the project open in another tab** during the
  visual pass ("다른 탭에서 같은 프로젝트를 편집하고 있어요 · 이 탭의 변경은
  저장되지 않아요" joined the status line), so the pass's edit could not
  reach storage and was undone in memory anyway. The dev server was not
  running and was started for the pass (this session's process).

**The E8-2c plan below is done; kept as the record.** Context that held
when it was written: `5b56e41` was on `origin/main`. **E8-2c:** drag the
words anywhere on the stage — the owner's end goal for 예능 자막; `posX` /
`posY` box fractions are already the fields (ADR-0017), the preview
already has a pointer drag for the picture (`.stage`), and the two
existing drag gestures (`Timeline.tsx`, `SubtitleLane.tsx`) are the
rule-of-three trigger to extract the DOM half. **Decided by the owner on
2026-09-15 (evening), for E8-2c:**

- **Free, with a light snap near a preset.** The words go anywhere in
  the box; within a small distance of a preset's value (아래 / 가운데 /
  위, and the horizontal centre) the drop lands ON that value, so the
  자리 radio lights again. The snap distance is the plan's to fix (a
  few percent of the box).
- **The keyboard route is two sliders in the panel, 가로 · 세로**, the
  same shape as the clip's 화면 옮기기 (0–100%, 5% notches, described in
  words) — a screen-reader user and a keyboard user get the same result
  the pointer gets, and the position is read as a sentence.
- **Off every preset the 자리 row shows nothing checked, plus a position
  sentence** ("왼쪽에서 32% · 위에서 70%") beside the row or the sliders.
  No fourth radio.

### E8-2c execution plan — 자막 끌기

**Facts the plan stands on (measured 2026-09-15 evening):** the place is
already the block's centre as fractions of the box (`posX` / `posY`,
ADR-0017); `layoutSubtitle` clamps a placed block to the bottom margin,
so `posY = 1` draws EXACTLY where the absent field (the bottom stack)
draws, and `posX` absent is `0.5`; `placeOf` returns null off every
preset and the 자리 row then shows nothing checked; the stage already has
a pointer drag (the picture's pan: pointer capture on `.stage`, a 3 px
threshold, `clip.pan` dispatched per move under one coalesce key so the
drag is one undo step, the sentence from the command's `done`); the
overlay canvas sits on the picture's measured rect at the export grid's
size; no command writes an arbitrary position yet.

**Rule table — the contract the tests assert:**

| Rule          | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command       | `subtitle.setPosition` 자막 자리 정하기 (not 옮기기: `clip.move`'s label is 옮기기, and the vocabulary test forbids one label inside another) — arg-taking, hidden, `{ subtitleId, posX?, posY? }` fractions in [0, 1] rounded to whole percents (0.01), absent = the preset value (`posX` 0.5, `posY` the bottom stack). One `fieldOps`, exact inverse, refuses no change. Coalesce key `pos:<id>` for a drag / a slider run, so each is ONE undo step (the pan's shape).                                                                                                                                                                                                                                                                                                                                                              |
| Normal form   | `normalizePosition({posX, posY})` (engine): `posX` 0.50 → absent; `posY` ≥ 0.97 → absent (the bottom stack; it draws the same and lights 아래). So a drop at the bottom centre is byte-identical to the 아래 preset and undo of every move gives the document it was.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Snap          | `snapPosition(pos, bottomCentreY)` (engine, pure): on each axis independently, within 0.03 of a preset value the value becomes it — `posX` near 0.5; `posY` near 0.15 (위), 0.5 (가운데), or near `bottomCentreY` (the centre the bottom stack's block has for THIS text and look, given by the caller from `layoutSubtitle(text, box, measure, look, {posX})` with no `posY`) → absent. Applied at the DROP only; during the move the words follow the pointer.                                                                                                                                                                                                                                                                                                                                                                        |
| Sentence      | `describePosition(posX, posY)`: on a preset the existing sentence ("자막 자리를 가운데로 옮겼어요."); off it "자막을 옮겼어요 · 왼쪽에서 32% · 위에서 70%." with "맨 아래" for an absent `posY` and "가운데" for an absent `posX` on the other axis. The same words, without the verb, are the row's position sentence ("왼쪽에서 32% · 위에서 70%").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| The drag      | On `.stage`, the ONE pointerdown handler hit-tests first: if a subtitle is under the playhead and the point is inside `layoutBounds` of its current layout (overlay px, through the overlay's rect), the gesture is the words'; else the picture's pan as today. The words' drag: selects that subtitle at press (no "press again" step — the words are unambiguous, the picture is not), locks its id for the gesture, base = the block's centre at press (so the first move does not jump, bottom stack included), per move dispatches `setPosition` with the pointer delta as fractions of the overlay, at release re-dispatches the snapped normal form under the same key, then `endGesture`. Cursor `move` over the words (`.stage-subtitle` stays `pointer-events: none`; the stage sets the cursor from the hit test on hover). |
| The sliders   | Two `<input type="range">` 가로 · 세로 under the 자리 row, 0–100 step 1 (PageUp/Down = 10 natively), `aria-valuetext` in words ("왼쪽에서 32%", "위에서 70%" / "맨 아래"); value = the fraction × 100, 50 / 100 when absent; input writes `setPosition` with the normal form (50 → absent, ≥ 97 → absent) under the coalesce key, one sentence at the end (the clip's 화면 옮기기 shape). The 자리 radios keep lighting from `placeOf`.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Row sentence  | Beside the 자리 row when `placeOf` is null: the position words ("왼쪽에서 32% · 위에서 70%"), no live region (the status line already said it); a screen reader reaches the same as the sliders' values.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Playback      | The drag locks the subtitle at press; if the playhead leaves the subtitle mid-drag the words vanish from the overlay but the gesture keeps writing that subtitle's position; nothing is drawn for it until the playhead is back. The pointer is not stolen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Not extracted | The stage's two drags (pan, words) are the pan's shape (capture, per-move coalesced dispatch); the timeline's two (clips, subtitles) are another shape (threshold, plan, commit at release). Each pair is at two; nothing reaches three in this unit. The stage's pair shares the one handler set with a hit test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Export        | Nothing: `SubtitleFrame` already carries `posX` / `posY` and the plan draws them (ADR-0017).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Shape of the work, in order:**

1. Engine, test-first (a new `subtitlePosition.ts`): `normalizePosition`,
   `snapPosition`, `describePosition`, the slider mapping
   (`sliderOfPosition` / `positionOfSlider`), `bottomCentreY` from a
   layout; `subtitle.setPosition` in `subtitleCommands.ts` with the
   coalesce contract (two dispatches under `pos:<id>` = one undo,
   `toStrictEqual` on undo, the no-change refusal, the sentence on and
   off a preset).
2. `Preview.tsx`: the hit test, the words' drag, the cursor; the pan
   untouched (its e2e stays green).
3. `SubtitlePanel.tsx`: the two sliders, the row sentence; `styles.css`
   for the range inputs if the clip's rules do not already apply.
4. e2e `e2e/subtitle-drag.spec.ts`: a drag on the words moves the ink's
   centre by the drag (within a few px) and is one undo step; a drop
   near 가운데 lights the radio and says the preset sentence; a drop off
   every preset shows nothing checked and the position sentence; the
   pan still moves the picture when the press is off the words; ArrowRight
   on 가로 moves the ink and says the sentence; a reload keeps the
   position; an export with a dragged subtitle has 90 frames.
5. ADR-0019 (the words are dragged on the stage; snap; the normal form
   and why `posY` 1 is the bottom), `docs/TESTING.md` rows (the drag,
   the sliders, the row sentence), CLAUDE.md's two-drags entry updated
   (the stage now has a pair too), UX.md if a rule is new.
6. Persona round, fix blockers, `npm run verify`, visual pass in the
   owner's Chrome (ask which by deviceId; a FOREGROUND tab this time so
   the drag can be seen), `npm run handoff`, ONE commit with approval.

**Out of scope for this unit:** rotating or scaling the words, a drag on
the timeline lane to place (that lane moves TIME), multi-select,
alignment guides drawn on the stage (the snap is the guide), images /
stickers (E10), Escape cancelling the stage drag (the pan has none; both
or neither, a later polish).

**How progress and issues are reported:** as E8-2b — "### E8-2c
progress" and "### E8-2c issues" under this plan, one line per step,
written before moving on; stop before the commit for the owner's
approval.

### E8-2c progress

Built in Claude Code on 2026-09-15 (evening, KST), the plan's steps in
order:

1. **Engine, test-first — done.** `src/engine/subtitlePosition.ts` (new:
   `normalizePosition`, `snapPosition` with `SNAP` 0.03, `bottomCentreY`,
   `positionText` / `positionXText` / `positionYText`,
   `describePosition`, `sliderOfPosition` / `positionOfSlider`) with 11
   tests; `subtitle.setPosition` 자막 자리 정하기 in `subtitleCommands.ts`
   (3 tests: a coalesced gesture is one undo step back to absent fields,
   the no-change refusal after normalising, the preset's sentence when the
   numbers are one); `placeOf` now reads an absent `posX` as the centre
   (both spellings of 가운데 / 위 light the radio); `layoutOfFrame` split
   out of `drawSubtitle` for the hit test (1 test). Engine unit: 655.
2. **Preview — done.** The stage's pointerdown hit-tests the words first
   (`wordsUnder`: the pointer through the overlay's rect onto the export
   grid, against `layoutBounds` of the frame's own layout); a hit selects
   the subtitle and starts its drag (`wordsDragRef`), per move
   `subtitle.setPosition` under `pos:<id>`, at release the snapped normal
   form under the same key, then `endGesture`; a hover over the block sets
   `.stage.words` (cursor `move`). The pan is untouched below it.
3. **Panel — done.** `RangeRow` moved from `ClipPanel.tsx` to its own
   `ui/RangeRow.tsx` (its fifth and sixth uses); two sliders 가로 자리 ·
   세로 자리 (0–100, step 1) under the 자리 row in `.subtitle-position`,
   values from `sliderOfPosition`, `aria-valuetext` per axis, described by
   one sentence that is the position words off a preset and "<preset>
   자리에 있어요 · 화면의 자막을 끌거나 슬라이더로 옮길 수 있어요" on one.
4. **e2e — done.** `e2e/subtitle-drag.spec.ts`, 6 tests on real Chrome:
   a drag moves the ink's centre by the drag (±0.05 of the box), says
   where, shows nothing checked and the position sentence, and one undo
   puts the bottom stack back; a drop within the snap of 가운데 lights the
   radio and says the preset's sentence; a press off the words still
   chooses the clip and then pans the picture, the words unmoved; the
   sliders move the words by keyboard with `aria-valuetext` and one undo
   entry per gesture; a position survives a reload; an export with
   dragged words has 90 frames. The pan's own e2e (`picture.spec.ts`)
   re-run green beside them. First run 6/7: the slider test assumed three
   separate arrow presses were one gesture — they are three (the key
   comes up between them; a held key is one), as on the picture's
   sliders; the assertion was wrong, the code right.
5. **Docs — done.** ADR-0019 and its index row; `docs/TESTING.md` rows for
   the words drag, the two sliders and the position note; CLAUDE.md's
   two-drags entry now counts the stage's pair.
6. **Full gate before the personas: GREEN** (unit 682 · e2e 136).
7. **Persona round — done** (tester-qa, tester-a11y, tester-novice,
   framewright-reviewer, in parallel). No blocker; four majors fixed
   test-first (below), the rest in CLAUDE.md "Known tech debt" (eight new
   entries at the top). Engine unit after the fixes: 657 (the e2e spec
   grew to 7).
8. **Full gate after the fixes: GREEN** (unit 684 · e2e 137).
9. **Visual pass in the owner's Chrome — done, with pixels this time**
   (the owner chose `da2a0786-…`, the tab in the foreground; Claude in
   Chrome on the live dev server at 9990, the owner's own autosaved
   project: 7 clips, 3 subtitles). Selected 자막 1 ("걸침", 10–24) with
   Enter (playhead to 10). Hovering the words turned the cursor to a hand
   (`.stage.words`, computed `grab`); a drag of −25% × −40% of the box put
   the words at the left middle of the colour bars (seen), said "자막을
   옮겼어요 · 왼쪽에서 25% · 위에서 50%.", lit no 자리 radio, and the
   sliders read 25 / 50 with the note "왼쪽에서 25% · 위에서 50%"; the
   document held `posX 0.25, posY 0.5`. A second drag to just past the
   horizontal centre snapped: "자막 자리를 가운데로 옮겼어요.", 가운데 lit,
   the document `{ posY: 0.5 }` alone (the normal form). The panel
   (zoomed): the 자리 row, then 가로 자리 / 세로 자리 as two full-width
   slider rows with their readouts (가로 가운데 · 위에서 50%), the note
   under them — aligned with the picture panel's sliders. Home on 세로
   자리 put the words at the top margin (seen in the zoomed preview),
   said "자막을 옮겼어요 · 가로 가운데 · 위에서 0%." Three edits undone
   with Ctrl+Z from the ruler: 아래 lit, sliders 50 / 100, the persisted
   project JSON identical to the snapshot taken before the pass. **No
   finding.** One mis-aimed first press (the driver's coordinate
   conversion, not the app) selected the clip and said the pan's
   "지금 보이는 클립을 골랐어요" sentence without moving anything. Tab
   closed. The stamp at the top is the handoff run after this pass.

### E8-2c issues

- **Major (QA): the hit test ignored the effect.** `wordsUnder` tested
  the pointer against the REST bounds, but 올라오기 draws the words a
  good way below them on its first frames and 톡 draws them smaller, so
  a press on the visible ink on such a frame fell through to the
  picture's pan. Fixed with `drawnBounds(frame, layout, height)` in
  `subtitleRender.ts` (the rest bounds through the effect's transform;
  unit-tested for 올라오기's shift and 톡's scale about the centre); the
  hit is against it, the drag's base stays the REST centre (the one the
  stored fractions name, so the first move does not add the effect's
  offset). E2e: 올라오기, Enter on the chip (its first frame), a drag on
  the ink follows the pointer. ADR-0019's "drawn centre" wording
  corrected.
- **Minor (QA), fixed:** a hand-edited `posY` of 0.98 drew at the bottom
  but was said as "위에서 98%" and lit no radio. `BOTTOM_FROM` / `isBottomY`
  moved to `subtitleStyle.ts`; `placeOf` and `positionYText` read such a
  value as the bottom (unit tests), and `placeOf` now answers by value on
  both axes — `{ posX: 0.5 }` alone is 아래 (it draws at the bottom
  centre), which changed one E8-2a expectation with the reason beside it.

- **The plan's label 자막 자리 옮기기 failed the vocabulary test**
  (`clip.move`'s label 옮기기 is inside it); the command is 자막 자리
  정하기.
- **Two spellings of one place.** The radios write `posX: 0.5`
  (ADR-0017); the normal form writes nothing for the centre. Rather than
  make the drag write 0.5 (then 가로 slider 50 on a bottom subtitle would
  write a field for nothing), `placeOf` and the command's no-change test
  compare by VALUE (`posX ?? 0.5`). ADR-0019 records it.
- **The row sentence is always shown**, not only off a preset as the
  plan said: the sliders need a description either way, and on a preset
  it is the one line that tells a first-time user the words can be
  dragged at all.
- **Major (a11y): a press on the words that did not move them changed
  the selection in silence** — the panel swapped under the pointer with
  no sentence, where the picture's press says "지금 보이는 클립을
  골랐어요". Fixed: the drag records whether the press changed the
  selection and, on a release without a move, says "화면의 자막을 골랐어요
  · 끌면 자리가 옮겨져요." (e2e asserts it after the pan test's clip
  press).
- **Major (novice): the cursor said nothing** — `.stage.movable` sets
  `move` over the WHOLE stage whenever the clip on screen is the selected
  one, so the words' `move` was the same arrows. Fixed: the words get a
  hand (`grab`); TESTING.md and ADR-0019 updated.
- **Major (novice): "가운데" for the horizontal centre collided with the
  가운데 radio.** The most natural first drag (straight up) produced
  "자막을 옮겼어요 · 가운데 · 위에서 63%", which reads as the preset.
  Fixed: an absent `posX` is said as 가로 가운데 (`positionXText`; unit
  test).
- **Majors kept as debt (CLAUDE.md, top of the list):** focus after a
  stage drag is wherever it was (a11y); the words drag detaches from the
  pointer at the box's edge like the pan (novice).
- **Minors kept as debt:** `Preview.tsx` at ~780 lines with the words
  drag as the next extraction (reviewer); a layout per hover move for the
  cursor (reviewer); the whole sentence on every slider step (a11y); the
  radios and the sliders not one group (a11y); 자리 vs 위치 (a11y,
  novice); the 세로 slider's 0 above the 위 preset and no snap on the
  keyboard route (novice, a11y).
- **Noted, not debt:** `SubtitlePositionArgs`' optional axes mean "the
  preset value", not "leave as is" — every caller passes both; the field
  comment says so (reviewer). The first-press asymmetry between the two
  stage drags is ADR-0019's decision (novice).

**The E8-2b plan below is done; kept as the record.** Decided by the
owner on 2026-09-15:

- **Free faces only, original files, no subsetting.** Every font has a
  licence; the candidates are OFL (SIL Open Font License) faces from
  Google Fonts, which allow bundling, burning into a video and the
  user's commercial use, on two conditions: ship the licence text and
  do not modify the file (a subset — the font cut down to the common
  2,350 syllables — counts as a modification and would force a rename,
  and it also drops the rare syllables outside that set, which a
  variety caption reaches for on purpose). So the woff2 goes in as
  published, licence beside it.
- **Loaded when chosen, not at start.** A face is fetched from the app's
  own origin the first time a subtitle picks it (about 0.5–1.5 MB each,
  ~3 MB for three, browser-cached after), never on first load and never
  from a third-party CDN at export time. Until it lands the preview draws
  the fallback stack and the status line says the face is on its way; the
  export waits for `document.fonts.load` on every face its plan uses
  before drawing frame 0.

- **The three faces and the field — decided (the owner said "as
  recommended", 2026-09-15 afternoon):** 붓글씨 = Nanum Brush Script,
  손글씨 = Nanum Pen Script, 굵은고딕 = Black Han Sans, all OFL, the
  original TTFs from the google/fonts repository with each face's own
  `OFL-*.txt` beside it in `public/fonts/` (7.6 MB, tracked by git). The
  face is its OWN field on the subtitle, `font?`, with its own row 글꼴
  in the panel — a face and a look (colour, outline) are chosen apart. A
  list of faces that need a licence of their own (배민, paid calligraphy
  families) goes in `docs/FONTS.md` for a later unit.

### E8-2b execution plan — 캘리그라피 글꼴

**Rule table — the contract the tests assert:**

| Rule                 | Value                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Field                | `font?: 'brush' \| 'pen' \| 'black'` on `Subtitle`; absent = 기본, the system stack every subtitle had. Schema stays 2. `splitSubtitleAt` carries it (it copies every field since ADR-0017).                                                                                                                                                     |
| The faces            | One table `SUBTITLE_FONT_FILES` in `src/engine/fonts.ts`: id → CSS family name, file under `/fonts/`, licence. Labels 기본 / 붓글씨 / 손글씨 / 굵은고딕; hints name the face.                                                                                                                                                                    |
| Font string          | `subtitleFont(fontPx, weight, font?)`: a face is prepended to the system stack (`"Nanum Brush Script", "Malgun Gothic", …`) so a glyph the face lacks falls back per character; **a face is always drawn at weight 400** — the look's weight (600 / 800) is for the system stack; a synthetic bold on a brush face is not the face.              |
| One frame            | `SubtitleFrame.font?` is set by `subtitleFrameOf`; the export plan carries it like the look (ADR-0017); `drawSubtitle` sets the font string from it.                                                                                                                                                                                             |
| Loader behind a seam | `FontLoader { ready(font): boolean; load(font): Promise<boolean> }` in the engine; the browser one (`src/ui/fonts.ts`) uses `FontFace` + `document.fonts.add`, memoises per face, never throws (resolves false on failure), notifies subscribers. Rule 8: the engine never touches `FontFace`.                                                   |
| When it loads        | On the choice (the panel calls `load` after the command ran) and lazily by the preview when a frame under the playhead names a face that is not ready (a document reopened from storage). Never at app start.                                                                                                                                    |
| While it loads       | The preview draws the fallback stack; the panel's sentence after the choice is "자막 글꼴을 붓글씨로 바꿨어요 · 글꼴을 받는 중이에요 · 받으면 바로 바뀌어요."; when it lands the status says "붓글씨 글꼴을 받았어요." and the overlay redraws (a `fontsVersion` in `Preview`); on failure "붓글씨 글꼴을 받지 못했어요 · 기본 글꼴로 보여요."   |
| The export           | `exportProject` takes `options.fonts`; before rendering it collects `fontsInPlan(plan)` (unique faces in first-use order), reports phase `'fonts'`, awaits `load` on each; a face that fails is drawn with the fallback and listed in `ExportResult.missingFonts`; the button's sentence warns "⚠ 붓글씨 글꼴을 받지 못해 기본 글꼴로 그렸어요." |
| Command              | `subtitle.setFont` 자막 글꼴 고르기 — arg-taking, hidden, one `updateSubtitle` op with the exact inverse (absent restored through `dropUndefined`), refuses the face already set. Sentence: "자막 글꼴을 붓글씨로 바꿨어요." / "자막 글꼴을 기본으로 되돌렸어요."                                                                                |
| Panel                | A fourth `Choices` row 글꼴 between 모양 and 자리 (the two "how the words look" rows together), the same radiogroup contract as the other three.                                                                                                                                                                                                 |

**Shape of the work, in order:**

1. `src/engine/fonts.ts` (test-first): the vocabulary, the file table,
   `fontOf` / `fontField`, `fontFamilyStack`, `FontLoader` and `NO_FONTS`,
   `fontsInPlan`, the sentences. `types.ts` gains `SubtitleFont` and
   `font?`. `subtitleRender.subtitleFont` takes the face (weight 400 rule),
   `SubtitleFrame.font?`, `subtitleFrameOf` carries it. Cases: the stack
   with and without a face; weight forced to 400 only with a face; a plan
   with two faces used out of order lists them in first-use order once
   each; a plan with none is empty.
2. `subtitle.setFont` in `subtitleCommands.ts` with tests (undo restores
   an ABSENT field, `toStrictEqual`; the same face refused; sentences).
3. `src/ui/fonts.ts`: the browser loader and `subscribeFonts`.
4. `exporter.ts`: `options.fonts`, the `'fonts'` phase, `missingFonts`;
   `ExportButton` passes the loader, names the phase, warns.
5. `SubtitlePanel`: the 글꼴 row; the choice starts the load and says so;
   `Preview`: lazy load + redraw on arrival.
6. e2e `e2e/subtitle-font.spec.ts`: the row and its default; 붓글씨 →
   `document.fonts.check` becomes true and the overlay's ink bounds
   change, 기본 → the bounds are exactly the system face's again; a face
   survives a reload and is fetched again for it; an export with a face
   has 90 frames and no font warning.
7. `docs/FONTS.md` (the shipped faces, their licence, how to add one,
   the faces that need a licence of their own — 배민 family, paid
   calligraphy — listed for a later unit); ADR-0018; `docs/TESTING.md`
   contract rows; CLAUDE.md debt after the personas.
8. Persona round, fix blockers, `npm run verify`, visual pass in the
   owner's Chrome (ask which by deviceId), `npm run handoff`, ONE commit
   with approval.

**Out of scope for this unit:** subsetting or woff2 conversion, 배민 or
paid faces, a per-look default face, a font size or letter-spacing
control, showing a face's own sample in its radio, a progress number
while a face downloads.

**How progress and issues are reported:** as E8-2a — "### E8-2b
progress" and "### E8-2b issues" under this plan, one line per step,
written before moving on; stop before the commit for the owner's
approval.

Housekeeping, closed on 2026-09-15: `91795d8` pushed; the chrome://inspect
toggle is OFF (port 9222 has no listener, the dev-browser daemon is dead).
Still open: the owner's own uncommitted edits to `AGENTS.md`, `CLAUDE.md`
(one bullet) and `docs/UX.md`, theirs to commit.

### E8-2b progress

Built in Claude Code on 2026-09-15 (KST), across two sessions (the first
ended mid-unit by the owner's `/handoff`, with steps 1–5 and the drafts of
6–7 in the tree, uncommitted), the plan's steps in order:

1. **Engine, test-first — done.** `src/engine/fonts.ts` (new: `FONT_IDS`
   / `FONT_LABEL` / `FONT_HINT`, `SUBTITLE_FONT_FILES`, `fontOf` /
   `fontField`, `fontFamilyStack`, the `FontLoader` seam and `NO_FONTS`,
   `fontsInPlan`, the sentences and `missingFontsText`) with 8 tests;
   `types.ts` gained `SubtitleFont` and `Subtitle.font?`;
   `subtitleRender.subtitleFont(px, weight, font?)` puts the face first
   in the stack and forces weight 400 with a face; `SubtitleFrame.font?`
   set by `subtitleFrameOf`. `splitSubtitleAt` carries it for free (it
   copies every field since ADR-0017).
2. **Command — done.** `subtitle.setFont` 자막 글꼴 고르기 in
   `subtitleCommands.ts`, 3 tests: undo restores an ABSENT field
   (`toStrictEqual`), the same face is refused, the sentences.
3. **Browser loader — done.** `src/ui/fonts.ts`: `browserFonts`
   (`FontFace` + `document.fonts.add`, memoised per face, an in-flight
   load returns the same promise, never throws), `subscribeFonts`,
   `fontState`.
4. **Export — done.** `exporter.ts` takes `options.fonts`, collects
   `fontsInPlan(plan)`, reports phase `'fonts'`, awaits each load before
   frame 0, lists a failed face in `ExportResult.missingFonts`;
   `ExportButton` passes `browserFonts`, names the phase 글꼴 받는 중 and
   warns "⚠ … 글꼴을 받지 못해 기본 글꼴로 그렸어요."
5. **Panel and preview — done.** A fourth `Choices` row 글꼴 between
   모양 and 자리; the choice runs the command, then `load`, and says the
   loading / arrived / failed sentence; `Preview` loads a face lazily
   when the frame under the playhead names one that is not ready, and
   redraws on `fontsVersion` when any face lands.
6. **e2e — done.** `e2e/subtitle-font.spec.ts`, 4 tests: the row and its
   default with nothing fetched; 붓글씨 fetched → the overlay's ink
   bounds change, 기본 → the system face's bounds exactly; a reopened
   document fetches its face when the playhead reaches the words; an
   export with a face has 90 frames and no font warning. First run on
   real Chrome 3/4, second 3/4, third 4/4 — both failures were in the
   spec, not the code (see "E8-2b issues").
7. **Docs — done.** `docs/FONTS.md`, ADR-0018 and its index row,
   `docs/TESTING.md` contract row for radiogroup "글꼴".
8. **Full gate before the personas: GREEN** (unit 658 · e2e 128, the new
   spec included).
9. **Persona round — done** (tester-qa, tester-a11y, tester-novice,
   framewright-reviewer, in parallel). One blocker and six majors, all
   fixed the same day, test-first (`abort.test.ts` new; `fonts.test.ts`,
   `subtitleRender.test.ts`, `subtitleCommands.test.ts` extended; the
   e2e spec grew to 6 tests); the minors are in CLAUDE.md "Known tech
   debt" (five new entries at the top). Engine unit after the fixes: 640.
   Details under "E8-2b issues".
10. **Full gate after the fixes: GREEN** (unit 667 · e2e 130).
11. **Visual pass in the owner's Chrome — done** (the owner chose
    `da2a0786-…`; Claude in Chrome on the live dev server at 9990, the
    owner's own autosaved project: 7 clips, 3 subtitles). Selected 자막 1
    ("걸침", 10–24) with Enter (playhead to 10), read the panel: four
    radiogroups, 글꼴 between 모양 and 자리 with 기본 / 붓글씨 / 손글씨 /
    굵은고딕, hints as `title` and `aria-describedby`. Pressed 붓글씨: the
    status went "자막 글꼴을 붓글씨로 바꿨어요 …받는 중이에요…" → "붓글씨
    글꼴을 받았어요." in 5.7 s (3.4 MB from Vite), `document.fonts` held
    the face, the overlay's ink changed. 외침 then 손글씨: the ink changed
    again (400 on the pen face vs 800 on the system one); 손글씨 pressed
    again said "이미 손글씨 글꼴이에요."; 굵은고딕 landed within 80 ms.
    **The tab was `document.hidden` in the owner's window, so every
    screenshot timed out** — the pass read the DOM and the overlay
    canvas instead; nothing was seen as pixels on a screen. **One
    finding, fixed:** the panel glued the finished sentence and the wait
    with " · ", so the line read "바꿨어요**. ·** 글꼴을 받는 중이에요".
    `describeFont(id, look, loading)` now builds the whole sentence with
    one full stop; `fonts.test.ts` pins it and `e2e/subtitle-font.spec.ts`
    matches the entire status line. Four edits undone with Ctrl+Z; the
    persisted project JSON equals the snapshot taken before the pass.
    Tab closed. The gate re-ran after the fix (the stamp at the top).

### E8-2b issues

- **Blocker (QA): a face this build does not know blanked the whole
  editor.** `fontFamilyStack` read `SUBTITLE_FONT_FILES[font].family` for
  whatever the document said; a `font` written by a later build (a
  fourth face) or a hand edit threw inside `Preview`'s draw effect, and
  with no error boundary React unmounted the tree. Fixed with
  `knownFont` (engine/fonts.ts): an unknown face is the system stack at
  the look's weight, the export neither waits for nor reports it, the
  browser loader has no file for it. The same shape existed since E8-2a
  for an unknown LOOK (`SUBTITLE_LOOKS[look ?? 'plain']`, three sites) —
  fixed together with `lookSpec`, unknown = plain. Unit tests for both;
  e2e "a document naming a face this build does not know still draws
  its words" writes `calligraphy` into the saved project, reloads, and
  asserts the system face's ink to the pixel, nothing fetched, nothing
  said, no `pageerror`.
- **Major (QA, a11y, novice): a fetch that settled late said the wrong
  thing.** `chooseFont`'s `.then` set the status whatever had happened
  since: pick 붓글씨, pick 손글씨 before the first lands → "붓글씨 글꼴을
  받았어요" over the newer sentence; pick, Ctrl+Z → "받았어요" for a face
  the subtitle no longer has. Fixed: the settle reads the live document
  and says nothing unless that subtitle still wants that face
  (`fetchFace`).
- **Major (QA): the export's font wait ignored Cancel.** Every other
  stage checks the signal; the new loop awaited `fonts.load` with no way
  in, so 취소 during 글꼴 받는 중 waited for the fetch — for ever, on a
  fetch that neither resolves nor rejects. Fixed with `raceAbort`
  (`engine/abort.ts`, new, 4 unit tests): the load is raced against the
  signal, `AbortError` at once, listener removed either way.
- **Major (novice, a11y): the reopened document's fetch said nothing.**
  `Preview`'s lazy load redrew on arrival with no sentence — a sighted
  user saw the letters reshape mid-subtitle, a screen-reader user heard
  nothing, and a failure was never reported on that path. Fixed: when
  the preview is the FIRST to ask for a face (nobody has asked yet — the
  panel's choice asks first and speaks for itself) it says "손글씨 글꼴을
  받는 중이에요 · 받으면 바로 바뀌어요." and then the arrived / failed
  sentence, the latter only while the words under the playhead still
  want the face. The e2e asserts the sentences (from the cache the file
  can land before the first is read, so the spec accepts either, then
  requires the second).
- **Major (novice): a failed face had no retry.** The command had
  already written the field, so the radio stayed checked and a second
  press said "이미 붓글씨 글꼴이에요"; the only way was 기본 then 붓글씨
  again, said nowhere. Fixed: the font row's `same` handler retries the
  fetch when the face's state is `failed` and says "붓글씨 글꼴을 다시
  받는 중이에요 · 받으면 바로 바뀌어요." E2e: the font route aborted,
  붓글씨 → the failed sentence, the system ink, the radio still checked;
  route restored, the same radio → the retry sentence, the face lands,
  the ink changes.
- **Major (novice): a face silently dropped a bold look's weight.** 외침
  is 800 on the system face; a face is always 400, and nothing said the
  two choices meet. Fixed in the sentence: `describeFont(id, look)` adds
  "· 외침의 굵은 글씨는 붓글씨 본래 굵기로 보여요." on 강조 / 외침, and the
  command's `done` passes the subtitle's look. Unit-tested in
  `fonts.test.ts` and `subtitleCommands.test.ts`.
- **Major (reviewer): `docs/TESTING.md`'s new row described the probe the
  spec had just stopped using** (`document.fonts.check`, written before
  the probe was fixed). Descriptive doc, code is right: the row now
  describes the `document.fonts` enumeration and why `check()` cannot.
- **Minors kept as debt** (CLAUDE.md, top of the list): the fourth copy
  of the set-one-field command shape; the export bar at 0% through the
  fonts phase and again at audio; the face hint hover-only for a sighted
  mouse user and leading with the product name; the preview never
  re-asking for a face that failed once (the radio is the retry, unsaid);
  the 글꼴 radios' colour-only checked state, inherited from the shared
  rule.
- **Not done, deliberately:** an export cancelled during the fonts phase
  has no e2e (a fetch that never settles is hard to stage; the unit test
  on `raceAbort` covers the race). A "prefetch every face the DOCUMENT
  names on load" (which would remove the reopened document's fallback
  window at the cost of a cache hit per reopen) is a contract change
  left to the owner — see the reopened-document entry below.

- **The e2e's first probe was vacuous.** `document.fonts.check('16px
"Nanum Brush Script"')` answers TRUE for a family the page never
  registered — the CSS Font Loading spec treats an unknown family as a
  system font — so "nothing fetched yet" read as fetched and the three
  "fetched" polls in the other tests would have passed with the loader
  deleted. The probe now enumerates `document.fonts` for a `FontFace` of
  that family with status `loaded`; the first test then failed for the
  right reason and passed once the probe was honest. Recorded in the
  spec's comment and in `docs/TESTING.md`'s row.
- **A reload parks the playhead on frame 0, so a reopened document
  fetches nothing until the playhead reaches the words.** The spec
  assumed the playhead would be on the words after `page.reload()`; it
  is not (`projectStore` starts at 0). That is the contract (ADR-0018:
  on the choice, or under the playhead — never at start), so the spec
  now asserts nothing was fetched after the reload, presses Enter on the
  chip (select + seek to its first frame) and then sees the fetch. **The
  user-visible consequence, for the owner:** a document reopened with a
  face draws the words in the system font until playback or a click
  reaches them and the file lands (from the browser cache, usually well
  under a second; on a first visit to a new machine, a few seconds), and
  the swap happens on screen mid-subtitle — since the persona round,
  WITH a sentence (the preview says 받는 중 / 받았어요 / 받지 못했어요 on
  that path; the entry above). What remains is the window itself: a
  prefetch on load of only the faces the DOCUMENT names would remove it
  at the cost of that fetch (a cache hit, usually) on every reopen. That
  is a contract change to ADR-0018's "never at start" and is the owner's
  call; left as is.

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

1. **E10 step 2 is waiting to be committed.** `origin/main` = `8f10d25`
   (E10 step 1, pushed 2026-09-16 with approval). Step 2's engine work
   is done, the gate is green, and the tree is uncommitted — the owner
   must be asked before the commit, and again before the push. The file
   list and the recipe are in "Next single step". The owner's own
   uncommitted edits to `AGENTS.md`, `CLAUDE.md` (the ui-ux-guide
   bullet) and `docs/UX.md` stay theirs to commit; `debug.log` and
   `e9-baseline.log` are stray.
2. **E10 is in flight: 2 of 10 steps done, step 3 (media) is next.**
   The plan is written below and its four open questions are answered
   there. Three of its recommendations were taken as recommended and the
   owner is still to confirm them at the end of the unit: one image on
   screen at a time; import places the image at the playhead for 2 s in
   one undo step; the words draw above images.
3. **The visual pass's trace in the owner's Chrome:** nothing left in the
   document (verified identical); the playhead was left on frame 10 and
   the three faces are now in that browser's HTTP cache. The tab was
   hidden throughout, so no pixels were seen — if the owner wants a look
   at the faces on the colour bars, a foreground tab and one press of
   붓글씨 on 자막 1 is the whole test.
4. **Done in E8-2d:** the faces a reopened document names are fetched
   when it opens (ADR-0018, amended 2026-09-16); the window is closed.
   Two product calls the round raised are the owner's: whether a stage
   press should stop playback (the blind-drag entry in CLAUDE.md), and
   whether the export bar should be one monotonic bar across phases
   rather than restarting per phase.
5. **Two auto snapshots and one file** from the visual pass: 자동 저장
   10:26 / 10:29 (2026-09-11) in the browser's 이전 상태, and
   `Downloads/Untitled.mp4`. Delete or keep.
6. **Product calls still open from the reframe unit (E8-2 no longer waits
   on them):** should 세로 imply 채우기 for every clip (today: per clip,
   deliberately, ADR-0015 "Consequences"); should the box change be
   reachable from the toolbar or only the preview row and the palette;
   should a 4:3 preset exist.
7. **Unchanged from E7:** playback and an export with a transformed clip
   watched; the sound unit's listening list; the auto snapshots from the
   2026-09-10 visual passes in the browser's 이전 상태; the turn's own
   STATUS sentence (the panel note says the black now, the sentence does
   not); the fade-edge heading, zoom's real-pixel count, the fade mark
   over bright footage, the dip through black at a double fade, the
   quiet-source waveform, the AWS deployment direction.
