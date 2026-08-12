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

Anything that touches decoding, playback, or export cannot be unit-tested (no
WebCodecs in Node) — cover it in `e2e/` with Playwright instead. Two shipped bugs
came from that gap; don't widen it.

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

Run these in order. **`typecheck` is not optional** — a duplicate import or a
use-before-declaration compiles away silently in dev and then breaks the whole
page, which makes every e2e failure look like an unrelated selector problem.

1. `npm run check:refs` — duplicate/unresolved imports
2. `npm run typecheck` — types, including TS2448 use-before-declaration
3. `npm test` — unit tests
4. `npm run e2e` — browser behaviour (see `docs/TESTING.md`)
5. Persona review when UI or engine behaviour changed (`docs/TESTERS.md`)

Also:

- Relevant frame-accuracy invariants hold (see `docs/TESTING.md`)
- Touches an architectural decision? Add/update an ADR.

### When you change UI structure

Renaming, moving, or replacing a component is not done when the new file looks
right. Before finishing: re-check every place that imported or referenced it,
confirm nothing imports a symbol twice, and confirm no dead import points at a
file that moved. Then run `check:refs` and `typecheck`.

## Known tech debt

- The `Editor` instance is a module singleton in `store/projectStore.ts`. Fine for
  one document; move to React context if we ever open several projects at once.
- Playback restarts a decoder at every cut (a new `PlaybackSession` per clip).
  Warm-decoder reuse + proxy media + a frame cache are the planned fix.
- Audio uses `decodeAudioData` on the whole file (simple, but holds the decoded
  track in memory). Fine for short clips; revisit for long files.
- AAC encoder delay (priming) is left to the muxer — verify A/V sync on real
  footage before trusting it for long exports.
- Export runs on the main thread (yields between frames). RUNBOOK calls for a
  Worker + OffscreenCanvas — not done yet.
- No golden-file byte comparison for export output yet; e2e asserts frame count
  and duration, and the pure parts are unit-tested.
- Rotation metadata is still ignored, so a rotated source renders sideways in
  both preview and export (consistent, but wrong).
- Trim/move commands, clipboard, and a user-editable keymap are not built yet
  (`ui/useShortcuts.ts` holds a fixed default map that already targets command ids).
