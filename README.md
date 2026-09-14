# framewright

**Craft video in your browser — a frame-accurate, WebCodecs-powered editor.**

framewright is a web-native video editor built on `WebCodecs` (hardware-accelerated
decode/encode in the browser) with TypeScript + React. This repo currently contains
the **First Playable Loop** — the walking skeleton that proves the riskiest path
end-to-end: import a video → decode with WebCodecs → render to canvas → play/scrub →
minimal timeline.

## Status — the loop is closed: import → cut → export

Epic numbers follow `docs/HANDOVER.md`, which is the record of what is done.

- [x] E0–E1 — time model, document, command registry + undo, persistence and
      version history
- [x] E2 — import, mp4box demux, WebCodecs decode, preview playback (audio is
      the master clock)
- [x] E3 — split (`C`) and ripple delete (`Del`)
- [x] E4 — **MP4 export** (H.264 + AAC, rendered offline so it matches the cut)
- [x] E5 — trim / move / snap / close gaps
- [x] E6 — keymap as data, `Ctrl+K` command palette, clipboard
- [x] Epic C — clip thumbnails and the audio waveform on the timeline
- [x] E7 — subtitles, fades, a clip's sound, a clip's picture (zoom / pan / turn)
- [x] E8, first item — the shorts reframe (가로 / 세로 / 정사각 box, 화면 채우기)
- [x] e2e — Playwright across import, editing, subtitles, sound, picture, export
- [ ] next — E9 silence auto-cut, then E8's second item (style presets); owed
      regardless: proxy media, Worker-based export, rotation metadata, a
      project list, golden-file export QC

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
- Codex hooks: `npm run setup:codex`, then review/trust with `/hooks`.
  See [setup, behavior and limitations](docs/CODEX_HOOKS.md).
- `AGENTS.md` — the Codex twin of `CLAUDE.md` (same rules; the tech-debt list
  stays in `CLAUDE.md`). `.codex/agents/` — the six personas as Codex roles;
  `.codex/skills/` — `adr`, `handoff`, `new-command`.

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
