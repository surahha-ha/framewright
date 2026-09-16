# 0019 — The words are dragged on the stage: any place, snapped near a preset, one language for the drag, the sliders and the radios

- Status: Accepted
- Date: 2026-09-15

## Context

E8-2c is the owner's end goal for 예능 자막 (ADR-0017): put the words
anywhere on the picture. ADR-0017 already stored a subtitle's place as the
centre of its block in fractions of the box, so that "whatever the presets
write, the drag must write too". Three things were still open, and the
owner settled them on 2026-09-15 (evening):

**Free or snapped?** Free, with a light snap near a preset, so a drop
"about in the middle" IS 가운데 and the radio lights again.

**The keyboard's route?** Two sliders in the panel, the shape the clip's
picture already has (`RangeRow`): a screen-reader user and a keyboard user
reach what the pointer reaches, and hear it in words.

**What the 자리 row shows off every preset?** Nothing checked, plus a
sentence that says where the words are. No fourth radio: a radio that
cannot be pressed into is not a choice.

And one fact, measured, that made the rest simple: `layoutSubtitle` clamps
a placed block into the bottom margin, so `posY = 1` draws EXACTLY where
the absent field (the bottom stack every project had) draws; and an absent
`posX` is read as 0.5 by the renderer.

## Decision

**One normal form, in `engine/subtitlePosition.ts`, that every writer
goes through.** Whole percents (0.01), clamped to [0, 1]; `posX` 0.5 is
stored as ABSENT; `posY` ≥ 0.97 is stored as ABSENT. So a drop on the
horizontal centre, or at the bottom, is byte for byte the preset — and
`placeOf` lights 가운데 / 위 / 아래 for it. The radios still write
`posX: 0.5` (ADR-0017); `placeOf` and the command's no-change test read an
absent `posX` as 0.5, so the two spellings of one place are one place.

**One command, `subtitle.setPosition` 자막 자리 정하기**, arg-taking and
hidden: `{ subtitleId, posX?, posY? }`, normalised, one `fieldOps`, an
exact inverse, a no-change refusal by value. Callers dispatch under the
coalesce key `pos:<id>`, so a drag or a slider run is ONE undo step — the
pan's shape (ADR-0006, ADR-0014). Its sentence is the preset's own when
the position is one ("자막 자리를 가운데로 옮겼어요."), else "자막을
옮겼어요 · 왼쪽에서 32% · 위에서 70%." with 가로 가운데 / 맨 아래 for an
absent axis (not 가운데 alone: that word is the vertical preset's name).

**The snap is applied once, at the drop.** `snapPosition(pos,
bottomCentreY)`: each axis independently, within 0.03 of a preset's value
becomes it — `posX` the centre; `posY` 위 (0.15), 가운데 (0.5), or the
bottom stack's own centre, which depends on the block (one line, two
lines) and is measured by the caller from the bottom stack's layout
(`layoutOfFrame(..., { posX })`, no `posY`). During the move the words
follow the pointer exactly.

**The drag is the stage's, beside the pan.** The one pointerdown handler
hit-tests the words first: the pointer through the overlay's rect onto the
export grid, against `drawnBounds` — the frame's own layout
(`layoutOfFrame`, the draw's first half on its own) put through the
effect's transform, because on 올라오기's first frames the ink sits well
below its rest bounds and on 톡's it is smaller, and a press on the ink
must count. A hit selects the subtitle and starts its drag in the same
press — the words are unambiguous; the picture needs a press-to-choose
because it is not — and locks the subtitle for the gesture, so playback
moving the playhead off it changes nothing. The base is the block's REST
centre at press (the one the stored fractions name), so the first move
does not jump and does not fold an effect's offset into the document (a
bottom stack has no `posY` to start from; its drawn centre is the base). At
release the snapped normal form goes under the same key, then
`endGesture`. A press that chose another subtitle and did not move it
says so ("화면의 자막을 골랐어요 · 끌면 자리가 옮겨져요."): the panel
changed under the pointer. The cursor is a hand (`grab`) over the block,
against the picture's `move` arrows, which cover the whole stage whenever
the clip on screen is the selected one.

**The sliders are the pan's sliders.** `RangeRow` moved out of
`ClipPanel.tsx` into `ui/RangeRow.tsx` (its fifth and sixth uses); 가로
자리 · 세로 자리, 0–100 step 1, the absent fields shown as 50 and 100 and
written back as absent, `aria-valuetext` per axis in words. One sentence
under them is the sliders' description: the position words off a preset,
"<preset> 자리에 있어요 · 화면의 자막을 끌거나 슬라이더로 옮길 수 있어요"
on one — the one line that tells a first-time user the words can be
dragged at all.

## Consequences

- A document holds positions in one form, whoever wrote them; undo of a
  drag restores the exact bytes; a drop on a preset shows as the preset.
- The stage has two drags now (the picture, the words) of one shape —
  pointer capture, per-move coalesced dispatch — sharing one handler set
  with a hit test; the timeline has two of another shape (threshold,
  plan, commit at release). Each pair is at two; the rule-of-three
  trigger to extract a DOM half has not fired.
- The snap distance (3% of the box) and the bottom's threshold (97%) are
  two numbers in `subtitlePosition.ts`; a 4K box and a phone box get the
  same fractions, which is the point of fractions.
- Off every preset the row has no radio to Tab to as "the current one";
  the first radio is the Tab stop (ADR-0017's rule), and the sliders
  beneath carry the actual value.
- Nothing about the export changed: `SubtitleFrame` carried `posX` /
  `posY` since ADR-0017 and the plan draws them.
- Not built, deliberately: rotating or scaling the words, guides drawn on
  the stage (the snap is the guide), Escape cancelling a stage drag (the
  pan has none; both or neither), multi-select, images (E10).

## Amendment (2026-09-16) — the pointer stays attached at the edge

**Changed:** both stage drags — the words and the picture's pan
(ADR-0014) — clamp their value on every move and, when it WAS clamped,
move the drag's origin so that pointer and value coincide again
(`engine/stageDrag.ts`, `dragAxis`, pure and unit-tested). Before, the
origin stayed at the press: past the edge the pointer ran ahead of the
stored value, and dragging back did nothing until the pointer had
returned by the whole overshoot (the novice reviewer's E8-2c finding,
and the pan's before it).

**What did not change.** The value written is the same clamped value;
the coalesce key, the snap at the drop, the one undo step, the base
being the block's rest centre. The pan's limit is the clip's own
(`clipPanLimits`), the same one the command clamps to, so the drag never
asks for a value the command would refuse.

**Also this day:** the words drag moved out of `Preview.tsx` into
`ui/useWordsDrag.ts` (the file was 790 lines and five concerns), with
the frame's layout measured once and kept until the frame, the overlay's
size or the fonts on the page change — a hover move only tests a point
against it. The stage's one handler set stays in `Preview` and asks the
hook first; the two stage drags are still a pair, and a third (E10's
images) is still the trigger to extract the DOM half they share.
