// framewright — fades (ADR-0012): what an edge softens into, over how many
// frames, and what the picture is at each of those frames.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FADE_SEC,
  blendAt,
  describeFade,
  effectiveFades,
  fadeLimit,
  fadePartner,
  fadeSecondsText,
  defaultFadeFrames,
} from './fades';
import { createProject } from './project';
import { FPS_30 } from './time';
import type { Asset, Clip, Project } from './types';

/** Clips on the video track, plus the assets they point at (3 s each). */
function seed(clips: Clip[], assets: Partial<Asset>[] = []): Project {
  const p = createProject(FPS_30);
  const ids = new Set(clips.map((c) => c.assetId));
  const known = new Map(assets.map((a) => [a.id, a]));
  return {
    ...p,
    nextId: 10,
    assets: [...ids].map((id) => ({
      id,
      kind: 'video',
      name: `${id}.mp4`,
      meta: { durationSec: 3 },
      ...known.get(id),
    })),
    tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips } : t)),
  };
}

const clip = (
  id: string,
  startFrame: number,
  inFrame: number,
  outFrame: number,
  extra: Partial<Clip> = {},
): Clip => ({
  id,
  assetId: `asset_${id}`,
  startFrame,
  inFrame,
  outFrame,
  ...extra,
});

describe('effectiveFades', () => {
  it('is zero on both edges for a plain clip', () => {
    expect(effectiveFades(clip('a', 0, 0, 30))).toEqual({
      fadeIn: 0,
      fadeOut: 0,
    });
  });

  it('passes fades through when they fit', () => {
    expect(
      effectiveFades(clip('a', 0, 0, 30, { fadeIn: 10, fadeOut: 12 })),
    ).toEqual({ fadeIn: 10, fadeOut: 12 });
  });

  it('clamps to the clip, head first, so no frame belongs to two fades', () => {
    // A trim shortened the clip under its fades: nothing rewrites the
    // document, the drawing just uses what fits. 30 frames, asked 20 + 20.
    expect(
      effectiveFades(clip('a', 0, 0, 30, { fadeIn: 20, fadeOut: 20 })),
    ).toEqual({ fadeIn: 20, fadeOut: 10 });
    expect(effectiveFades(clip('a', 0, 0, 10, { fadeIn: 40 }))).toEqual({
      fadeIn: 10,
      fadeOut: 0,
    });
  });
});

describe('fadeLimit', () => {
  it('is the room the other edge leaves', () => {
    const c = clip('a', 0, 0, 30, { fadeOut: 10 });
    expect(fadeLimit(c, 'in')).toBe(20);
    expect(fadeLimit(c, 'out')).toBe(30);
  });

  it('is the whole clip when the other edge is hard', () => {
    expect(fadeLimit(clip('a', 0, 0, 30), 'in')).toBe(30);
  });
});

describe('defaultFadeFrames', () => {
  it('is half a second at the timeline rate', () => {
    expect(DEFAULT_FADE_SEC).toBe(0.5);
    expect(defaultFadeFrames(FPS_30)).toBe(15);
  });
});

describe('fadePartner', () => {
  it('is black at the start of the video', () => {
    const p = seed([clip('a', 0, 0, 30)]);
    expect(fadePartner(p, 'a', 'in')).toEqual({ kind: 'black' });
  });

  it('is black at the end of the video', () => {
    const p = seed([clip('a', 0, 0, 30)]);
    expect(fadePartner(p, 'a', 'out')).toEqual({ kind: 'black' });
  });

  it('is the butted neighbour', () => {
    const p = seed([clip('a', 0, 0, 30), clip('b', 30, 0, 30)]);
    expect(fadePartner(p, 'b', 'in')).toMatchObject({
      kind: 'clip',
      clipId: 'a',
    });
    expect(fadePartner(p, 'a', 'out')).toMatchObject({
      kind: 'clip',
      clipId: 'b',
    });
  });

  it('is black across a gap — a hole is black, and a fade into it says so', () => {
    const p = seed([clip('a', 0, 0, 30), clip('b', 40, 0, 30)]);
    expect(fadePartner(p, 'b', 'in')).toEqual({ kind: 'black' });
    expect(fadePartner(p, 'a', 'out')).toEqual({ kind: 'black' });
  });

  it('is black when the neighbour softens the same cut itself', () => {
    // A fades out AND B fades in at one cut: a dip through black, not A's
    // overhang flashing back at full strength the frame after A went dark.
    const p = seed([
      clip('a', 0, 0, 30, { fadeOut: 10 }),
      clip('b', 30, 0, 30, { fadeIn: 10 }),
    ]);
    expect(fadePartner(p, 'b', 'in')).toEqual({ kind: 'black' });
    expect(fadePartner(p, 'a', 'out')).toEqual({ kind: 'black' });
  });

  it('is nothing for a clip that is not there', () => {
    expect(fadePartner(seed([]), 'zzz', 'in')).toBeNull();
  });
});

describe('blendAt', () => {
  it('is null on a hard-cut clip and in a gap', () => {
    const p = seed([clip('a', 0, 0, 30), clip('b', 40, 0, 30)]);
    expect(blendAt(p, 0)).toBeNull();
    expect(blendAt(p, 29)).toBeNull();
    expect(blendAt(p, 35)).toBeNull();
  });

  it('fades in from black: fully black on the first frame, gone after N', () => {
    const p = seed([clip('a', 0, 0, 30, { fadeIn: 10 })]);
    expect(blendAt(p, 0)).toEqual({ assetId: null, sourceFrame: 0, weight: 1 });
    expect(blendAt(p, 5)).toEqual({
      assetId: null,
      sourceFrame: 0,
      weight: 0.5,
    });
    expect(blendAt(p, 9)).toEqual({
      assetId: null,
      sourceFrame: 0,
      weight: 0.1,
    });
    expect(blendAt(p, 10)).toBeNull();
  });

  it('fades out to black: fully black on the last frame', () => {
    const p = seed([clip('a', 0, 0, 30, { fadeOut: 10 })]);
    expect(blendAt(p, 19)).toBeNull();
    expect(blendAt(p, 20)).toEqual({
      assetId: null,
      sourceFrame: 0,
      weight: 0.1,
    });
    expect(blendAt(p, 29)).toEqual({
      assetId: null,
      sourceFrame: 0,
      weight: 1,
    });
  });

  it('dissolves from the previous clip’s overhang when it fades in at a cut', () => {
    // a is source frames [0,30) of a 3 s file: after its out-point the file
    // goes on, and those are the frames the dissolve shows under b.
    const p = seed([clip('a', 0, 0, 30), clip('b', 30, 0, 30, { fadeIn: 10 })]);
    expect(blendAt(p, 30)).toEqual({
      assetId: 'asset_a',
      sourceFrame: 30,
      weight: 1,
    });
    expect(blendAt(p, 34)).toEqual({
      assetId: 'asset_a',
      sourceFrame: 34,
      weight: 0.6,
    });
    expect(blendAt(p, 39)).toEqual({
      assetId: 'asset_a',
      sourceFrame: 39,
      weight: 0.1,
    });
    expect(blendAt(p, 40)).toBeNull();
  });

  it('dissolves into the next clip’s pre-roll when it fades out at a cut', () => {
    // b starts at source frame 20, so 20 frames of pre-roll exist before it.
    const p = seed([
      clip('a', 0, 0, 30, { fadeOut: 10 }),
      clip('b', 30, 20, 50),
    ]);
    expect(blendAt(p, 20)).toEqual({
      assetId: 'asset_b',
      sourceFrame: 10,
      weight: 0.1,
    });
    expect(blendAt(p, 29)).toEqual({
      assetId: 'asset_b',
      sourceFrame: 19,
      weight: 1,
    });
    expect(blendAt(p, 30)).toBeNull();
  });

  it('holds the neighbour’s last real frame when its file has no more', () => {
    // a is the whole file (90 frames of 3 s): there is no overhang, so the
    // dissolve shows a’s last frame, held — never a frame the file lacks.
    const p = seed([clip('a', 0, 0, 90), clip('b', 90, 0, 30, { fadeIn: 10 })]);
    expect(blendAt(p, 90)).toMatchObject({
      assetId: 'asset_a',
      sourceFrame: 89,
    });
    expect(blendAt(p, 99)).toMatchObject({
      assetId: 'asset_a',
      sourceFrame: 89,
    });
  });

  it('holds the neighbour’s first frame when its in-point is the file’s start', () => {
    const p = seed([
      clip('a', 0, 0, 30, { fadeOut: 10 }),
      clip('b', 30, 0, 30),
    ]);
    expect(blendAt(p, 20)).toMatchObject({
      assetId: 'asset_b',
      sourceFrame: 0,
    });
    expect(blendAt(p, 29)).toMatchObject({
      assetId: 'asset_b',
      sourceFrame: 0,
    });
  });

  it('holds the clip’s own last frame when the file’s length is unknown', () => {
    // An unmeasured source proves no overhang at all (same rule as trimming).
    const p = seed(
      [clip('a', 0, 0, 30), clip('b', 30, 0, 30, { fadeIn: 10 })],
      [{ id: 'asset_a', meta: {} }],
    );
    expect(blendAt(p, 35)).toMatchObject({
      assetId: 'asset_a',
      sourceFrame: 29,
    });
  });

  it('uses the clamped fades, so a shortened clip never double-blends', () => {
    const p = seed([clip('a', 0, 0, 20, { fadeIn: 15, fadeOut: 15 })]);
    // head wins: frames 0..14 fade in, 15..19 fade out
    expect(blendAt(p, 14)).toMatchObject({ weight: 1 / 15 });
    expect(blendAt(p, 15)).toMatchObject({ weight: 0.2 });
    expect(blendAt(p, 19)).toMatchObject({ weight: 1 });
  });
});

describe('the sentence', () => {
  it('says the seconds in a form a first-time user reads as seconds', () => {
    expect(fadeSecondsText(15, FPS_30)).toBe('0.5초');
    expect(fadeSecondsText(30, FPS_30)).toBe('1초');
    expect(fadeSecondsText(10, FPS_30)).toBe('0.33초');
  });

  it('names the partner, so the user learns what the fade goes to', () => {
    const p = seed([clip('a', 0, 0, 30), clip('b', 30, 0, 30)]);
    expect(describeFade(p, 'a', 'in', 15)).toBe(
      '앞부분이 0.5초 동안 서서히 나타나요 · 검은 화면에서 시작해요.',
    );
    expect(describeFade(p, 'b', 'in', 15)).toBe(
      '앞부분이 0.5초 동안 서서히 나타나요 · 앞 클립과 겹쳐서 넘어와요.',
    );
    expect(describeFade(p, 'a', 'out', 30)).toBe(
      '뒷부분이 1초 동안 서서히 사라져요 · 뒤 클립과 겹쳐서 넘어가요.',
    );
    expect(describeFade(p, 'b', 'out', 30)).toBe(
      '뒷부분이 1초 동안 서서히 사라져요 · 검은 화면으로 끝나요.',
    );
  });

  it('says when it was turned off', () => {
    const p = seed([clip('a', 0, 0, 30)]);
    expect(describeFade(p, 'a', 'in', 0)).toBe('앞부분이 바로 시작해요.');
    expect(describeFade(p, 'a', 'out', 0)).toBe('뒷부분이 바로 끝나요.');
  });

  it('blames the other fade, not the clip, when that is what took the room', () => {
    // 2 s clip, fade-out 1 s already on: asking 2 s of fade-in gets 1 s. The
    // clip is not short — the other control is what to turn down.
    const p = seed([clip('a', 0, 0, 60, { fadeOut: 30 })]);
    expect(describeFade(p, 'a', 'in', 30, 60)).toBe(
      '앞부분이 1초 동안 서서히 나타나요 · 검은 화면에서 시작해요 · 뒷부분의 서서히 사라지기와 겹치지 않게 1초로 줄였어요.',
    );
  });

  it('says when the clip was too short for what was asked', () => {
    const p = seed([clip('a', 0, 0, 10)]);
    expect(describeFade(p, 'a', 'in', 10, 15)).toBe(
      '앞부분이 0.33초 동안 서서히 나타나요 · 검은 화면에서 시작해요 · 클립이 짧아 0.5초에서 줄였어요.',
    );
  });
});
