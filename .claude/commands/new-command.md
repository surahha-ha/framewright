---
description: Scaffold a new editor command (registry entry + inverse) with a failing-first test.
argument-hint: <command-id> <short description>
---

Create a new framewright editor command following CLAUDE.md and ADR-0003.

Command: $ARGUMENTS

Do it test-first:

1. Write the Vitest spec first (red): assert the frame-accuracy invariants
   (half-open `[in,out)`, frame-sum preserved), plus exact undo and deterministic redo.
2. Register the command (id, label, icon, `canRun`, `run` → patch, `invert`).
3. It must edit only the document (no direct store mutation), use `src/engine/time.ts`
   for any time math, and deterministic ids.
4. Run `npm test` and `npm run typecheck`; do not finish until both are green.
