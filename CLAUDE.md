# CLAUDE.md — framewright

Guide for AI agents (and humans) working in this repo. Read before editing.

**framewright** is a web-native, frame-accurate video editor on WebCodecs
(TypeScript + React + Vite). See `docs/adr/` for the "why" behind these rules.

## Golden rules (non-negotiable)

1. **Engine is framework-agnostic.** Nothing in `src/engine/**` may import React or
   touch the DOM directly. It must be unit-testable in Node.
2. **All document edits go through commands.** Never mutate the project state
   directly. Every edit is a named command with an inverse (for undo). Buttons,
   menus, palette, and shortcuts dispatch the same commands. (ADR-0003)
3. **All time math via `src/engine/time.ts`.** Never write inline frame/second
   arithmetic. Timeline is CFR integer frames; fps is a rational `{num,den}`. (ADR-0002)
4. **Deterministic IDs only.** Use the document-scoped id counter. Never
   `Date.now()` / `Math.random()` for IDs — it breaks redo and CRDT.
5. **Clip frame ranges are half-open `[in, out)`.** Splits/cuts must preserve the
   total frame count exactly (no gap, overlap, or dropped frame).
6. **Close every `VideoFrame`/`AudioData`** after use. Leaks crash the tab.
7. **No wall-clock in engine timing.** Playback/export derive position from the
   master clock / frame index, so preview and export agree.
8. **Isolate libraries behind interfaces.** mp4box → `demux.ts`; the muxer → the
   export module. Lazy-load `ffmpeg.wasm`; never bundle it eagerly.
9. **Don't over-abstract.** No plugin system / effect registry / worker-RPC layer
   until a concrete third case appears (rule of three).

## TDD

Engine logic is test-first. Write the Vitest spec (red), implement to green.
Run `npm test` before considering a change done. See `docs/TESTING.md`.

Anything that touches decoding, playback, or export cannot be unit-tested (no
WebCodecs in Node) — cover it in `e2e/` with Playwright instead. Two shipped bugs
came from that gap; don't widen it.

## Layout

```
src/
  engine/   time · types · project · demux · decoder · playbackSession · player · registry
  store/    projectStore (zustand — UI state only, not document logic)
  ui/       MediaBin · Preview · Timeline
docs/
  adr/      architecture decision records
  TESTING.md
```

## Commands

- `npm run dev` · `npm run build` · `npm run typecheck` · `npm test`

## Working mode — run the loop, don't ask

The owner has asked for this explicitly: **do not stop between steps to report or
to ask permission.** For a unit of work (an epic, or one numbered backlog item),
run the whole loop yourself and come back once, at the end:

```
implement → npm run verify → fix → persona review (all three) → fix
          → npm run verify → repeat until GREEN and zero blocker findings
          → visual QA in real Chrome, if a browser is connected
```

Rules for the loop:

- **`npm run verify` must be green before you claim anything is done.** Not "the
  engine tests pass" — the whole gate, e2e included.
- A persona finding in the blocker tier is a defect, not feedback. Fix it and run
  the gate again. Lower tiers go into "Known tech debt" below, never silently
  dropped.
- If the same fix fails twice in a row, stop and report — that is a real
  disagreement about the design, and it is worth the owner's time. Everything
  else is not.
- **Announce before any git operation** and wait. This is the one hard stop.
- **Look at it before handing it over.** If a Chrome is connected
  (`list_connected_browsers`), drive the real UI and read the screenshots — the
  gate cannot see a clipped label or an invisible gap. Every visual finding ships
  with a new assertion so it cannot come back unseen. See docs/TESTING.md. If no
  browser is connected, say so and skip it; do not guess at appearance. (A
  Codex session does the same pass through dev-browser; `AGENTS.md` is this
  file's Codex twin and `docs/TESTING.md` names the driver per session.)
- Final taste and judgement are the owner's, at the end. Don't ask them to be
  your test runner.

## Handoff — how work survives a session

Chat context dies. A session ends, a context window fills, the owner comes back
three days later. Everything that matters therefore lives in files, and there are
exactly three, with different lifetimes:

| File                    | Lifetime                           | Answers                                                         |
| ----------------------- | ---------------------------------- | --------------------------------------------------------------- |
| `CLAUDE.md` (this file) | rarely changes                     | how we work, what must never break                              |
| `docs/HANDOVER.md`      | changes when the _project_ changes | what this is for, who the owner is, what has already gone wrong |
| `docs/STATUS.md`        | **rewritten every unit of work**   | where we are right now, and the next single step                |

### Starting a session

1. Read `docs/STATUS.md`, then `docs/HANDOVER.md`, then this file.
2. **Run `npm run verify` before writing any code.** The doc says what the last
   session believed; the gate says what is true. When they disagree, the gate
   wins and the disagreement is the first thing to fix.

### Ending a unit of work — before reporting anything

1. `npm run handoff` — runs the gate and stamps its real result (green or red)
   into `docs/STATUS.md`. It cannot be faked; that is the point.
2. Rewrite the rest of `docs/STATUS.md`: where we are, what is in flight, the
   **next single step**, what is blocked or needs the owner, and any decision a
   future session would otherwise get wrong.
3. Move every persona finding you did not fix into "Known tech debt" below.
4. Add or update an ADR if an architectural decision changed.

Write `STATUS.md` for a reader with zero memory of any conversation. No "as
discussed", no "the fix from earlier", no pronoun pointing at chat history. If a
future session has to ask the owner what you meant, the handoff failed.

### When to end the session and start a fresh one

**Default boundary: one epic.** Finish E6 end to end, gate green, then hand off
and stop. Every new session pays a fixed re-orientation cost — read three docs,
run the gate — so cutting per backlog item pays that cost three times for the
same work. Cutting per epic pays it once.

A cut is only **safe** when all four hold:

1. `npm run verify` is green (or `STATUS.md` records, honestly, that it is red
   and exactly why)
2. `npm run handoff` has stamped the real result
3. `STATUS.md` names the **next single step**
4. the work is committed — and the owner was asked first

Override the default and cut early, mid-epic, when any of these fire:

- **Context drops to 40% remaining.** This is a hard stop, not a guideline, and
  it outranks finishing the epic. At 40% you still have room to run the gate,
  rewrite `STATUS.md` properly and commit; at 15% you do not, and the handoff
  becomes the rushed, vague kind that costs the next session an hour. Hand off
  before, not after — a half-finished unit with an honest `STATUS.md` is
  recoverable; a finished one nobody can find is not.
- **The same bug has survived three hypotheses.** By then the session is full of
  wrong theories, and every new idea is anchored to them. A fresh session reading
  only `STATUS.md` sees the problem clean. Write down what you ruled out and why —
  that is the valuable part, not the theories.
- **The kind of work changes** — implementation → planning, or a broad refactor.
  Carrying implementation detail into a design conversation makes the design
  smaller than it should be.
- **Right before something risky** (a dependency change, a wide rename), so the
  previous session is a clean checkpoint to return to.

Never cut mid-epic with a red gate and no explanation. That hands the next
session a broken tree and no idea which of the breakage was intentional.

## Hooks and subagents

Both are already configured (`.claude/`). Two things follow from that.

### What runs without you asking

- **PreToolUse** blocks edits to lockfiles, `.env` and `.git/`.
- **PostToolUse** formats the file you just wrote, then runs `check:guardrails`
  and `check:refs` — so a duplicate import surfaces at the edit, not three
  files later when the page is blank.
- **Stop** runs refs → guardrails → typecheck → unit tests and **refuses to let
  the turn end while they are red**, handing the failure back as feedback. After
  three consecutive red stops it relents and tells you to report being stuck
  instead. e2e is not in this hook (too slow per turn); it belongs to the
  explicit `npm run verify`.
- **SessionStart** prints the live handoff from `docs/STATUS.md`.
- **Bash / PowerShell (pre + post)** run the vendored harness guard
  (`.harness/danger-guard.mjs`, rules in `harness.config.mjs`). It **denies**
  force-pushes and piping a verify/test command into anything (the exit code
  would be the pipe's, so red reads as green), and **asks** before git writes
  and before anything that discards uncommitted work — the mechanised form of
  "announce before any git operation". The block message names the rule and
  what to do instead; read it rather than routing around it. Nothing here
  replaces the owner's approval.
- **Stop** also runs `.harness/turn-end.mjs`, which only records that the turn
  ended (plus a test-coverage count for `src/engine/`). It never blocks.
  `node .harness/metrics.mjs` renders the report; `.harness/log.jsonl` is
  git-ignored and stays local.

None of that replaces running `npm run verify` yourself. The hook is a net, not
the gate. The guard's status is `node .harness/danger-guard.mjs --status` —
"active" there means the rules load, not that the hook is wired; the hook is
wired in `.claude/settings.json` (and its courier copy `_claude-setup/`, which
`npm run setup:claude` copies over `.claude/` — keep both in step).

### Use the persona subagents — do not role-play them

`.claude/agents/` holds `tester-qa`, `tester-a11y` and `tester-novice`
(read-only), plus `framewright-reviewer`, `test-writer` and `export-qc`. Spawn
them with the Task tool, in parallel, once the gate is green. Two reasons, and
the second is the one that bites:

1. **They are not anchored to your implementation.** A separate context reviewing
   the diff finds things the author cannot see. In the E5 round the personas
   found two blockers — `Ctrl+C` splitting the clip, and a `role="slider"` that
   deleted every clip's name from the accessibility tree — that no test caught.
2. **Their tokens are not your tokens.** Persona review is the most expensive
   step in the loop. Run it inline and it eats the context you need for the
   handoff. Run it as subagents and only the findings come back.

Feed each one the changed file list and what to focus on; ask for tiered findings
(blocker / major / minor) with file:line and a concrete failing scenario. Fix
every blocker, re-run the gate, and put the rest in "Known tech debt".

## Definition of done for a change

Run these in order. **`typecheck` is not optional** — a duplicate import or a
use-before-declaration compiles away silently in dev and then breaks the whole
page, which makes every e2e failure look like an unrelated selector problem.

1. `npm run check:refs` — duplicate/unresolved imports
2. `npm run typecheck` — types, including TS2448 use-before-declaration
3. `npm test` — unit tests
4. `npm run e2e` — browser behaviour (see `docs/TESTING.md`)
5. Persona review when UI or engine behaviour changed (`docs/TESTERS.md`)

Also:

- Relevant frame-accuracy invariants hold (see `docs/TESTING.md`)
- Touches an architectural decision? Add/update an ADR.

### When you change UI structure

Renaming, moving, or replacing a component is not done when the new file looks
right. Before finishing: re-check every place that imported or referenced it,
confirm nothing imports a symbol twice, and confirm no dead import points at a
file that moved. Then run `check:refs` and `typecheck`.

## Known tech debt

- **`useStageDrag.onPointerDown` has no re-entrancy guard, and its
  `setPointerCapture` is unguarded.** A second pointer pressing the same
  target while a drag is on overwrites the drag ref, so the first
  pointer's release — and the words' snap at the drop — is silently
  dropped; and `setPointerCapture` is called after the ref is written,
  so a throw (the element removed mid-press) leaves the ref non-null
  with no capture until the next successful gesture on that key. Both
  pre-existing in the pan and the words code before the extraction, and
  carried into the hook unchanged on purpose; now one place, so the fix
  is one guard and one try/catch, and the image drag (E10 row 6) is the
  moment to add them with a jsdom PointerEvent test (QA, E10-1).
- **A words drag during playback goes blind.** The drag locks the
  subtitle's id at press (ADR-0019) and every move lands on it, but
  nothing stops playback on the press, so when the rAF loop carries the
  playhead past the subtitle's end the overlay draws whatever is under the
  playhead now while the pointer is still rewriting the locked subtitle's
  position, unseen, until release. The pan has the same latent gap.
  Stopping playback on a stage press is the obvious lever (QA, E8-2d).
- **A face's "받았어요" is never said after the fact.** The playhead's
  sentence settles only while the same face is still wanted under the
  playhead; a user who moves on during the fetch and comes back later
  finds the face already drawn and hears nothing — the promise of "받으면
  바로 바뀌어요" is kept on screen, not in words (a11y, E8-2d).
- **The 자리 group and its radiogroup share one name.** Both are
  `aria-labelledby` the visible word, so a screen reader may say "자리
  grouping, 자리 radio group" back to back on entry. Unverified against a
  real AT; if it grates, the radiogroup's own name is the cheap fix, and
  every spec's `radiogroup "자리"` locator follows it (a11y, E8-2d).
- **No `forced-colors` rule anywhere.** The checked radio's dot, its
  teal border and every other colour state vanish under Windows High
  Contrast; app-wide and pre-existing, the dot is one more instance. One
  shared `@media (forced-colors: active)` rule with an outline or a
  border-style is the fix (a11y, E8-2d).
- **The checked dot is 4px.** Legible in the owner's Chrome at 100%
  (2026-09-16), but small, and a first-time user who notices it may read
  it as a badge; the teal border stays the dominant cue (novice, E8-2d).
- **A stage drag's limits are frozen at the press.** `R` (rotate) or a
  box change pressed while the pointer is down changes the pan's limits
  and the box's size under a running drag; the document is still clamped
  by the command (`decidePan`), but `dragAxis` then rebases against stale
  bounds and the pointer can detach for the rest of that one gesture
  (reviewer, QA, E8-2d).
- **A face that failed in one document stays failed for the next.**
  `ui/fonts.ts`'s state map is a module singleton (see the other singleton
  entries below): a restore or a new document naming that face skips the
  quiet fetch because the state says `failed`, and only the radio's
  retry asks again (QA, E8-2d).
- **`Preview.tsx` is ~600 lines and two concerns** — scrub, and the
  playback loop with its audio scheduling. The words' drag is a hook
  (`ui/useWordsDrag.ts`) and the faces another (`ui/useSubtitleFonts.ts`)
  since 2026-09-16; the pan's DOM half is in `ui/useStageDrag.ts` with
  the words' since the same day (E10 step 1), and the pan's remaining
  ~60 lines in `Preview` are its hit test, its limits and its sentence.
  The playback loop is what remains to pull out (reviewer, ADR-0019).
- **After a drag on the stage, focus is wherever it was.** `.stage` is not
  focusable and the words drag's release moves focus nowhere, so a
  mouse-plus-screen-reader user has no way to ask "where am I now" after
  the panel changed under the pointer; the sentence is the only sign. The
  keyboard route (the sliders) never enters this path. Moving focus after
  a mouse gesture is focus theft unless the owner wants it — their call
  (a11y).
- **Every slider step says the whole position sentence.** "자막을 옮겼어요
  · 왼쪽에서 53% · 맨 아래." on each ArrowRight — the most verbose instance
  of the shared `RangeRow` pattern (the pan's is two clauses); arrival on
  a preset is already said shorter (a11y).
- **자리 here, 위치 there.** The subtitle's sliders are 가로 자리 · 세로
  자리, the picture's 가로 위치 · 세로 위치 — never on screen together,
  and the different word tells the two apart, but it is one more word to
  learn (a11y, novice).
- **The 세로 slider's 0 is above the 위 preset (15).** Its extreme is the
  top margin; the nearest radio never lights for it; the note says the
  true position. The keyboard route has no snap at all (`snapPosition` is
  applied at the pointer's drop only, by the plan) — the radios are the
  exact route (a11y, novice).
- **The export's progress bar jumps back to 0% at the audio phase.** The
  fonts phase counts per face now (1/3, 2/3 …), then the audio phase
  starts from 0 over the plan's frames, and the bar goes backwards once.
  Same family as "잠시 뒤 다시 눌러 주세요 has no sense of how long"
  (reviewer, QA, a11y, novice).
- **What a face looks like is hover-only for a sighted mouse user.**
  `FONT_HINT` ("붓으로 쓴 글씨 · 나눔붓") is the radio's `title` and its
  `aria-describedby`, so a screen reader hears it and a hover shows it; a
  click-only user picks 붓글씨 / 손글씨 / 굵은고딕 sight unseen. A sample
  of the face in its own radio is out of scope by the plan (novice, a11y).
- **A face that failed is asked for once per session.** The document's
  quiet fetch on open (ADR-0018, amended) and the playhead's sentence do
  not retry; the radio pressed again is the retry, and the failed
  sentence now says so. A reopened document whose face did not come
  (offline at the time) shows the system face until that press — and,
  after a reload in the same renderer, may show the face anyway from
  Chrome's cache while the sentence says it did not come (TESTING.md,
  "A reload does not forget a web font").
- **An effect shows only on the frames where the subtitle comes and goes.**
  With the playhead mid-subtitle (where it usually is after typing), pressing
  톡 or 올라오기 changes nothing on the preview; the status sentence now
  says what the effect is and the panel hint says to play it, but nothing
  parks the playhead on the subtitle's first frame or previews the motion.
  A "play this subtitle" button, or a re-cue to its start on the choice,
  is the next lever (novice, ADR-0017).
- **A short subtitle's effect is capped to near nothing in silence.** The
  way in is at most half the subtitle (ADR-0017), so a 0.3 s caption gets
  four frames of 올라오기 each side and no sentence says so (novice).
- **The subtitle panel has one sub-heading, 꾸미기, for four sections.** The
  words, the timing line and the 재생 위치로 buttons have none; a
  screen-reader user navigating by heading sees one substructure. Same
  shape as the clip panel's fade-edge entry below (a11y).
- **Undo inside a radiogroup leaves focus on a radio that is no longer the
  Tab stop.** Undo reverts the document without moving focus, so after
  arrowing to 외침 and pressing Ctrl+Z, focus sits on an unchecked radio
  with `tabIndex -1` and the next Tab skips the row. App-wide: undo also
  says no sentence. The e2e moves focus to the ruler first (a11y).
- **The palette does not list the nine subtitle choices.** The three
  commands are arg-taking and hidden like `subtitle.setText`; whether
  "자막 자리를 위로" belongs in the palette as a row is the owner's call
  (ADR-0017).
- **`Choices` in `SubtitlePanel.tsx` is the second copy of the radiogroup
  keyboard code** (`FramePicker` the first). A third is the trigger to
  extract it (reviewer, ADR-0017).
- **`Preview` keys the subtitle overlay on the frame's JSON.** A
  `JSON.stringify` per render and a parse when it changes; correct while
  `subtitleFrameOf` builds its fields in one fixed order. A shallow-equal
  memo would say the same thing more directly (reviewer).
- **꾸미기 is a loose umbrella for 자리.** Decoration fits 모양 and 효과;
  where the words sit is layout. Not misleading, just imprecise (novice).
- **조용한 부분 없애기 wakes up in silence.** The toolbar button flips from
  "소리를 아직 읽는 중이에요" to runnable when a source's peaks land, and
  nothing announces it: `aria-disabled` and `title` change on an unfocused
  control, which a screen reader does not read. The user learns by
  re-tabbing to it or pressing it again. The clip panel's ceiling has a
  `setStatus` for its own out-of-band change; the button could say one
  sentence the first time it becomes runnable after having been blocked
  (ADR-0016, a11y).
- **The cut's sentence does not say what happened to the selected clip.**
  "조용한 부분 1곳을 없앴어요 · 0.93초 짧아졌어요 · 앞뒤 0.2초씩은 남겨
  뒀어요" counts and times; a selected clip that lay wholly inside a pause
  is gone (selection dropped, `pruneSelection`) and one that survived is
  now several clips, and neither is said. Focus stays on the toolbar
  button, so the changed clip labels are not re-announced either (a11y,
  novice).
- **"N곳" counts cuts, not pauses.** A pause that spans a split (one the
  user made earlier inside it) is cut once per piece and counted twice.
  ADR-0016 accepts this as honest about the cuts; a first-time user heard
  one pause (novice).
- **The playhead stays on its frame NUMBER across the cut**, so after
  removing [30, 50) a playhead at 40 is on what used to be frame 60. Same
  as `timeline.closeGaps`; nothing repositions or announces it (QA).
- **"잠시 뒤 다시 눌러 주세요" has no sense of how long.** The peaks of a
  long file take a while and the button shows no progress; the thumbnail
  strip has the same gap (novice).
- **The palette's rows recompute on `peaksVersion` now, and on nothing
  else out of band.** `CommandPalette.rows` is a `useMemo` on
  `[query, keymap, peaksVersion]`; a future command whose availability
  depends on another async signal will need its own bump, and the QA
  persona's stale-row scenario is guarded only for this one
  (`e2e/silence.spec.ts`, "wakes up when it lands").
- **The fade clamp at a cut is written twice** — `splitCommand` and
  `silencePatch`'s `fadeInOf` / `fadeOutOf` (head keeps fade-in if its
  edge was not cut, tail keeps fade-out, each at what the piece can hold).
  Second occurrence; a third is the trigger to share it (reviewer).
- **`EditorCtx` carries two non-document fields**, `clipboard` and `peaks`.
  Both are "the environment the edit is made in"; a third is the moment to
  name that (reviewer, ADR-0016).
- **The palette → removed-clip focus path is untested.** A clip focused
  from the palette's opener, wholly inside a pause, removed by the cut:
  the palette's refocus targets a detached node and `Timeline`'s recovery
  effect takes over. Reads right; no e2e exercises it (a11y).
- **A quarter turn's own black sides are said by the panel, not by the
  turn.** The note under the sliders is geometric now (`emptySides`,
  ADR-0015: "90° 회전 · 화면 양옆이 비어요"), but the status sentence is
  still just "화면을 90° 돌렸어요." — a screen-reader user hears the black
  only on the next focus of the panel. One clause on the turn's sentence
  would do it (novice).
- **Two phrasings for "the picture does not cover the frame".** "화면
  양옆이 비어요" (which sides are black, from the drawn rectangle) and
  "보이는 범위" (why a slider is short; a turn pulled the pan in). Down
  from three: "화면 한쪽이 비어요" is gone (novice).
- **Filling is per clip.** A project of seven clips stood up needs seven
  presses of 화면 채우기; the box change rewrites nothing on purpose
  (ADR-0015). A "fill every clip" command, or 세로 implying 채우기 for a
  first-time user, is the owner's call.
- **A 4:3 project has no preset of its own.** `frameShapeOf` names only
  16:9 / 9:16 / 1:1, so the picker shows "1440×1080" with nothing pressed
  and every preset offered; there is no way back to 4:3 but undo.
- **The box change's hint does not name the clip.** "비는 클립을 고르고
  화면 채우기를 누르면 꽉 차요" is project-wide (`frameHints`); with ten
  clips and one uncovered, a screen-reader user has to hunt for it (a11y).
- **A box change re-announces nothing per clip.** The sound ceiling has
  its own `useEffect` + `setStatus` for a slider end that moves on its
  own; a frame change that narrows the selected clip's pan slider (50% →
  15%) says only the one project-wide sentence (a11y).
- **화면 원래대로 puts the clip back, not the box.** It sits three
  buttons from 화면 채우기, and someone undoing an experiment may reach
  for it expecting 가로 too; the box's own way back is the radio or
  Ctrl+Z, and nothing says so (novice).
- **A preview drag can park the pan between slider notches.** The drag
  stores a whole percent (18%), the slider's step is 5, so the handle
  sits at 20 while the readout beside it says 오른쪽으로 18% (seen in the
  owner's Chrome, 2026-09-11). Pre-existing since the picture unit; the
  next notch pressed on the slider snaps it.
- **The export sentence says "90 frames" and "3.00s".** `ExportButton`'s
  "내보내기 완료 · 90 frames · 3.00s" is the one English-and-jargon line a
  first-time user reaches in the reframe flow; pre-existing (novice).
- **The two picture notes sit under the buttons, not under the sliders**,
  in the same 12px dim style; the one that explains a short slider is two
  rows past the slider it explains (novice).
- **A pan limit can round down to 0%.** `notchDown` floors to a 5% notch,
  so a picture whose share of the box on an axis is under 2.5% (a 40:1
  aspect mismatch) gets `min = max = 0`: an inert slider and the sentence
  "가로로는 0%까지만 옮길 수 있어요". Correct, unpolished (QA).
- **The strip's pictures ignore the clip's transform.** Thumbnails are the
  source frames as shot; a clip zoomed to 400% and turned still shows its
  original frames on the timeline, with only the 🔍↻✥ pill to say so. The
  thumbnail cache is keyed by source frame, so drawing them transformed is
  a draw-time change in `ClipCanvas`, not a cache change.
- **Zoom crops, silently.** A 400% zoom of a 720p file shows 180 real
  pixels across the box and nothing says so. A sentence keyed on the
  source's size is cheap; the source's size is in `asset.meta`.
- **A focused slider swallows every plain key, `R` included.** Range inputs
  own unmodified keys (`useShortcuts.controlOwnsKey`, from the fade-length
  list's Delete accident), so `R` on the zoom slider does nothing and says
  nothing. Consistent, deliberate, and a real "why did R stop working"
  for someone who tabbed there (QA).
- **The stage's drag has no signal for assistive tech.** `.stage` is a
  div with pointer handlers and `cursor: move`; the two pan sliders are
  the equal keyboard route, so nothing is unreachable, but nothing in the
  DOM says the picture can be dragged (a11y).
- **`Preview` resolves the clip under the playhead on every render.** One
  O(clips) `resolveAt` per render, same class as the `subtitleAt` beside
  it, on a component that re-renders every playhead tick. Fine for the
  clip counts an MVP sees (guardrail).
- **The ceiling reads whole buckets, so it can be a notch low at a trim.**
  `clipPeak` takes every 128-sample bucket the clip's range touches, so a
  peak up to 2.7ms outside the trim counts. Errs toward quieter, never
  toward clipping; a first-time user will not notice a notch.
- **Until the peaks arrive the ceiling is 200%.** A level set in that
  window (the first second after an import) can exceed the ceiling; it is
  then heard, shown and described at the ceiling, the status line says so
  the moment the ceiling lands, and the document keeps the number. Same
  rule as a fade under a trim. A trim INTO a quieter passage raises the
  ceiling back and the sound gets louder with no sentence tying it to the
  trim (novice).
- **The ceiling's status sentence fires only while the clip is selected.**
  A ceiling that lands for an unselected clip (peaks arriving after the
  user moved on) is shown on the strip's pill and said in the panel when
  the clip is next selected, never announced.
- **A re-cue's click scales with the level.** Every edit during playback
  stops the sources and starts new ones (`AudioPlayer.stop()`, no release
  ramp); the discontinuity is the sample times the gain in effect, so a
  clip at 200% pops twice as hard as one at 100%. Same mechanism the fades
  accepted, reasoned about only up to gain 1 until now.
- **`clip.mute`'s disabled reason is unreachable from the panel.** The
  panel returns null with no clip selected, so the button never renders
  `aria-disabled`; the reason exists for the palette and the key, like the
  last branch of `subtitle.add`.
- **The panel's fade edges have no heading; the sound does.** "소리" is an
  `<h3>` under the panel's `<h2>`, the two fade toggles above it are not
  under any. A screen-reader user navigating by headings jumps from "클립"
  to "소리" with nothing for the fades in between.
- **소리 끄기 and 소리 크기 are one syllable apart in one 12px row.** The
  visible strings are the full phrases now, so UX.md's "one word, one
  meaning" holds, but a person scanning rather than reading can still
  conflate them before the "소리" heading registers (novice).
- **The sound pill inherits `.clip-name`'s contrast** (same translucent
  ground, see that entry): AA, not AAA, over the brightest footage.
- **The fade mark is subtle over bright or busy footage.** `.clip-fade` is a
  dark ramp plus a 2px teal diagonal drawn over whatever the thumbnails
  contain; the ramp is legible for its first third and the diagonal is thin
  against a rainbow frame (seen in the owner's Chrome, 2026-09-09). It is
  decorative — the clip's `aria-describedby` says the same in words — and it
  has no `title`, so a sighted user who did not add the fade learns what it
  is only by selecting the clip. A bar along the mark's extent, or a
  hover title, are the cheap next levers. Same shape as the `.clip-name`
  contrast entry below: the ground is the footage, not a token.
- **The preview leaves a dissolve's second picture out until that decoder
  delivers its first frame**; the export waits for it. A neighbour's decoder
  opened cold at a cut takes a few frames, so on screen a dissolve starts
  a few frames late and the file does not. Chosen over the alternative
  (black at the fade's weight, which flashed dark at every dissolve). A
  pre-roll started before the cut would hide it; that is the same warm-decoder
  work playback already owes at every hard cut.
- **`missingFrames` counts a frame whose DISSOLVE picture could not be read
  as a missing frame**, and the export sentence then says those frames were
  "검은 화면으로 채웠어요" — overstated: the footage was there, only the
  picture under it went black. Honest count, imprecise sentence.
- **The audio crossfade is linear, like the picture.** An equal-power curve
  sounds better through a long dissolve and would then disagree with what
  the eye sees ramping. ADR-0012 leaves it linear on purpose.
- **A fade-out and a fade-in on the same cut dip through black**, legally
  and silently: each panel note says where its own edge goes, nothing says
  "the cut now goes dark". A first-time user who wanted a dissolve and set
  both gets the dip. One sentence on the second toggle would do it.
- **A split inside a fade steepens the ramp** — each piece fades over what it
  has. The split's own sentence says so (`서서히 구간도 나뉘어 짧아졌어요`),
  which is the honest option short of refusing the split.
- **The palette finds the fades only by their Korean label.** Typing `fade`
  or `페이드` finds nothing; the filter is a plain substring on the label
  (see the palette entry further down). The panel is the discoverable route.
- **A quiet source still reads as a thickened line, not a shape.** The wave is
  drawn through `waveAmplitude` (a square root) so that ordinary audio is
  visible at all in an 18px band — the repo's own fixture peaks at 0.19, which
  drawn literally filled two rows of that band. Curved, it fills six. That is
  legible but modest, and the next levers, if anyone complains, are a true dB
  curve or a taller band; both cost either honesty about level or picture.
- **`buildPyramid` is one uninterrupted synchronous pass over every sample**,
  and `pump()` yields only BETWEEN assets. Roughly 30ms for ten minutes of
  stereo, unmeasured on anything longer. Nothing checks whether playback is
  running before starting one, so a clip scrolled into view mid-playback can
  stall the thread that is decoding it. Chunking the pass is the fix, and it
  would reopen the identity window that `pump`'s "no re-check after the build"
  note relies on — the guard would have to come back with it.
- **"This file has no sound" and "the wave is still being worked out" are told
  apart by a dim line versus nothing at all.** That is a real distinction and
  it is announced properly (`clip-silent-note`), but the two DRAWINGS differ
  only in a hairline's colour, which is subtle at 18px. Named independently by
  the novice and a11y reviewers.
- **Nothing anywhere tells a first-time user what the wave IS.** No label, no
  tooltip, no word in the hint line or the status line — the canvas is
  `aria-hidden` and `pointer-events: none`, so it cannot even be hovered. Every
  editor does the same thing, which is not an argument that this one should.
  A product/copy call for the owner.
- **A clip trimmed into a silent passage of a source that has sound is visibly
  flat but says nothing.** `clip-silent-note` is per-ASSET ("this file has no
  audio track"), while the wave is per-CLIP and reflects its `[in, out)`. The
  cheap version of the missing half would be a per-clip "이 부분은 조용해요",
  which needs a rule for how quiet counts as quiet.
- **The wave band takes the bottom 42% of a clip**, so the picture that
  identifies the shot is now roughly the top half of an already small strip.
  This compounds the name-pill entry below rather than being independent of it.
- **`waveform.ts` and `thumbnails.ts` answer the same question twice** — a
  visible frame range and a pixels-per-frame in, a grid out — and each has its
  own three-field clip span (`ThumbSpan` / `WaveSpan`, structurally identical).
  That is the second case, not the third; `engine/thumbnails.ts`'s own header
  says to combine them when a third appears.
- The peak pyramid, its queue and its refusal map in `ui/waveform.ts` are three
  more module-level singletons of the same shape as the entry further down, and
  would need the same treatment to open two documents.
- **The "ask canRun, show the chord in `title`, dispatch via `perform`,
  `aria-disabled`" button is now one component** (`ui/CommandButton.tsx`,
  used by the toolbar, the zoom buttons and the subtitle panel). The
  palette's rows are `option`s in a listbox and still carry their own copy of
  the same four steps; a fourth surface is the trigger to fold them in too.
- **A subtitle with no words can sit on the timeline for ever.** "자막 넣기"
  makes an empty one and says 내용을 적어 주세요 once; nothing says it again,
  and the chip just reads 내용 없음. Harmless (never drawn, never exported)
  but clutter. A cheap nudge would be the status line on export.
- **A paste into a subtitle splits it, and the split is silent.** The tail
  is a new subtitle with the same words (`splitSubtitleAt`, wired into
  `clip.paste`); the status line still says only where the clip landed. The
  owner chose splitting over stretching or leaving it, after seeing both
  halves of the alternative on a real frame. A word about the split in the
  paste's `done` sentence is the obvious next touch.
- **Two drag gestures, one per kind of thing** — `Timeline.tsx` for clips and
  `SubtitleLane.tsx` for subtitles, with the same ~120 lines of pointer
  handling around shared engine arithmetic. The third draggable thing OF
  THAT SHAPE (threshold, plan, commit at release) is the trigger to extract
  the DOM half. The stage's pair of another shape — the picture's pan and
  the words (ADR-0019): pointer capture, a coalesced command per move —
  shares `ui/useStageDrag.ts` since 2026-09-16 (E10 step 1); the timeline
  pair is still two copies, and its trigger is still a third timeline
  drag.
- **Delete on a subtitle chip is a key the component handles itself**, not a
  binding (`SubtitleLane.onChipKey`). The keymap binds a chord to ONE action
  and Delete belongs to `clip.deleteRipple`; so this is exactly the shape E6
  removed from the clips. Fine until someone rebinds Delete and finds the
  chip did not follow.
- **Subtitles have no one-frame nudge.** A clip has six; a subtitle is timed
  by dragging or by parking the playhead and pressing one of the three
  재생 위치로 buttons. A keyboard user gets frame-exact results that way but
  needs the ruler for every step.
- **The subtitle font is whatever the browser resolves** from the stack in
  `subtitleRender.ts`. One browser previews and exports, so they agree with
  each other; another machine may wrap a line differently.
- `Track.type` still admits `'text'` and nothing creates one (subtitles are
  their own list, ADR-0011). Remove it when nothing saved can refer to it.
- `subtitle.add`'s last `disabledReason` branch ('지금은 쓸 수 없어요.') is
  unreachable given its `canRun`; it exists so the function total.
- **A disabled control's reason is reachable only by pressing it.** It lives in
  `title` (mouse hover) and in `setStatus` on the click of an `aria-disabled`
  button. That is the app-wide convention, not new — but a screen-reader user
  has to activate a control that says it cannot run in order to hear why.
- **Zoom announces itself mid-drag before anything moves.** A drag freezes the
  scale for the gesture, so `=` pressed with the pointer down says
  "타임라인을 크게 봤어요" while the strip does not change until release.
- **`ticks()` has no absolute cap on the marks it builds.** The bound is proven
  for any real document (visible range ÷ a step from the ladder), but a
  corrupted project with an absurd `total` would generate spans in proportion.
- **The timeline has no independent pan.** A keyboard user scrolls it only by
  moving the playhead or tabbing to a clip; there is no "scroll the view without
  moving anything" control. Fine while every state has a clip and a ruler in it.
- **There is no cue in the strip itself that content continues off-screen** —
  only the native scrollbar. Zoom re-centres and the playhead auto-scrolls, so
  the app's own controls never strand you; a manual scroll can.

- **A thumbnail slot can be up to twice as wide as the picture it holds.** The
  step is a power of two in FRAMES (that is what makes a zoom step reuse half
  the cache), so a slot is between `THUMB_PX` and `2 × THUMB_PX` wide while a
  16:9 frame at clip height is ~74px. The draw is cover-fit, so the widest
  slots crop the frame vertically by up to half. Honest but not pretty; the fix
  is a pitch decoupled from the cache grid, which is a redesign of
  `thumbStrip`'s contract.
- **The clip's name pill covers part of its first thumbnail** — the one picture
  that identifies the clip. The pill is text-height, so the top and bottom of
  that frame still show, but the middle band is hidden.
- **A clip decoding its pictures and a clip whose file is gone are told apart by
  the ⚠ and the hatched fill, and by nothing else.** There is no "still
  loading" affordance: a slow machine shows a plain clip filling in tile by
  tile, with no spinner and no word. It resolves on its own and never blocks.
- **`QUEUE_LIMIT` is global and trimmed FIFO while the queue drains LIFO.** With
  many small clips visible at once their combined slot count can pass 32, and
  the trim then drops the earliest-requested clip's slots even though none of
  them are stale. It self-corrects on the next render, but the first clips in
  DOM order can visibly lag the later ones — the opposite of what the module's
  own comment promises.
- **`.clip-name`'s pill is AA but not AAA over the brightest possible footage**
  (≈6.9:1 against pure white). It is the one place in the stylesheet whose
  effective background is not a design token but whatever the video contains.
  `.clip-mark` and `.clip-name` also carry their colour and their contrast
  treatment in two separate, non-adjacent CSS blocks.
- The thumbnail cache, its decode queue, its refusal set and its listener set in
  `ui/thumbnails.ts` are four more module-level singletons of the same shape as
  the entry below, and would need the same treatment to open two documents.
- The `Editor` instance is a module singleton in `store/projectStore.ts`. Fine for
  one document; move to React context if we ever open several projects at once.
  `mediaRepo` and the media work queue in `ui/media.ts` are the same shape and
  would need the same treatment.
- **`opfsKey` is written by two different paths.** A first import folds it into
  the asset inside `Editor.importAsset` — a hand-written method that builds its
  own patch instead of being a registry `Command` (this predates ADR-0009) — and
  a re-link writes it through the `asset.attachMedia` command. Both are
  invertible, but "record where the file went" exists twice, and a refactor of
  `importAsset` could quietly drop one.
- `registry.setDecodeService` silently overwrites an existing service for the
  same asset without releasing the old one. Nothing leaks a WebCodecs handle
  (the service holds samples and a config, not a live decoder), but two full
  sample sets briefly coexist if it ever happens.
- The media panel's asset rows run identity and state together in one string
  ("⚠ movie.mp4 다시 선택 필요"), with no structural separation for a screen
  reader. Pre-existing; the restore state extended it.
- Media is stored per browser profile, not per project or per account. Nothing
  shares it between devices — that is the `srcUrl` half of ADR-0004, still
  unbuilt.
- **The eviction hint carries no `⚠`**, unlike the incomplete-read warning in
  the same status-line builder. It matches its real sibling (`NOT_KEPT`, the
  other media-storage sentence, which has no icon either) and the owner asked
  for a quiet line — but it is the most consequential sentence on that line and
  the least visually distinguished. Revisit if anyone reports missing it.
- **The persistence answer is asked once per page load and never re-asked.** If
  the origin earns persistence mid-session (the tab gets bookmarked, engagement
  crosses a threshold), a later import in that same session would still warn.
  One extra true-ish sentence, and a reload fixes it; not worth polling for.
- Playback restarts a decoder at every cut (a new `PlaybackSession` per clip).
  Warm-decoder reuse + proxy media + a frame cache are the planned fix.
- Audio uses `decodeAudioData` on the whole file (simple, but holds the decoded
  track in memory). Fine for short clips; revisit for long files.
- AAC encoder delay (priming) is left to the muxer — verify A/V sync on real
  footage before trusting it for long exports.
- Export runs on the main thread (yields between frames). RUNBOOK calls for a
  Worker + OffscreenCanvas — not done yet. **This is probably worse than it
  looks:** the yield is `setTimeout(…, 0)` (`exporter.ts:312,317`), and Chrome
  clamps timers in a hidden tab to one per second — then to one per _minute_
  after five minutes hidden, silent and without WebRTC, which is exactly what an
  export is. Playback already handles being hidden (`visibilitychange` pauses
  it); export does not. **Not measured yet** — one export with the tab in the
  background settles it.
- No golden-file byte comparison for export output yet; e2e asserts frame count
  and duration, and the pure parts are unit-tested.
- Rotation metadata is still ignored, so a rotated source renders sideways in
  both preview and export (consistent, but wrong).
- **A/V sync assumes the audio track has no presentation offset of its own.**
  ADR-0008 rebases every track to its own first sample. That is right when the
  video's offset is reorder delay and the audio's is zero — the shape that
  produced the defect — but nothing verifies it. If a file's audio genuinely
  starts later in its own container, both tracks are zeroed anyway and drift
  apart by the difference, uniformly and with no warning. The audio pipeline
  cannot even see it: `decodeAudioData` never goes through demux, and
  `decodeAudioTrack` concatenates decoded PCM in callback order, ignoring `cts`.
  No fixture of that shape exists to fix against.
- **The edit list (`elst`) is still not read.** `min(cts)` gives the same answer
  for the reorder-delay case, but a file that expresses a trim as an edit is
  treated as if the trimmed material were still there.
- **A project saved before ADR-0008 shifts when its media is re-linked.** The
  status line says so (the asset has no recorded `startOffsetSec`), but there is
  no migration and no way to re-cut automatically. The warning no longer repeats
  — ADR-0009's `asset.attachMedia` writes the offset into the asset — but the
  cuts themselves are still where the old mapping put them.
- The keymap has no presets (Premiere / Final Cut style) and no import/export —
  it is per-browser `localStorage` only, so a new machine starts from defaults.
- The palette filters by plain substring on the label. No fuzzy match, no
  initials, no recently-used ordering.
- A paste always lands on the video track, and the insert point snaps to a clip
  boundary rather than splitting. "Paste attributes" (E6's fourth item) is not
  built — there are no clip attributes to paste yet.
- `clip.copy` / `clip.cut` are app actions, so unlike every editor command they
  are not testable in Node; their coverage is the e2e spec, which self-skips on
  bundled Chromium (no H.264).
- The nudge labels say "프레임", which is jargon for a first-time user, and the
  nudges have no toolbar button to anchor the idea to.
- The shortcuts panel is a flat ~21-row list with no grouping, and its "없애기"
  (unbind) and "처음으로" (restore the default) buttons are adjacent and one word
  apart in meaning.
- The "명령 찾기" toolbar button uses `⌘` as its icon on what is a Windows-first
  audience. The binding text itself is localised correctly (`Ctrl+K`).
- Toolbar buttons carry their binding only in `title`; the timeline hint shows
  `<kbd>` text permanently. Now that bindings are user-editable, the toolbar
  should probably show them too.
- Export is not in the command palette (it lives in `ExportButton`, not the
  registry), so the palette does not in fact list everything the editor can do.
- A keymap override for an action id that no longer exists is ignored but never
  cleaned out of `localStorage`, and nothing reports it.
- `drag.ts` uses `Number.MAX_SAFE_INTEGER` where `clipboard.ts` uses
  `Number.POSITIVE_INFINITY` for the same "no clip to the right" sentinel.
- `AppAction` and `Command` repeat five field names (`label`, `icon`,
  `defaultKey`, `canRun`, `disabledReason`) with no shared base type. If a third
  bindable kind ever appears, that is the rule-of-three trigger to extract one.
- Dragging still freezes the timeline scale for the gesture — but only because
  a FITTED scale follows the window, and a resize mid-drag would move it under
  the pointer. The overshoot half of this item is fixed (ADR-0010): a clip
  dragged past the end now widens the scrolled content instead of being pinned
  to the edge.
- Trim/move drags are single-track only; there is one video track, so this is not
  yet a limitation — it becomes one the moment a second track exists.
- The keyboard nudge step is one frame with no coarse alternative. `Q`/`W` cover
  "go exactly here"; a next-snap-target jump is still missing. (The six nudges
  are rebindable now, but a bigger step is a different command, not a binding.)
- The drag readout sits in the track header, not next to the pointer.
- Deleting or splitting restores focus to a neighbouring clip only when focus
  fell to `<body>`; a more precise roving-focus model is still owed.
- Selecting a clip with Enter parks the playhead on its first frame, where `Q`/`W`
  cannot run. The refusal is now announced, but the flow still needs a step the
  user has to work out (move the playhead first).
- A clip can be moved past the end of the timeline, which lengthens the document
  and exports the new empty space as black. The drag readout warns ("앞에 빈 곳이
  생겨요"), but there is no hard limit and no snap-back.
- `ExportButton` still uses native `disabled`, so its reason ("영상 파일을 다시
  선택한 뒤…") is unreachable by keyboard. The rest of the toolbar moved to
  `aria-disabled`.
