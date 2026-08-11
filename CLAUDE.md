# CLAUDE.md — framewright

Guide for AI agents (and humans) working in this repo. Read before editing.

**framewright** is a web-native, frame-accurate video editor on WebCodecs
(TypeScript + React + Vite). See `docs/adr/` for the "why" behind these rules.

## Golden rules (non-negotiable)

1. **Engine is framework-agnostic.** Nothing in `src/engine/**` may import React or
   touch the DOM directly. It must be unit-testable in Node.
2. **All document edits go through commands.** Never mutate the project state
   directly. Every edit is a named command with an inverse (for undo). Buttons,
   menus, palette, and shortcuts dispatch the same commands. (ADR-0003)
3. **All time math via `src/engine/time.ts`.** Never write inline frame/second
   arithmetic. Timeline is CFR integer frames; fps is a rational `{num,den}`. (ADR-0002)
4. **Deterministic IDs only.** Use the document-scoped id counter. Never
   `Date.now()` / `Math.random()` for IDs — it breaks redo and CRDT.
5. **Clip frame ranges are half-open `[in, out)`.** Splits/cuts must preserve the
   total frame count exactly (no gap, overlap, or dropped frame).
6. **Close every `VideoFrame`/`AudioData`** after use. Leaks crash the tab.
7. **No wall-clock in engine timing.** Playback/export derive position from the
   master clock / frame index, so preview and export agree.
8. **Isolate libraries behind interfaces.** mp4box → `demux.ts`; the muxer → the
   export module. Lazy-load `ffmpeg.wasm`; never bundle it eagerly.
9. **Don't over-abstract.** No plugin system / effect registry / worker-RPC layer
   until a concrete third case appears (rule of three).

## TDD

Engine logic is test-first. Write the Vitest spec (red), implement to green.
Run `npm test` before considering a change done. See `docs/TESTING.md`.

## Layout

```
src/
  engine/   time · types · project · demux · decoder · playbackSession · player · registry
  store/    projectStore (zustand — UI state only, not document logic)
  ui/       MediaBin · Preview · Timeline
docs/
  adr/      architecture decision records
  TESTING.md
```

## Commands

- `npm run dev` · `npm run build` · `npm run typecheck` · `npm test`

## Definition of done for a change

- Unit tests written/updated and passing (`npm test`)
- `npm run typecheck` clean
- Relevant frame-accuracy invariants hold (see `docs/TESTING.md`)
- Touches an architectural decision? Add/update an ADR.

## Known tech debt

- `src/engine/registry.ts` is a global singleton — replace with an `EditorEngine`
  instance passed via React context when building the command registry.
- `MediaBin` uses `performance.now()` for asset ids — switch to the deterministic
  id counter.
- No audio pipeline yet; first export is video-only.
