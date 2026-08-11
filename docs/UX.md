# UX principles — simple, familiar, accessible

The editor must feel easy from the first minute. These principles are a guardrail:
prefer the option that is simpler, more familiar, and more accessible.

## Familiar (transfer knowledge, don't reinvent)

- Reuse conventions people already know: `Space` play/pause, `C` cut, `V` select,
  `J/K/L` shuttle, drag to move, edges to trim, a horizontal timeline with a playhead.
- Standard icons and layout (source/preview/properties/timeline) so no relearning.
- Familiar words ("cut", "trim", "export"), not internal jargon.

## Simple (reduce choices, sensible defaults)

- Progressive disclosure: basics visible, advanced folded away.
- Strong defaults + templates so the common task needs no configuration.
- One obvious way to do the common thing; the properties panel shows only what's selected.
- Avoid a wall of options; a beginner should finish a basic edit without a manual.

## Accessible (works for everyone)

- Fully keyboard-navigable; visible focus; logical tab order.
- ARIA roles/labels on controls; the transport and timeline are operable without a mouse.
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
