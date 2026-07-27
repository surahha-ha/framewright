# framewright

**Craft video in your browser — a frame-accurate, WebCodecs-powered editor.**

framewright is a web-native video editor built on `WebCodecs` (hardware-accelerated
decode/encode in the browser) with TypeScript + React. This repo currently contains
the **First Playable Loop** — the walking skeleton that proves the riskiest path
end-to-end: import a video → decode with WebCodecs → render to canvas → play/scrub →
minimal timeline.

## Status — M1: First Playable Loop (E0–E4 slice)

- [x] E0 — Vite + React + TS setup
- [x] E1 — media import + mp4box demux + WebCodecs decode service
- [x] E2 — project data model + **canonical time-model** (`src/engine/time.ts`)
- [x] E3 — canvas render + play/scrub (master clock)
- [x] E4 — minimal single-track timeline + playhead
- [ ] E5+ — cut/trim/split, command registry, clipboard, versions, export (next)

## Architecture (key decisions)

- **Timeline is fixed CFR (integer frames).** Frame rate is a rational (`num/den`),
  so 29.97 = 30000/1001 is exact. VFR sources are detected and conformed onto the grid.
- **One canonical time-model** (`engine/time.ts`) does all frame ↔ sec ↔ sample math —
  no inline time arithmetic anywhere else (prevents drift / off-by-one).
- **Client-side WebCodecs** for decode; `mp4box.js` for demux. ffmpeg.wasm is reserved
  for muxing on export and codec fallback (e.g. HEVC), not the hot path.
- **Serializable JSON document with stable IDs** — CRDT-friendly for future collaboration.
- **Local-first, sync-ready** — data lives locally now; the repository seam lets a server
  document store drop in later without a rewrite.

## Run

```bash
npm install
npm run dev      # open the printed http://localhost:5173 in Chrome/Edge
```

> WebCodecs needs a recent **Chrome/Edge**. First slice targets **H.264 MP4**; HEVC is
> reported as "fallback needed", VFR is flagged for conform.

## Scripts

- `npm run dev` — dev server
- `npm run build` — typecheck + production build
- `npm run typecheck` — types only

## Layout

```
src/
  engine/   time · types · project · demux · decoder · player · registry
  store/    projectStore (zustand)
  ui/       MediaBin · Preview · Timeline
  App.tsx · main.tsx · styles.css
```
