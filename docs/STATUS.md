# STATUS — the live handoff

**This file is the handoff.** It is rewritten at the end of every unit of work,
by whoever did the work, before they report anything to the owner.

Write it for a reader with **zero memory of any conversation**. No "as
discussed", no "the fix we talked about", no pronoun pointing at chat history.
If it is not in a file in this repo, it does not exist — chat context dies, the
repo does not.

<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->

**Last verified:** 2026-08-13 03:15 UTC — `npm run verify` **GREEN**

- unit 167 passed · e2e 41 passed

<!-- VERIFY:END -->

## Where we are

**E6 is closed and green: the keymap is data, the ⌘K palette exists, and
copy / cut / paste work.** ADR-0007 records the three decisions worth arguing
about; `docs/HANDOVER.md` lists what shipped.

Four persona subagents (qa, a11y, novice, framewright-reviewer) reviewed the
diff. Both blocker-tier findings are fixed, with a test each, plus six major and
two minor ones. Everything not fixed is in "Known tech debt" in `CLAUDE.md`.

The two blockers, because they are the kind that come back:

1. **A clipboard entry could point at a _replaced_ asset.** `importAsset`'s
   inverse used to rewind `nextId`, so undo-an-import → import-another-file
   handed the second file `asset_1` — the id the clipboard was still holding.
   Paste then inserted frames measured against a completely different video and
   nothing looked wrong. The inverse no longer rewinds the counter (there is a
   comment at `command.ts` saying why), and `clip.paste` also refuses a range the
   current source cannot cover.
2. **The nudge commands' `canRun` ignored the bounds their `run` enforces.** A
   clip already against a wall was listed in the palette as runnable; pressing
   Enter closed the palette and did nothing. `canRun` now clamps exactly the way
   `run` does, a property test asserts the two can never disagree, and the
   palette reports a refusal instead of closing on a no-op.

## Visual QA — done this time, and it found a real defect

A Chrome was connected, so the pass that E5 shipped without actually happened.
Drove the real app end to end: import `e2e/fixtures/sample-h264.mp4` → split →
copy → paste → drag a clip open into a gap → hover states → console.

**Everything E6 added behaved.** The paste status line reads
"00:01:14 위치에 붙여넣었어요 · 클립 앞에 넣었어요 · 뒤 클립을 밀었어요", the
pasted clip is visibly the selected one, the gap draws hatched, the preview goes
black inside it, disabled buttons do not light up on hover, and the console is
clean apart from one deliberate audio log.

Three things worth keeping:

- `.toolbar` already has `flex-wrap: wrap`, so the twelve buttons wrap rather
  than overflow. At 1280px they still fit on one line.
- No disabled-reason text in the palette is clipped at 1280px. That is now an
  e2e assertion (`.pal-why` `scrollWidth <= clientWidth`), because `.pal-why` is
  `white-space: nowrap` + ellipsis and one longer sentence would silently turn a
  reason into "재생 위치를 클립 안(맨 앞이…".
- **The preview is two frames early on this fixture — see below.** This is what
  the pass was for; no test in the suite could have seen it.

### The defect: presentation that does not start at zero

The fixture burns its own frame number into the picture. The playhead read
22 / 44 / 69 / 89 while the picture read **20 / 42 / 67 / 87**. Probing the
container (`mp4box`, first eight samples) explains it exactly:

- the file has B-frames, the first sample's `cts` is **1024** at timescale
  **15360** — two frames — and **there is no edit list** to take that back out;
- `PlaybackSession` matches a requested `fromSec` (computed as `frame / fps`)
  against raw `cts` (`playbackSession.ts`, `tsUs`), and nothing subtracts the
  media's start offset.

So every frame is two early, and the last two frames of the media are
unreachable — the timeline's last frame renders source frame 87 of 89.

**This is not an E6 regression** and it is not a playback bug: preview and export
share the mapping, so they still agree with each other (golden rule 7 holds).
What is wrong is the frame→media mapping, which belongs to demux/player.

It was left unfixed on purpose: it is a different subsystem from this epic, it
touches the riskiest code in the project, and it deserves its own TDD round.
`e2e/playback-session.spec.ts` now carries a `test.fixme` that reproduces it with
synthetic samples shifted by two frames — the existing spec cannot see it because
it synthesises timestamps starting at 0. Delete the `.fixme` when you fix it.

The owner's own taste pass is still theirs to do; it does not block E7.

Note: the pass left a three-clip test project and two autosaves in that Chrome's
`localStorage` for `127.0.0.1:9990`. Harmless, and clearing it is one click in
the version panel — or say the word and it can be cleared.

## The e2e suite's memory cost, measured and cut

The owner reported `chrome-headless-shell` eating too much memory during e2e
runs. It was measured rather than guessed, by sampling every
`chrome-headless-shell` process once a second across full suite runs.

**The finding: Playwright's default worker count was buying nothing.** The
default is half the cores, which on a 12-core machine is one worker per spec
file — four Chromium instances, ~1,110MB. But with four spec files the run is
bottlenecked by the longest one, so **two workers finish in the same wall clock
and cost a third less**. `playwright.config.ts` now pins `workers: 2`; the gate
went from ~28s / 1,110MB to ~26s / ~770MB.

`npm run e2e:lowmem` (`--workers=1`) is there for a machine under real memory
pressure: ~425MB, but 43s instead of 27s, because one worker is the first
setting that actually serialises the critical path.

Three things checked and ruled out, so nobody re-derives them:

- **There is no leak.** On one worker, memory sawtooths between ~310MB and
  ~430MB for the whole run with no upward trend; the renderer is torn down and
  rebuilt per test. An earlier reading suggesting per-instance growth was an
  arithmetic error — peaks across workers are staggered, so four instances do
  not sum to four times one.
- **`--disable-gpu` saves nothing** (426MB vs 428MB): `chrome-headless-shell`
  still starts a gpu-process for SwiftShader.
- **`--trace off` saves ~10%** and costs every failure trace. Not taken.

Of one instance's ~425MB peak, only the renderer (~148MB) is this app's; the
rest is Chromium's fixed floor (network + storage utilities ~122MB, gpu ~81MB,
browser ~82MB). The numbers and the method are in `docs/TESTING.md`.

Leftover `chrome-headless-shell` processes were seen on this machine with no run
in progress (9 of them, ~1.2GB). A run that ends normally leaves zero behind, so
those are the residue of a killed run — kill by name, no code change owed.

## In flight

Nothing. E6 is committed **and pushed** — `main @ 4cdf618`, in sync with
`origin/main`. The working tree carries only the e2e memory change above
(`playwright.config.ts`, `package.json`, `docs/TESTING.md`, this file),
uncommitted.

## Next single step

**Ask the owner whether to commit the e2e memory change, then commit it.** After
that, the open question below is which unit of work comes next — it has been put
to the owner and not answered.

## Blocked / needs the owner

1. **Committing.** Announce before any git operation and wait — hard stop.
2. **Which unit of work is next.** Four candidates were put to the owner and
   none was picked: (A, recommended) fix the two-frame source-offset defect
   described above; (B) E7 — subtitles, transitions, audio volume/fades,
   transform; (C) timeline zoom + ruler ticks + thumbnails + waveform;
   (D) the naming/consistency cleanup in item 3.
3. **A naming decision, not a defect.** Three toolbar controls contain the word
   "잘라내기": `clip.cut` (clipboard) and the two trim-to-playhead commands
   ("앞부분/뒷부분 잘라내기"). Their icons (`✁` and `✂`) are indistinguishable at
   toolbar size. The novice persona rated this major: someone trying to "cut 30
   seconds out" will click the wrong one. Renaming E5's commands is a product
   call, so it was left alone rather than changed quietly.

## Decisions a future session would otherwise get wrong

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
  `importAsset`'s inverse now agrees. If some future command rewinds `nextId`
  past an asset id, blocker #1 above comes straight back.
- **`space`, `enter`, the arrows, `home` and `end` cannot be bound by the user.**
  A focused button or slider takes them first, so an action bound to one would
  work on the page and be silently dead whenever a control has focus. They are
  still the _defaults_ for play/pause and the playhead steps — those are exactly
  the actions that should stand down when a control has focus.
- **The keymap lives in `localStorage` under `framewright.keymap.v1` and
  outlives a reload.** Any e2e spec that rebinds anything must clear that key
  first, or the previous test decides what this one's keys do.

## Recently closed, with the reasoning

Kept short on purpose: only what a future session would otherwise get wrong.

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
  one file's runtime overtakes `palette-keymap.spec.ts`.
