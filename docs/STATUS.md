# STATUS — the live handoff

**This file is the handoff.** It is rewritten at the end of every unit of work,
by whoever did the work, before they report anything to the owner.

Write it for a reader with **zero memory of any conversation**. No "as
discussed", no "the fix we talked about", no pronoun pointing at chat history.
If it is not in a file in this repo, it does not exist — chat context dies, the
repo does not.

<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->

**Last verified:** 2026-08-18 02:17 UTC — `npm run verify` **GREEN**

- unit 259 passed · e2e 66 passed

<!-- VERIFY:END -->

## Where we are

**C's first half is built: the timeline has a scale of its own, and it zooms.**
`docs/adr/0010-the-timeline-has-a-scale.md` is the argument.

**Nothing is committed.** `main` is still at `16a4c3b` (the previous session's
handoff commit) and this entire unit is sitting uncommitted in the working tree,
because the owner is asked before any git operation.

Until now the timeline had no coordinate system: every position was a percentage
of the container (`frames / documentLength * 100`), so one pixel was worth a
different number of frames in every document, and in the same document after
every edit. That is replaced by **pixels per frame plus a scroll offset**, owned
by a new pure engine module.

### What is new

- **`src/engine/timelineView.ts`** (new, 33 unit tests) — `frameToX`, `xToFrame`,
  `frameAtX`, `deltaFrames`, `visibleRange`, `visibleSpan`, `centerOn`,
  `keepVisible`, `contentWidth`, `maxScroll`, `clampScroll`, the zoom clamps
  (`fitScale` / `clampScale` / `zoomedScale`) and the tick ladder (`tickSteps` /
  `ticks`). Pure and Node-testable, like `drag.ts`.
- **`src/ui/Timeline.tsx`** — one scroll container (`.strip`) holding `.ruler`
  and `.track`, both drawn at content width. The component keeps the gesture and
  the DOM; every frame↔pixel conversion goes through the engine.
- **Three app actions** — `view.zoomIn` (`=`), `view.zoomOut` (`-`),
  `view.zoomFit` (`\`), with buttons in the track head reading `⊖ 작게`
  `⊕ 크게` `⛶ 전체`, plus a standing readout ("한 화면에 3초").
- **Ruler ticks**, built for the visible range only, labelled in `m:ss`.
- **`src/store/projectStore.ts`** — `timelineScale` (`null` = fitted) and
  `timelineWidthPx`. View state: never undoable, never persisted.
- **`e2e/timeline-zoom.spec.ts`** (15 tests) — everything Node cannot see.

### Five decisions a future session would otherwise get wrong

1. **`timelineScale === null` means FITTED, and that is not the same as the
   number which happens to equal today's fit.** Fitted follows the document as
   it grows; a number does not. So zooming out onto the floor stores `null`, and
   emptying the timeline resets to `null`. Both were QA findings; both have e2e
   tests.
2. **Zoom out stops at the whole document, zoom in at 40px per frame — and the
   floor wins over the ceiling.** A five-frame document already fills the strip
   at 180px/frame; clamping that down would pull it off the edges it has always
   filled.
3. **The ruler stays a slider over the DOCUMENT at every zoom.** `aria-valuemax`
   is `total - 1` regardless of what is visible: zoom changes what you can see,
   never where the playhead is allowed to go. The strip scrolls to follow it.
4. **A zoom step anchors on the focused clip, not blindly on the playhead.**
   Centring on the playhead scrolled a focused clip off screen while it kept DOM
   focus — an invisible focus ring (WCAG 2.4.7). The anchor is the clip the
   keyboard is on, and the playhead only when it is not on one.
5. **The ruler is labelled `m:ss`, NOT the app's `mm:ss:ff`.** See below.

### The label format, and why it changed mid-unit

The first build labelled ruler ticks with `formatTimecode` (`mm:ss:ff`). Looked
at in Chrome, a three-second clip came out reading `00:00:05 … 00:02:25` — which
looks like two and a half **minutes**. One such value next to a frame count is
legible; a whole row of them is not.

`src/engine/time.ts` gained **`formatClock`** (`m:ss`, and `h:mm:ss` past an
hour). `formatTimecode` is untouched and still used everywhere else. Two
questions, two formats: "which frame is this" keeps frames, "how far along is
this" does not. `docs/UX.md` carries the rule; four unit tests pin the format.

Two consequences inside `tickSteps`: a **labelled** step is never shorter than
one second (`0:03` printed three times running is worse than no label), and the
sub-second detail moved to the **unlabelled** marks, which subdivide as finely
as they stay countable — one per frame once a frame is wide enough to see.
`MIN_MINOR_TICK_PX` was raised from 9 to 14 after looking at the real ruler.

### What the persona round found

Four reviewers (guardrail, QA, a11y, novice) and **zero blockers**. Fixed:

1. A stale zoom survived an emptied timeline and was applied to the next import,
   so a fresh video opened showing a sliver of itself (QA, major).
2. Zooming out to the floor stored a number rather than `null`, so the view
   silently stopped following the document (QA, major).
3. A zoom step could scroll a focused clip off screen (a11y, major).
4. `mm:ss:ff` on the ruler (novice, major) — above.
5. The zoom buttons were icon-only, so the deciding word lived behind a hover
   (novice, major). They carry `작게` / `크게` / `전체` now.
6. `⤢` did not read as "fit to view"; it is `⛶` now (novice, major).
7. Nothing exposed the current zoom to a screen reader — the status line says
   what CHANGED, once (a11y, major). The `한 화면에 N초` readout says what IS.
8. `Math.max(...spread)` over the clip list would throw on a very large project
   (QA, minor) — a `reduce` now.
9. A visible flash of every clip at width zero before the first measurement
   (QA, minor) — `useLayoutEffect`.
10. No NaN guard on the value that feeds `seekTo` (QA, minor).
11. `ADR-0010` was cited by two files and did not exist, and `ADR-0006`'s
    Consequences still described the stub-pin behaviour this unit removed
    (guardrail, major). Both fixed.

Everything not fixed is in `CLAUDE.md` "Known tech debt" — six new entries.

### Two test traps this unit walked into, now written down

- **A test can pass for the wrong reason, and a one-pixel layout change can
  expose it.** `e2e/palette-keymap.spec.ts`'s "the pasted clip is the selected
  one" clicked the exact CENTRE of a clip, which is the exact tie in
  `pastePlan`'s nearer-edge rule; the new box model moved the click by one pixel
  and the paste landed on the other side — failing a test about selection over a
  question of position. It clicks at 75% now, and says why.
- **`.focus()` followed by `.click()` moves focus to the button.** The first
  version of the "a zoom step keeps the focused clip visible" test read
  `document.activeElement` after clicking the zoom button — so it measured the
  button, and passed with the fix reverted. It uses the KEY now, and was
  confirmed red with the fix reverted before being kept.

### The box model, which was wrong by a pixel before this unit

`.ruler` and `.track` carry no left/right border any more; the border moved to
the scroll container. An absolutely positioned child is laid out from its
parent's PADDING box, so with a 1px border every clip was drawn one pixel to the
right of the frame it claimed to be on, while a click read one pixel to the
left. Do not put a horizontal border back on either element.

## Next single step

**C's second half: clip thumbnails, then the audio waveform.** Both are now
cheap, and that is why the coordinate change came first — each of them is
"given a visible frame range and a pixels-per-frame, what do I draw", and
`visibleRange(view)` plus `view.scale` is exactly that.

Start with **thumbnails**, because they need no decoding path playback does not
already have, and the ruler has already proved the drawing pattern:

- Decode one frame per N pixels of clip width, with N chosen so the count is
  bounded by the VISIBLE range and not by the clip's length. `ticks` in
  `src/engine/timelineView.ts` is the shape to copy.
- The decode itself cannot be unit-tested (no WebCodecs in Node), so the
  placement arithmetic belongs in `timelineView.ts` (pure, test-first) and only
  the decode and the draw belong in the component.
- **Close every `VideoFrame`.** A thumbnail strip is the easiest place in this
  codebase to leak one per scroll event.
- Cache by (assetId, sourceFrame) so the cache survives a zoom change.
  Re-decoding on every zoom step would make the strip unusable.

## Blocked / needs the owner

1. **NOTHING IS COMMITTED.** `main` is at `16a4c3b` and the whole of this unit
   is in the working tree. The one hard stop stands: announce before any git
   operation and wait. `bash.exe.stackdump` is still untracked in the repo root
   — a crash artefact, safe to delete, deliberately never staged.

2. **The `m:ss` ruler label is a product call and the owner can overturn it.**
   The alternative is consistency with the transport readout (`mm:ss:ff`
   everywhere) at the cost of a ruler that reads as minutes. Cheap to change:
   one function in `src/engine/time.ts`, one call site in `src/ui/Timeline.tsx`,
   four unit tests and one e2e regex.

3. **`MAX_SCALE = 40` px/frame is a guess that has only ever been tried on a
   three-second fixture.** With the only test footage in the repo, fit is
   already ~14px/frame, so zoom has barely two steps of range and hits the
   ceiling almost immediately. On a ten-minute file the same ceiling is nine
   doublings away. Nobody has yet zoomed a long file by hand.

4. **Two directions the owner set, neither started as code.** Deployment on
   **AWS for real users**, and design informed by
   `docs/research/editor-pain-points.md`. The gating question is unchanged:
   static hosting (S3 + CloudFront, possible today) or a real backend for
   projects and media? A consequence worth restating: **a project does not
   follow the user to another machine** — the document is in `localStorage` and
   the video is in that browser profile's OPFS.

5. **The remaining backlog, in the order agreed:** the rest of C — thumbnails
   and waveform — then B: E7 (subtitles, transitions, audio volume/fades,
   transform).
