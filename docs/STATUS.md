# STATUS — the live handoff

**This file is the handoff.** It is rewritten at the end of every unit of work,
by whoever did the work, before they report anything to the owner.

Write it for a reader with **zero memory of any conversation**. No "as
discussed", no "the fix we talked about", no pronoun pointing at chat history.
If it is not in a file in this repo, it does not exist — chat context dies, the
repo does not.

<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->

**Last verified:** 2026-08-12 05:41 UTC — `npm run verify` **GREEN**

- e2e 23 passed

<!-- VERIFY:END -->

## Where we are

E5 (trim / move / snap / close gaps) is implemented and its engine layer is
covered. Two full persona rounds were run against it; every blocker-tier finding
from both rounds is fixed. The last change removed the selection state from the
clip's `aria-label` (it belongs in `aria-pressed` alone), which was breaking four
e2e specs at once.

## In flight

Nothing. E5 is closed pending a green `npm run verify` and the owner's visual
pass.

## Next single step

Run `npm run verify`. If green, start **E6**: clipboard (cut / copy / paste,
paste attributes), a user-editable keymap with presets, and a ⌘K command
palette. The palette is close to free — commands are already data in
`src/engine/commands.ts`, carrying `label`, `icon`, `defaultKey`, `hidden`,
`done` and `disabledReason`.

Suggested order inside E6, smallest risk first:

1. keymap as data (lift the `Alt`+arrow nudges out of `ui/Timeline.tsx` — they
   are the last hardcoded bindings; see tech debt in `CLAUDE.md`)
2. command palette over the existing registry
3. clipboard commands (`clip.copy` / `clip.cut` / `clip.paste`), which need a new
   op and therefore a new inverse — TDD this in `src/engine/`

## Session boundary

The owner's setting is **one epic per session**. E6 (keymap → palette →
clipboard) is one session's work: finish it green, `npm run handoff`, ask before
committing, then stop. See "When to end the session" in `CLAUDE.md` for the
signals that override this and justify cutting early.

## Blocked / needs the owner

- **Not committed.** Nothing since E5 has been committed or pushed. The owner
  must be asked before any git operation — this is a hard stop, not a courtesy.
- No other open questions.

## Recently closed, with the reasoning

Kept short on purpose: only what a future session would otherwise get wrong.

- **Gaps are legal and visible, never auto-closed.** Moving or head-trimming
  leaves a hole. It is drawn hatched, the preview paints black in it (because
  that is what export writes there), and `timeline.closeGaps` removes it *on
  request*. A magnetic mode that reflows clips the user did not touch was
  rejected. See ADR-0006.
- **One gesture = one undo step.** A drag only previews; the command is
  dispatched on release. A held key coalesces via `coalesceKey`, which is only
  sound because trim/move ops are absolute assignments — a relative op would
  compound. `endCoalesce()` on key release ends the gesture.
- **Single-key shortcuts must never fire with a modifier held.** `Ctrl+C` was
  splitting the clip and `Ctrl+W` was trimming it on the way to closing the tab,
  where the `pagehide` flush then persisted the edit.
- **A slider must not contain interactive children.** ARIA makes them
  presentational, which deleted every clip's name and state from the
  accessibility tree. Hence the `.ruler` / `.track` split.
