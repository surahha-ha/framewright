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

## Invariants (assert in tests)

- rendered frame count == sum of clip frame counts
- export duration == sum of clip durations (frame-exact)
- every `VideoFrame` allocated is closed (no leaks)
- preview and export produce identical frames (determinism)

## Still missing

- A golden-file byte/frame comparison for export output.
- Audio (no pipeline yet).
