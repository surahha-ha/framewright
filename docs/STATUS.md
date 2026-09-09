# STATUS — the live handoff

**This file is the handoff.** It is rewritten at the end of every unit of work,
by whoever did the work, before they report anything to the owner.

Write it for a reader with **zero memory of any conversation**. No "as
discussed", no "the fix we talked about", no pronoun pointing at chat history.
If it is not in a file in this repo, it does not exist — chat context dies, the
repo does not.

<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->

**Last verified:** 2026-09-09 02:31 UTC — `npm run verify` **GREEN**

- unit 462 passed · e2e 96 passed

<!-- VERIFY:END -->

## Where we are

**E7's second item, fades (the transitions), is built, gate-green and
committed as `4f970f8`** (one commit, `CLAUDE.md` included). Not pushed:
`origin/main` is at `8ff129d` (the subtitles unit, pushed 2026-09-09 with
the owner's approval). Everything below is in that commit.

### What is new

- **`src/engine/types.ts`** — `Clip.fadeIn?` / `Clip.fadeOut?`, frames,
  absent for a hard cut. Nothing else is stored; ADR-0012 says why.
- **`src/engine/ops.ts`** — `updateClip` drops `undefined` fields, so undo
  leaves no `fadeIn: undefined` key (persistence round-trip equality).
- **`src/engine/fades.ts`** (new, 26 unit tests) — `effectiveFades` (clamp
  to the clip, head first), `fadeLimit`, `fadePartner` (butted neighbour
  unless it softens the same cut, else black), `blendAt` (the second picture
  and its weight per frame), `fadeIntoText`, `fadeShortenedText`,
  `describeFade`, `fadeSecondsText` ("0.5초"), `DEFAULT_FADE_SEC` 0.5,
  `FADE_CHOICES_SEC` [0.3, 0.5, 1, 2].
- **`src/engine/fadeCommands.ts`** (new, 10 dispatcher tests) —
  `clip.fadeIn` / `clip.fadeOut`: no args = toggle the selected clip's edge
  with the default; `{ clipId?, frames }` = set (0 = off). `hidden` (panel and
  palette, not the toolbar). `Command.done` now receives the command's
  `args` as a third parameter (`commands.ts`, `projectStore.run`).
- **`src/engine/commands.ts`** — `clip.split` keeps the head's fade-in and
  the tail's fade-out, written at what each piece can hold, and says
  "서서히 구간도 나뉘어 짧아졌어요" when the cut fell inside a fade;
  `clip.paste` carries fades from the clipboard (`clipboard.ts` entry).
- **`src/engine/exportPlan.ts`** — `ExportFrame.blend`.
- **`src/engine/audioSchedule.ts`** — `AudioSegment.gain` (linear ramp
  points, timeline-relative, may be negative), neighbour overhang under a
  fade-in and pre-roll under a fade-out, `gainAt`, `scheduleGain`;
  `audioPlayer.ts` and `audio.ts`'s offline render put it on a `GainNode`.
- **`src/engine/feeds.ts`** (new, 9 tests) — `FeedPool`: the decoder
  sessions behind a frame, the "continue or re-cue" rule (`isContinuous`)
  in one place, two sessions through a dissolve, a feed keeps its newest
  `VideoFrame` and closes it itself.
- **`src/engine/compose.ts`** (new, 5 tests) — `composeFrame`: black,
  footage letterboxed into the box, blend at its weight, words. Used by the
  exporter and the preview. **The preview canvas is now the TIMELINE's
  size**, which retires the overlay-aspect debt entry.
- **`src/engine/exporter.ts`** — uses the pool and `composeFrame`; a missing
  blend picture counts in `missingFrames`.
- **`src/ui/Preview.tsx`** — playback and scrub through the pool; a
  neighbour's decoder with no picture yet leaves the blend out (no black
  flash); a cold primary keeps the last picture.
- **`src/ui/ClipPanel.tsx`** (new) — the "클립" sidebar panel: name, range,
  two toggles (`CommandButton` with `aria-pressed` and `aria-describedby`),
  a length `<select>` per edge while it is on, a note per edge (what it
  goes to / why it is off / that it was cut short) with an id the controls
  point at. `Edge` is a module-level component — inside the panel it
  remounted on every click and dropped focus.
- **`src/ui/Timeline.tsx`** — `.clip-fade.in/.out` ramps inside the clip,
  and a per-clip sr-only `clip-fade-<id>` in the clip's `aria-describedby`.
- **`src/ui/useShortcuts.ts`** — a `<select>` owns every unmodified key
  (Delete on the length list used to ripple-delete the clip).
- **`src/ui/CommandButton.tsx`** — `pressed`, `describedBy` props.
- Docs: ADR-0012, seven DOM-contract rows in `docs/TESTING.md`,
  `docs/HANDOVER.md` progress, seven new entries in `CLAUDE.md` "Known tech
  debt", one entry there resolved (overlay aspect).
- Tests: unit 398 → 462, e2e 90 → 96 (`e2e/fades.spec.ts`, 6 scenarios).

### Decisions a future session would otherwise get wrong

1. **A fade is an edge of a clip, and the partner is derived.** Do not add a
   transition object at a cut, and do not centre a fade on the cut: edge-
   anchored needs one file's overhang, centred needs both (ADR-0012).
2. **Both edges softening one cut = a dip through black.** `fadePartner`
   returns black when the neighbour fades the same cut. Otherwise a's
   picture would go dark on its last frame and come back at full strength
   as the overhang under b.
3. **The neighbour's picture beyond its edge is held, never invented.**
   `blendAt` clamps to the file's last frame (or the clip's own last frame
   when the file is unmeasured). Two whole files butted together dissolve
   from a held frame, on purpose.
4. **Fades are clamped when read; only `clip.split` writes a clamped value.**
   A trim never rewrites a fade — lengthen the clip again and it is back.
5. **The audio pre-roll ramp runs over the pre-roll the file HAS**, not the
   picture's full fade, and there is no ramp at all when the file has none —
   a ramp anchored at the picture's fade start put the first audible sample
   at 70% (QA finding).
6. **The preview never draws black in place of a neighbour's picture that
   has not arrived**; it leaves the blend out for those frames. Black as the
   partner (the plan asked for it) is drawn. Export waits instead.
7. **`Command.done(before, after, args)`** — the third argument exists
   because "asked 2초, got 1초" is only knowable from the panel's call.
8. **The "shortened" sentence blames the right thing.** When the other
   edge's fade took the room it says so (`뒷부분의 서서히 사라지기와 겹치지
않게 1초로 줄였어요`); only a genuinely short clip gets `클립이 짧아`.

### What the persona round found, and what was done

Four reviewers (guardrail, QA, a11y, novice). **One blocker, fixed**: a
split inside a fade silently steepened the ramp (QA) → each piece is written
at what it holds and the split's sentence says so; unit test. **Majors, all
fixed**: preview flashed black at the start of every dissolve (QA); audio
popped in at 70% when the pre-roll was shorter than the fade (QA);
`missingFrames` ignored a missing blend picture (QA); the `<select>` let
Delete/c/q/w through to the editor (a11y); the panel's note was not tied to
any control (a11y); "클립이 짧아" blamed the clip when the other fade took
the room (novice). Minors fixed: exporter drew after `pool.end()` (now
before, like the preview); the "into" sentence lived in two files (now
`fadeIntoText`); a same-feed-twice-per-frame test was missing. Everything
not fixed is in `CLAUDE.md` "Known tech debt".

### What the browser found

Visual QA ran in the owner's Chrome (deviceId `da2a0786-…`, approved
2026-09-09) on the project the browser had kept (three clips of the fixture,
two subtitles). The tab was `visibility: hidden` for most of the pass — the
owner's window was behind another — so playback (which pauses on hidden, by
design) could not be watched and screenshots timed out intermittently;
everything static was checked: the panel, the toggles' pressed state, the
length select, the notes, the marks' widths (199px for 15 frames at the
strip's scale), frame 0 fully black (brightness 0), frame 5 dimmed (0.157),
the status sentences including the clamp sentence, undo ×3 restoring the
document exactly. **One thing only the eye caught, not fixed**: the fade
mark's dark ramp reads for its first third and the teal diagonal is thin over
the rainbow fixture — recorded as tech debt, not a defect. The owner's
document was left as found (three undos, verified 0 marks).

## Next single step

**Push (owner's call), then E7 item 3: audio volume.** Before designing
it, read `src/engine/audioSchedule.ts` (gain points already exist per
segment — a per-clip volume is a third source of gain to fold into the same
ramp list) and `src/ui/ClipPanel.tsx` (the natural home for a volume control,
next to the fades).

## Blocked / needs the owner

1. **Push.** `4f970f8` (fades) and the docs commit after it are local
   only; the owner decides when.
2. **Playback through a dissolve was not watched by eye** (hidden tab). The
   e2e reads pixels frame by frame while paused, and the pool's behaviour is
   unit-tested; the real-time look of a dissolve on real footage is still
   the owner's to judge. Two whole files butted (a held-frame dissolve) is the
   case worth looking at first.
3. **Product calls surfaced by this unit:** is a dip through black the
   right answer when both edges of a cut are softened, or should the second
   toggle warn? Is 0.5초 the right default? Should the fade mark carry a
   bar along its extent (tech debt entry)?
4. **Unchanged and still open** from earlier units: the quiet-source
   waveform reads as a thick line; nothing explains what the wave is;
   thumbnail slots can be twice their picture's width; the `m:ss` ruler
   label; `MAX_SCALE = 40`; the AWS deployment direction.
