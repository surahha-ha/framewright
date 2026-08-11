# framewright

**Craft video in your browser — a frame-accurate, WebCodecs-powered editor.**

framewright is a web-native video editor built on `WebCodecs` (hardware-accelerated
decode/encode in the browser) with TypeScript + React. This repo currently contains
the **First Playable Loop** — the walking skeleton that proves the riskiest path
end-to-end: import a video → decode with WebCodecs → render to canvas → play/scrub →
minimal timeline.

## Status — the loop is closed: import → cut → export

- [x] E0 — Vite + React + TS setup
- [x] E1 — media import + mp4box demux + WebCodecs decode service
- [x] E2 — project data model + **canonical time-model** + **command registry**
- [x] E3 — canvas render + play/scrub (streaming decode, per-clip sessions)
- [x] E4 — timeline with multiple clips, selection, playhead
- [x] E5 — split (`C`) and ripple delete (`Del`), undo/redo, shortcuts
- [x] E11 — **MP4 export** (H.264 + AAC)
- [x] audio — decode, timeline-accurate playback (audio is the master clock),
      and AAC export rendered offline so it matches the cut
- [x] e2e — Playwright covering decode sessions, import/split/delete, export
- [ ] next — trim/move, clipboard, version history, proxy media for smooth 4K
      scrubbing, Worker-based export

## Architecture (key decisions)

See `docs/adr/` for full records. In short:

- **Timeline is fixed CFR (integer frames)**; fps is a rational (`num/den`), so
  29.97 = 30000/1001 is exact. VFR sources are detected and conformed. (ADR-0002)
- **One canonical time-model** (`engine/time.ts`) does all frame ↔ sec ↔ sample math.
- **Client-side WebCodecs** for decode; `mp4box.js` for demux; `ffmpeg.wasm` reserved
  for export mux / codec fallback (lazy). (ADR-0001)
- **Command registry** is the spine — all edits are named commands with inverses;
  undo/shortcuts/palette/clipboard derive from it. (ADR-0003)
- **Local-first, sync-ready** storage behind a repository seam. (ADR-0004)

## Run

```bash
npm install
npm run dev      # open the printed http://127.0.0.1:<port> in Chrome/Edge
```

The dev server address lives in **`dev-server.ts`** (one place — Vite and
Playwright both read it). Change the port there, or per-run:

```bash
FRAMEWRIGHT_PORT=1234 npm run dev
```

> WebCodecs needs a recent **Chrome/Edge**. First slice targets **H.264 MP4**; HEVC is
> reported as "fallback needed", VFR is flagged for conform.

## Scripts

- `npm run dev` — dev server
- `npm run build` — typecheck + production build
- `npm run typecheck` — types only
- `npm test` / `npm run test:watch` — unit tests (Vitest)
- `npm run e2e` — browser tests (Playwright). Import/export tests need H.264, so
  run those with `npm run e2e:chrome` (bundled Chromium has no H.264).

## Testing

Test-first for pure engine logic. See `docs/TESTING.md` for the pyramid
(Vitest unit → Playwright e2e → manual harness) and the invariants.

## Working with AI agents

- `CLAUDE.md` — the non-negotiable rules; read before editing.
- `.claude/agents/` — `framewright-reviewer`, `test-writer`, `export-qc`.
- `.claude/commands/` — `/new-command`, `/adr`.
- `.claude/settings.json` — typecheck hook on edits.

## Layout

```
src/
  engine/   time · types · project · demux · decoder · playbackSession · player · registry
  store/    projectStore (zustand)
  ui/       MediaBin · Preview · Timeline
docs/
  adr/      architecture decision records
  TESTING.md
```
