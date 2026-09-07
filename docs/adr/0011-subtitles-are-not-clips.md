# 0011 — Subtitles are not clips, and are drawn once for both preview and export

- Status: Accepted
- Date: 2026-09-07

## Context

E7 opens with subtitles. Two things had to be decided before a line of it
could be written, and both could reasonably have gone the other way.

**What a subtitle is in the document.** `Track.type` has carried `'text'`
since E0 and nothing ever used it; the obvious move was a text track whose
clips carry a `text` field. But a `Clip` is a window onto a source file —
`assetId`, `inFrame`, `outFrame` are what it is — and every consumer of
`track.clips` (drag bounds, trim limits, the export plan, the thumbnail and
waveform strips, the clipboard) reads those three fields. A subtitle has none
of them. Making `Clip` a union would have put a branch in each of those
places, or made a subtitle carry a fake source.

**Where the words are drawn.** The preview paints a decoded `VideoFrame` onto a
canvas and the export paints one onto an `OffscreenCanvas`; the words could be
an HTML layer over the preview (crisp, selectable, accessible for free) and a
canvas draw in the export. Two renderers, two layouts, two fonts' worth of
metrics — and the whole reason this editor exists is that the file matches the
screen.

## Decision

**A subtitle is its own thing: `Project.subtitles: Subtitle[]`**, sorted by
start, never overlapping, `[startFrame, endFrame)` like everything else, with
its own three ops (`insertSubtitle` / `removeSubtitle` / `updateSubtitle`) and
its own commands (`src/engine/subtitleCommands.ts`). The document schema goes
to 2 and `persistence.upgradeProject` fills the list into older saves — the
live document and every version snapshot alike.

**One function draws the words for both surfaces:** `drawSubtitle` in
`src/engine/subtitleRender.ts`. Every size in it is relative to the picture's
height — the font, the padding, the bottom margin — and the layout arithmetic
(wrap, centre, stack) is separate from the canvas calls so it is unit-tested
with a fake measurer. The preview draws on a second canvas sized to the
TIMELINE's dimensions and laid over the picture by script; the export composes
each output frame from a `picture` canvas plus this draw, so a held frame
(`HOLD`) cannot carry a subtitle that has already ended. `buildExportPlan`
records the words per frame, so "what does frame N show" has one answer.

**Selection is one thing at a time.** `Editor` gains `selectedSubtitleId`;
selecting a clip clears it and vice versa. Delete has to act on the thing the
user can see is chosen, and a keymap chord binds one action, so the chip
answers Delete for itself rather than a second command claiming the key.

**The words are typed in the sidebar, committed on Enter or blur** — one undo
step per edit, not one per keystroke — and focus goes into that field only on
the signal that a command just CREATED a subtitle (`subtitleWordsWanted`).
"The words are empty" was the trigger for one afternoon, and an undo of the
words then pulled focus into the field, where the next Ctrl+Z belonged to the
browser.

## Consequences

- Nothing that iterates `track.clips` changed. `Track.type: 'text'` is still
  in the union and still unused; remove it when something else is sure nothing
  saved refers to it.
- `timelineDuration` still ignores subtitles. A subtitle can outlast a video
  that was shortened under it: it stays in the lane (the strip's content grows
  to keep it reachable), is not exported, and its own end stays a legal drag
  target so it can be pulled back in.
- Preview and export can still disagree in one case that predates this: the
  preview draws the frame at its own size, the export letterboxes it into the
  timeline's box. The overlay is scaled onto the preview's picture box, so
  when the two aspect ratios differ the words are proportionally right for the
  export and slightly off for the preview. The first import sets the timeline
  from the footage, so the case needs a mixed-aspect project.
- The font stack is resolved by the browser doing the drawing. The same
  browser previews and exports, so they agree; a different machine may wrap a
  line differently. A bundled font would fix it at the cost of a download.
- **Captions follow the footage.** Ripple delete, paste-push and close-gaps
  move the subtitles with the frames they caption (`rippleSubtitles`). A
  subtitle wholly inside a removed span goes with it (undoably); one across
  the edge of a removed span keeps its surviving part; **one across a paste
  point is split in two**, the tail taking a new id and moving with the
  footage after the paste, so neither half captions the pasted frames. The
  owner chose the split after seeing the alternative on a real frame: left
  alone, the words sat on the pasted clip and were gone from the shot they
  were written for. `clip.move` and the trims do not ripple — they open
  gaps, they do not remove time.
- No styling. One look — white words on a translucent pill, bottom-centred —
  is the decision until someone asks for a second one; position, colour and
  size are the obvious fields to add to `Subtitle` when that happens, and the
  layout function is where they would land.
- ASR (automatic captions) is a separate decision and deliberately not here:
  `docs/research/editor-pain-points.md` §7 says why — doing it on a server
  ends the "your video never leaves the browser" position.
