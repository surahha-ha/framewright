# UX principles — simple, familiar, accessible

The editor must feel easy from the first minute. These principles are a guardrail:
prefer the option that is simpler, more familiar, and more accessible.

## Familiar (transfer knowledge, don't reinvent)

- Reuse conventions people already know: `Space` play/pause, `C` split (Premiere's
  razor), `V` select, `J/K/L` shuttle, drag to move, edges to trim, a horizontal
  timeline with a playhead.
- Standard icons and layout (source/preview/properties/timeline) so no relearning.
- Familiar words ("cut", "trim", "export"), not internal jargon.

### One word, one meaning — and one shape

Five controls once said 자르기 / 잘라내기 for three different edits, and `✂`
(split) sat three buttons from `✁` (clipboard cut). A toolbar is scanned, not
read: someone wanting to drop the first 30 seconds was picking by coin flip.

| edit                                   | word                                          | glyph   |
| -------------------------------------- | --------------------------------------------- | ------- |
| put a clip on the clipboard (`Ctrl+X`) | **잘라내기**                                  | `✂`     |
| make one clip into two (`C`)           | **나누기**                                    | `◫`     |
| trim to the playhead (`Q` / `W`)       | **재생 위치까지 앞부분 / 뒷부분 줄이기**      | `◧` `◨` |
| trim by one frame (`Alt`+arrows)       | **앞부분 / 뒷부분 한 프레임 줄이기 · 늘리기** | —       |
| trim by dragging an edge               | **앞부분 / 뒷부분 조절** (never rendered)     | —       |

`잘라내기` + `Ctrl+X` + scissors is what every OS teaches, so the clipboard keeps
all three; trimming borrows the nudges' 줄이기 / 늘리기 because they are the same
edit at different sizes. A drag says 조절, not 줄이기, because pulling a handle
outwards puts trimmed media **back** — and `Q`/`W` carry 재생 위치까지 in the
label itself, because that is the one fact that decides what the button does and
a tooltip is not where it can live.

The same applies to what an edit **says it did**: the sentence hedges (조절했어요)
only when the caller genuinely cannot know the direction, and a gap is only ever
announced on the side the edit could have opened. Announcing a hole that was
already there is a claim the user cannot check.

The rule generalises: **no name may be, or contain, another name**, and no two
buttons may wear the same glyph. Asserted in three places, because no one of
them sees the whole surface — `src/engine/vocabulary.test.ts` (the command
registry), and the toolbar and shortcut-list scans in `e2e/personas.spec.ts`
(which add the app actions and the keyboard-only commands).

## Direct manipulation (the timeline is the document)

- Drag a clip's body to move it; drag either edge to trim it. Edges show a grab
  affordance on hover/selection, and a short clip only ever moves — a handle you
  can grab but never use is worse than no handle.
- A gesture is one undo step: the drag only previews, and the command is
  dispatched on release. A press without movement stays a plain click (select).
- Snapping (8px) to neighbours, the playhead, `0` and the timeline end — never to
  the clip's own edges, or a small nudge would always spring back.
- Grabbing a trim handle does not scrub, so "trim to the playhead" is possible.
- Every drag has a keyboard equivalent: `Alt`+`←`/`→` move, `Alt`+`Shift`+arrows
  trim the head, and `Q`/`W` trim head/tail to the playhead. `Q`/`W` are the
  primary route, not a bonus: `Ctrl`+`Alt`+arrow is a workspace switch on GNOME
  and a tab switch on macOS, so a modifier-free binding is the only one that is
  reliably available. A held key coalesces into one undo step, like a drag.
- When a drag stops, say why ("옆 클립에 닿았어요", "원본 영상이 여기까지예요").
  A control that freezes with no explanation reads as broken, not as bounded.
- Gaps are allowed, drawn (hatched), and never silently rearranged: `빈 곳 없애기`
  closes them on request. An automatic magnetic mode would move clips the user
  didn't touch. The preview paints black in a gap, because that is what export
  writes there — the picture must never promise footage the file won't have.

## Simple (reduce choices, sensible defaults)

- Progressive disclosure: basics visible, advanced folded away.
- Strong defaults + templates so the common task needs no configuration.
- One obvious way to do the common thing; the properties panel shows only what's selected.
- Avoid a wall of options; a beginner should finish a basic edit without a manual.

## Accessible (works for everyone)

- Fully keyboard-navigable; visible focus; logical tab order.
- ARIA roles/labels on controls; the transport and timeline are operable without a mouse.
- A composite widget never nests interactive children inside a `slider`/`option`
  role — ARIA makes those children presentational, silently deleting their names
  and states. The playhead (`.ruler`) and the clip strip (`.track`) are separate.
- Unavailable actions are `aria-disabled`, not `disabled`: they stay in the tab
  order and can say what they are waiting for.
- Sufficient color contrast; never rely on color alone.
- Respect `prefers-reduced-motion`; captions/subtitles are first-class, not an afterthought.

## Forgiving (never punish a mistake)

- Undo/redo everywhere; non-destructive edits (originals untouched).
- Autosave + version history; clear, one-click recovery.

## Honest feedback

- Progress for anything slow; cancelable long operations.
- Plain-language errors that say what happened and what to do next (see RUNBOOK.md).

## Performance is UX

- Proxy scrubbing and a warm decoder keep interaction responsive — smoothness is a
  usability feature, not a nice-to-have.

> When a design choice is unclear, pick the one a first-time user would find obvious.
