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

## Working mode — run the loop, don't ask

The owner has asked for this explicitly: **do not stop between steps to report or
to ask permission.** For a unit of work (an epic, or one numbered backlog item),
run the whole loop yourself and come back once, at the end:

```
implement → npm run verify → fix → persona review (all three) → fix
          → npm run verify → repeat until GREEN and zero blocker findings
          → visual QA in real Chrome, if a browser is connected
```

Rules for the loop:

- **`npm run verify` must be green before you claim anything is done.** Not "the
  engine tests pass" — the whole gate, e2e included.
- A persona finding in the blocker tier is a defect, not feedback. Fix it and run
  the gate again. Lower tiers go into "Known tech debt" below, never silently
  dropped.
- If the same fix fails twice in a row, stop and report — that is a real
  disagreement about the design, and it is worth the owner's time. Everything
  else is not.
- **Announce before any git operation** and wait. This is the one hard stop.
- **Look at it before handing it over.** If a Chrome is connected
  (`list_connected_browsers`), drive the real UI and read the screenshots — the
  gate cannot see a clipped label or an invisible gap. Every visual finding ships
  with a new assertion so it cannot come back unseen. See docs/TESTING.md. If no
  browser is connected, say so and skip it; do not guess at appearance.
- Final taste and judgement are the owner's, at the end. Don't ask them to be
  your test runner.

## Handoff — how work survives a session

Chat context dies. A session ends, a context window fills, the owner comes back
three days later. Everything that matters therefore lives in files, and there are
exactly three, with different lifetimes:

| File                    | Lifetime                           | Answers                                                         |
| ----------------------- | ---------------------------------- | --------------------------------------------------------------- |
| `CLAUDE.md` (this file) | rarely changes                     | how we work, what must never break                              |
| `docs/HANDOVER.md`      | changes when the _project_ changes | what this is for, who the owner is, what has already gone wrong |
| `docs/STATUS.md`        | **rewritten every unit of work**   | where we are right now, and the next single step                |

### Starting a session

1. Read `docs/STATUS.md`, then `docs/HANDOVER.md`, then this file.
2. **Run `npm run verify` before writing any code.** The doc says what the last
   session believed; the gate says what is true. When they disagree, the gate
   wins and the disagreement is the first thing to fix.

### Ending a unit of work — before reporting anything

1. `npm run handoff` — runs the gate and stamps its real result (green or red)
   into `docs/STATUS.md`. It cannot be faked; that is the point.
2. Rewrite the rest of `docs/STATUS.md`: where we are, what is in flight, the
   **next single step**, what is blocked or needs the owner, and any decision a
   future session would otherwise get wrong.
3. Move every persona finding you did not fix into "Known tech debt" below.
4. Add or update an ADR if an architectural decision changed.

Write `STATUS.md` for a reader with zero memory of any conversation. No "as
discussed", no "the fix from earlier", no pronoun pointing at chat history. If a
future session has to ask the owner what you meant, the handoff failed.

### When to end the session and start a fresh one

**Default boundary: one epic.** Finish E6 end to end, gate green, then hand off
and stop. Every new session pays a fixed re-orientation cost — read three docs,
run the gate — so cutting per backlog item pays that cost three times for the
same work. Cutting per epic pays it once.

A cut is only **safe** when all four hold:

1. `npm run verify` is green (or `STATUS.md` records, honestly, that it is red
   and exactly why)
2. `npm run handoff` has stamped the real result
3. `STATUS.md` names the **next single step**
4. the work is committed — and the owner was asked first

Override the default and cut early, mid-epic, when any of these fire:

- **Context drops to 40% remaining.** This is a hard stop, not a guideline, and
  it outranks finishing the epic. At 40% you still have room to run the gate,
  rewrite `STATUS.md` properly and commit; at 15% you do not, and the handoff
  becomes the rushed, vague kind that costs the next session an hour. Hand off
  before, not after — a half-finished unit with an honest `STATUS.md` is
  recoverable; a finished one nobody can find is not.
- **The same bug has survived three hypotheses.** By then the session is full of
  wrong theories, and every new idea is anchored to them. A fresh session reading
  only `STATUS.md` sees the problem clean. Write down what you ruled out and why —
  that is the valuable part, not the theories.
- **The kind of work changes** — implementation → planning, or a broad refactor.
  Carrying implementation detail into a design conversation makes the design
  smaller than it should be.
- **Right before something risky** (a dependency change, a wide rename), so the
  previous session is a clean checkpoint to return to.

Never cut mid-epic with a red gate and no explanation. That hands the next
session a broken tree and no idea which of the breakage was intentional.

## Hooks and subagents

Both are already configured (`.claude/`). Two things follow from that.

### What runs without you asking

- **PreToolUse** blocks edits to lockfiles, `.env` and `.git/`.
- **PostToolUse** formats the file you just wrote, then runs `check:guardrails`
  and `check:refs` — so a duplicate import surfaces at the edit, not three
  files later when the page is blank.
- **Stop** runs refs → guardrails → typecheck → unit tests and **refuses to let
  the turn end while they are red**, handing the failure back as feedback. After
  three consecutive red stops it relents and tells you to report being stuck
  instead. e2e is not in this hook (too slow per turn); it belongs to the
  explicit `npm run verify`.
- **SessionStart** prints the live handoff from `docs/STATUS.md`.

None of that replaces running `npm run verify` yourself. The hook is a net, not
the gate.

### Use the persona subagents — do not role-play them

`.claude/agents/` holds `tester-qa`, `tester-a11y` and `tester-novice`
(read-only), plus `framewright-reviewer`, `test-writer` and `export-qc`. Spawn
them with the Task tool, in parallel, once the gate is green. Two reasons, and
the second is the one that bites:

1. **They are not anchored to your implementation.** A separate context reviewing
   the diff finds things the author cannot see. In the E5 round the personas
   found two blockers — `Ctrl+C` splitting the clip, and a `role="slider"` that
   deleted every clip's name from the accessibility tree — that no test caught.
2. **Their tokens are not your tokens.** Persona review is the most expensive
   step in the loop. Run it inline and it eats the context you need for the
   handoff. Run it as subagents and only the findings come back.

Feed each one the changed file list and what to focus on; ask for tiered findings
(blocker / major / minor) with file:line and a concrete failing scenario. Fix
every blocker, re-run the gate, and put the rest in "Known tech debt".

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
- **A source whose presentation does not start at zero is two frames early.**
  The timeline maps frame `n` to `n/fps` seconds and matches that against raw
  `cts`, so a file with B-frames and no edit list (like `e2e/fixtures/
sample-h264.mp4`, first `cts` 1024 at timescale 15360) decodes two frames
  early everywhere, and its last two frames cannot be reached at all. Preview
  and export share the mapping, so they still agree with each other — it is the
  frame→media mapping that is wrong. Found by visual QA; reproduced by the
  `test.fixme` in `e2e/playback-session.spec.ts`, which the existing spec misses
  because it synthesises timestamps starting at 0.
- The keymap has no presets (Premiere / Final Cut style) and no import/export —
  it is per-browser `localStorage` only, so a new machine starts from defaults.
- The palette filters by plain substring on the label. No fuzzy match, no
  initials, no recently-used ordering.
- A paste always lands on the video track, and the insert point snaps to a clip
  boundary rather than splitting. "Paste attributes" (E6's fourth item) is not
  built — there are no clip attributes to paste yet.
- `clip.copy` / `clip.cut` are app actions, so unlike every editor command they
  are not testable in Node; their coverage is the e2e spec, which self-skips on
  bundled Chromium (no H.264).
- **Three controls say "잘라내기" and two of them mean different things.**
  `clip.cut` (clipboard) sits next to `clip.trimStartToPlayhead` /
  `trimEndToPlayhead` ("앞부분/뒷부분 잘라내기"), and `✂` (split) vs `✁` (cut)
  are indistinguishable at toolbar size. Renaming is a naming decision for the
  owner, not a defect to fix quietly — see `docs/STATUS.md`.
- The nudge labels say "프레임", which is jargon for a first-time user, and the
  nudges have no toolbar button to anchor the idea to.
- The shortcuts panel is a flat ~21-row list with no grouping, and its "없애기"
  (unbind) and "처음으로" (restore the default) buttons are adjacent and one word
  apart in meaning.
- The "명령 찾기" toolbar button uses `⌘` as its icon on what is a Windows-first
  audience. The binding text itself is localised correctly (`Ctrl+K`).
- Toolbar buttons carry their binding only in `title`; the timeline hint shows
  `<kbd>` text permanently. Now that bindings are user-editable, the toolbar
  should probably show them too.
- Export is not in the command palette (it lives in `ExportButton`, not the
  registry), so the palette does not in fact list everything the editor can do.
- A keymap override for an action id that no longer exists is ignored but never
  cleaned out of `localStorage`, and nothing reports it.
- `drag.ts` uses `Number.MAX_SAFE_INTEGER` where `clipboard.ts` uses
  `Number.POSITIVE_INFINITY` for the same "no clip to the right" sentinel.
- `AppAction` and `Command` repeat five field names (`label`, `icon`,
  `defaultKey`, `canRun`, `disabledReason`) with no shared base type. If a third
  bindable kind ever appears, that is the rule-of-three trigger to extract one.
- Dragging freezes the timeline scale for the gesture, so trimming a clip longer
  than the current timeline runs past the right edge until release (the readout
  shows the real numbers). A proper fix is timeline zoom, not a live rescale.
- Trim/move drags are single-track only; there is one video track, so this is not
  yet a limitation — it becomes one the moment a second track exists.
- The keyboard nudge step is one frame with no coarse alternative. `Q`/`W` cover
  "go exactly here"; a next-snap-target jump is still missing. (The six nudges
  are rebindable now, but a bigger step is a different command, not a binding.)
- The drag readout sits in the track header, not next to the pointer.
- Deleting or splitting restores focus to a neighbouring clip only when focus
  fell to `<body>`; a more precise roving-focus model is still owed.
- Selecting a clip with Enter parks the playhead on its first frame, where `Q`/`W`
  cannot run. The refusal is now announced, but the flow still needs a step the
  user has to work out (move the playhead first).
- A clip can be moved past the end of the timeline, which lengthens the document
  and exports the new empty space as black. The drag readout warns ("앞에 빈 곳이
  생겨요"), but there is no hard limit and no snap-back.
- `ExportButton` still uses native `disabled`, so its reason ("영상 파일을 다시
  선택한 뒤…") is unreachable by keyboard. The rest of the toolbar moved to
  `aria-disabled`.
