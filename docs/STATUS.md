# STATUS — the live handoff

**This file is the handoff.** It is rewritten at the end of every unit of work,
by whoever did the work, before they report anything to the owner.

Write it for a reader with **zero memory of any conversation**. No "as
discussed", no "the fix we talked about", no pronoun pointing at chat history.
If it is not in a file in this repo, it does not exist — chat context dies, the
repo does not.

<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->

**Last verified:** 2026-08-13 05:42 UTC — `npm run verify` **GREEN**

- unit 181 passed · e2e 44 passed

<!-- VERIFY:END -->

## Where we are

**The two-frame source-offset defect is fixed.** It was the "A" option of four
that the owner was offered after E6; they declined to pick and said to take the
recommendation, so A was taken. E6 and the e2e worker change are already
committed (`4cdf618`, `1ce3921`, `d723949`); **this work is not committed yet.**

The defect, restated for someone who never saw it: `e2e/fixtures/sample-h264.mp4`
has B-frames and no edit list, so its first sample's `cts` is **1024** at
timescale **15360** — two frames at 30fps. The timeline maps frame _n_ to
`n/fps` seconds and matched that against raw container `cts`, so every frame
rendered two early **and the last two frames of the media could not be reached at
all**. Visual QA caught it (the fixture burns its own frame number into the
picture; the playhead read 22 / 44 / 69 / 89 while the picture read
20 / 42 / 67 / 87). No test in the suite could see it.

**The fix is `rebaseToPresentationStart` in `src/engine/demux.ts`** — the seam
that owns container quirks, so playback, scrub and export all inherit it at once.
Each track's samples are shifted so its earliest `cts` becomes 0.
**ADR-0008 is the argument**; read it before changing any of this.

Two more corrections came with it, both from the review round and both real:

1. **The correction runs in both directions.** `ctts` version 1 offsets are
   signed, so a file can present its first picture _before_ zero. The first guard
   only handled a late start, which left the mirrored defect intact — verified by
   reverting the guard and watching `earlyTail` return media frame 57 where 59
   was asked for.
2. **The clip's length now comes from the samples, not the container header.**
   The header duration is not reduced by the offset just removed. Where the two
   disagree, a timeline sized from the header claims frames the media cannot
   fill: preview freezes on the last picture and export writes it again, at the
   right frame count, silently. `presentationSpan` measures the real span and
   wins whenever the extraction is complete and every sample carries a duration.

## Visual QA — done, and it found a second defect

Driven in the owner's real Chrome (deviceId `da2a0786-…`, the one with permission
for `127.0.0.1:9990`), because that is the only place H.264 and the owner's own
fonts/zoom exist.

- **The fix is visible in the real app.** Playhead 22 → picture 22; playhead 89
  (the last frame) → picture 89. Before, those read 20 and 87, and 88–89 were
  unreachable.
- **Found: the picture stayed black after re-linking a file**, until the playhead
  happened to move. Re-linking changes _nothing_ in the document — same project
  object, same playhead — so the preview's scrub effect never re-ran. Fixed with
  `mediaVersion` in `store/projectStore.ts`, bumped by `noteMediaAttached()`.
  The assertion that keeps it from coming back reads the **canvas pixels**
  (`e2e/editor.spec.ts` → "the picture comes back without touching the
  playhead"); it fails on the old code.
- **The re-link warning renders correctly** and is not clipped: "sample-h264.mp4
  을(를) 다시 연결했어요. ⚠ 이 영상은 시작 지점이 어긋나 있어 바로잡았어요 —
  예전에 잘라 둔 자리가 2프레임만큼 달라 보일 수 있어요."

That warning exists because a project saved **before** this fix chose its cut
points against the old mapping, so re-linking moves the picture under them.
`AssetMeta.startOffsetSec` records what was removed at import, so a re-link can
tell "imported with the correction" from "imported before it existed" and only
warns for the second.

## What the review round found, and what was done with it

Three subagents reviewed the diff (`framewright-reviewer`, `tester-qa`,
`export-qc`). One blocker (the negative-offset guard above) — fixed. Of the
majors: the duration-from-samples fix above, and two that were **not** fixed on
purpose and now live in "Known tech debt" in `CLAUDE.md`:

- **A/V sync assumes the audio track has no offset of its own.** True for the
  shape that produced this defect, unverified in general, and the audio pipeline
  cannot even see it (`decodeAudioData` never goes through demux;
  `decodeAudioTrack` concatenates decoded PCM in callback order, ignoring `cts`).
  No fixture of that shape exists to fix against — building one is the first step
  if this is ever taken on.
- **The edit list (`elst`) is still not read.** `min(cts)` gives the same answer
  for the reorder-delay case; a file that expresses a trim as an edit is treated
  as if the trimmed material were still there.

## In flight

**Uncommitted work in the tree.** `npm run verify` is GREEN over it (stamped
above). Changed:

- `src/engine/demux.ts` — `rebaseToPresentationStart`, `presentationSpan`,
  wiring, `startOffsetSec` on both demux results
- `src/engine/time.ts` — `secToTimescale`
- `src/engine/types.ts` — `AssetMeta.startOffsetSec`
- `src/engine/audio.ts` — uses `timescaleToUs` instead of inline time math
- `src/store/projectStore.ts` — `mediaVersion` / `noteMediaAttached`
- `src/ui/Preview.tsx`, `src/ui/MediaBin.tsx`
- `e2e/source-offset.spec.ts` (new), `e2e/playback-session.spec.ts`,
  `e2e/editor.spec.ts`, unit tests for demux and time
- `docs/adr/0008-…` (new), `docs/adr/README.md`, `docs/TESTING.md`, `CLAUDE.md`
- `docs/research/` — a background research pass the owner asked for (see below)

## Next single step

**Ask the owner to commit this work, then commit it.** Announcing before any git
operation is the one hard stop in this project.

## Blocked / needs the owner

1. **Committing.** Nothing here is committed.
2. **Which unit of work is next.** Of the four candidates offered after E6, A is
   now done. The rest, unranked by the owner: **B** — E7 (subtitles,
   transitions, audio volume/fades, transform); **C** — timeline zoom + ruler
   ticks + thumbnails + waveform; **D** — the naming cleanup in item 3. The owner
   has said they would rather be handed a recommendation than a menu.
3. **A naming decision, not a defect.** Three toolbar controls contain the word
   "잘라내기": `clip.cut` (clipboard) and the two trim-to-playhead commands
   ("앞부분/뒷부분 잘라내기"). Their icons (`✁` and `✂`) are indistinguishable at
   toolbar size. The novice persona rated this major: someone trying to "cut 30
   seconds out" will click the wrong one. Renaming E5's commands is a product
   call, so it was left alone rather than changed quietly.
4. **Two new directions the owner set, neither started as code.** They want this
   deployed on **AWS for real users**, and they want the design informed by what
   real users complain about in Premiere / Final Cut / DaVinci / CapCut /
   browser editors, including hard adoption and review numbers. The research is
   in `docs/research/editor-pain-points.md`; nothing has been decided from it.
   The deployment question that gates the rest: is this static hosting
   (S3 + CloudFront, possible today) or does it need a backend for projects and
   media?

## Decisions a future session would otherwise get wrong

- **A source's time starts at its own first picture, not at the container's
  clock.** `DemuxSample.cts` is rebased and is no longer a faithful record of the
  container. Anything that ever needs true container time (remux, passthrough
  export, reading an edit list) must take it from `startOffsetSec`. ADR-0008.
- **The clipboard is not document state.** It lives on the `Editor` beside the
  playhead and the selection. Undo must not empty it; a version restore must not
  repopulate it; it is never serialised. That is _why_ copy/cut are app actions
  rather than commands — a command must return an invertible `Patch`.
- **`AppAction` is a second concept on purpose.** Undo, play/pause, copy and
  "open the palette" produce no patch. Encoding them as commands would mean a
  `run()` returning an empty patch — a lying undo entry every consumer would
  then special-case. ADR-0007 argues this; do not "simplify" it back.
- **A paste never splits, overwrites or drops anything.** The insert point moves
  to a clip boundary if the playhead is inside a clip, a big-enough gap is used
  as-is, and otherwise later clips move right by exactly what the space falls
  short. This is a push on an explicit command, which is not the magnetic mode
  ADR-0006 rejected.
- **Asset ids are never reused, ever.** `restoreProject` already said so;
  `importAsset`'s inverse agrees. If some future command rewinds `nextId` past an
  asset id, a clipboard entry can point at a replaced asset — that was an E6
  blocker.
- **`space`, `enter`, the arrows, `home` and `end` cannot be bound by the user.**
  A focused button or slider takes them first, so an action bound to one would
  work on the page and be silently dead whenever a control has focus. They are
  still the _defaults_ for play/pause and the playhead steps — those are exactly
  the actions that should stand down when a control has focus.
- **The keymap lives in `localStorage` under `framewright.keymap.v1` and
  outlives a reload.** Any e2e spec that rebinds anything must clear that key
  first, or the previous test decides what this one's keys do.
- **Clearing framewright's `localStorage` from the console does not stick.** The
  app flushes the in-memory document on `pagehide`, so a removal followed by a
  reload writes it straight back. Neuter the write first:
  `Object.defineProperty(Storage.prototype, 'setItem', { value() {}, writable: true, configurable: true })`,
  then remove the keys. (`localStorage.setItem = fn` does **not** shadow the
  method — it stores a key called "setItem".)

## Recently closed, with the reasoning

Kept short on purpose: only what a future session would otherwise get wrong.

- **A test that cannot self-skip is worth more than a faithful one.**
  `e2e/source-offset.spec.ts` runs the **real fixture** through `demuxVideo` and
  asserts timeline frame _n_ is media frame _n_ for every _n_. It needs no
  decoder, so unlike the import/export specs it runs on bundled Chromium too —
  a spec that skipped on the machine running the gate would have guarded nothing.
- **Gaps are legal and visible, never auto-closed.** Moving or head-trimming
  leaves a hole. It is drawn hatched, the preview paints black in it (because
  that is what export writes there), and `timeline.closeGaps` removes it _on
  request_. A magnetic mode that reflows clips the user did not touch was
  rejected. See ADR-0006.
- **One gesture = one undo step.** A drag only previews; the command is
  dispatched on release. A held key coalesces via `coalesceKey`, which is only
  sound because trim/move ops are absolute assignments — a relative op would
  compound. The gesture ends on `keyup` **and on `blur`/`visibilitychange`** —
  the default nudge binding is `Alt`+arrow, and `Alt`+`Tab` takes the window
  away before the release ever arrives.
- **Single-key shortcuts must never fire with a modifier held.** `Ctrl+C` was
  splitting the clip and `Ctrl+W` was trimming it on the way to closing the tab,
  where the `pagehide` flush then persisted the edit. This is now structural:
  `c` and `mod+c` are different chords, so they cannot match each other.
- **Only actions that mean "again" may repeat.** Holding `Ctrl+V` used to stack
  one paste per key repeat, each its own undo entry. `Command.repeatable` /
  `AppAction.repeatable` mark the nudges and the playhead steps; everything else
  fires once per press.
- **A slider must not contain interactive children.** ARIA makes them
  presentational, which deleted every clip's name and state from the
  accessibility tree. Hence the `.ruler` / `.track` split.
- **`workers: 2` in `playwright.config.ts` is a measured number, not a guess.**
  Raising it back to Playwright's default costs ~340MB and returns no time,
  because the suite's critical path is its longest spec file. Re-measure before
  changing it — the right number moves the moment a fifth spec file appears or
  one file's runtime overtakes `palette-keymap.spec.ts`. The measurements and
  the method are in `docs/TESTING.md`.
