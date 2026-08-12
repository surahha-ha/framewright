# Testing strategy

## Pyramid

1. **Unit (Vitest, Node — fast, no browser).** Pure engine only: time-model,
   document reducers, commands + undo, ID generation, VFR detection, export plan,
   codec-level/letterbox math, and the frame-selection rules (`drainPlan`,
   `isContinuous`). **This is where we do TDD.**
2. **Browser e2e (Playwright).** Everything that needs real WebCodecs: decode
   sessions, playback, import, split/delete in the real UI, and export.
3. **Manual harness.** `webcodecs_verify.html` for exploratory codec /
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
- `npm run e2e:chrome` — Playwright against your installed Google Chrome
- `npm run e2e:ui` — interactive Playwright runner

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
- Import/export tests need H.264 (our fixture and our export target) and
  **self-skip** on bundled Chromium. Run them with `npm run e2e:chrome`.

## Regression tests worth knowing about

Two shipped bugs live on as tests, because both were invisible to unit tests:

- **"plays fast after a cut"** — a clip starting mid-source answered with the
  newest *buffered* frame instead of the requested one while the decoder was
  still catching up. Rule extracted as `drainPlan`; behaviour covered in
  `e2e/playback-session.spec.ts`.
- **"freezes when you split during playback"** — the fix above stopped consuming
  frames while undecided, jamming the buffer. Covered by the same spec, plus
  `isContinuous` (a split must not restart the decoder at all).

## The e2e DOM contract

Playwright tests reach into the DOM, so the DOM is an API. These selectors and
attributes are a **contract**: change one and you must change the specs in the
same commit. Anything not on this list is free to change.

| Contract | Meaning |
| --- | --- |
| `.ruler` | the playhead, `role="slider"`, `aria-valuenow` = current frame |
| `.track` | the clip strip, `role="group"`; clicking it scrubs |
| `.timeline .clip` | one clip button, in timeline order |
| `.gap` | a hole in the strip (decorative, `aria-hidden`) |
| `.statusbar` | `role="status"`; the last thing that happened, in words |
| `.transport .dim` | `playhead / total`, in frames |
| clip `aria-label` | identity + position + length. **Never state.** |
| clip `aria-pressed` | selected or not. The ONLY place selection lives. |

### Rule: never assert on a value that mixes identity and state

Four e2e tests failed at once because the clip's `aria-label` carried
`, 선택됨`. Every "did undo restore this?" check compared the label before and
after — but clicking the clip to drag it also *selected* it, so the label moved
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
