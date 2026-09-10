# 0014 — A clip puts its picture in the box: zoom, pan and quarter turns

- Status: Accepted
- Date: 2026-09-10

## Context

E7's fourth item is "transform": where a clip's picture sits in the
frame. Every editor has a version of it, and the same three questions come
first.

**What is stored?** A full affine matrix is the general answer and the
wrong one for a first-time user, who has three intentions: make it bigger,
move it, turn it the right way up. Anything the matrix can express beyond
those (skew, free rotation, non-uniform scale) is a thing they would have
to undo by hand.

**Move by how much?** A pan in source pixels means "half a screen" is a
different number at every zoom and for every file. A pan in fractions of
the BOX means the same thing everywhere, and a drag on the preview is one
division away from it.

**Where is it applied?** The preview and the export already draw a frame
through one function (`composeFrame`, ADR-0011, ADR-0012). A transform
applied anywhere else would be the first thing the two surfaces could
disagree on since that function was written.

## Decision

**Four optional fields on the clip**: `zoom` (a multiple of the fit, 1–4),
`panX` / `panY` (fractions of the box at the fit, −0.5..0.5), `rotation`
(90, 180 or 270, clockwise). All absent is as shot: fitted into the box, centred, upright.
`pictureTransform` reads them clamped and defaulted; a value outside the
range is read at the edge, never rewritten.

**`pictureRect` is the one place that says where the picture is drawn**:
the turned footprint fitted into the box (a quarter turn swaps the sides),
grown `zoom` times about the box's centre, moved by the pan TIMES the zoom.
The pan scales with the zoom so that the point of the picture at the box's
centre stays put when the zoom changes — frame a subject, then grow it — and
so that half a box of pan is always exactly enough to bring the picture's own
edge to the centre: every part reachable, at least half the box always
showing picture. A QA reviewer found the first version growing about the
shot's original centre, which slid a framed subject away on zoom; a novice
reviewer found a pan that could push the whole picture out, leaving black
with no explanation. The panel says when a side of the box has gone black
(`coversBox`).

**The limit is per axis and per picture** (`panLimits`): half of the
fitted footprint's share of the box on that axis, at most half a box,
rounded down to a slider notch. For a picture that fills the axis that is
the half box above; for one narrower than the box — stood up by a quarter
turn, or 4:3 in 16:9 — it is where that picture's own edge reaches the
centre (a 16:9 stood up in a 16:9 box: 15% sideways). The first shipped
version used half a box for every picture, and a stood-up clip panned
half a box left the box entirely: an all-black preview under "화면 한쪽이
비어요", seen in the owner's Chrome on 2026-09-10. `clip.pan` clamps to
the limit, `clip.rotate` pulls a pan inside the limit the turn creates and
says so in its sentence, the sliders end at it and say why
(`clip-picture-limit`), and `pictureRect` reads a stored pan past it at
the limit — never rewritten, the sound ceiling's rule. `composeFrame`
draws exactly that, for the footage and — where ITS clip puts it — for the
other side of a dissolve, on the preview and in the file. The unturned case
goes through the same `drawImage` call it always did; only a turn saves the
context, translates to the picture's centre and rotates.

**The plan records it.** `ExportFrame.transform` and `Blend.transform`,
present only when the clip is not as shot, for the reason the words and the
blend are in the plan: one answer per frame, for both surfaces.

**Four commands, of two kinds.** `clip.rotate` (a quarter on, or an exact
turn; `R`; in the palette) and `clip.pictureReset` (everything back; in
the palette) do whole things. `clip.zoom` and `clip.pan` set numbers and
need them (`requiresArgs`): the panel's sliders and a drag on the preview
are their callers, each notch or pointer move a dispatch with a coalesce
key, so a drag is one undo step.

**A drag on the preview moves the SELECTED clip's picture, while it is the
one under the playhead.** A first press on a different clip selects it and
says so; the next drag moves it. (The first version moved whatever was under
the playhead and reselected silently — the novice reviewer's blocker: the
panel showed one clip's numbers while another clip changed.) Pixels over
the picture canvas's CSS size, divided by the zoom, are the pan.

**The word is 화면, throughout**: 확대 (the slider), 화면 돌리기, 화면 원래대로,
화면 위치 바꾸기, and every sentence. Two words for one picture (화면 / 그림)
and a second 크기 under 소리 크기 were both flagged by the novice reviewer.
A pan is said with its direction (오른쪽으로 50%), never as a signed number.

## Consequences

- Rotation is by quarters only; the rotation-metadata debt (a source shot
  sideways renders sideways) now has a manual fix, not an automatic one.
- Zoom crops. Nothing warns that a 400% zoom of a 720p file shows 180
  real pixels across the box.
- A pan can leave a side of the box black at the fit (half a box at most);
  the panel's note says so (화면 한쪽이 비어요). It can never leave the
  whole box black: the picture's edge stops at the centre on every axis.
- A quarter turn can move the pan sliders' ends and pull the pan in with
  them; the turn's sentence says so, and one undo restores both.
- The strip's clip pictures are still the source frames as shot. The
  thumbnails do not zoom, pan or turn with the clip.
- `carriedFields` grew to eight fields; copy, paste and split carry them.
