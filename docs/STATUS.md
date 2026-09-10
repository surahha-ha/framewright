# STATUS — the live handoff

**This file is the handoff.** It is rewritten at the end of every unit of work,
by whoever did the work, before they report anything to the owner.

Write it for a reader with **zero memory of any conversation**. No "as
discussed", no "the fix we talked about", no pronoun pointing at chat history.
If it is not in a file in this repo, it does not exist — chat context dies, the
repo does not.

<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->

**Last verified:** 2026-09-10 09:06 UTC — `npm run verify` **GREEN**

- unit 541 passed · e2e 106 passed

<!-- VERIFY:END -->

## Where we are

**E7's fourth item, a clip's picture (zoom, pan, quarter turns), is
committed as `fc6ff59`** (2026-09-10, with the owner's approval) and
pushed with this file's update. **E7 is complete**: subtitles (ADR-0011),
fades (ADR-0012), sound (ADR-0013), picture (ADR-0014). Before it on
`main`: the sound unit `f04858f`, its ceiling follow-up `ba74880`.

How it got here, because it explains the shape of this file: the session
that built the unit ran its persona round, stamped a green gate (unit 531 ·
e2e 106, 2026-09-10 16:52 KST), then kept fixing review findings in six
files for another ten minutes and was cut off mid-turn — no STATUS rewrite,
no commit, and an e2e run it had started never finished (the two retained
`test-results/` failures from that run both say "timeout while setting up
page": a killed run, not a product defect). The following session
verified the tree as it stands (the stamp above is that run) and wrote
this file. The persona findings are therefore reconstructed from what the
previous session did record — ADR-0014's Context/Decision and the five new
"Known tech debt" entries in `CLAUDE.md` — not from its chat.

### What is new

- **`src/engine/types.ts`** — `Clip.zoom?` (a multiple of the fit, 1–4),
  `Clip.panX?` / `panY?` (fractions of the BOX the picture is moved
  right / down, −0.5..0.5), `Clip.rotation?: 90 | 180 | 270` (clockwise
  quarter turns). All absent = as shot. ADR-0014 says why these four and
  not a matrix.
- **`src/engine/picture.ts`** (new, 14 unit tests) — `pictureTransform`
  (the one reader: clamped and defaulted; a value outside the range is read
  at the edge, never rewritten), `pictureRect` (the one place that says
  where the picture is drawn: the turned footprint fitted into the box,
  grown `zoom` times about the box's centre, moved by pan × zoom),
  `coversBox` (whether a side of the box has gone black), `nextRotation`,
  `roundZoom` / `roundPan` (whole percent, no −0), `isAsShot`, and the
  sentences (`describeZoom`, `describePan` with a direction word,
  `describeRotation`, `pictureNoteText` "화면 200% · 90° 회전 · 위치
  옮김"). `ZOOM_MAX` 4, `ZOOM_STEP_PERCENT` 10, `PAN_LIMIT` 0.5.
- **`src/engine/pictureCommands.ts`** (new, 7 dispatcher tests) —
  `clip.rotate` (a quarter on, or an exact turn; default key `r`; hidden
  from the toolbar, in the palette), `clip.pictureReset` (everything back;
  in the palette; `aria-disabled` with "화면이 이미 찍은 그대로예요" when
  as shot), `clip.zoom` and `clip.pan` (`requiresArgs`: no palette row, no
  shortcut row; the panel's sliders and the preview drag are their only
  callers). A field at its default is written as no field.
- **`src/engine/compose.ts`** — `drawPicture`: the unturned case goes
  through the same `drawImage` call it always did; a turn saves the
  context, translates to the picture's centre and rotates.
  `composeFrame(…, transform = AS_SHOT)` draws the footage where its clip
  puts it and the other side of a dissolve where ITS clip puts it
  (`Blend.transform`). `FrameContext` gained `translate` / `rotate`.
- **`src/engine/exportPlan.ts` / `exporter.ts`** — `ExportFrame.transform`
  and `Blend.transform`, present only when the clip is not as shot, so the
  plan holds one answer per frame for both surfaces.
- **`src/engine/fades.ts`** — the partner (the dissolve's second picture)
  carries its clip's transform.
- **`src/engine/clipboard.ts`** — `carriedFields()` grew from four to eight
  fields; copy, paste and the tail of a split carry the picture with the
  sound and the fades. **`commands.ts`** registers `PICTURE_COMMANDS`.
- **`src/ui/ClipPanel.tsx`** — a "화면" `<h3>` block: sliders "확대"
  (100–400, step 10), "가로 위치" and "세로 위치" (−50..50) with
  `aria-valuetext` in words (오른쪽으로 50%), each notch a `clip.zoom` /
  `clip.pan` dispatch with coalesce key `zoom:<id>` / `pan:<id>`; the
  buttons 화면 돌리기 and 화면 원래대로 as `CommandButton`s; one note
  sentence `#clip-picture-note` ("찍은 그대로 보여요", or the summary,
  plus " · 화면 한쪽이 비어요" when `coversBox` is false).
- **`src/ui/Preview.tsx`** — `paint()` takes the clip's transform; the
  stage carries `.movable` while the SELECTED clip is the one under the
  playhead, and a pointer drag on it dispatches `clip.pan` (pixels over
  the canvas's CSS size, divided by the zoom) under one coalesce key, so a
  drag is one undo step. A press while a different clip is under the
  playhead selects that clip and says "지금 보이는 클립을 골랐어요 · 다시
  끌면 화면이 옮겨져요." — it does not move anything.
- **`src/ui/Timeline.tsx`** — `.clip-picture-mark` pill after the name
  (🔍 zoomed, ↻ turned, ✥ moved, in that order) and sr-only
  `clip-picture-<id>` in the clip's `aria-describedby`.
- **`src/styles.css`** — the panel block, the pill, `.stage.movable`
  (`cursor: move`).
- Docs: ADR-0014 (+ the README row), `docs/HANDOVER.md` progress, six new
  DOM-contract rows in `docs/TESTING.md`, five "Known tech debt" entries in
  `CLAUDE.md`.
- **`src/engine/commands.ts`** — `asset.attachMedia` also records
  `width` / `height` (the re-link path in `MediaBin.tsx` passes the
  demuxer's), so a same-named file of another shape moves the picture's
  pan limits with it; undo removes a size the asset never had.
- Tests: unit 507 → 541 (the last eight are the pan limit's: `panLimits`,
  the draw-time clamp, `panLimitText`, the clamped pan, the turn that
  pulls a pan in, the re-link's size); `e2e/picture.spec.ts` (4 scenarios: a quarter turn
  leaves black at both sides + mark + words + undo; `R` and the palette
  list the turn and the reset but not the sliders; zoom grows, pan moves,
  reset puts all back in one step; a preview drag is one undo step). All
  four RAN in the stamped run (106 passed, 0 skipped) — the `supportsH264`
  guard at their top only skips on a Chromium build without H.264, and
  this machine's has it. `e2e/volume.spec.ts`'s ceiling scenario now records
  every status sentence with a `MutationObserver` instead of asserting the
  last one, because the zoom's own sentence races it.

### Decisions a future session would otherwise get wrong

1. **Pan is a fraction of the BOX, not of the picture, and it scales with
   the zoom.** So "half a screen right" means the same thing at every zoom,
   a drag is one division from it, the point at the box's centre stays put
   when the zoom changes, and the pan's limit is where the picture's own
   edge reaches the centre — every part reachable, picture always at the
   centre. **That limit is per axis and per picture** (`panLimits`): half a
   box for a picture that fills the axis, less for a narrower one (15% for
   a 16:9 stood up). A flat half box for every picture was the first
   version, and it emptied the box for a turned clip (see "What the
   browser found"). The first version also grew about the shot's original
   centre (QA: a framed subject slid away on zoom).
2. **A quarter turn swaps the fitted sides** (`pictureRect` fits the turned
   footprint), so a 16:9 clip turned 90° stands in the box with black at
   both sides — the e2e's first assertion.
3. **The drag moves the SELECTED clip, only while it is under the
   playhead.** The first version moved whatever was under the playhead and
   reselected silently — the novice reviewer's blocker: the panel showed
   one clip's numbers while another changed.
4. **One word, 화면.** 확대 / 화면 돌리기 / 화면 원래대로 / 화면 위치
   바꾸기 and every sentence. Neither 그림 nor a second 크기 under 소리
   크기 (both novice findings). A pan is said with its direction, never as
   a signed number.
5. **`pictureRect` is the one rectangle; nothing else computes where the
   picture goes.** The strip's thumbnails do not use it yet (debt), and a
   future crop or safe-area feature must go through it too.
6. **`carriedFields` is the one place** that copies a clip's optional
   fields. Add the next one there (unchanged rule from the sound unit).

### What the persona round found (reconstructed, see above)

Blockers, fixed before the previous session ended: the drag moving an
unselected clip (novice) → selection first, decision 3; zoom growing about
the shot's centre (QA) → about the box's centre, decision 1; a pan that
could empty the box (novice) → `PAN_LIMIT` 0.5 with the pan scaling, plus
the 화면 한쪽이 비어요 note. Wording (novice): 그림 → 화면, 크기 → 확대.
Recorded as debt in `CLAUDE.md` rather than fixed: the strip's thumbnails
ignore the transform; zoom crops silently; a focused slider swallows `R`
(QA); the stage's drag has no signal for assistive tech (a11y); `Preview`
resolves the clip under the playhead on every render (guardrail). Whether
that list is complete cannot be known from the files; a fresh persona pass
on the diff is cheap insurance before E8 starts, and is listed under
"needs the owner" only because it costs their tokens.

### The persona round on the pan-limit fix

Three reviewers (QA, a11y, novice) read the fix's diff. **No blocker.**
Majors, all fixed in this tree: the limit sentence described BOTH pan
sliders while naming only the limited axis, so the free slider was told
it stops at 15% (a11y) → only the limited axis's slider carries
`clip-picture-limit`, with an e2e assertion on the other's
`aria-describedby`; "상자" was a word nothing on screen is called (novice)
→ the sentence now shares the turn's "보이는 범위" ("가로로는 15%까지만
옮길 수 있어요 · 더 가면 화면이 보이는 범위를 벗어나요"); a same-named
re-link to a file of another shape froze `meta.width/height`, so the
panel's limit and the draw's limit could disagree for ever (QA) →
`asset.attachMedia` now records `width`/`height` (the re-link path has
them from the demuxer), undo removes a size the asset never had, unit
test in `attachMedia.test.ts`. Minors are in `CLAUDE.md` "Known tech
debt" (the turn's own black sides unsaid; three phrasings for one fact;
the notes' placement; a limit that rounds to 0%; the drag detaching past
the limit).

### What the gate found

The follow-up session's run is the stamp above. Before it: `check:refs` 0,
`typecheck` 0, unit 533 (17:25 KST). The two `test-results/` folders from
the killed run (editor.spec re-link, fades.spec frame 7) both failed on
page setup, not on an assertion.

### What the browser found — and the fix it forced

Visual QA ran in the owner's Chrome (deviceId `da2a0786-…`, approved
2026-09-10; loopback confirmed by `netstat`, screenshots came through
although the tab reported `visibility: hidden`) on the project the browser
had kept (seven clips of the fixture, two subtitles), against the dev
server that was already up on 9990.

- The "화면" block sits under "소리", below the fold at 964px window
  height; scrolled into view, nothing is clipped. Sliders read 확대 100–400
  step 10, 가로/세로 위치 ±50 step 5; 화면 원래대로 is `aria-disabled` as shot.
- `R` on the selected clip: the picture stands up with black at both
  sides (column brightness 0 / 0.48 / 0), the burnt-in timecode moves from
  top-left to top-right (clockwise, as ADR-0014 says), status "화면을 90°
  돌렸어요.", the ↻ pill after the name (16×16px, legible), description
  "90° 회전", the document holds `rotation: 90`.
- 확대 to 200% by keyboard: status, pill 🔍↻, note "화면 200% · 90° 회전",
  the picture fills the box's height.
- **BLOCKER, found here, fixed in this tree: 가로 위치 to 50% made the
  preview entirely black** under the note "화면 한쪽이 비어요". The stood-up
  picture is 101 of 320 box pixels wide; a half-box pan (the flat
  `PAN_LIMIT`) carried it clear out. This is the novice reviewer's blocker
  from the persona round ("a pan that could push the whole picture out")
  coming back for every picture narrower than the box — a turned one, a
  4:3 in 16:9 — because the limit was written for a picture that fills the
  box's width. The e2e had panned only the unturned 16:9 fixture.
- **The fix (ADR-0014, amended):** `panLimits` in `picture.ts` — per axis,
  half the fitted footprint's share of the box, at most 0.5, rounded down
  to a 5% notch (stood-up 16:9: 15% sideways, 50% up/down; 4:3: 35%).
  `clipPanLimits(project, clip, rotation?)` reads `asset.meta.width/height`
  and `timeline.width/height`. `clip.pan` clamps to it; `clip.rotate`
  computes the limit for the turn it is about to make, pulls the pan
  inside in the same patch (one undo restores both) and says "· 위치는
  보이는 범위 안으로 맞췄어요."; the sliders end at it and a second sentence
  `#clip-picture-limit` says why (both pan sliders described by it, after
  the note); a stored pan past the limit is drawn AND shown at the limit,
  never rewritten (the sound ceiling's rule). Seen working in the same
  Chrome: the stored 50% read at 15%, the picture back at the centre-right,
  the slider `max` 15 with the sentence under it.
- Every visual finding ships with an assertion: the quarter-turn e2e now
  checks the slider's `max` is 15, the limit sentence, and that at that
  limit the centre column still has picture; the zoom/pan/reset e2e
  expects the turn to pull 50% in to 15% and the undo to restore that,
  not the 50%.
- The pass ended by pressing 화면 원래대로 on the clip, so the owner's
  document is as it was — but **the auto snapshots made during the pass
  ("자동 저장" 17:49 / 17:50 in the "이전 상태" list) hold the turned /
  zoomed / panned states**; deleting them is the owner's call, as before.

**Not seen:** playback with a transformed clip (the tab was hidden, so
playback would have paused), a dissolve between two differently
transformed clips, an export of one. The e2e reads pixels for the first;
nothing has watched the file.

## Repository analysis memory — 2026-09-09

The owner asked to preserve the earlier repository analysis in
[REPO_ANALYSIS.md](REPO_ANALYSIS.md). It records the pre-fades inspection,
including version-history ID collisions and malformed-save acceptance reproduced
with in-memory storage, plus export cleanup and subtitle aspect-ratio concerns.
Its 398 unit / 90 e2e results belong to that earlier run, not the current tree.
Recheck each finding against the current code before acting. This memory entry
does not replace the implementation handoff or the next step below.

## Next single step

**Start E8: style presets and the shorts reframe.** Take the reframe
first: a 9:16 output of a 16:9 project is a `pictureRect` question — the
box changes shape and every clip's picture is placed in it through the
same one rectangle (`panLimits` already answers how far it may move in a
box of any shape) — so it exercises ADR-0014 while that design is fresh,
and it settles what "the box" is when the timeline's size is not the
first import's. Read ADR-0014 and `src/engine/picture.ts` first; the
presets come after, on top of whatever the reframe needs.

## Blocked / needs the owner

1. **Look at playback and an export with a transformed clip.** The visual
   pass saw only stills (the tab was hidden); a dissolve between two
   differently placed clips and an exported file with a turned clip have
   been seen by nothing but the unit tests' arithmetic.
2. **Listen, unchanged from the sound unit:** playback through a 50%
   clip, a mute mid-playback, a 200% clip.
3. **Auto snapshots from the two visual passes** (2026-09-10 15:25, 15:29,
   17:49, 17:50 in the browser's "이전 상태" list) hold the muted / 50% and
   the turned / zoomed / panned documents. Delete or keep.
4. **The turn's own black sides** (a stood-up clip shows black at both
   sides and nothing says so) — one clause on the turn's sentence; a
   product call on wording, listed in `CLAUDE.md` debt.
5. **Product calls still open:** should the fade edges get a heading now
   that 소리 and 화면 have one; should zoom say how many real pixels it is
   showing (the "zoom crops silently" debt); the fade mark over bright
   footage; the dip through black when both edges of a cut fade; the
   quiet-source waveform; the AWS deployment direction.
