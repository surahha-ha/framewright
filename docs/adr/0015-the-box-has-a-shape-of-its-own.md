# 0015 — The box has a shape of its own: 가로, 세로, 정사각

- Status: Accepted
- Date: 2026-09-11

## Context

E8's first item is the shorts reframe: a 9:16 video out of a project whose
footage is 16:9. ADR-0014 made "where is a clip's picture drawn" one
question with one answer — `pictureRect`, fitting the turned footprint into
"the box", grown and moved from there — and left one thing unnamed: what
the box IS when it is not the first import's shape.

Three things decide it.

**The box already exists, in one place.** `timeline.width × height` is set
by the first import (`Editor.importAsset`, the way a real NLE takes its
sequence from the first file), and read by the preview's canvas, the
export's encoder and muxer, the pan limits, and the subtitle layout (font
and margins relative to the box's height, ADR-0011). Nothing else has a
size of its own. So a 9:16 output is not a new concept; it is the one
number every drawing surface already reads, taking another value.

**What pixel size does a shape get?** Doubling the long side or keeping
the pixel COUNT both give a portrait box a resolution its footage cannot
fill. Keeping the short side does not: 1280×720 stood up is 720×1280 —
the footage's own resolution across, the size a phone expects — and laid
back down it is 1280×720 again, so the presets are each other's inverse
and the same project can be exported both ways without drifting.

**What happens to the clips?** A 16:9 picture fitted into a 9:16 box is
a strip across the middle with black above and below. That is exactly
what `pictureRect` says (fit, then zoom, then pan) and it is honest, but
it is not what someone who pressed 세로 wanted, and "zoom to 320%" is not
a step a first-time user can be expected to find. And the panel's note
about black sides — `coversBox` — reasoned from the zoom and the pan alone,
as if every picture filled the box at the fit; a stood-up clip already
showed black at both sides under a note that said nothing (listed as debt
after ADR-0014). In a box of another shape that would be every clip.

## Decision

**Three commands change the box** — `frame.landscape` (가로 영상으로
바꾸기, 16:9), `frame.portrait` (세로 영상으로 바꾸기, 9:16),
`frame.square` (정사각 영상으로 바꾸기, 1:1) — each one `setTimeline` op
with the frame rate kept and the previous box as its inverse. The size is
`frameSize`: the short side keeps its pixel count (nearest even), the long
side follows the ratio. Nothing on any clip is rewritten: every picture
is fitted into the new box by the same rectangle it always was, and a pan
the new box cannot show is read at the new limit and shown there, never
changed (the sound ceiling's rule, ADR-0013). A radiogroup over the
preview (가로 · 세로 · 정사각, with the pixel size beside them) and the
palette are the routes. Radios, not toggle buttons: exactly one shape is
ever current, and the current one is chosen, not unavailable — a button
that read "pressed, dimmed" to a screen reader was the a11y reviewer's
objection — so the checked radio is never `aria-disabled` (choosing it
again says "지금 세로 영상이에요." and changes nothing), the others are
disabled only before the first import, and the arrows move between them
as one Tab stop.

**The commands refuse an empty project** ("영상을 먼저 넣어 주세요."),
because the first import sets the box from the footage and would silently
overwrite a shape chosen before it. The alternative — a "chosen" flag the
import respects — is one more field for a case that has no footage to
look at yet.

**`clip.pictureFill` (화면 채우기) grows the picture until it covers the
box**: the zoom is `fillZoom`, the smallest slider notch at or above the
exact cover ratio (320% for 16:9 in 9:16, 240% for 4:3, 180% in a square),
capped at the slider's 400%, so a hairline of black never survives the
rounding. The pan is kept — the fill is not a reset, and a framing the
user chose is theirs — and the sentence says what that leaves: "화면을
320%로 확대해 꽉 채웠어요.", or "…확대했어요 · 옮겨 둔 위치 때문에 화면
왼쪽이 비어요", or at the cap "…400%까지 확대했어요 · 더는 키울 수 없어
화면 위아래가 비어요". A picture already big enough but moved off centre
is refused with "확대는 충분해요 · 위치를 가운데로 옮기면 꽉 차요.", not
"already full" over a black side; one at the cap that would not cover the
box even centred is refused with "더는 키울 수 없어요 · 화면 위아래가
비어요" (the QA reviewer found the first version blaming the position of
a picture that was already centred). The box change's own sentence points
here: "…으로 바꿨어요 · 비는 클립을 고르고 화면 채우기를 누르면 꽉
차요." when any clip's picture stopped covering the box — "pick the clip"
included, because the fill lives in the clip panel, which is not on
screen until a clip is chosen — and "· 크게 확대된 클립은 화면 원래대로로
되돌릴 수 있어요" when a clip is zoomed past what the new box needs: a
clip filled for 세로 and taken back to 가로 is a crop to a third with no
black to show it (the novice reviewer's finding). The zoom itself is
kept; the box change rewrites nothing on any clip.

**The stage is not black.** The box draws its own black — a fade, a gap,
the sides a picture does not reach — and that black is in the file. The
room around the box on screen is not, and with a portrait box in a
landscape stage the two were one undifferentiated frame: 화면 채우기
removed the bars and the screen still looked black on every side (the
novice reviewer's blocker). The stage is the app's ground colour now and
the picture canvas carries a hairline edge, so "black inside the line is
your video" holds.

**The empty sides are geometric now.** `emptySides` reads `pictureRect` —
the turned footprint, the zoom, the pan as drawn — and names the sides of
the box the picture does not reach; `coversBox` is its emptiness.
`emptySidesText` says them in one sentence shape ("화면 위아래가 비어요",
"화면 양옆이 비어요", "화면 왼쪽이 비어요", "화면 위아래와 오른쪽이
비어요"), under the sliders, whether a pan, a turn or the box's own shape
left the black. The turn's own black sides are said now.

## Consequences

- One number changed, four surfaces followed: the preview canvas, the
  export, the pan limits and the subtitle layout all took the new box
  with no change of their own. That is the ADR-0014 design paying off,
  and the reason the reframe was taken before the style presets.
- A box change is document-wide but touches no clip, so undo is one step
  and a clip's stored zoom and pan mean the same thing in every box.
- Filling crops. A 16:9 clip filled into a 9:16 box shows the middle
  third of its width; the pan sliders and a drag on the preview choose
  which third. The strip's thumbnails still show the frames as shot.
- Filling is per clip. A project of seven clips stood up needs seven
  presses of 화면 채우기, or a paste of one filled clip's attributes —
  which does not exist yet. A "fill every clip" command is the obvious
  next lever; it was left out so that the box change itself rewrites
  nothing, and so the owner can decide whether "세로" should imply
  "채우기" for a first-time user.
- `frameShapeOf` names only the three presets. A 4:3 source project is
  "1440×1080" on the picker with nothing pressed, and every preset is
  offered; there is no way back to 4:3 but undo.
- The pixel size is the footage's short side, so a 480p project stood up
  exports at 480×854 — small for a phone screen. Upscaling was
  deliberately not offered: the encoder cost would be paid for pixels the
  file does not have.
