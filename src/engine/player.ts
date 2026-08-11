// DEPRECATED — scheduled for deletion.
//
// This module held an early playback clock. It is no longer imported by
// anything: `ui/Preview.tsx` owns the playback loop (it has to, because it also
// resolves the timeline and swaps decode sessions at every cut).
//
// It also violated two project rules (CLAUDE.md): it used browser-only APIs
// (requestAnimationFrame) inside `src/engine/**`, which must stay Node-testable,
// and it re-derived frames from seconds by hand instead of using `time.ts`.
//
// Remove it with:  git rm src/engine/player.ts
export {};
