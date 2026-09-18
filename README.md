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
- [x] E9 — silence auto-cut (조용한 부분 없애기, one press, one undo step)
- [x] e2e — Playwright across import, editing, subtitles, sound, picture,
      silence, export
- [ ] next — E8's second item, style presets = 예능 자막 (a subtitle's look,
      place and effect; then calligraphy fonts; then dragging the words
      anywhere on the picture); then E10 images and stickers; owed
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

## Setting up on another machine

The two lines above are the short version. A machine that has never built this
repo needs one more install step, and without it `npm run verify` cannot finish:

```bash
npm ci
npx playwright install chromium
```

- **Node** is the version `.nvmrc` names — **24**. `package.json`'s `engines`
  says the same, so npm warns if you are below it.
- **`npx playwright install chromium` is not optional.** There is no
  `postinstall` script, so `npm ci` does not download the browser and
  `npm run e2e` fails at launch until you run it. Do **not** add `--with-deps`;
  that flag installs Linux system packages and only works there.
- **Check whether any e2e skipped itself.** The specs that decode or export
  video ask the browser for H.264 at runtime and skip themselves with
  `this browser has no H.264 (use npm run e2e:chrome)` when it says no — so a
  green `npm run verify` can be green _without having touched the video path_.
  Read the skip count, do not assume either way: Playwright 1.62.1's bundled
  Chromium on Windows **does** have H.264 (measured 2026-09-18 — 142 passed, 0
  skipped), but that is a property of the build, not a promise. If those specs
  do skip on your machine, install Google Chrome and run `npm run e2e:chrome`
  (`playwright.config.ts` carries a `chrome` project on `channel: 'chrome'` for
  exactly this).
- **On Windows you need Git Bash**, because the repo's hooks run `bash`.

**What the clone does not bring with it.** Imported media (stored in OPFS), saved
documents and their version history, and your keymap all live in the browser
profile, not in the repo — so a new machine starts with an empty media bin, no
project history and the default shortcuts.

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
