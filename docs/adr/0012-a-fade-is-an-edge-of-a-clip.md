# 0012 — A fade is an edge of a clip, and what it fades into is not stored

- Status: Accepted
- Date: 2026-09-09

## Context

E7's second item is transitions. Every editor offers a cross-dissolve at a
cut and a fade from/to black at the ends, and every one of them has to answer
the same three questions first.

**Where does a transition live in the document?** The obvious model is an
object at a cut — "between clip A and clip B, N frames". It breaks the moment
the two are no longer butted: a move opens a gap and the object refers to a
cut that does not exist. Premiere keeps such an object and re-attaches it to
one side; iMovie and Final Cut avoid the question by shortening the clips to
make them overlap, which is precisely the reflow ADR-0006 refused
(`docs/research/editor-pain-points.md` G10: _"every time I add a transition it
moves all clips out of sync with the music"_).

**Where do the extra frames come from?** A dissolve of N frames shows two
pictures on each of those frames. One is the clip's own; the other must come
from the neighbour's file BEYOND its trimmed edge — its overhang after the
out-point, or its pre-roll before the in-point. The commonest first-time
case, two whole files butted together, has no overhang at all.

**How does the picture get made?** The preview and the export each kept one
streaming decoder and their own copy of the "can it carry on, or must it
re-cue" rule (`isContinuous`). A dissolve needs two decoders per frame, and
after the cut the one that was primary becomes the one underneath — the same
forward run, not a restart.

## Decision

**A fade is a property of a clip's edge**: `Clip.fadeIn` and `Clip.fadeOut`,
each a number of TIMELINE frames, absent for a hard cut. Nothing else is
stored. What the edge fades INTO is derived (`src/engine/fades.ts`,
`fadePartner`): the butted neighbour when there is one and it does not soften
the same cut itself, and black otherwise. So one field is a dissolve at a
cut, a fade from black at the start of the video, and a fade into a gap — and
a fade never moves a clip. When both sides soften one cut the result is a dip
through black, not the neighbour's overhang flashing back at full strength the
frame after it went dark.

**A fade lives inside its clip's frames**: a fade-in over the first N frames,
a fade-out over the last N. Not centred on the cut. Centred needs BOTH files'
overhang; edge-anchored needs one, and the difference is invisible to the
person watching. The weight is linear: the first frame of a fade-in is fully
the partner, the last frame of a fade-out is fully the partner.

**The neighbour's picture beyond its edge is its overhang, and when the file
has none, its last real frame held.** Never a frame the file lacks, and the
file's length is trusted the way trimming trusts it (unmeasured means none).
Two full files butted together therefore dissolve from a held last frame —
what Premiere calls "repeated frames", and honest.

**Fades are clamped when read, and no trim rewrites them.** `effectiveFades` fits them
to the clip, head first, so no frame belongs to two fades. A trim that
shortens a clip under its fade changes nothing in the document; lengthen it
again and the fade is back. A split strips the fade-out from the head and the
fade-in from the tail, and writes each surviving fade at what its piece can
hold. A split OUTSIDE the fades changes nothing about the picture; one inside
a fade cannot keep the ramp whole — each piece fades over what it has, which
is steeper — and the split's own sentence says so.

**The plan records the blend.** `ExportFrame.blend` names the second picture
and its weight, for the same reason it records the words: one answer per
frame, for both surfaces.

**One pool of decoders, one draw.** `src/engine/feeds.ts` holds the
"continue or re-cue" rule once and runs as many sessions as a frame needs; a
feed keeps its newest picture, so a held frame is drawn from there rather
than remembered by a canvas. `src/engine/compose.ts` paints black, the
footage letterboxed into the timeline's box, the blend at its weight, the
words — for the preview and the export alike. The preview's canvas is now the
TIMELINE's size, which retires the one case where the two disagreed.

**The sound follows the picture.** `buildAudioSchedule` puts a linear gain
ramp on the same frames, lets the previous clip's audio run on under a
fade-in and starts the next clip's early under a fade-out, and the same
ramp is scheduled on a `GainNode` by the player and the offline render.

**The words are 서서히 나타나기 / 서서히 사라지기, and the length is in
seconds.** The panel says what the edge goes to (앞 클립과 겹쳐서 / 검은 화면에서),
so "dissolve" is never a word to learn. `00:00:15` reads as fifteen seconds
to a first-time user; a fade is "0.5초".

## Consequences

- Two decoders run through a dissolve, on the main thread like everything
  else. A cold start at a cut still exists (it did before); a dissolve that
  starts the NEXT clip's pre-roll early is a cold start N frames sooner.
- A dissolve across a split of one shot is invisible — both sides show the
  same frames — and correct. The pool answers the identical want with one
  decoder.
- The audio crossfade is linear, like the picture. An equal-power curve
  would sound better through a long dissolve; it would then disagree with
  what the eye sees ramping. Left linear on purpose, noted as debt.
- Both `A.fadeOut` and `B.fadeIn` at one cut are legal and dip through black.
  Nothing prevents it; the panel and the status line both say where each
  edge goes.
- `ClipboardEntry` carries the fades, so paste keeps the look. The document
  schema does not change (optional fields on `Clip`).
- `Command.done` gained a third argument, the command's `args`, because a
  panel call is the only place that knows what was ASKED when the clip was
  too short for it.
