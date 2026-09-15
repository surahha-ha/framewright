# 0017 — A subtitle has a look, a place and a way in, as fields, drawn once

- Status: Accepted
- Date: 2026-09-15

## Context

E8's second item was written down on 2026-08-12 as two words, "style
presets", and the conversation behind them was never recorded. The owner
defined it on 2026-09-15: **예능 자막**, the caption of a Korean variety
show — words that are styled, that sit anywhere on the picture rather than
only along the bottom, and that come and go with an effect. Not shorts-only.
The owner's end goal is dragging a subtitle to any spot on the picture;
images and stickers are wanted later (E10).

Against the code as it stood — one `Subtitle` shape (`id`, `text`, a frame
range), one fixed look drawn by one function for both the preview and the
export (ADR-0011) — four questions had to be settled before the first
layer, E8-2a, could be built.

**One kind of subtitle or two?** A variety caption is a short punch phrase,
not a transcription. It could be a second list ("titles") with its own
panel, lane and commands; or fields on the subtitle everyone already has.

**Where is a placed subtitle's position kept?** Pixels of the preview, a
named slot (아래 / 가운데 / 위), or fractions of the box. The drag to come
(E8-2c) decides this: whatever the presets write, the drag must write too,
or the two will disagree.

**How does an effect reach the file?** The export plan records the words
per frame as a string (ADR-0011: one answer per frame, so the preview and
the export cannot disagree). An effect is a value that changes on every
frame of its way in; a string cannot carry it.

**How long is the way in, and what of a short subtitle?** A 0.5 s subtitle
with a 0.25 s way in and a 0.25 s way out would never be fully shown.

## Decision

**Fields on the subtitle, all optional, absent = the subtitle every project
had.** `look?: 'bold' | 'shout'`, `posX?` / `posY?`, `effect?: 'fade' |
'pop' | 'rise'`. No second list. The schema stays at 2 and `upgradeProject`
is untouched — the same convention as a clip's `zoom` and `panX`
(ADR-0014). The 기본 look, the 아래 place and the 바로 effect are written
as ABSENT fields, never as a value, so a document that has had a choice
undone is byte-for-byte the document it was (`subtitleCommands.test.ts`
asserts the JSON). `splitSubtitleAt` copies every field into the tail; a
paste that splits a styled subtitle leaves two styled halves.

**The place is the centre of the text block as fractions of the box**, the
language a clip's pan already speaks. The three presets are three values
of it (가운데 = 0.5, 위 = 0.15, both at `posX` 0.5; 아래 = absent, which
is the bottom-margin stack the renderer always drew). Any value in [0, 1]
is legal — the drag will write arbitrary ones — and the draw keeps the
block a margin inside the box, centring a block taller than the room
rather than pushing it off an edge. Each axis stands alone: a `posX` with
no `posY` moves the bottom stack sideways. `placeOf` names the preset a
subtitle is at, or null when no preset names it; then the panel's row has
nothing checked.

**Three looks, in one table (`SUBTITLE_LOOKS` in `subtitleRender.ts`),
every number relative to the picture's height like the plain font is.**
기본: the white-on-pill subtitle as before. 강조: yellow ink, a black
outline, no pill, 1.4× the font. 외침: white ink, a thicker outline, 1.8×,
weight 800. Three because a first-time user picks from a row, not a colour
wheel (UX.md "Simple"); yellow with an outline because it is what every
Korean variety caption reaches for first. Custom colours and sizes are not
in this unit.

**Three effects, one length, capped.** 서서히 (alpha 0 → 1), 톡 (scale
0.6 → 1 about the block's centre, ease-out), 올라오기 (from 6% of the box
height below, ease-out). `EFFECT_SEC = 0.25`, an engine constant, rounded
to frames through `time.ts` and **capped at half the subtitle's length**,
so the way in and the way out never overlap and a subtitle is always fully
shown for at least the middle of its life; a one-frame subtitle is simply
shown. The same effect runs at both edges, mirrored. `subtitlePhase` gives
`t` in [0, 1] per frame: `min(1, (frame − start + 1) / n, (end − frame) /
n)`, so the first and last frames show `1 / n` — something is visible on
every frame the subtitle owns, half-open like everything else.

**One object per frame for both surfaces.** `SubtitleFrame = { text, look?,
posX?, posY?, effect?, t }` is built by `subtitleFrameOf` /
`subtitleFrameAt` (`subtitleStyle.ts`); `ExportFrame.subtitle` carries it
(it was a string), and `Preview` builds the same object with the draft's
words swapped in while typing. `drawSubtitle` takes it. A plain subtitle
goes through exactly the canvas calls it always did — no save, no
transform (`compose.test.ts` pins that); an effect is applied inside a
save/restore so the next frame starts clean. A held frame after the
subtitle's end still carries none (ADR-0011).

**Three arg-taking commands, one field each, one undo step each:**
`subtitle.setLook` 자막 모양 고르기, `subtitle.setPlace` 자막 자리 고르기,
`subtitle.setEffect` 자막 효과 고르기 — hidden from the palette like
`subtitle.setText`, since the panel supplies the subtitle and the choice.
A choice already made is refused (not an edit, not an undo entry) and the
panel says so. The sentences name the choice — "자막 모양을 강조로
바꿨어요.", "자막 자리를 위로 옮겼어요.", "자막 효과를 톡으로 바꿨어요." —
with 로 / 으로 chosen by the last syllable (`toward`; the first e2e run
announced "톡로").

**The surface is three radiogroups in the subtitle panel**, under one
heading 꾸미기: 모양 (기본 / 강조 / 외침), 자리 (아래 / 가운데 / 위), 효과
(바로 / 서서히 / 톡 / 올라오기), the `FramePicker` pattern — one Tab stop
per row, the arrows move choice and focus together, the checked radio is
chosen rather than unavailable. No toolbar button, no default key.

## Consequences

- The drag (E8-2c) is a gesture on the stage that writes `posX` / `posY`;
  nothing in the document or the draw changes for it. Fonts (E8-2b) are a
  fourth look-table column and a load-before-export step.
- The export plan grew: every frame under a subtitle carries an object
  instead of a string. The plan is built once per export and per frame
  count; the cost is a few fields per frame.
- `updateSubtitle` now drops `undefined` fields like `updateClip` does
  (`ops.ts` `dropUndefined`). Before this unit no subtitle op ever wrote
  one; the first inverse that did left an own key holding `undefined` on
  the live document, invisible to `JSON.stringify` and to `toEqual`, seen
  by `Object.keys` and `toStrictEqual`. The reviewer caught it; the test
  now asserts strictly.
- The effect's sentence carries what the effect is ("자막 효과를 톡으로
  바꿨어요 · 작았다가 톡 커지며 나타나요."), and each radio's hint is its
  `aria-describedby` as well as its `title`: on most frames the sentence
  is the only proof the effect changed, and a hover is mouse-only (novice,
  a11y).
- The palette does not list the nine choices. Three arg-taking commands
  were chosen over nine visible ones; whether the palette should offer
  "자막 자리를 위로" as a row is the owner's call, recorded as debt.
- The look table is three rows. A fourth look, or a user's own colour,
  changes the panel from a row of radios to something else; that is a
  design decision, not a table entry.
- `Choices` in `SubtitlePanel.tsx` is the second copy of the radiogroup
  keyboard code (`FramePicker` is the first). A third is the trigger to
  extract it.
- An effect's first and last frames are at `1 / n` of the way in, never
  fully hidden. A subtitle that should start invisible and fade in over
  0.25 s would need `t` to reach 0 on its first frame, which would draw
  nothing on a frame the subtitle owns; the half-open convention was kept
  over that.
