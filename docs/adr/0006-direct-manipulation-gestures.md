# 0006 — Direct manipulation: one gesture, one undo step

- Status: Accepted

## Context

E5 introduced dragging: move a clip by its body, trim it by either edge, and nudge
it with `Alt`+arrow. Three problems fell out of that immediately, and all three
are the kind that only show up in someone's hands, not in a test:

1. A drag emits a continuous stream of positions. Dispatching each one would put
   ~60 entries on the undo stack per gesture, so `Ctrl+Z` would rewind a drag one
   pixel at a time. A held nudge key has exactly the same shape.
2. The timeline used to be a single element with `role="slider"` that also
   contained the clip buttons. ARIA treats a slider's descendants as
   presentational, so every clip's role, name and `aria-pressed` were stripped
   from the accessibility tree — the code carefully described clips to nobody.
3. Moving and head-trimming can now leave a **gap**. Gaps were previously
   unreachable, so nothing in the preview drew them and nothing in the UI
   admitted they existed, while export writes black there.

## Decision

**A gesture is a preview plus one command.** While the pointer is down the
component draws where the clip _would_ land (`previewGeometry`); the command is
dispatched once, on release. A gesture that ends where it began dispatches
nothing. For the keyboard, `Editor.dispatch` takes a `coalesceKey`: a key repeat
folds into the previous undo entry instead of pushing a new one. Coalescing keeps
the _original_ inverse and adopts the newest forward, which is only sound because
trim/move ops are absolute assignments — a relative op would compound. Any undo,
redo or unkeyed edit ends the gesture.

**The arithmetic lives in the engine.** `src/engine/drag.ts` owns snapping,
clamping, bounds and the mode→command mapping. It is pure and unit-tested; the
component only converts pixels to frames. The first bug this caught was real:
ranking snap candidates by distance let "no snap" (distance 0) always beat a real
snap, so a clip could never sit flush against the clip on its right.

**Two controls, not one.** `.ruler` is the playhead slider and has no interactive
children. `.track` is a `role="group"` of clip buttons. Everything a drag can do
also has a keyboard route: `Alt`+arrows nudge, and `Q`/`W` trim the head/tail to
the playhead — modifier-free bindings (Premiere's) that no window manager or
browser claims, unlike `Ctrl+Alt`+arrow.

**Gaps are legal, visible, and never closed behind your back.** They are drawn
hatched in the track, the preview paints black in them (so the picture agrees
with what export will write), and `timeline.closeGaps` removes them _on request_.
A magnetic mode that silently reflows clips the user did not touch was rejected:
it makes an edit you did not ask for, which is the opposite of forgiving.

## Consequences

- Undo granularity is a product decision, expressed in one place.
- The drag scale is frozen for the duration of a gesture. A clip trimmed longer
  than the timeline therefore runs past the right edge until release (it is
  pinned as a stub so it stays grabbable). The real fix is timeline zoom.
  **Superseded by ADR-0010.** Timeline zoom was built, and the stub pin is gone:
  the strip has a scale of its own, so an overshooting clip makes the scrolled
  content wider and stays where it actually is. The freeze survives, for a
  smaller reason — a fitted scale still follows the WINDOW, and a resize
  mid-gesture would move it under the pointer.
- `Command` gained `hidden`, `done` and `disabledReason`, so a control can say
  why it is unavailable and what it just did without the UI hardcoding strings.
