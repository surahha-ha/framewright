// framewright — spans (pure).
//
// A span is anything that sits on the timeline for a range of frames without
// being footage: a subtitle (`subtitles.ts`), an image (E10). It has an id and
// a half-open `[startFrame, endFrame)`, and nothing else this module knows
// about — everything else on it comes along untouched.
//
// This is the timing arithmetic all of them share: where a new one may go, how
// far an edge may travel, how they follow the footage when a cut moves it.
// Shared on the SECOND use rather than the third, on purpose: the ripple below
// carries ordering invariants (split before ripple; remove high-to-low, insert
// low-to-high, so redo is deterministic) that a copy would drift from silently,
// and silently wrong captions are the worst kind. Kept in the engine so it is
// unit-tested in Node like `drag.ts`.
//
// It takes plain numbers, never a `Project`: a caller reads the document (and
// converts its own seconds to frames through `time.ts`) and hands in the list,
// the total and the length it wants.

/** The whole of what this module needs to know about a timed thing. */
export interface Span {
  id: string;
  startFrame: number;
  endFrame: number;
}

/** The span shown on this frame, if any. Half-open like everything else. */
export function spanAt<T extends Span>(
  spans: readonly T[],
  frame: number,
): T | null {
  for (const s of spans) {
    if (s.startFrame > frame) break; // sorted: nothing later can cover it
    if (frame < s.endFrame) return s;
  }
  return null;
}

export function locateSpan<T extends Span>(
  spans: readonly T[],
  id: string | null,
): { index: number; span: T } | null {
  if (!id) return null;
  const index = spans.findIndex((s) => s.id === id);
  return index < 0 ? null : { index, span: spans[index] };
}

/**
 * Where a "put one here" command puts a new span: at the playhead, for
 * `defaultLen` frames, cut short by whichever comes first — the next span or
 * `total` (the end of the picture). Null when there is no room at all: off the
 * end of the video, or on a frame that already has one (edit that one
 * instead).
 *
 * `defaultLen` is in FRAMES. The caller owns the conversion from its own
 * seconds (`secToFrame`, `time.ts`); nothing here does time arithmetic.
 */
export function spanPlan(
  spans: readonly Span[],
  total: number,
  defaultLen: number,
  playhead: number,
): { startFrame: number; endFrame: number; index: number } | null {
  if (playhead < 0 || playhead >= total) return null;
  if (spanAt(spans, playhead)) return null;
  // The list is sorted and nothing covers the playhead, so every span that
  // starts at or before it also ends at or before it.
  const index = spans.filter((s) => s.startFrame <= playhead).length;
  const next = spans[index];
  const ceiling = next ? Math.min(next.startFrame, total) : total;
  return {
    startFrame: playhead,
    endFrame: Math.min(playhead + defaultLen, ceiling),
    index,
  };
}

/**
 * Room a span's edges have, in timeline frames. The same four numbers
 * `trimLimits` gives a clip, minus the source: a span's only far wall is
 * `total` — unless it already sticks out past a video that was shortened
 * underneath it, in which case its own end stays reachable so it can be pulled
 * back in. One frame is the shortest span there is, which is what the ±1 says.
 */
export function spanLimits(
  spans: readonly Span[],
  total: number,
  id: string,
): {
  minStart: number;
  maxStart: number;
  minEnd: number;
  maxEnd: number;
} | null {
  const found = locateSpan(spans, id);
  if (!found) return null;
  const { index, span } = found;
  const prev = spans[index - 1];
  const next = spans[index + 1];
  return {
    minStart: prev ? prev.endFrame : 0,
    maxStart: span.endFrame - 1,
    minEnd: span.startFrame + 1,
    maxEnd: next ? next.startFrame : Math.max(total, span.endFrame),
  };
}

/**
 * Move the spans the way a ripple edit moved the footage under them.
 *
 * A span belongs to particular frames. When a ripple delete pulls the footage
 * after a cut to the left, or a paste pushes it right, it has to go with the
 * pictures it was put there for — a caption (or a sticker) that stays put
 * while the shot slides out from under it is silently wrong, which is the
 * worst kind.
 *
 * `delta < 0` removes the span of frames `[at, at − delta)`: one wholly inside
 * it is dropped (its footage is gone), one straddling an edge keeps the part
 * that survives, everything after slides left. `delta > 0` inserts `delta`
 * frames at `at`: everything starting at or after `at` slides right. A span
 * straddling `at` is NOT handled here — it has to become two, and that needs
 * an id, so a caller runs `splitSpanAt` first (the paste command does). Left
 * alone it would sit over the new footage as well as the old; stretched it
 * would do the first half of that.
 */
export function rippleSpans<T extends Span>(
  spans: readonly T[],
  at: number,
  delta: number,
): T[] {
  if (delta === 0) return spans as T[];
  if (delta > 0) {
    return spans.map((s) =>
      s.startFrame >= at
        ? {
            ...s,
            startFrame: s.startFrame + delta,
            endFrame: s.endFrame + delta,
          }
        : s,
    );
  }
  const cutEnd = at - delta;
  const out: T[] = [];
  for (const s of spans) {
    if (s.endFrame <= at) {
      out.push(s);
      continue;
    }
    // Before the cut: stays. Inside it: collapses to the cut point. After
    // it: slides left by the cut's length.
    const startFrame =
      s.startFrame < at
        ? s.startFrame
        : s.startFrame >= cutEnd
          ? s.startFrame + delta
          : at;
    const endFrame = s.endFrame > cutEnd ? s.endFrame + delta : at;
    if (endFrame > startFrame) out.push({ ...s, startFrame, endFrame });
  }
  return out;
}

/**
 * Cut the one span that straddles `at` — starts before it, ends after it —
 * into two: the head keeps its id and ends at `at`, the tail is a new span
 * with everything else the same from `at` on. Used before a paste ripples the
 * footage after `at` to the right, so each half stays with the frames it was
 * put on. Nothing straddles an EDGE (`at` equal to a start or an end), so
 * those are untouched — and then `makeId` is never called, so a caller's id
 * counter does not move for a split that did not happen.
 *
 * The total frame count is preserved exactly: head `[start, at)` plus tail
 * `[at, end)`.
 */
export function splitSpanAt<T extends Span>(
  spans: readonly T[],
  at: number,
  makeId: () => string,
): { spans: T[]; split: boolean } {
  const index = spans.findIndex((s) => s.startFrame < at && at < s.endFrame);
  if (index < 0) return { spans: spans as T[], split: false };
  const s = spans[index];
  const head: T = { ...s, endFrame: at };
  // The tail is the same span from `at` on: every field but the id and the
  // range comes with it (a subtitle's look, place and effect — ADR-0017).
  const tail: T = { ...s, id: makeId(), startFrame: at, endFrame: s.endFrame };
  const out = spans.slice();
  out.splice(index, 1, head, tail);
  return { spans: out, split: true };
}

/** How a caller spells the three edits this module's diff needs. The op kinds
 *  are per list (`insertSubtitle`, `insertImage`, …), so they come from here
 *  rather than being hard-coded. */
export interface SpanOps<T extends Span, O> {
  insert(index: number, span: T): O;
  remove(index: number): O;
  retime(id: string, startFrame: number, endFrame: number): O;
}

/**
 * The ops that take `before` to `after`, with their inverses — for a command
 * that moved the footage and now has to move what sits on it. Ids are the key:
 * a span may be re-timed, removed (a cut swallowed it) or added (the tail of a
 * split). Never re-ordered by id, which is what keeps the index arithmetic
 * below honest.
 *
 * Forward: re-time (by id, order-free), then remove from the highest `before`
 * index down (so each index still means what it meant), then insert from the
 * lowest `after` index up (so each lands where `after` has it). Inverse:
 * exactly backwards.
 *
 * Only the range is diffed. Every other field belongs to the command that
 * owns it, and a ripple must not re-write what it was not asked about.
 */
export function spanDiffOps<T extends Span, O>(
  before: readonly T[],
  after: readonly T[],
  ops: SpanOps<T, O>,
): { forward: O[]; inverse: O[] } {
  const inAfter = new Map(after.map((s) => [s.id, s]));
  const inBefore = new Set(before.map((s) => s.id));

  const retime: O[] = [];
  const untime: O[] = [];
  const removals: O[] = [];
  const reinserts: O[] = [];
  before.forEach((old, index) => {
    const now = inAfter.get(old.id);
    if (!now) {
      removals.push(ops.remove(index));
      reinserts.push(ops.insert(index, old));
      return;
    }
    if (now.startFrame === old.startFrame && now.endFrame === old.endFrame) {
      return;
    }
    retime.push(ops.retime(old.id, now.startFrame, now.endFrame));
    untime.push(ops.retime(old.id, old.startFrame, old.endFrame));
  });
  const inserts: O[] = [];
  const uninserts: O[] = [];
  after.forEach((s, index) => {
    if (inBefore.has(s.id)) return;
    inserts.push(ops.insert(index, s));
    uninserts.push(ops.remove(index));
  });

  return {
    forward: [...retime, ...removals.reverse(), ...inserts],
    inverse: [...uninserts.reverse(), ...reinserts, ...untime],
  };
}
