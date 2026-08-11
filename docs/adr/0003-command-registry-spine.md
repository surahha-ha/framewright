# 0003 — Command registry as the spine

- Status: Accepted

## Context

We need Undo/Redo, customizable shortcuts, a clipboard, a command palette, and later
real-time collaboration — without divergent code paths for each entry point.

## Decision

Every document edit is a **named command** with an inverse. Buttons, menus, the
command palette, and keyboard shortcuts all derive from one registry and dispatch the
same commands. Edits produce **op-based patches** (forward + inverse) over the
document. IDs are **deterministic** (a document-scoped counter) — never
`Date.now()`/`Math.random()` — so Redo is reproducible and CRDT merge is possible.

## Consequences

- Discipline required: **no direct state mutation** — all edits go through `dispatch`.
- Undo/Redo, palette, and shortcut remapping come "for free."
- Op-based patches + stable IDs make later CRDT collaboration a retrofit, not a rewrite.
