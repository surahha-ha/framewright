// framewright — subtitles: where one may go, how far it may be dragged.
import { describe, expect, it } from 'vitest';
import { createProject } from './project';
import type { Clip, Project, Subtitle } from './types';
import {
  DEFAULT_SUBTITLE_SEC,
  describeSubtitleEdit,
  locateSubtitle,
  normalizeSubtitleText,
  rippleSubtitles,
  splitSubtitleAt,
  subtitleAt,
  subtitleDiffOps,
  subtitleDragBounds,
  subtitleDragCommand,
  subtitleDragTargets,
  subtitleLength,
  subtitleLimits,
  subtitlePlan,
} from './subtitles';
import { planDrag } from './drag';
import { applyOps } from './ops';

/** A 300-frame video (one clip) with the given subtitles already on it. */
function doc(subtitles: Subtitle[] = [], videoFrames = 300): Project {
  const p = createProject();
  const clip: Clip = {
    id: 'clip_1',
    assetId: 'asset_1',
    startFrame: 0,
    inFrame: 0,
    outFrame: videoFrames,
  };
  return {
    ...p,
    nextId: 2,
    tracks: p.tracks.map((t) =>
      t.type === 'video' ? { ...t, clips: videoFrames ? [clip] : [] } : t,
    ),
    subtitles,
  };
}

const sub = (
  id: string,
  startFrame: number,
  endFrame: number,
  text = id,
): Subtitle => ({ id, text, startFrame, endFrame });

describe('subtitleAt', () => {
  it('answers with the subtitle covering a frame, half-open', () => {
    const p = doc([sub('a', 10, 20), sub('b', 20, 40)]);
    expect(subtitleAt(p, 9)).toBeNull();
    expect(subtitleAt(p, 10)?.id).toBe('a');
    expect(subtitleAt(p, 19)?.id).toBe('a');
    expect(subtitleAt(p, 20)?.id).toBe('b'); // a's end is exclusive
    expect(subtitleAt(p, 40)).toBeNull();
  });

  it('locates by id with its index', () => {
    const p = doc([sub('a', 10, 20), sub('b', 20, 40)]);
    expect(locateSubtitle(p, 'b')).toEqual({
      index: 1,
      subtitle: p.subtitles[1],
    });
    expect(locateSubtitle(p, 'zzz')).toBeNull();
    expect(locateSubtitle(p, null)).toBeNull();
  });
});

describe('subtitlePlan — where "자막 넣기" puts a new one', () => {
  it('starts at the playhead and lasts the default length', () => {
    const p = doc();
    const plan = subtitlePlan(p, 30);
    expect(plan).toEqual({
      startFrame: 30,
      endFrame: 30 + DEFAULT_SUBTITLE_SEC * 30,
      index: 0,
    });
  });

  it('never runs past the end of the picture', () => {
    // 300 frames of video; a two-second subtitle from frame 290 has 10 frames
    // of picture left to sit on. A subtitle over black is not a subtitle.
    expect(subtitlePlan(doc(), 290)).toEqual({
      startFrame: 290,
      endFrame: 300,
      index: 0,
    });
  });

  it('stops short of the next subtitle instead of overlapping it', () => {
    const p = doc([sub('later', 45, 100)]);
    expect(subtitlePlan(p, 30)).toEqual({
      startFrame: 30,
      endFrame: 45,
      index: 0,
    });
  });

  it('slots in after the subtitles that end before the playhead', () => {
    const p = doc([sub('a', 0, 10), sub('b', 10, 20), sub('c', 200, 210)]);
    expect(subtitlePlan(p, 100)?.index).toBe(2);
  });

  it('refuses when the playhead is already on a subtitle', () => {
    const p = doc([sub('a', 10, 50)]);
    expect(subtitlePlan(p, 10)).toBeNull();
    expect(subtitlePlan(p, 49)).toBeNull();
    expect(subtitlePlan(p, 50)).not.toBeNull();
  });

  it('refuses off the end of the video, and on an empty timeline', () => {
    expect(subtitlePlan(doc(), 300)).toBeNull();
    expect(subtitlePlan(doc([], 0), 0)).toBeNull();
  });
});

describe('subtitleLimits — how far the edges may go', () => {
  it('is walled by neighbours, the start, and the end of the picture', () => {
    const p = doc([sub('a', 0, 10), sub('b', 50, 100), sub('c', 150, 160)]);
    expect(subtitleLimits(p, 'b')).toEqual({
      minStart: 10,
      maxStart: 99,
      minEnd: 51,
      maxEnd: 150,
    });
    expect(subtitleLimits(p, 'c')).toEqual({
      minStart: 100,
      maxStart: 159,
      minEnd: 151,
      maxEnd: 300,
    });
    expect(subtitleLimits(p, 'a')?.minStart).toBe(0);
  });

  it('lets a subtitle already past a shortened video keep its own end', () => {
    // The video was cut down to 100 frames under a subtitle that ends at 160.
    // It may shrink; it must not be told its end is somewhere it is not.
    const p = doc([sub('c', 150, 160)], 100);
    expect(subtitleLimits(p, 'c')?.maxEnd).toBe(160);
  });

  it('is null for an unknown id', () => {
    expect(subtitleLimits(doc(), 'nope')).toBeNull();
  });
});

describe('subtitleDragBounds — the same shape a clip drag uses', () => {
  const p = doc([sub('a', 0, 10), sub('b', 50, 100), sub('c', 150, 160)]);

  it('names the wall on each side', () => {
    expect(subtitleDragBounds(p, 'b', 'move')).toEqual({
      min: 10,
      minReason: 'neighbour',
      max: 100, // 150 − length 50
      maxReason: 'neighbour',
    });
    expect(subtitleDragBounds(p, 'a', 'trimStart')).toEqual({
      min: 0,
      minReason: 'timelineStart',
      max: 9,
      maxReason: 'minLength',
    });
    expect(subtitleDragBounds(p, 'c', 'trimEnd')).toEqual({
      min: 151,
      minReason: 'minLength',
      max: 300,
      maxReason: 'videoEnd',
    });
    expect(subtitleDragBounds(p, 'b', 'trimEnd')?.maxReason).toBe('neighbour');
  });

  it('feeds planDrag exactly like a clip does', () => {
    const bounds = subtitleDragBounds(p, 'b', 'move')!;
    const frame = planDrag({
      mode: 'move',
      originStart: 50,
      originEnd: 100,
      deltaFrames: 500,
      targets: [],
      snapThreshold: 1,
      bounds,
    });
    expect(frame).toBe(100);
  });

  it('offers clip edges, other subtitles, and the playhead (for trims) as snap targets', () => {
    const targets = subtitleDragTargets(p, 'b', 'trimEnd', 77);
    expect(targets).toContain(77); // the playhead
    expect(targets).toContain(150); // c's start
    expect(targets).toContain(300); // the clip's end
    expect(targets).not.toContain(100); // never its own edge
    expect(subtitleDragTargets(p, 'b', 'move', 77)).not.toContain(77);
  });

  it('turns a finished drag into the right command, or nothing', () => {
    expect(subtitleDragCommand('move', 'b', 60, 50, 100)).toEqual({
      id: 'subtitle.move',
      args: { subtitleId: 'b', startFrame: 60 },
    });
    expect(subtitleDragCommand('trimStart', 'b', 55, 50, 100)).toEqual({
      id: 'subtitle.trimStart',
      args: { subtitleId: 'b', frame: 55 },
    });
    expect(subtitleDragCommand('trimEnd', 'b', 90, 50, 100)).toEqual({
      id: 'subtitle.trimEnd',
      args: { subtitleId: 'b', frame: 90 },
    });
    expect(subtitleDragCommand('move', 'b', 50, 50, 100)).toBeNull();
    expect(subtitleDragCommand('trimEnd', 'b', 100, 50, 100)).toBeNull();
  });
});

describe('rippleSubtitles — captions follow the footage they caption', () => {
  const list = () => [
    sub('a', 0, 20),
    sub('b', 40, 60),
    sub('c', 55 + 5, 80), // 60..80
    sub('d', 100, 120),
  ];

  it('removing a span pulls everything after it left, and drops what was inside', () => {
    // Cut [60, 100): c is entirely inside and goes; d slides left by 40.
    expect(rippleSubtitles(list(), 60, -40)).toEqual([
      sub('a', 0, 20),
      sub('b', 40, 60),
      sub('d', 60, 80),
    ]);
  });

  it('keeps the part of a straddling subtitle that survives the cut', () => {
    // Cut [50, 70): b loses its tail, c loses its head; what is left of each
    // is contiguous footage, so each stays one subtitle.
    expect(rippleSubtitles(list(), 50, -20)).toEqual([
      sub('a', 0, 20),
      sub('b', 40, 50),
      sub('c', 50, 60),
      sub('d', 80, 100),
    ]);
  });

  it('inserting a span pushes everything at or after it right; a straddler is split first', () => {
    // 30 frames land at 50. b straddles 50: its words belong to the frames on
    // both sides, so it becomes two subtitles — the tail gets a fresh id and
    // moves with the footage it captioned. a stays, c and d move.
    const split = splitSubtitleAt(list(), 50, 7);
    expect(split.nextId).toBe(8);
    expect(rippleSubtitles(split.subtitles, 50, 30)).toEqual([
      sub('a', 0, 20),
      sub('b', 40, 50, 'b'),
      { id: 'sub_7', text: 'b', startFrame: 80, endFrame: 90 },
      sub('c', 90, 110),
      sub('d', 130, 150),
    ]);
  });

  it('splits nothing when no subtitle straddles the point', () => {
    // 60 is b's end and c's start: an edge, not an inside.
    expect(splitSubtitleAt(list(), 60, 7)).toEqual({
      subtitles: list(),
      nextId: 7,
    });
    expect(splitSubtitleAt(list(), 30, 7)).toEqual({
      subtitles: list(),
      nextId: 7,
    });
  });

  it('does nothing for a zero delta', () => {
    expect(rippleSubtitles(list(), 50, 0)).toEqual(list());
  });

  it('turns the difference into ops with exact inverses', () => {
    const before = list();
    const after = rippleSubtitles(before, 60, -40);
    const { forward, inverse } = subtitleDiffOps(before, after);
    const p = { ...doc(before) };
    const applied = applyOps(p, forward);
    expect(applied.subtitles).toEqual(after);
    expect(applyOps(applied, inverse).subtitles).toEqual(before);
    // Nothing to do is no ops at all — not an empty undo step.
    expect(subtitleDiffOps(before, before)).toEqual({
      forward: [],
      inverse: [],
    });
  });

  it('diffs an insertion (the tail of a split) as well as removals and moves', () => {
    const before = list();
    const split = splitSubtitleAt(before, 50, 7);
    const after = rippleSubtitles(split.subtitles, 50, 30);
    const { forward, inverse } = subtitleDiffOps(before, after);
    const applied = applyOps(doc(before), forward);
    expect(applied.subtitles).toEqual(after);
    expect(applyOps(applied, inverse).subtitles).toEqual(before);
  });

  it('survives a removal and an insertion in the same diff', () => {
    // Contrived but possible: cut [0, 20) — a goes — and a new one appears.
    const before = list();
    const after = [
      ...rippleSubtitles(before, 0, -20),
      { id: 'sub_9', text: 'new', startFrame: 200, endFrame: 210 },
    ];
    const { forward, inverse } = subtitleDiffOps(before, after);
    const applied = applyOps(doc(before), forward);
    expect(applied.subtitles).toEqual(after);
    expect(applyOps(applied, inverse).subtitles).toEqual(before);
  });
});

describe('what a subtitle drag says when it stops', () => {
  it('names a subtitle neighbour as a subtitle, and shares every other wall with the clip', async () => {
    const { SUBTITLE_LIMIT_TEXT } = await import('./subtitles');
    const { LIMIT_TEXT } = await import('./commands');
    expect(SUBTITLE_LIMIT_TEXT.neighbour).toBe('옆 자막에 닿았어요.');
    for (const key of Object.keys(LIMIT_TEXT) as (keyof typeof LIMIT_TEXT)[]) {
      if (key === 'neighbour') continue;
      expect(SUBTITLE_LIMIT_TEXT[key]).toBe(LIMIT_TEXT[key]);
    }
  });
});

describe('text', () => {
  it('trims the ends and squeezes blank lines, keeping real line breaks', () => {
    expect(normalizeSubtitleText('  안녕하세요 \n\n\n둘째 줄  ')).toBe(
      '안녕하세요\n둘째 줄',
    );
    expect(normalizeSubtitleText('\r\n첫 줄\r\n둘째 줄\r\n')).toBe(
      '첫 줄\n둘째 줄',
    );
    expect(normalizeSubtitleText('   ')).toBe('');
  });

  it('measures length half-open', () => {
    expect(subtitleLength(sub('a', 10, 25))).toBe(15);
  });
});

describe('what a subtitle edit says it did', () => {
  it('reports a move by position and a trim by direction', () => {
    const p = doc([sub('a', 30, 60)]);
    expect(describeSubtitleEdit('move', p, 'a')).toBe(
      '자막을 00:01:00 위치로 옮겼어요.',
    );
    expect(describeSubtitleEdit('trimEnd', p, 'a', 40)).toBe(
      '자막 뒷부분을 줄였어요 · 길이 00:01:00',
    );
    expect(describeSubtitleEdit('trimStart', p, 'a', 20)).toBe(
      '자막 앞부분을 늘렸어요 · 길이 00:01:00',
    );
    expect(describeSubtitleEdit('trimStart', p, 'a')).toBe(
      '자막 앞부분을 조절했어요 · 길이 00:01:00',
    );
    expect(describeSubtitleEdit('move', p, 'zzz')).toBe('');
  });
});
