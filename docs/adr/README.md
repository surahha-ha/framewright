# Architecture Decision Records (ADR)

Short, immutable records of significant decisions. Nygard style
(Context → Decision → Consequences). Add a new file per decision; mark superseded
ones, don't delete.

| #    | Title                              | Status   |
| ---- | ---------------------------------- | -------- |
| 0001 | Web-first on WebCodecs             | Accepted |
| 0002 | CFR timeline + rational time-model | Accepted |
| 0003 | Command registry as the spine      | Accepted |
| 0004 | Local-first, sync-ready storage    | Accepted |
| 0005 | H.264 / MP4 export target          | Accepted |
| 0006 | Direct manipulation, one undo step | Accepted |
| 0007 | Bindings as data; paste placement  | Accepted |

## Template

```md
# NNNN — Title

- Status: Proposed | Accepted | Superseded by ADR-XXXX
- Date: YYYY-MM-DD

## Context

What forces are at play, what problem are we solving.

## Decision

What we decided.

## Consequences

What becomes easier / harder as a result.
```
