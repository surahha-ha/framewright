# STATUS — the live handoff

**This file is the handoff.** It is rewritten at the end of every unit of work,
by whoever did the work, before they report anything to the owner.

Write it for a reader with **zero memory of any conversation**. No "as
discussed", no "the fix we talked about", no pronoun pointing at chat history.
If it is not in a file in this repo, it does not exist — chat context dies, the
repo does not.

<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->

**Last verified:** 2026-09-10 07:06 UTC — `npm run verify` **GREEN**

- unit 507 passed · e2e 102 passed

<!-- VERIFY:END -->

## Where we are

**E7's third item, a clip's sound (volume and mute), is committed as
`f04858f` and pushed** (2026-09-10, with the owner's approval; it also
carries `docs/REPO_ANALYSIS.md` and the "Repository analysis memory"
section further down this file, both kept at the owner's request). **A
follow-up is in the working tree, gate-green and NOT yet committed: the
slider's ceiling from the clip's own peak** — see "The ceiling" below.
Everything else below is in `f04858f`.

### The ceiling (follow-up, uncommitted)

The owner asked what the clipping risk was, saw it reproduced on screen
(a demo overlay drawn into the page for that conversation only — not a
feature), and chose the automatic bound over a limiter or a user setting.

- **The claim that started it was wrong.** An export-qc reviewer said two
  clips at 200% through a dissolve sum to four times full scale. They sum
  to at most the louder clip's level: the two ramps add to 1 for every
  ramp shape `audioSchedule.ts` builds, pre-roll shorter than the fade
  included. So a bound on each clip bounds the whole mix, and no DSP is
  needed. CLAUDE.md's debt entry and ADR-0013 were corrected.
- **`src/engine/waveform.ts`** — `clipPeak(pyramid, inFrame, outFrame,
fps)`: the loudest |sample| over the clip's source range, finest level,
  whole buckets. **`src/engine/volume.ts`** — `volumeCeiling(peak)` =
  `max(1, min(2, 1/peak))` rounded down to a notch, unknown → 2;
  `ceilingText`; `audioNoteText(clip, heard?)`.
- **`buildAudioSchedule(project, start, ceiling?)`** takes a per-clip
  ceiling callback; `ExportOptions.levelCeiling` carries it into the
  export; `src/ui/waveform.ts`'s `clipCeiling(project, clip)` (from
  `getPeaks`, never builds) is what `Preview.tsx` and `ExportButton.tsx` pass.
- **The ceiling is measured over `audibleSourceRange`**, not the trim: a
  QA reviewer showed that a transient the trim cut away is still played,
  at the clip's level, as pre-roll or overhang under a neighbour's
  dissolve. `reach()` in `audioSchedule.ts` is now the one place that
  says how far a clip's sound extends; the schedule and `clipCeilingFor`
  both read it. (The reviewer's scenario is the unit test "measures the
  ceiling over everything a dissolve can play".)
- **`ClipPanel.tsx`** — the slider's `max` is the ceiling, its value is
  `min(stored, ceiling)`, a second sentence `#clip-sound-limit` ("이 클립은
  소리가 커서 110%까지만 키울 수 있어요") describes the slider alone, and
  the panel subscribes to the peaks. When the ceiling DROPS for the
  selected clip with no gesture (the peaks land, a trim moves the range)
  the status line says so — `describeCeiling`: "소리를 200%로 두었지만, 이
  클립은 소리가 커서 110%로 들려요." — because a slider whose end moves on
  its own reads as broken (novice) and a screen reader hears the note only
  on focus (a11y). **`Timeline.tsx`** — the pill and the wave show what is
  HEARD (`min(clipLevel, ceiling)`) and subscribe too.
- A stored level above the ceiling is heard, shown and described at the
  ceiling and never rewritten (the fade-under-a-trim rule).
- Persona round on the follow-up (QA, a11y, novice): one blocker (the
  range, above), two majors each from novice (the silent snap-back; "이
  구간" reading as a sub-range → "이 클립은") and a11y (the note not being
  live; `max` narrowing silently — both answered by the status sentence),
  one a11y minor (the limit described the mute button too → its own id).
- Tests: unit 496 → 507, e2e 101 → 102: the new scenario swaps the fixture's decoded
  sound for a loud one THROUGH THE APP'S OWN MODULE INSTANCE (found via
  `performance.getEntriesByType('resource')`, because a plain
  `import('/src/engine/audio.ts')` can be a second, empty instance under
  Vite HMR), then zooms — a clip canvas re-render is what asks for new
  peaks; a playhead move does not, because `ClipCanvas` is memoised.

### What is new

- **`src/engine/types.ts`** — `Clip.volume?` (linear gain, 1 = as
  recorded, absent = 1) and `Clip.muted?: true` (absent = heard; never
  `false`). ADR-0013 says why a mute is not "volume 0".
- **`src/engine/volume.ts`** (new, 14 unit tests) — `clipLevel` (0 when
  muted, else the clamped volume), `roundVolume` (whole percent),
  `volumePercent` / `percentToVolume` / `volumeText` ("95%"),
  `describeVolume` ("소리를 150%로 키웠어요." / "…줄였어요." / "원래 크기로
  되돌렸어요."), `describeMute`, `audioNoteText` ("소리 끔" / "소리 95%"),
  `VOLUME_MAX` 2, `VOLUME_STEP_PERCENT` 5.
- **`src/engine/volumeCommands.ts`** (new, 13 dispatcher tests) —
  `clip.mute` (toggle; default key `m`; hidden from the toolbar, in the
  palette) and `clip.volume` (`{ clipId?, volume }`, `requiresArgs`, so no
  palette row and no shortcut row; the panel's slider is its only caller;
  1 is written as no field).
- **`src/engine/audioSchedule.ts`** — the level multiplies every gain ramp
  point; a segment with no ramp gets one flat point at its start (in the
  past when playback joins later, like a fade's); a muted / 0% clip emits
  NO segment, so a neighbour's dissolve gets no overhang from it. 7 new
  tests in `audioSchedule.test.ts`.
- **`src/engine/clipboard.ts`** — `ClipboardEntry.volume/muted`, and
  `carriedFields()`: the four optional fields a clip carries (fades and
  sound), used by copy, paste and the tail of a split — the third copy of
  that spread was the trigger to write it once.
- **`src/engine/commands.ts`** — split keeps volume and mute on both
  pieces; paste carries them; `VOLUME_COMMANDS` registered after the fades.
- **`src/ui/ClipPanel.tsx`** — a "소리" `<h3>` block under the fade edges:
  the mute `CommandButton` (glyph 🔊 / 🔇 follows the state, label 소리
  끄기, `aria-pressed`), a `<input type=range>` "소리 크기" 0–200 step 5
  with `aria-valuetext`, an aria-hidden `<output>` percent, and one note
  sentence (`#clip-sound-note`) both controls are described by. Each notch
  dispatches `clip.volume` with coalesce key `volume:<clipId>`;
  `endGesture` on pointerup / keyup / blur.
- **`src/ui/useShortcuts.ts`** — a range input owns every unmodified key,
  like a `<select>` (the a11y round's blocker: `Delete` on the slider
  ripple-deleted the clip).
- **`src/ui/Timeline.tsx`** — `.clip-sound-mark` pill after the name
  ("🔇" or "🔉 95%") and sr-only `clip-sound-<id>` in the clip's
  `aria-describedby`; passes `gain` to the canvas.
- **`src/ui/ClipCanvas.tsx`** — `gain` prop (in the memo comparator); the
  wave's samples are scaled by it before the curve; a muted clip draws its
  full shape in the "quiet" colour.
- **`src/ui/Preview.tsx`** — the picture canvas is `.stage-picture` and
  `paint()` stamps `data-frame` = the timeline frame it drew. Not part of
  the sound; it is what made the gate honest (see "What the gate found").
- Docs: ADR-0013, six DOM-contract rows plus `.stage-picture[data-frame]`
  in `docs/TESTING.md`, `docs/HANDOVER.md` progress, six new "Known tech
  debt" entries in `CLAUDE.md`.
- Tests: unit 462 → 496, e2e 96 → 101 (`e2e/volume.spec.ts`, 5 scenarios:
  mute switch, slider + coalesced undo, `M` key + palette, single keys do
  nothing on the slider, export of a muted clip is 무음 with 90 frames).

### Decisions a future session would otherwise get wrong

1. **Linear gain in the document, percent to the user.** The audio graph
   and the fade ramps are linear; the conversion lives in `volume.ts` only.
2. **Mute is its own field, `true` or absent.** So the level survives a
   mute and undo leaves no key (`dropUndefined` in `ops.ts`).
3. **A muted clip has no segment**, not a segment at zero — that is what
   keeps its overhang out from under a neighbour's fade-in. A muted clip's
   own fade-in still makes the previous clip's sound fade out under it
   (ADR-0013 consequences).
4. **A fade on a quiet clip ramps to the clip's level**, because the level
   multiplies the points; it does not sit on top of them.
5. **The slider is not a `CommandButton`** and `clip.volume` is
   `requiresArgs`; its `disabledReason` is generic, like the trims'.
6. **Volume changes during playback ARE heard**, after the store's 120 ms
   debounced re-cue (`afterDocumentChange` → `seekVersion`). A reviewer
   called this a blocker from reading `Preview.tsx` alone; it is handled one
   layer up. The re-cue restarts the picture pool too (a cold start), which
   is pre-existing.
7. **`carriedFields` is the one place** that copies fades and sound from a
   clip or a clipboard entry. Add the next optional clip field there.

### What the persona round found, and what was done

Five reviewers (guardrail, QA, a11y, novice, export-qc). **One blocker,
fixed**: single keys leaked from the focused slider to the app — `Delete`
ripple-deleted the clip, `c` split it, `m` muted it (a11y) → range inputs
own unmodified keys, with an e2e scenario. **Majors, fixed**: the mute
button's glyph did not change with the state (novice) → 🔊 / 🔇; the
slider's visible label "크기" differed from its accessible name (novice) →
"소리 크기". **Minors, fixed**: the pill "95%" read as progress (novice) →
"🔉 95%"; three copies of the carry-forward spread (guardrail) →
`carriedFields`; a muted neighbour's effect on a dissolve was undocumented
(QA) → ADR-0013. **Not a defect**: "volume is inaudible while playing" (QA)
— see decision 6. Everything else is in `CLAUDE.md` "Known tech debt": no
limiter for two loud clips through a dissolve and a re-cue click that
scales with gain (export-qc), the unreachable disabled reason, the fades'
missing heading, 끄기 / 크기 one syllable apart, the pill's contrast.

### What the gate found

The first full run was RED on `fades.spec` "frame 7 is half-way"
(chromium project), and only under parallel load. Three hypotheses, in
order, with what settled each:

1. _Stale picture satisfies the first poll._ Reordering the two assertions
   made it fail MORE (3 of 4), so the frame-7 picture was not merely late.
2. _The scrub decode fails under load and `pump` keeps the last picture
   silently._ A `console.warn` in the catch and a bounded retry: the next
   failure's trace had no such warning. Reverted.
3. _`goToFrame` waits for the playhead, not for the picture._ The failing
   run's `full` was 0.47 where the frame-20 picture is 0.22: the reference
   brightness had been read off an intermediate frame of the key-press
   run (the fixture changes colour per frame; a scrub is "latest wins").
   The fix is the `data-frame` stamp above and `goToFrame` waiting for it.
   44 of 44 under the same load twice, then the full gate.

The first attempt's locator, `.stage canvas`, matched the subtitle overlay
too (strict-mode violation, 12 failures) — hence `.stage-picture`.

### What the browser found

Visual QA ran in the owner's Chrome (deviceId `da2a0786-…`, approved
2026-09-10; loopback confirmed by `netstat`) on the project the browser
had kept (three clips of the fixture, two subtitles). The tab was
`visibility: hidden` again, so screenshots timed out about half the time
and playback could not be watched; everything static was checked, by
screenshot where one came through and by reading the DOM and the clip
canvases' pixels otherwise:

- The "소리" block sits under the fade edges and BELOW THE FOLD of the
  sidebar at 797px window height (the version list and the fade block take
  the room); it scrolls into view, nothing is clipped.
- Mute: button 🔊 → 🔇 with `aria-pressed`, status "소리를 껐어요 · 이
  클립은 들리지 않아요.", note "들리지 않아요", pill 🔇 after the name on
  the strip (21×16px — small but legible), description "소리 끔".
- 50% by keyboard (ten ArrowLeft): pill "🔉 50%", status "소리를 50%로
  줄였어요.", note "녹음된 것보다 작게 들려요"; the wave's ink pixels fell
  3039 → 1825 (the sqrt curve's expected ~60%) and its rows 6 → 4 of an
  18px band. Muted at 50%: note "들리지 않아요 · 다시 켜면 50%로 돌아와요"
  and the wave rows read grey-blue (≈106,126,142) where the neighbours read
  teal (127,243,228) — the full shape in the quiet colour, as designed.
- `m` with the slider focused did nothing (the a11y blocker's fix).
- Eleven undos put the document back exactly (0 marks, slider 100, no
  `volume`/`muted` in the saved project). **Two auto snapshots (15:25,
  15:29) made during the pass remain in the owner's "이전 상태" list** with
  the muted / 50% states inside; deleting them is the owner's call.

**Nothing was heard.** The tab was hidden, playback pauses on hidden, and
the pass has no ears anyway.

## Repository analysis memory — 2026-09-09

The owner asked to preserve the earlier repository analysis in
[REPO_ANALYSIS.md](REPO_ANALYSIS.md). It records the pre-fades inspection,
including version-history ID collisions and malformed-save acceptance reproduced
with in-memory storage, plus export cleanup and subtitle aspect-ratio concerns.
Its 398 unit / 90 e2e results belong to that earlier run, not the current tree.
Recheck each finding against the current code before acting. This memory entry
does not replace the implementation handoff or the next step below.

## Next single step

**Commit the ceiling follow-up (owner's call), then E7 item 4: transform**
(position / scale / crop of the picture). Before
designing it, read `src/engine/compose.ts` (the one draw for preview and
export — a transform is a matrix applied there, once) and ADR-0013's
"one reader" shape (`clipLevel`) for how a per-clip property reaches both
surfaces.

## Blocked / needs the owner

1. **Two auto snapshots from the visual pass** (2026-09-10 15:25 and
   15:29, in the browser's "이전 상태" list) hold a muted / 50% document.
   Delete them or keep them; nothing in the repo depends on it.
2. **Listen.** Playback through a 50% clip, a mute pressed mid-playback,
   a 200% clip. Unit tests cover the schedule, e2e covers the DOM and a
   muted export; nothing here has heard the result.
3. **Product call surfaced by this unit:** should the fade edges get a
   heading now that the sound has one? (The limiter question is answered:
   the per-clip ceiling, chosen by the owner on 2026-09-10.)
4. **Unchanged and still open** from earlier units: the fade mark over
   bright footage, the dip through black when both edges of a cut fade,
   the quiet-source waveform, the AWS deployment direction.
