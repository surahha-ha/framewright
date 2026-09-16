// framewright — spans: the timing arithmetic every timed thing shares.
//
// `subtitles.test.ts` pins the subtitle's behaviour and must not change; this
// file pins the generic contract underneath it — the parts a second kind of
// span (an image, E10) relies on and the subtitle's own tests never exercise:
// the list/total/defaultLen shape, the minted id, the op factory.
import { describe, expect, it } from 'vitest';
import {
  locateSpan,
  rippleSpans,
  spanAt,
  spanDiffOps,
  spanLimits,
  spanPlan,
  splitSpanAt,
} from './spans';

/** A span with a field of its own, so "everything else comes along" is testable. */
type Box = {
  id: string;
  startFrame: number;
  endFrame: number;
  label?: string;
};

const box = (
  id: string,
  startFrame: number,
  endFrame: number,
  label = id,
): Box => ({ id, startFrame, endFrame, label });

const list = (): Box[] => [
  box('a', 0, 20),
  box('b', 40, 60),
  box('c', 60, 80),
  box('d', 100, 120),
];

describe('spanAt', () => {
  it('answers half-open, and nothing in a gap', () => {
    const l = list();
    expect(spanAt(l, 0)?.id).toBe('a');
    expect(spanAt(l, 19)?.id).toBe('a');
    expect(spanAt(l, 20)).toBeNull(); // a's end is exclusive, and b is later
    expect(spanAt(l, 59)?.id).toBe('b');
    expect(spanAt(l, 60)?.id).toBe('c'); // an edge belongs to the later span
    expect(spanAt(l, 120)).toBeNull();
  });

  it('answers null for an empty list', () => {
    expect(spanAt([], 0)).toBeNull();
  });
});

describe('locateSpan', () => {
  it('gives the index and the span, and null for anything it cannot find', () => {
    const l = list();
    expect(locateSpan(l, 'c')).toEqual({ index: 2, span: l[2] });
    expect(locateSpan(l, 'nope')).toBeNull();
    expect(locateSpan(l, null)).toBeNull();
  });
});

describe('spanPlan — the list, the total and the default length, not a Project', () => {
  it('takes its default length in FRAMES, converting nothing', () => {
    // The caller turns its own seconds into frames (`secToFrame`); this module
    // does no time conversion at all.
    expect(spanPlan([], 300, 60, 30)).toEqual({
      startFrame: 30,
      endFrame: 90,
      index: 0,
    });
  });

  it('stops at the total instead of running past the picture', () => {
    expect(spanPlan([], 300, 60, 290)).toEqual({
      startFrame: 290,
      endFrame: 300,
      index: 0,
    });
  });

  it('stops short of the next span, and slots in after the ones that ended', () => {
    const l = list();
    expect(spanPlan(l, 300, 60, 20)).toEqual({
      startFrame: 20,
      endFrame: 40,
      index: 1,
    });
    expect(spanPlan(l, 300, 60, 200)?.index).toBe(4);
  });

  it('refuses a covered frame, the far end, a negative playhead and a total of 0', () => {
    const l = list();
    expect(spanPlan(l, 300, 60, 40)).toBeNull(); // b covers it
    expect(spanPlan(l, 300, 60, 59)).toBeNull();
    expect(spanPlan(l, 300, 60, 80)).not.toBeNull(); // c ends at 80: free again
    expect(spanPlan([], 300, 60, 300)).toBeNull();
    expect(spanPlan([], 300, 60, -1)).toBeNull();
    expect(spanPlan([], 0, 60, 0)).toBeNull();
  });
});

describe('spanLimits — how far the edges may go', () => {
  it('is walled by neighbours, the start, and the total', () => {
    const l = list();
    expect(spanLimits(l, 300, 'b')).toEqual({
      minStart: 20,
      maxStart: 59, // one frame is the shortest span there is
      minEnd: 41,
      maxEnd: 60,
    });
    expect(spanLimits(l, 300, 'a')?.minStart).toBe(0);
    expect(spanLimits(l, 300, 'd')?.maxEnd).toBe(300);
  });

  it('lets a span that already sticks out past a shortened total keep its end', () => {
    expect(spanLimits([box('a', 150, 160)], 100, 'a')?.maxEnd).toBe(160);
  });

  it('is null for an unknown id', () => {
    expect(spanLimits(list(), 300, 'nope')).toBeNull();
  });
});

describe('rippleSpans — a span follows the footage under it', () => {
  it('returns the very same list for a zero delta', () => {
    const l = list();
    expect(rippleSpans(l, 50, 0)).toBe(l);
  });

  it('pushes everything at or after the point right, and leaves a straddler alone', () => {
    // b straddles 50 and is NOT stretched: it has to become two, which needs
    // an id, so a caller runs `splitSpanAt` first.
    expect(rippleSpans(list(), 50, 30)).toEqual([
      box('a', 0, 20),
      box('b', 40, 60),
      box('c', 90, 110),
      box('d', 130, 150),
    ]);
  });

  it('drops what a cut swallowed, trims the straddlers, slides the rest left', () => {
    // Cut [50, 70): b loses its tail, c loses its head, d slides by 20.
    expect(rippleSpans(list(), 50, -20)).toEqual([
      box('a', 0, 20),
      box('b', 40, 50),
      box('c', 50, 60),
      box('d', 80, 100),
    ]);
    // Cut [60, 100): c is wholly inside and goes.
    expect(rippleSpans(list(), 60, -40).map((s) => s.id)).toEqual([
      'a',
      'b',
      'd',
    ]);
  });

  it('drops a span the cut leaves with no frames at all', () => {
    // Cut exactly b's extent: nothing of it survives, so it is not kept as a
    // zero-length span sitting on the cut point.
    expect(rippleSpans(list(), 40, -20).map((s) => s.id)).toEqual([
      'a',
      'c',
      'd',
    ]);
  });

  it('carries every other field along, both ways', () => {
    const l = [box('b', 40, 60, '자막 내용')];
    expect(rippleSpans(l, 0, 10)[0].label).toBe('자막 내용');
    expect(rippleSpans(l, 50, -5)[0].label).toBe('자막 내용');
  });
});

describe('splitSpanAt — the id comes from the caller', () => {
  it('mints one id, only when something straddles the point', () => {
    const ids: string[] = [];
    const makeId = () => {
      ids.push(`img_${ids.length + 1}`);
      return ids[ids.length - 1];
    };
    const { spans, split } = splitSpanAt(list(), 50, makeId);
    expect(split).toBe(true);
    expect(ids).toEqual(['img_1']); // once, not once per span
    expect(spans).toEqual([
      box('a', 0, 20),
      box('b', 40, 50),
      { id: 'img_1', startFrame: 50, endFrame: 60, label: 'b' },
      box('c', 60, 80),
      box('d', 100, 120),
    ]);
  });

  it('preserves the total frame count exactly', () => {
    const before = list();
    const { spans } = splitSpanAt(before, 50, () => 'x_1');
    const frames = (l: Box[]) =>
      l.reduce((n, s) => n + (s.endFrame - s.startFrame), 0);
    expect(frames(spans)).toBe(frames(before));
  });

  it('leaves an edge and an empty gap untouched, and mints no id', () => {
    const before = list();
    const makeId = () => {
      throw new Error('minted an id with nothing to split');
    };
    expect(splitSpanAt(before, 60, makeId)).toEqual({
      spans: before,
      split: false,
    }); // 60 is b's end and c's start: an edge, not an inside
    expect(splitSpanAt(before, 30, makeId).spans).toBe(before); // the gap
  });
});

describe('spanDiffOps — the op kinds come from the caller', () => {
  type FakeOp =
    | { kind: 'in'; index: number; span: Box }
    | { kind: 'out'; index: number }
    | { kind: 'time'; id: string; startFrame: number; endFrame: number };

  const ops = {
    insert: (index: number, span: Box): FakeOp => ({ kind: 'in', index, span }),
    remove: (index: number): FakeOp => ({ kind: 'out', index }),
    retime: (id: string, startFrame: number, endFrame: number): FakeOp => ({
      kind: 'time',
      id,
      startFrame,
      endFrame,
    }),
  };

  /** The smallest reducer that honours the ops, so the ORDER is what is tested. */
  function apply(l: Box[], applied: FakeOp[]): Box[] {
    let out = l.slice();
    for (const op of applied) {
      if (op.kind === 'in') out.splice(op.index, 0, op.span);
      else if (op.kind === 'out') out.splice(op.index, 1);
      else
        out = out.map((s) =>
          s.id === op.id
            ? { ...s, startFrame: op.startFrame, endFrame: op.endFrame }
            : s,
        );
    }
    return out;
  }

  it('emits no op kind of its own — only what the factory makes', () => {
    const before = list();
    const after = rippleSpans(before, 60, -40);
    const { forward } = spanDiffOps(before, after, ops);
    expect(forward.every((op) => ['in', 'out', 'time'].includes(op.kind))).toBe(
      true,
    );
  });

  it('round-trips a removal, a re-time and an insertion in one diff', () => {
    const before = list();
    const split = splitSpanAt(before, 50, () => 'x_1');
    const after = [
      ...rippleSpans(split.spans, 50, 30),
      box('late', 200, 210),
    ].sort((p, q) => p.startFrame - q.startFrame);
    const { forward, inverse } = spanDiffOps(before, after, ops);
    const applied = apply(before, forward);
    expect(applied).toEqual(after);
    expect(apply(applied, inverse)).toEqual(before);
  });

  it('removes from the highest index down and inserts from the lowest up', () => {
    // Two removals and two insertions in one diff: applied in the other order
    // each index would mean something else by the time it was used.
    const before = [box('a', 0, 10), box('b', 10, 20), box('c', 20, 30)];
    const after = [
      box('n1', 0, 5),
      box('b', 10, 20),
      box('n2', 25, 30),
      box('n3', 40, 50),
    ];
    const { forward, inverse } = spanDiffOps(before, after, ops);
    const removals = forward.filter((op) => op.kind === 'out');
    expect(removals).toEqual([
      { kind: 'out', index: 2 },
      { kind: 'out', index: 0 },
    ]);
    const inserts = forward.filter((op) => op.kind === 'in');
    expect(inserts.map((op) => (op.kind === 'in' ? op.index : -1))).toEqual([
      0, 2, 3,
    ]);
    expect(apply(before, forward)).toEqual(after);
    expect(apply(apply(before, forward), inverse)).toEqual(before);
  });

  it('says nothing at all when nothing moved — not an empty undo step', () => {
    const before = list();
    expect(spanDiffOps(before, before, ops)).toEqual({
      forward: [],
      inverse: [],
    });
  });

  it('diffs the range only — a field that changed beside it is not its business', () => {
    // The commands that own the other fields write their own ops; a ripple
    // must not silently re-write words it was never asked about.
    const before = [box('a', 0, 10, 'before')];
    const after = [box('a', 0, 10, 'after')];
    expect(spanDiffOps(before, after, ops).forward).toEqual([]);
  });
});
