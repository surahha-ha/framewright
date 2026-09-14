# AGENTS.md — framewright (Codex)

Guide for Codex sessions working in this repo. Read before editing.

This file is the Codex twin of `CLAUDE.md`: **the same rules, adapted to what
Codex reads and runs.** Codex loads this file on its own and never loads
`CLAUDE.md`. When a rule changes, change both files. The one thing that lives
only in `CLAUDE.md` is the **"Known tech debt"** list at its end — read that
section before a persona review, and append to it when you close a unit.

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
.codex/
  hooks.json    the four lifecycle hooks (see docs/CODEX_HOOKS.md)
  agents/       persona roles for subagents (tester-qa, tester-a11y, tester-novice,
                framewright-reviewer, test-writer, export-qc)
  skills/       adr · handoff · new-command
```

## Commands

- `npm run dev` · `npm run build` · `npm run typecheck` · `npm test`
- `npm run verify` — the gate: refs → guardrails → hook tests → typecheck → unit → e2e
- `npm run handoff` — runs the gate and stamps its real result into `docs/STATUS.md`

**Never pipe `verify`, `test` or `e2e` into anything** (`| tail`, `| grep`).
The exit code becomes the pipe's and a red run reads as green. Redirect to a
file and read the file, or read the runner's own summary line.

## Working mode — run the loop, don't ask

The owner has asked for this explicitly: **do not stop between steps to report or
to ask permission.** For a unit of work (an epic, or one numbered backlog item),
run the whole loop yourself and come back once, at the end:

```
implement → npm run verify → fix → persona review (all three) → fix
          → npm run verify → repeat until GREEN and zero blocker findings
          → visual QA in real Chrome through dev-browser, if one is attached
```

Rules for the loop:

- **`npm run verify` must be green before you claim anything is done.** Not "the
  engine tests pass" — the whole gate, e2e included.
- A persona finding in the blocker tier is a defect, not feedback. Fix it and run
  the gate again. Lower tiers go into "Known tech debt" in `CLAUDE.md`, never
  silently dropped.
- If the same fix fails twice in a row, stop and report — that is a real
  disagreement about the design, and it is worth the owner's time. Everything
  else is not.
- **Announce before any git operation** and wait. This is the one hard stop.
  Codex has no hook that enforces it (see "Hooks" below), so it holds by
  discipline: no `git commit`, `git push`, `git reset`, `git checkout --`,
  `git stash` or anything else that writes to git or discards work without
  the owner's answer in this conversation. Never force-push.
- **Look at it before handing it over.** The gate cannot see a clipped label or
  an invisible gap. In Codex the visual pass runs through **dev-browser**
  attached to the owner's real Chrome — see `docs/TESTING.md` "Visual QA" for
  the rules (confirm which browser, leave the state as you found it, every
  visual finding ships with a new assertion). If no dev-browser daemon or
  Chrome is available, say so and skip it; do not guess at appearance.
- Final taste and judgement are the owner's, at the end. Don't ask them to be
  your test runner.

## Handoff — how work survives a session

Chat context dies. A session ends, a context window fills, the owner comes back
three days later. Everything that matters therefore lives in files, and there are
exactly three, with different lifetimes:

| File                              | Lifetime                           | Answers                                                         |
| --------------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| `AGENTS.md` / `CLAUDE.md` (twins) | rarely changes                     | how we work, what must never break                              |
| `docs/HANDOVER.md`                | changes when the _project_ changes | what this is for, who the owner is, what has already gone wrong |
| `docs/STATUS.md`                  | **rewritten every unit of work**   | where we are right now, and the next single step                |

### Starting a session

1. Read `docs/STATUS.md`, then `docs/HANDOVER.md`, then this file (the
   SessionStart hook prints the top of `STATUS.md` for you).
2. **Run `npm run verify` before writing any code.** The doc says what the last
   session believed; the gate says what is true. When they disagree, the gate
   wins and the disagreement is the first thing to fix.

### Ending a unit of work — before reporting anything

1. `npm run handoff` — runs the gate and stamps its real result (green or red)
   into `docs/STATUS.md`. It cannot be faked; that is the point.
2. Rewrite the rest of `docs/STATUS.md`: where we are, what is in flight, the
   **next single step**, what is blocked or needs the owner, and any decision a
   future session would otherwise get wrong.
3. Move every persona finding you did not fix into "Known tech debt" in
   `CLAUDE.md`.
4. Add or update an ADR if an architectural decision changed.

Write `STATUS.md` for a reader with zero memory of any conversation. No "as
discussed", no "the fix from earlier", no pronoun pointing at chat history. If a
future session has to ask the owner what you meant, the handoff failed.

### When to end the session and start a fresh one

**Default boundary: one epic.** Finish an epic end to end, gate green, then hand
off and stop. Every new session pays a fixed re-orientation cost — read three
docs, run the gate — so cutting per backlog item pays that cost three times for
the same work. Cutting per epic pays it once.

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
  becomes the rushed, vague kind that costs the next session an hour.
- **The same bug has survived three hypotheses.** Write down what you ruled out
  and why — that is the valuable part, not the theories — and let a fresh
  session read the problem clean from `STATUS.md`.
- **The kind of work changes** — implementation → planning, or a broad refactor.
- **Right before something risky** (a dependency change, a wide rename), so the
  previous session is a clean checkpoint to return to.

Never cut mid-epic with a red gate and no explanation. That hands the next
session a broken tree and no idea which of the breakage was intentional.

## Hooks and subagents

### What runs without you asking

`.codex/hooks.json` wires four hooks to `scripts/codex-hooks.mjs`. They run
only once the owner has reviewed and trusted them in Codex's `/hooks` for this
project; `docs/CODEX_HOOKS.md` has the details and the limits.

- **SessionStart** prints the live handoff from `docs/STATUS.md`.
- **PreToolUse** (`apply_patch`, `Edit`, `Write`) blocks edits to lockfiles,
  `.env`, `.git/` and anything outside the repo.
- **PostToolUse** formats the file you just wrote, then runs `check:guardrails`
  and `check:refs` — so a duplicate import surfaces at the edit, not three
  files later when the page is blank.
- **Stop** runs refs → guardrails → hook tests → typecheck → unit tests. The
  first red asks you to fix it; a second red in the turn it started lets the
  turn end with a message. It never turns red into green. e2e is not in this
  hook (too slow per turn); it belongs to the explicit `npm run verify`.

**What Codex does not have:** the Bash guard that Claude Code runs
(`.harness/danger-guard.mjs`) needs an "ask" decision Codex's hooks do not
offer, so nothing here denies a force-push or a `verify | tail` for you, and
nothing asks before a git write. Those three rules are yours to keep.

None of that replaces running `npm run verify` yourself. The hook is a net, not
the gate.

### Use the persona subagents — do not role-play them

`.codex/agents/` holds six roles: `tester-qa`, `tester-a11y` and
`tester-novice` (review only, they must not edit), plus
`framewright-reviewer`, `test-writer` and `export-qc`. They are the same
personas as `.claude/agents/`, in Codex's role format. Spawn them as
subagents, in parallel, once the gate is green. Two reasons, and the second is
the one that bites:

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

Lives in `CLAUDE.md`, under the heading of the same name, and only there. Read
it before a persona review so you do not re-report what is already recorded;
append to it when you close a unit.
