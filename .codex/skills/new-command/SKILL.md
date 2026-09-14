---
name: new-command
description: Scaffold a new framewright editor command (registry entry with an inverse for undo) test-first, following AGENTS.md and ADR-0003.
---

Create a new framewright editor command following AGENTS.md and ADR-0003.

The command id and a short description come from the user's request; if either
is missing, ask before writing anything.

Do it test-first:

1. Write the Vitest spec first (red): assert the frame-accuracy invariants
   (half-open `[in,out)`, frame-sum preserved), plus exact undo and deterministic redo.
2. Register the command (id, label, icon, `canRun`, `run` → patch, `invert`).
3. It must edit only the document (no direct store mutation), use `src/engine/time.ts`
   for any time math, and deterministic ids.
4. Run `npm test` and `npm run typecheck`; do not finish until both are green.
