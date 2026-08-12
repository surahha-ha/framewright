# HANDOVER — read this first

You are continuing **framewright** for its owner (둥쓰). This file is the
context a fresh session does not have. Read it, then `CLAUDE.md`, then
`docs/TESTERS.md`.

## What this is, and what it is for

framewright is a web-native, frame-accurate video editor (WebCodecs + React +
Vite). It is an **MVP built as the first step of a larger product**: an all-in-one
studio for 병의원 (clinics) — video editing, live streaming, chat, video calls,
and virtual gifting, where a finished live stream becomes VOD history.

The differentiation priority for that product, in order:
**올인원 편의성 > AI > 후원 > 라이브/VOD.** Money comes from content
subscriptions/memberships, a B2B SaaS fee, and live tipping. Regulatory exposure
is deliberately mid-level: education and consultation content, **no patient
records stored**.

The editor itself is being built **for general users, not clinics** — the whole
point is that anyone can pick it up. That is why there is no "expert editor"
persona (`docs/TESTERS.md` explains the reasoning).

## Standing rules from the owner — do not break these

1. **Announce before touching git and wait for a reply.** Committing or pushing
   without saying so first is the one thing that is never acceptable.
2. **When you change UI structure, chase the references.** Renaming or replacing a
   component is not done because the new file looks right: re-check every import,
   look for a symbol imported twice, look for a dead import pointing at a moved
   file. A duplicate import once broke the whole page and made five unrelated e2e
   failures look like selector problems. `npm run check:refs` exists because of
   that day.
3. **Run the loop; don't ask between steps.** See "Working mode" in `CLAUDE.md`.
   The owner does the final visual pass. They are not your test runner.
4. **Usability and consistency are the goal**, not feature count. When a choice is
   unclear, pick what a first-time user would find obvious (`docs/UX.md`).

## Where the work stands

Done: **E0–E6.**

- E0–E1 — time model, document, command registry + undo, persistence/versions
- E2 — import, demux, decode, preview playback (audio as master clock)
- E3 — split / ripple delete
- E4 — H.264 + AAC MP4 export, deterministic export plan
- E5 — **trim / move / snap / close gaps** (this was the last unit of work)
  - `src/engine/drag.ts` — pure drag arithmetic (snap, clamp, mode→command)
  - `clip.trimStart` / `clip.trimEnd` / `clip.move` / `timeline.closeGaps`
  - `clip.trimStartToPlayhead` (Q) / `clip.trimEndToPlayhead` (W)
  - drag preview + one-gesture-one-undo, and key-repeat coalescing
  - `.ruler` / `.track` split (ARIA presentational-children fix), `aria-disabled`
    toolbar, gap rendering, black preview in gaps
  - ADR-0006 records the decisions
- E6 — **keymap as data, ⌘K command palette, clipboard**
  - `src/engine/keymap.ts` — chords, parsing, conflict-reporting resolution
  - `src/engine/clipboard.ts` — what a copy holds, where a paste lands
  - `clip.paste` plus six bindable nudge commands (the `Alt`+arrow bindings that
    used to be hardcoded in `ui/Timeline.tsx`)
  - `src/ui/actions.ts` — app actions (undo/redo/copy/cut/play/seek/overlays),
    the things a key can run that are not document edits
  - `ui/CommandPalette.tsx`, `ui/ShortcutsPanel.tsx`, `ui/keymapStore.ts`
  - ADR-0007 records the decisions

Next, in order: **E7** (text/subtitles, transitions, audio volume/fades,
transform), E8 (style presets, shorts reframe), E9 (silence auto-cut).

Still owed regardless of epic: timeline zoom + ruler ticks + thumbnails +
waveform, preview depth (quality toggle, loop range, fullscreen, safe area),
proxy media, Worker-based export, rotation metadata, a project list, and a
golden-file export QC. Post-MVP: the dashboard (progress + YouTube analytics)
and optional YouTube account linking for archive/shorts upload, managed from a
settings screen.

`CLAUDE.md`'s "Known tech debt" is the live list — every persona finding that was
not fixed is recorded there, deliberately, rather than dropped.

## How to verify

`npm run verify` is the gate: refs → guardrails → typecheck → unit → e2e.

Two things that will otherwise waste an hour:

- Playwright's bundled Chromium is the open-source build and **has no H.264**, so
  the import/export specs self-skip there. `npm run e2e:chrome` runs them for
  real against installed Chrome.
- `dev-server.ts` is the single source of truth for host and port. A
  `Timed out waiting ... from config.webServer` failure is a port mismatch, not a
  broken test.

`docs/TESTING.md` has the e2e DOM contract — the selectors and attributes the
specs are allowed to depend on. Read it before changing markup.

## Bugs this project has already shipped, so you don't ship them again

Every one of these passed a green test suite:

- **Playback ran fast after a cut** — a clip starting mid-source answered with
  the newest _buffered_ frame while the decoder caught up. Fix: `drainPlan`.
- **Freeze when splitting during playback** — caused by the fix above not
  consuming frames while undecided, which jammed the queue.
- **Silent audio** — the playback loop re-cued audio every frame because it
  detected "seeks" by comparing playhead values. Fix: an explicit `seekVersion`.
- **"오디오 없음" that wasn't** — the real cause was a stale Vite module graph.
  There is a BUILD marker in the UI now for exactly this.
- **A blank page from a duplicate import** — see standing rule 2.
- **Four e2e failures from one bad `aria-label`** — the accessible name carried
  the selection state, so it moved for reasons unrelated to the edit under test.

The pattern: the failures live in the seams between decoder, clock, and UI, and
in things no unit test looks at. Distrust green.
