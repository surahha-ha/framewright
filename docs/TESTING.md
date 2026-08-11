# Testing strategy

## Pyramid

1. **Unit (Vitest, Node — fast, no browser).** Pure engine only: time-model,
   document reducers, commands + undo, ID generation, VFR detection, schema
   migration. **This is where we do TDD.**
2. **Integration / e2e (Playwright + headless Chromium — has WebCodecs).** The
   browser-only paths: demux, decode, render, playback, export. Golden-file frame
   accuracy on real clips. Added when export lands.
3. **Manual harness.** `webcodecs_verify.html` (in the design repo) for exploratory
   codec / seek-latency / memory checks.

## Why the split

WebCodecs, Canvas, and OPFS do not exist in Node/jsdom, so they cannot be unit tested.
Keep them behind interfaces (`demux.ts`, decode service, export), unit-test the pure
logic, and verify the browser paths in Playwright + the manual harness.

## Commands

- `npm test` — unit tests once
- `npm run test:watch` — watch mode
- `npm run typecheck` — types only

## TDD flow for the next feature (A: command registry + cut/split)

Write the spec first (red), then implement to green:

- split at frame `N` yields `[in, N)` and `[N, out)` — no gap/overlap, frame sum preserved
- delete + ripple shifts downstream by exactly the removed length
- undo restores the document exactly; redo is deterministic (stable IDs)
- dispatching an unknown command is a no-op; `canRun` gates disabled commands

## Invariants (assert in tests)

- rendered frame count == sum of clip frame counts
- export duration == sum of clip durations (frame-exact)
- every `VideoFrame` allocated is closed (no leaks)
- preview and export produce identical frames (determinism)
