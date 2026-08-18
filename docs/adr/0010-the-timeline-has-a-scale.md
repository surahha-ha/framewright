# 0010 — The timeline has a scale of its own

- Status: Accepted
- Date: 2026-08-18
- Revises the geometry ADR-0006 assumed ("one scale, always the whole document").

## Context

The timeline had no coordinate system. Every position on it was a percentage of
the container:

```ts
const denom = drag ? drag.denom : total;
const pct = (frames: number) => (denom > 0 ? (frames / denom) * 100 : 0);
```

where `total` is the whole document's length. Clips, gaps, the playhead and the
ruler thumb all went through it. Three things followed, and all three were felt
rather than seen:

1. **One pixel meant a different number of frames in every document**, and in
   the same document after every edit. A minute of footage in a 1240px strip put
   ~1.5 frames in a pixel; ten minutes put 15. Trimming a long clip by eye was
   guessing.
2. **The scale moved when the document did.** Lengthening the timeline redrew
   everything smaller, mid-gesture included — which is why a drag had to freeze
   `denom` for its duration, and why a clip trimmed longer than the timeline ran
   off the right edge until release, pinned there as a 24px stub so it stayed
   grabbable. ADR-0006 recorded that as a consequence and named the fix:
   "The real fix is timeline zoom."
3. **Zoom could not be expressed at all**, and neither could anything that
   depends on a visible range: ruler ticks, clip thumbnails, an audio waveform.
   Each of those is "given a visible frame range and a pixels-per-frame, what do
   I draw", and there was no pixels-per-frame to give them.

## Decision

**The timeline is measured in pixels per frame, and it scrolls.**
`src/engine/timelineView.ts` owns the whole mapping — `frameToX`, `xToFrame`,
`visibleRange`, `centerOn`, `keepVisible`, `contentWidth`, the zoom clamps and
the tick ladder — and it is pure, so it is unit-tested in Node like `drag.ts`.
`Timeline.tsx` keeps the gesture and the DOM and nothing else.

Five decisions inside that, each of which could have gone the other way:

**Fitted is still the default, and it is a real state, not a zoom level of 1.**
`timelineScale === null` means "follow the document", which is exactly what the
timeline always did; a document that grows still stays wholly on screen. Once
the user zooms, the scale becomes an absolute number of pixels per frame and
stops following the document — otherwise "zoom" would silently mean something
different after every edit, which is the percentage model wearing a hat.
"전체 보기" puts it back to `null` rather than computing today's fit, so the
following behaviour comes back with it.

**Zoom out stops at the whole document; zoom in stops at 40px per frame.**
There is no state where the strip is a small thing floating in an empty box, and
none where magnifying further shows anything new. The floor WINS over the
ceiling: a five-frame document already fills 900px at 180px/frame, and clamping
that down to the ceiling would pull it away from the edges it has always filled.

**One scroll container, holding both the ruler and the track.** Two scrollers
would have to be kept in sync; one cannot drift. It also fixes the geometry the
old layout got wrong by a pixel: an absolutely positioned child is laid out from
its parent's PADDING box, so the ruler and the track now carry no left/right
border — the border belongs to the scroll container, which is not a coordinate
system. Before this, every clip was drawn one pixel right of the frame it
claimed to be on while a click read one pixel left.

**The ruler stays a slider over the DOCUMENT, not over the visible window.**
`aria-valuemin`/`aria-valuemax` are unchanged by zoom. Zoom changes what you can
see; it must not change where the playhead is allowed to go, or a keyboard user
would lose access to frames by magnifying them. The strip scrolls to follow the
playhead instead: `keepVisible` on an ordinary move (minimum travel, so playback
does not make the strip shimmer), `centerOn` after a zoom step (the
magnification changed under the user, and "where was I?" has to be answered).

**Zoom is an app action, not a command.** It produces no patch and is not
undoable, so making it a `Command` would lie about what a command is (ADR-0003).
It is still bindable, still in the palette, still refuses with a sentence.

**The ruler is labelled in `m:ss`, not in the app's `mm:ss:ff` timecode.** This
was decided by looking at the built thing in Chrome: a three-second clip came
out labelled `00:00:05 … 00:02:25`, which reads as two and a half **minutes** to
anyone who has not been told the last field is frames. A ruler is a whole row of
times at once, which is what makes the ambiguity dangerous here and tolerable in
the transport readout — the two answer different questions ("where am I in the
video" vs "which frame is this"), and only the second one needs frames in it.
`formatClock` is the new one; `formatTimecode` is untouched.

Two things follow. A labelled step is never shorter than a second, because
`0:03` printed three times in a row is worse than no label; and the sub-second
structure moves to the unlabelled marks, which subdivide as finely as they can
stay countable — down to one per frame once a frame is wide enough to see.

The drag still freezes its scale for the gesture — but for a different, smaller
reason than before. The document cannot change under a gesture, so a _chosen_
scale is already stable; what can still move is the WINDOW, and a fitted scale
follows the window. Freezing costs one field and removes that last case.

## Consequences

- Ticks, thumbnails and a waveform are now cheap: all three are a `visibleRange`
  and a `scale` away, and ticks are built for the visible range only (an hour of
  30fps footage is 108,000 frames; drawing them all is how a timeline stops
  answering the pointer).
- **The right-edge pin is gone.** A clip dragged or trimmed past the end of the
  document makes the content wider and the strip scrolls to it, instead of being
  pinned to the edge as a stub. The tech-debt item ADR-0006 opened is closed.
- `xToFrame` carries a floating-point tolerance. `x / scale` is not exact in
  binary — 30 frames across 301px draws frame 29 at x = 290.9666…, which divides
  back to 28.999999999999996 — and a frame-accurate editor that cannot click a
  boundary it has drawn is telling the user their aim was wrong. A sweep of
  ordinary widths against ordinary lengths finds two thousand such pairs.
- The timeline now has view state that is neither document nor undoable
  (`timelineScale`, `timelineWidthPx` in the store). It is deliberately not
  persisted: a zoom level restored from a previous session, into a window of a
  different width, is a worse first impression than the fitted default.
- Pixel constants keep their meaning, which is the point of expressing them in
  pixels: `SNAP_PX` is 8 screen pixels at every zoom (16 frames in a fitted
  minute, one frame magnified), and a clip narrower than 24px is still widened
  so it stays grabbable — by CSS `min-width`, so the component no longer has to
  know the number.
