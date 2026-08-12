# Virtual testers

Every change is judged by three personas before it counts as done. They exist
because our shipped bugs all passed a green test suite — the gap was never "is the
code correct?" but "what does a person actually experience?"

| Persona          | Stands for                     | Blocks on                                        |
| ---------------- | ------------------------------ | ------------------------------------------------ |
| `tester-novice`  | someone who has never edited    | confusion, jargon, dead ends, lost work           |
| `tester-a11y`    | keyboard-only / screen reader   | anything mouse-only, invisible focus, silent state |
| `tester-qa`      | adversarial QA + correctness    | data loss, races, leaks, frame/sync inaccuracy    |

**No expert-editor persona, deliberately.** The goal is an editor anyone can pick
up; an expert persona would pull the backlog toward pro features and away from
that. Its one genuinely universal demand — *frame accuracy and consistency* — is
folded into `tester-qa` instead.

## The loop

```
implement → verify (unit + engine invariants) → review (guardrails)
          → test (personas: e2e scenarios + agent review) → fix → repeat
```

## Definition of pass — strict

A change is done only when **all** hold:

- `npm test` green, engine invariants green, `npm run check:guardrails` clean
- `npm run e2e` green, including the persona scenarios in `e2e/personas.spec.ts`
- Zero findings from `tester-qa` in the "data loss / wrong output / leak" tier
- Zero blockers from `tester-novice` (confusion or dead end) and `tester-a11y`
  (anything impossible without a mouse)

Lower-tier findings are recorded in `CLAUDE.md` tech debt rather than silently
dropped.
