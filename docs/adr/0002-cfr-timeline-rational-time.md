# 0002 — CFR timeline + rational time-model

- Status: Accepted

## Context

Variable-frame-rate (VFR) sources treated as CFR, seconds stored as floats, and
inconsistent rounding at cut points cause the classic "video cut short / runs long"
bug. 29.97 fps = 30000/1001 rounded to 30 drifts ~3.6s/hour.

## Decision

The **timeline is a fixed CFR clock; positions are integer frames**. Frame rate is a
**rational** (`num/den`) so 29.97 is exact. VFR sources are detected and conformed
onto the grid at import. A single canonical **time-model** (`src/engine/time.ts`)
performs all frame ↔ sec ↔ sample conversions — no inline time arithmetic anywhere.

## Consequences

- Simple, robust, testable engine; off-by-one and drift eliminated by construction.
- Adds an import-time conform step for VFR.
- Frame-rate-aware retiming / true VFR passthrough deferred (extend the conform layer,
  not the engine).
- Enables the frame-accuracy invariants asserted in tests.
