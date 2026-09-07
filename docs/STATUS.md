# STATUS — the live handoff

**This file is the handoff.** It is rewritten at the end of every unit of work,
by whoever did the work, before they report anything to the owner.

Write it for a reader with **zero memory of any conversation**. No "as
discussed", no "the fix we talked about", no pronoun pointing at chat history.
If it is not in a file in this repo, it does not exist — chat context dies, the
repo does not.

<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->

**Last verified:** 2026-09-07 05:21 UTC — `npm run verify` **GREEN**

- unit 398 passed · e2e 90 passed

<!-- VERIFY:END -->

## Where we are

**E7's first item, subtitles, is built, gate-green and committed as
`9d4ee2b`.** Not pushed yet; `origin/main` is still at `c1c54e5`.

One oddity in the history, harmless but worth knowing: the owner committed
their harness guard (`f298f07`) from the same working tree while this unit was
being staged, and that commit carried `CLAUDE.md` — including this unit's
"Known tech debt" entries — plus the harness files. `9d4ee2b` therefore has
34 files and no `CLAUDE.md`. Every line is in `HEAD`; nothing is lost or
duplicated. Rewriting the two unpushed commits to separate them is possible
and was deliberately not done without the owner.

The two units before this one were epic C (clip thumbnails `78b656c`, audio
waveform `95a6d38`, handoff `c1c54e5`).

### What is new

- **`src/engine/types.ts`** — `Project.subtitles: Subtitle[]`. A subtitle is
  `{ id, text, startFrame, endFrame }`, half-open, sorted, never overlapping.
  It is NOT a clip; ADR-0011 says why.
- **`src/engine/ops.ts`** — `insertSubtitle` / `removeSubtitle` /
  `updateSubtitle`.
- **`src/engine/persistence.ts`** — `CURRENT_SCHEMA` 1 → 2; `upgradeProject`
  fills the list into older saves, on the live document and every version.
- **`src/engine/subtitles.ts`** (new, 27 unit tests) — where a new one goes
  (`subtitlePlan`), how far its edges may travel (`subtitleLimits`,
  `subtitleDragBounds`, `subtitleDragTargets`), how ripple edits move it
  (`rippleSubtitles`, `splitSubtitleAt`, `subtitleDiffOps`), text
  normalisation, the drag sentences (`describeSubtitleEdit`,
  `SUBTITLE_LIMIT_TEXT`).
- **`src/engine/subtitleCommands.ts`** (new, 17 dispatcher tests) —
  `subtitle.add` (toolbar, key `T`), `subtitle.setText`, `subtitle.remove`,
  `subtitle.move` / `trimStart` / `trimEnd` (drag), `subtitle.moveToPlayhead`
  / `startToPlayhead` / `endToPlayhead` (the keyboard's timing).
- **`src/engine/subtitleRender.ts`** (new, 8 unit tests) — ONE draw function
  for preview and export. Font, padding and margin are relative to the
  picture's height; the wrap/centre/stack arithmetic is separate from the
  canvas calls and tested with a fake measurer.
- **`src/engine/exportPlan.ts`** — every `ExportFrame` now carries
  `subtitle: string | null`. **`src/engine/exporter.ts`** — a `picture`
  canvas plus a composed output canvas, so a HOLD frame cannot keep words
  that have ended.
- **`src/engine/commands.ts`** — `clip.deleteRipple`, `clip.paste` and
  `timeline.closeGaps` now move the subtitles with the footage.
- **`src/engine/command.ts`** — `selectedSubtitleId`, one selection at a time.
- **`src/ui/SubtitleLane.tsx`** (new) — the lane under the clip strip, in the
  same scroll container at the same scale; chips with move/trim drag,
  Enter/Space selects, Delete removes.
- **`src/ui/SubtitlePanel.tsx`** (new) — the words (textarea; Enter or blur
  commits, Shift+Enter breaks a line, Escape reverts and says so), the time
  range, the three 재생 위치로 buttons and 자막 지우기.
- **`src/ui/CommandButton.tsx`** (new) — the one button that asks `canRun`,
  shows the chord, dispatches via `perform` and stays `aria-disabled`.
  Replaces `Toolbar.Button` and `Timeline.ZoomButton`.
- **`src/ui/Preview.tsx`** — an overlay canvas over the picture, sized to the
  timeline's dimensions and placed over the picture by script; drawn in a
  layout effect so the words land on the same paint as the frame; `role="img"`
  named by its words. The draft being typed is drawn too.
- **`src/store/projectStore.ts`** — `selectedSubtitleId`,
  `subtitleWordsWanted` (focus the field only when a command just CREATED a
  subtitle), `subtitleDraft` (what is being typed, drawn live and flushed
  into the document before any selection change).
- Docs: ADR-0011, six DOM-contract rows in `docs/TESTING.md`, one line in
  `docs/TESTING.md` "Operational facts" corrected (`outerWidth 0×0` is not a
  wrong-machine tell; `netstat` is), `docs/HANDOVER.md` progress, eleven new
  entries in `CLAUDE.md` "Known tech debt", one entry there resolved.
- Tests: unit 340 → 398, e2e 76 → 90 (`e2e/subtitles.spec.ts`, 14 scenarios).

### Decisions a future session would otherwise get wrong

1. **A subtitle is its own list, not a `text`-track clip.** Every consumer of
   `track.clips` reads `assetId`/`inFrame`/`outFrame`; a subtitle has none.
   `Track.type: 'text'` is still in the union, unused (ADR-0011).
2. **Captions follow the footage.** Ripple delete, paste-push and close-gaps
   call `rippleSubtitles`. A subtitle wholly inside a removed span is dropped
   (undoable); one straddling an edge keeps the surviving part; **one
   straddling a paste point is split** (`splitSubtitleAt`): the head keeps
   its id, the tail is `sub_<next>` with the same words and moves with the
   footage after the paste — neither half sits on the pasted frames. The
   owner chose this over "leave it" after watching frame 60 show the pasted
   clip under the old words and frame 105 show the old shot without them.
   `clip.move` and the trims do NOT ripple — they open gaps, they do not
   remove time.
3. **The words are committed on Enter/blur, one undo step per edit** — and
   because a chip or clip is selected on MOUSEDOWN, before the field's blur
   can run, the store's `select`/`selectSubtitle` flush the draft first.
4. **Focus goes into the words only on creation** (`subtitleWordsWanted`).
   "Text is empty" was the trigger for an afternoon; an undo of the words
   then pulled focus into the field, where Ctrl+Z was the browser's.
5. **"끝을 재생 위치로" sets `endFrame = playhead + 1`** — the playhead's frame
   is the last one shown. A clip's `W` does the opposite (the playhead frame
   is the first one cut); for a subtitle that would be a fencepost nobody
   can see.
6. **`SUBTITLE_LIMIT_TEXT` is a full copy of `LIMIT_TEXT`**, not a spread of
   it: `commands.ts` imports `subtitleCommands.ts` at load, so importing the
   table back is a cycle. `subtitles.test.ts` pins the shared sentences.
7. **Overlay = timeline dims, CSS-scaled onto the picture box.** Right for
   the file; slightly off on screen only when the footage's aspect differs
   from the timeline's (tech debt).

### What the persona round found, and what was done

Four reviewers (guardrail, QA, a11y, novice). **Four blockers, all fixed**:

1. **Ripple edits left every subtitle where it was** (QA) → decision 2, with
   unit and e2e coverage.
2. **Words typed and abandoned by clicking elsewhere were lost** (QA) →
   decision 3, e2e "words typed and then abandoned…".
3. **Deleting a subtitle stranded focus on `<body>`** (a11y) → focus moves to
   the neighbouring chip, or the ruler when none is left; e2e.
4. **No keyboard way to move a subtitle without changing its length**
   (a11y) → `subtitle.moveToPlayhead` ("자막 전체를 재생 위치로"), unit tests.

Majors fixed: the drag readout said 옆 클립 for a subtitle wall (now
옆 자막); typed words did not reach the picture until committed (now drawn
live); Escape discarded the draft silently (now announced); Enter-commits was
unexplained (a help line under the field); Delete-on-chip undocumented (track
hint + `aria-keyshortcuts`); `.subtitle.empty` contrast (now `--muted`).
Minors fixed: the chip's name carries `N프레임` like a clip's; `subtitleAt`
stops at the first later subtitle; the overlay draws in a layout effect.
Everything not fixed is in `CLAUDE.md` "Known tech debt".

### What the browser found

Visual QA ran in the owner's Chrome (approved by deviceId, `netstat` showed
the loopback pair). The whole flow was driven by hand: import, split at 45,
`T` at 30, "걸침", copy clip 1, paste at 45, then frames 60 and 105 read off
the burnt-in frame number — the paste-straddling behaviour reproduced exactly
as decision 2 describes (frame 60 shows the pasted clip's 15 with the words;
frame 105 shows the original 60 without them). Undo, a two-line subtitle
typed live, and a chip drag all behaved. No console errors.

Two things only the eye caught, both fixed and both now asserted:

- **The panel's time range wrapped inside a word** — "00:03:00까 / 지" — at
  the sidebar's 260px. `.subtitle-when` is now one fact per line,
  `white-space: nowrap`; e2e "the panel says when the subtitle runs without
  breaking a word in two" measures each line's height and overflow.
- **The textarea scrolled its first line out of sight** while a two-line
  subtitle was typed (`rows={2}` with a wrapping second line). Now `rows={3}`.

Left as seen: the panel pushes 이전 상태 below the fold of the sidebar (it
scrolls), and the help line under the field wraps once. Not defects.

## Next single step

**Push (owner's call), then E7 item 2: transitions.** Before
designing transitions, read `src/ui/ClipCanvas.tsx` (it draws pictures and the
wave; a transition mark is the third thing on that canvas and the trigger to
split its draw passes) and `src/engine/exportPlan.ts` (a transition is two
source frames per timeline frame, which `ExportFrame` cannot express yet).

## Blocked / needs the owner

1. **Push.** `f298f07` (harness) and `9d4ee2b` (subtitles) are local only.
   The owner decides whether to push as they are or first tidy the
   `CLAUDE.md` split described above. `bash.exe.stackdump` is still a crash
   artefact in the tree, untracked, safe to delete.
2. **Visual pass: done** (see "What the browser found"). One thing not
   looked at: the drag READOUT in the track head mid-drag — a scripted drag
   completes in one gesture, so the live sentence was never on screen.
3. **Product calls surfaced by this unit:** the straddling-paste question is
   decided (split — decision 2). Still open: is one look (white on a
   translucent pill, bottom-centred) enough for now? Should the paste's
   status line mention the split it made? ASR is deliberately not here —
   `docs/research/editor-pain-points.md` §7.
4. **Unchanged and still open** from epic C: the quiet-source waveform reads
   as a thick line; nothing explains what the wave is; thumbnail slots can be
   twice their picture's width; the `m:ss` ruler label; `MAX_SCALE = 40`;
   the AWS deployment direction (static hosting versus a backend — a project
   still does not follow the user to another machine).
