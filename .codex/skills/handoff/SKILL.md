---
name: handoff
description: Close out a unit of work — run the gate, stamp its real result into docs/STATUS.md, rewrite the handoff, record unfixed persona findings as tech debt, and propose the commit without touching git.
---

Close out the current unit of work, in this order. Do not skip a step.

1. Run `npm run verify` (never piped into anything). If it is red, fix it and
   start again — a handoff on a red gate is only acceptable when you are
   genuinely stuck, and then the redness and what you ruled out must be
   written down.
2. Run `npm run handoff` to stamp the real result into `docs/STATUS.md`.
3. Rewrite the rest of `docs/STATUS.md`: where we are, what is in flight, the
   **next single step**, what is blocked or needs the owner, and any decision a
   future session would otherwise get wrong. Write it for a reader with zero
   memory of this conversation.
4. Move every persona finding you did not fix into "Known tech debt" in
   `CLAUDE.md` (that list lives only there). Add or update an ADR if an
   architectural decision changed.
5. Show the owner the proposed commit message and **wait for approval** before
   touching git. Codex has no hook that stops a git write for you; this step is
   the stop.
