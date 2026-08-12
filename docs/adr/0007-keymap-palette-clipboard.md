# 0007 — Bindings as data, and what a paste is allowed to move

- Status: Accepted

## Context

E6 asked for three things at once: a user-editable keymap, a ⌘K command palette,
and clipboard (cut / copy / paste). They look like three features; they are one
question asked three times — **what is the list of things this editor can do, and
who is allowed to name them?**

Three concrete problems forced the answers:

1. **The last hardcoded bindings.** `Alt`+arrow (move) and its `Shift` / `Ctrl`
   variants were spelled out inside `ui/Timeline.tsx`. A user keymap could never
   have reached them, and the hint line under the track quoted them as prose that
   any rebinding would silently falsify.
2. **Undo, copy and play are not commands.** ADR-0003 says every document edit is
   a command with an inverse. Undo produces no patch. Neither does copy, nor
   play/pause, nor "open the palette". They are still things a key can be bound
   to and a palette can list, so they need a home that is not the command
   registry — and putting them there anyway would mean a command that returns an
   empty patch, i.e. an undo entry that undoes nothing.
3. **Paste has to put the clip somewhere.** The playhead is usually in the middle
   of a clip, the track is single, and ADR-0006 rejected a magnetic mode that
   reflows clips the user did not touch. Overwriting, splitting, and silently
   appending at the end are all defensible and all wrong in someone's hands.

## Decision

### A chord is a canonical string; the keymap is a value

`src/engine/keymap.ts` turns a key press into `mod+alt+shift+key` (in that fixed
order, `mod` covering Ctrl and Cmd) and back. `resolveKeymap(bindables,
overrides)` folds the registry's `defaultKey`s and the user's stored overrides
into one lookup. Two properties are now **structural rather than remembered**:

- `c` and `mod+c` are different chords, so a single-key binding can never fire
  with a modifier held. That is the `Ctrl+C`-splits-the-clip and
  `Ctrl+W`-trims-then-closes-the-tab bug, made impossible instead of guarded.
- A modifier pressed on its own is not a chord, so holding `Alt` on the way to
  `Alt`+← never looks like a binding.

A collision is **reported, not resolved silently**: an override beats a default,
the loser is left genuinely unbound, and the settings panel says so. Rebinding to
a taken chord takes it and names the previous owner. Overrides live in their own
`localStorage` key, because a keymap belongs to the person, not to the document —
restoring last Tuesday's version must not restore last Tuesday's shortcuts.

The six `Alt`+arrow nudges are now ordinary commands (`clip.moveLeft`,
`clip.headExtend`, …), bindable and listable like everything else, and the hint
line under the track is rendered _from_ the keymap.

### Commands edit the document; app actions do everything else

`src/ui/actions.ts` holds `AppAction` — the same display shape (`label`, `icon`,
`defaultKey`, `canRun`, `disabledReason`) with `perform()` instead of `run() =>
Patch`. Undo, redo, copy, cut, play/pause, the two playhead steps and the two
overlays are actions. The keymap, the palette and the toolbar treat commands and
actions identically; only the dispatcher knows the difference.

This is a second concept, which the "don't over-abstract" rule says to justify.
The justification is that the alternative is worse in a specific way: a command
whose `run` returns `{forward: [], inverse: []}` is a lie about what a command is,
and every consumer of the registry would then have to special-case it.

**The clipboard is not document state.** It lives on the `Editor` beside the
playhead and the selection, not in the `Project`. Undo must not empty your
clipboard, a version restore must not repopulate it, and it must never be
serialised into a saved project. Copy is therefore an action; `clip.paste` is a
command that reads `ctx.clipboard`.

### Paste never destroys, and says where it went

`src/engine/clipboard.ts` owns the placement, pure and unit-tested:

1. **The insert point is never inside a clip.** If the playhead is, it moves to
   that clip's nearer edge (ties go to the end — "after the thing I am looking
   at"). Nothing is ever split or overwritten.
2. **A gap is a place to put things.** If the free space at the insert point is
   big enough, the clip lands there and nothing else moves.
3. **Otherwise later clips move right by exactly what the space falls short** —
   no more, so spacing the user chose elsewhere survives.

Rule 3 is a push on an _explicit command_, which is a different thing from the
magnetic mode ADR-0006 rejected: nothing reflows unless you ask it to. Every one
of these decisions is announced in the status bar, because a paste that lands
somewhere other than the playhead is a bug unless it explains itself.

## Consequences

- `Command.done` may now be a function of `(before, after)`. `after` is where
  things ended up (a nudge reports its new position); `before` is the only place
  that still knows what was _asked for_ (a paste reports the placement it chose,
  which the finished document can no longer tell you).
- `locateClip` / `trimLimits` moved from `commands.ts` to `timeline.ts`. They are
  timeline queries, and `drag.ts` needed them without importing the command
  catalogue — which is what let `commands.ts` import `drag.ts` for the nudge
  limits instead of duplicating the bounds arithmetic.
- `Command.requiresArgs` marks the three drag commands that no button or palette
  row could ever run; `Command.repeatable` marks the commands whose held key
  coalesces into one undo entry (sound only because their ops are absolute
  assignments — see ADR-0006).
- Two modal surfaces now exist. They are keyboard-first: focus moves in on open,
  is trapped, and goes back to the opener on close. While either is open the
  global keymap is inert, so the dialog owns the keyboard completely.
- Pasting a clip whose asset has been removed (undo an import) is refused rather
  than producing a clip that exports as black.
