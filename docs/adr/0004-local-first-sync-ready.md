# 0004 — Local-first, sync-ready storage

- Status: Accepted

## Context

Local-only storage ships fastest but dead-ends collaboration, sharing, cross-device,
and a dashboard. Full server-from-day-one slows the MVP. The product roadmap needs the
server eventually.

## Decision

**Local-first, sync-ready.** MVP persists locally (OPFS + serializable project JSON),
but storage access goes through a **repository interface** and the document uses
**stable string IDs**, so a server document store drops in without a rewrite. The
server store is introduced right after the First Playable Loop.

## Consequences

- Fast MVP with no local-only dead-end.
- Requires a repository seam and disciplined serialization from the start.
- Media carries both `opfsKey` (local) and `srcUrl` (remote) so the sync path is ready.
