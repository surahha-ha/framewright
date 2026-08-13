# Testing strategy

## Pyramid

1. **Unit (Vitest, Node — fast, no browser).** Pure engine only: time-model,
   document reducers, commands + undo, ID generation, VFR detection, export plan,
   codec-level/letterbox math, and the frame-selection rules (`drainPlan`,
   `isContinuous`). **This is where we do TDD.**
2. **Browser e2e (Playwright).** Everything that needs real WebCodecs: decode
   sessions, playback, import, split/delete in the real UI, and export.
3. **Visual QA (Claude in Chrome).** A real Chrome, driven and _looked at_.
   See below — this is a distinct layer, not a slower e2e.
4. **Manual harness.** `webcodecs_verify.html` for exploratory codec /
   seek-latency / memory checks on real footage.

## Why the split

WebCodecs, Canvas, and OPFS do not exist in Node/jsdom, so they cannot be unit
tested. Keep them behind interfaces, unit-test the pure logic, and cover the
browser paths in Playwright.

The engine must stay **loadable by Node** — no browser globals at module scope and
no TypeScript constructor parameter properties (Node's type-stripping runner
rejects them). `npm run check:guardrails` enforces the first part.

## Commands

- `npm run verify` — **the gate**: refs → guardrails → typecheck → unit → e2e
- `npm test` — unit tests once
- `npm run test:watch` — watch mode
- `npm run typecheck` — types only
- `npm run e2e` — Playwright against bundled Chromium
- `npm run e2e:lowmem` — the same run on one worker, for a machine under memory
  pressure (see below)
- `npm run e2e:chrome` — Playwright against your installed Google Chrome
- `npm run e2e:ui` — interactive Playwright runner

## How much memory an e2e run costs

Every Playwright worker runs its own `chrome-headless-shell`, and one instance
peaks around **425MB** — renderer ~148MB, the network and storage utilities
~122MB together, gpu-process ~81MB, browser process ~82MB. Only the renderer is
ours; the rest is Chromium's fixed floor, so the total is set almost entirely by
**how many browsers run at once**.

Measured on this suite (peak resident across all `chrome-headless-shell`
processes, sampled at 1s; wall clock from two runs each):

| workers        | peak     | processes | wall clock |
| -------------- | -------- | --------- | ---------- |
| 4 (PW default) | ~1,110MB | 16        | 26–28s     |
| **2 (ours)**   | ~770MB   | 10        | 27s        |
| 1 (`:lowmem`)  | ~425MB   | 5         | 43s        |

Playwright's default is half the cores, which on a 12-core machine means one
worker per spec file. That buys nothing: with four spec files the run is
bottlenecked by the longest one, so **two workers are exactly as fast as four**
and cost a third less memory. Going to one worker is the first setting that
actually serialises the critical path, which is why it costs 16s.

Two things that look like levers and are not, both measured:

- **`--disable-gpu` saves nothing** (426MB vs 428MB). `chrome-headless-shell`
  still starts a gpu-process for SwiftShader.
- **`--trace off` saves ~10%** (384MB vs 428MB) and costs every failure trace.
  Not worth it; `retain-on-failure` stays.

There is no leak to chase here. On a single worker, memory sawtooths between
~310MB and ~430MB for the whole run and does not trend upward — the renderer is
torn down and rebuilt at each test. A run that ends normally leaves zero
processes behind; leftover `chrome-headless-shell` processes mean a previous run
was killed rather than finished, and they are safe to kill by name.

## Dev server address

`dev-server.ts` is the single source of truth (host + port) for both Vite and
Playwright. If they disagree, Playwright fails with
`Timed out waiting ... from config.webServer` — that is a port mismatch, not a
broken test. Override per-run with `FRAMEWRIGHT_PORT`.

**Leaving `npm run dev` running is fine and expected.** `webServer.reuseExisting‑
Server` is pinned to `true` (not Playwright's `!process.env.CI` default), because
`npm run handoff` sets `CI=1` and the default turned an already-open dev server
into `http://127.0.0.1:9990 is already used` — a hard failure that looks like a
test failure and isn't one. Vite serves from disk, so reusing a live server never
runs stale code; restart it by hand only after changing `vite.config.ts` or
dependencies.

`npm run handoff` recognises this class of problem and labels it **"not a code
failure"** in `docs/STATUS.md`, so a session picking the work up does not go
hunting for a bug that isn't there.

## ⚠ Codec availability in test browsers

Playwright's bundled Chromium is the **open-source build: it has no H.264**
(VP8/VP9/AV1 only). So:

- `e2e/playback-session.spec.ts` picks whatever codec the browser supports — it
  runs everywhere.
- `e2e/source-offset.spec.ts` needs **no** codec at all: demux only parses the
  container. It therefore runs everywhere too, which is the point — the defect it
  guards was found in the real H.264 fixture, and a spec that self-skipped on the
  machine running the gate would have guarded nothing.
- Import/export tests need H.264 (our fixture and our export target) and
  **self-skip** on bundled Chromium. Run them with `npm run e2e:chrome`.

## Regression tests worth knowing about

Three shipped bugs live on as tests, because all three were invisible to unit
tests:

- **"the picture is two frames behind the playhead"** — a source whose
  presentation does not start at zero (B-frames, no edit list) was matched
  against raw container `cts`, so every frame rendered early and the last two
  frames of the media were unreachable. Found by visual QA, not by the gate.
  Rule extracted as `rebaseToPresentationStart` (ADR-0008); covered by
  `e2e/source-offset.spec.ts` against the **real fixture** and by
  `e2e/playback-session.spec.ts` through a real decode session.
- **"the picture stays black after re-linking a file"** — re-linking changes
  nothing in the document (same project object, same playhead), so the preview's
  scrub effect never re-ran and the stage stayed black until the playhead
  happened to move. Fixed with `mediaVersion` in the store; covered by
  `e2e/editor.spec.ts` → "the picture comes back without touching the playhead",
  which reads the canvas pixels rather than trusting the DOM. Also found by
  visual QA, in the same pass.

- **"plays fast after a cut"** — a clip starting mid-source answered with the
  newest _buffered_ frame instead of the requested one while the decoder was
  still catching up. Rule extracted as `drainPlan`; behaviour covered in
  `e2e/playback-session.spec.ts`.
- **"freezes when you split during playback"** — the fix above stopped consuming
  frames while undecided, jamming the buffer. Covered by the same spec, plus
  `isContinuous` (a split must not restart the decoder at all).

## Visual QA — what Playwright structurally cannot do

Playwright checks what someone **thought to assert**. It will happily report all
green while the drag readout overflows its container, the gap hatching is
invisible against the track, a label is clipped to "빈 곳 없애…", or the timeline
collapses at 1280px. Nobody wrote an assertion for those, because you do not
know to write it until you have seen it.

Claude in Chrome closes that gap: it drives the user's real Chrome and takes
screenshots that get _read_. Two things follow from "real Chrome":

- **H.264 works**, so import, playback and export run on actual footage — no
  self-skipping, unlike bundled Chromium.
- It is the browser the owner actually uses, with their zoom, fonts and window
  size.

### It is a layer, not a gate

Visual QA is **not** part of `npm run verify` and never will be. It is
non-deterministic, needs a live extension connection, and its output is a
judgement rather than a boolean. Treat it as the step between "the gate is
green" and "the owner looks at it".

### The rule that keeps it from becoming a treadmill

**Every visual finding must leave behind an assertion.** If the readout
overflows, the fix ships with an e2e check on its width or on
`scrollWidth <= clientWidth`. If a control is unreachable at a narrow width, the
fix ships with a viewport-sized spec. Otherwise the same defect returns and is
only caught by someone happening to look again — which is exactly the failure
mode this project already has a history of.

### What to actually look at

Assertions cover behaviour; look for what they cannot say:

- **Text**: anything clipped, wrapped mid-word, or overflowing — the status bar,
  the drag readout, toolbar labels, clip names in a narrow clip.
- **The timeline at rest and mid-drag**: does a gap read as a gap? Is the pinned
  stub of an off-screen clip visible? Are the trim handles findable on hover,
  and on keyboard focus?
- **Disabled state**: `aria-disabled` buttons must _look_ unavailable — the
  hover style must not fire on them.
- **Contrast and focus rings** on the real background, not in a mockup.
- **A real drag with a real mouse**: does the clip land where you aimed? Does
  snapping feel like help or like fighting?
- **Console**: any error or warning during import → play → edit → export.
- **Narrow window** (~1280px) and a **long timeline** (a dozen clips).

### Running it

The owner must have the Claude in Chrome extension connected, with site
permission granted for the dev server host (`127.0.0.1:9990`). Check with
`list_connected_browsers` first; an empty list means it is not available and the
visual pass is simply skipped — say so rather than guessing.

Save the screenshots and send them. The owner's own pass should start from
evidence, not from a blank page.

## The e2e DOM contract

Playwright tests reach into the DOM, so the DOM is an API. These selectors and
attributes are a **contract**: change one and you must change the specs in the
same commit. Anything not on this list is free to change.

| Contract                | Meaning                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `.ruler`                | the playhead, `role="slider"`, `aria-valuenow` = current frame |
| `.track`                | the clip strip, `role="group"`; clicking it scrubs             |
| `.timeline .clip`       | one clip button, in timeline order                             |
| `.gap`                  | a hole in the strip (decorative, `aria-hidden`)                |
| `.statusbar`            | `role="status"`; the last thing that happened, in words        |
| `.transport .dim`       | `playhead / total`, in frames                                  |
| clip `aria-label`       | identity + position + length. **Never state.**                 |
| clip `aria-pressed`     | selected or not. The ONLY place selection lives.               |
| `.track-hint`           | the key hints under the track, rendered FROM the keymap        |
| `.overlay`              | the modal backdrop; clicking it closes the dialog              |
| dialog "명령 찾기"      | the palette: a `combobox` over a `listbox` of `option`s        |
| palette `option`        | one entry; `aria-disabled` carries "cannot run now"            |
| dialog "단축키"         | the keymap settings; one row per bindable action               |
| row button `aria-label` | `"<라벨> 단축키 바꾸기"` — how a spec picks a row              |

The keymap lives in `localStorage` under `framewright.keymap.v1` and **outlives a
reload**. A spec that rebinds anything must clear that key first, or the previous
test decides what this one's keys do.

### Rule: never assert on a value that mixes identity and state

Four e2e tests failed at once because the clip's `aria-label` carried
`, 선택됨`. Every "did undo restore this?" check compared the label before and
after — but clicking the clip to drag it also _selected_ it, so the label moved
for a reason that had nothing to do with the edit.

The lesson is not "write the test differently". It is that **an accessible name
that changes with state is a bug on its own**: a screen reader re-announces the
whole control every time you click it. State belongs in a state attribute
(`aria-pressed`, `aria-disabled`, `aria-valuenow`), never in the name.

So, when writing an e2e assertion:

- compare **one fact at a time** — a frame count, a start timecode, a count of
  elements — not a composite string, unless that string is contractually stable;
- if you find yourself wanting to strip a suffix off a label before comparing,
  the label is wrong, not the test;
- `toBeDisabled()` matches `aria-disabled="true"` as well as the native
  attribute, so the toolbar's `aria-disabled` buttons still assert normally.

### Rule: the undo stack starts at 1, not 0

Importing a file is an edit. After `importFixture`, `되돌리기` is **enabled**, so
"nothing was edited" cannot be asserted with `toBeDisabled()`. Assert it the
honest way: press `Ctrl+Z` once and require the timeline to be empty — if the
gesture had recorded a patch, a clip would survive.

## Invariants (assert in tests)

- rendered frame count == sum of clip frame counts
- export duration == sum of clip durations (frame-exact)
- every `VideoFrame` allocated is closed (no leaks)
- preview and export produce identical frames (determinism)

## Still missing

- A golden-file byte/frame comparison for export output.
- Audio (no pipeline yet).
