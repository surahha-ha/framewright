// framewright — silence auto-cut: the rule, the plan, the patch (ADR-0016).
//
// The rule table is the owner's (docs/STATUS.md, E9 plan): a run of 128-sample
// peak buckets below -40 dBFS lasting 0.5 s or more, with 0.2 s kept on each
// side rounded UP to whole frames, and nothing cut when under 0.1 s is left.
// These specs pin the arithmetic at the edges where it can go wrong: a run at
// the very start or end of a file, a run a clip is trimmed into, a run that
// spans a split, a partial last bucket, 29.97 fps, a bucket exactly at the
// threshold.
import { describe, expect, it } from 'vitest';
import { buildPyramid, type Pyramid } from './waveform';
import { createProject } from './project';
import { applyOps } from './ops';
import { timelineDuration, videoTrack } from './timeline';
import { FPS_2997, FPS_30 } from './time';
import type { Clip, Project, StageImage, Subtitle } from './types';
import {
  SILENCE_MIN_SEC,
  SILENCE_PAD_SEC,
  SILENCE_PEAK,
  silencePatch,
  silencePlan,
  silentRuns,
} from './silence';

const SR = 48000;

/** `sec` seconds of a 220 Hz tone at `amplitude` (0.2 unless said). */
function tone(sec: number, amplitude = 0.2): Float32Array {
  const n = Math.round(sec * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / SR);
  }
  return out;
}

/** `sec` seconds at a constant `level` (digital silence unless said). */
function flat(sec: number, level = 0): Float32Array {
  return new Float32Array(Math.round(sec * SR)).fill(level);
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function pyramidOf(samples: Float32Array): Pyramid {
  return buildPyramid([samples], SR);
}

/** One second of sound, 1.2 s of nothing, 0.8 s of sound: 3 s, 90 frames. */
const SOUND_GAP_SOUND = pyramidOf(concat(tone(1), flat(1.2), tone(0.8)));

describe('the rule, as constants', () => {
  it('is -40 dBFS, half a second, a fifth of a second', () => {
    expect(SILENCE_PEAK).toBeCloseTo(0.01, 10);
    expect(SILENCE_MIN_SEC).toBe(0.5);
    expect(SILENCE_PAD_SEC).toBe(0.2);
  });
});

describe('silentRuns — quiet stretches of a source, as cut ranges', () => {
  it('finds nothing in a file that never goes quiet', () => {
    expect(silentRuns(pyramidOf(tone(3)), FPS_30)).toEqual([]);
  });

  it('finds nothing in a file with no sound at all to measure', () => {
    expect(silentRuns(buildPyramid([], SR), FPS_30)).toEqual([]);
  });

  it('cuts the middle of a quiet run and keeps 0.2 s on each side', () => {
    // Quiet from 1.0 s to 2.2 s; padded, the cut is [1.2 s, 2.0 s) = [36, 60).
    expect(silentRuns(SOUND_GAP_SOUND, FPS_30)).toEqual([
      { inFrame: 36, outFrame: 60 },
    ]);
  });

  it('leaves a run shorter than half a second alone', () => {
    const p = pyramidOf(concat(tone(1), flat(0.4), tone(1)));
    expect(silentRuns(p, FPS_30)).toEqual([]);
  });

  it('cuts a run of exactly half a second when a tenth is left after padding', () => {
    // 0.5 s − 2 × 0.2 s = 0.1 s = 3 frames at 30 fps: exactly the floor.
    // Half a second is 187.5 buckets; the run is measured in whole buckets,
    // so it is 188 of them (0.5013 s) that make the shortest run that counts.
    const p = pyramidOf(concat(tone(1), flat(0.5 + 64 / SR), tone(1)));
    expect(silentRuns(p, FPS_30)).toEqual([{ inFrame: 36, outFrame: 39 }]);
  });

  it('rounds the padding UP to whole frames, so 29.97 can leave nothing to cut', () => {
    // A half-second run to the end of the file (24010 samples, so the last
    // bucket is partial): at 30 fps the padded end is 1.30021 s → 39.006 →
    // frame 39, three frames, exactly the floor. At 29.97 the same end is
    // 38.97 frames, rounded DOWN to 38: two frames, 0.067 s, under the floor.
    const p = pyramidOf(concat(tone(1), new Float32Array(24010)));
    expect(silentRuns(p, FPS_30)).toEqual([{ inFrame: 36, outFrame: 39 }]);
    expect(silentRuns(p, FPS_2997)).toEqual([]);
    // A longer run still cuts, at 29.97's own frame numbers.
    expect(silentRuns(SOUND_GAP_SOUND, FPS_2997)).toEqual([
      // 1.2 s → 35.96 → 36 up; 2.0 s → 59.94 → 59 down.
      { inFrame: 36, outFrame: 59 },
    ]);
  });

  it('pads a run at the very start of the file too', () => {
    const p = pyramidOf(concat(flat(1), tone(1)));
    expect(silentRuns(p, FPS_30)).toEqual([{ inFrame: 6, outFrame: 24 }]);
  });

  it('pads a run at the very end of the file, partial last bucket included', () => {
    // 100 extra samples: the last bucket is short, and it is still silent.
    const p = pyramidOf(concat(tone(1), flat(1), new Float32Array(100)));
    // Quiet from 1.0 s to 2.00208 s; the cut ends at floor((2.00208 − 0.2) × 30) = 54.
    expect(silentRuns(p, FPS_30)).toEqual([{ inFrame: 36, outFrame: 54 }]);
  });

  it('counts a bucket as quiet strictly below -40 dBFS', () => {
    const under = pyramidOf(concat(tone(1), flat(1.2, 0.0099), tone(0.8)));
    expect(silentRuns(under, FPS_30)).toEqual([{ inFrame: 36, outFrame: 60 }]);
    // (0.01 itself is a hair under 0.01 once stored as a float32 sample.)
    const over = pyramidOf(concat(tone(1), flat(1.2, 0.011), tone(0.8)));
    expect(silentRuns(over, FPS_30)).toEqual([]);
  });

  it('reads the peak as a magnitude, so a negative offset is not silence', () => {
    const p = pyramidOf(concat(tone(1), flat(1.2, -0.5), tone(0.8)));
    expect(silentRuns(p, FPS_30)).toEqual([]);
  });

  it('gives each separate run its own cut', () => {
    const p = pyramidOf(concat(tone(1), flat(1), tone(1), flat(1), tone(1)));
    expect(silentRuns(p, FPS_30)).toEqual([
      { inFrame: 36, outFrame: 54 },
      { inFrame: 96, outFrame: 114 },
    ]);
  });

  it('answers the same object for the same pyramid, so a render can ask', () => {
    const a = silentRuns(SOUND_GAP_SOUND, FPS_30);
    const b = silentRuns(SOUND_GAP_SOUND, FPS_30);
    expect(b).toBe(a);
    expect(silentRuns(SOUND_GAP_SOUND, FPS_2997)).not.toBe(a);
  });
});

// ---------------------------------------------------------------------------

function clip(
  id: string,
  startFrame: number,
  inFrame: number,
  outFrame: number,
  extra: Partial<Clip> = {},
): Clip {
  return { id, assetId: 'asset_1', startFrame, inFrame, outFrame, ...extra };
}

function withClips(
  clips: Clip[],
  subtitles: Subtitle[] = [],
  images: StageImage[] = [],
): Project {
  const p = createProject();
  return {
    ...p,
    nextId: 10,
    assets: [
      {
        id: 'asset_1',
        kind: 'video',
        name: 'a.mp4',
        meta: { durationSec: 3 },
      },
      {
        id: 'asset_2',
        kind: 'image',
        name: 'logo.png',
        meta: { width: 400, height: 200 },
      },
    ],
    subtitles,
    images,
    tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips } : t)),
  };
}

const peaks = (pyramid: Pyramid | null) => () => pyramid;
const clipsOf = (p: Project) => videoTrack(p).clips;

describe('silencePlan — which timeline frames go', () => {
  it('maps a source run onto the clip that shows it', () => {
    const p = withClips([clip('clip_1', 100, 0, 90)]);
    const plan = silencePlan(p, peaks(SOUND_GAP_SOUND));
    expect(plan.cuts).toEqual([
      { clipId: 'clip_1', startFrame: 136, length: 24 },
    ]);
    expect(plan.removedFrames).toBe(24);
    expect(plan).toMatchObject({ read: 1, unread: 0, muted: 0 });
  });

  it('cuts only the part of the run a trimmed clip still shows', () => {
    // Trimmed into the middle of the quiet: the clip starts at source 45.
    const p = withClips([clip('clip_1', 0, 45, 90)]);
    expect(silencePlan(p, peaks(SOUND_GAP_SOUND)).cuts).toEqual([
      { clipId: 'clip_1', startFrame: 0, length: 15 },
    ]);
  });

  it('follows a run across a split, one cut per piece', () => {
    const p = withClips([clip('clip_1', 0, 0, 45), clip('clip_2', 45, 45, 90)]);
    const plan = silencePlan(p, peaks(SOUND_GAP_SOUND));
    expect(plan.cuts).toEqual([
      { clipId: 'clip_1', startFrame: 36, length: 9 },
      { clipId: 'clip_2', startFrame: 45, length: 15 },
    ]);
    expect(plan.removedFrames).toBe(24);
  });

  it('leaves a sliver under a tenth of a second where a clip edge cuts the run', () => {
    // The clip ends one frame into the cut range.
    const p = withClips([clip('clip_1', 0, 0, 37)]);
    expect(silencePlan(p, peaks(SOUND_GAP_SOUND)).cuts).toEqual([]);
  });

  it('skips a muted clip and counts it', () => {
    const p = withClips([clip('clip_1', 0, 0, 90, { muted: true })]);
    const plan = silencePlan(p, peaks(SOUND_GAP_SOUND));
    expect(plan.cuts).toEqual([]);
    expect(plan).toMatchObject({ read: 0, unread: 0, muted: 1 });
  });

  it('skips a clip whose peaks have not arrived and counts it', () => {
    const p = withClips([clip('clip_1', 0, 0, 90)]);
    const plan = silencePlan(p, peaks(null));
    expect(plan.cuts).toEqual([]);
    expect(plan).toMatchObject({ read: 0, unread: 1, muted: 0 });
  });

  it('treats a source with no sound as read, with nothing to cut', () => {
    const p = withClips([clip('clip_1', 0, 0, 90)]);
    const plan = silencePlan(p, peaks(buildPyramid([], SR)));
    expect(plan.cuts).toEqual([]);
    expect(plan).toMatchObject({ read: 1, unread: 0 });
  });

  it('measures the source as recorded, whatever the level or the fades', () => {
    const p = withClips([
      clip('clip_1', 0, 0, 90, { volume: 0.05, fadeIn: 10, fadeOut: 10 }),
    ]);
    expect(silencePlan(p, peaks(SOUND_GAP_SOUND)).removedFrames).toBe(24);
  });
});

describe('silencePatch — the cut as one patch', () => {
  function cut(p: Project, pyramid: Pyramid = SOUND_GAP_SOUND) {
    const plan = silencePlan(p, peaks(pyramid));
    const patch = silencePatch(p, plan);
    const after = applyOps(p, patch.forward);
    return { plan, patch, after };
  }

  it('removes exactly the planned frames and keeps the total honest', () => {
    const p = withClips([clip('clip_1', 0, 0, 90)]);
    const { after, plan } = cut(p);
    expect(timelineDuration(after)).toBe(90 - plan.removedFrames);
    expect(clipsOf(after)).toEqual([
      clip('clip_1', 0, 0, 36),
      clip('clip_10', 36, 60, 90),
    ]);
    expect(after.nextId).toBe(11);
  });

  it('keeps the head fade on the head and the tail fade on the tail, none between', () => {
    // Two runs: three pieces. 0.6 s of quiet twice, 0.2 s cut each.
    const three = pyramidOf(
      concat(tone(1), flat(0.6), tone(1), flat(0.6), tone(0.8)),
    );
    const p = withClips([
      clip('clip_1', 0, 0, 120, { fadeIn: 5, fadeOut: 5, volume: 0.5 }),
    ]);
    const { after } = cut(p, three);
    const pieces = clipsOf(after);
    expect(pieces).toHaveLength(3);
    expect(pieces[0]).toMatchObject({ id: 'clip_1', fadeIn: 5, volume: 0.5 });
    expect(pieces[0].fadeOut).toBeUndefined();
    expect(pieces[1].fadeIn).toBeUndefined();
    expect(pieces[1].fadeOut).toBeUndefined();
    expect(pieces[1].volume).toBe(0.5);
    expect(pieces[2].fadeIn).toBeUndefined();
    expect(pieces[2]).toMatchObject({ fadeOut: 5, volume: 0.5 });
    // Butted, in order, nothing dropped.
    let cursor = 0;
    for (const c of pieces) {
      expect(c.startFrame).toBe(cursor);
      cursor += c.outFrame - c.inFrame;
    }
  });

  it('drops a fade whose edge was cut away, and fits one that no longer fits', () => {
    // Quiet at the very start: the head goes, and with it the fade-in.
    const headQuiet = pyramidOf(concat(flat(1), tone(2)));
    const p = withClips([
      clip('clip_1', 0, 0, 90, { fadeIn: 10, fadeOut: 40 }),
    ]);
    const { after } = cut(p, headQuiet);
    const pieces = clipsOf(after);
    // [0,6) stays (the padding), [6,24) goes, [24,90) stays.
    expect(pieces.map((c) => [c.inFrame, c.outFrame])).toEqual([
      [0, 6],
      [24, 90],
    ]);
    // The head piece is 6 frames; a 10-frame fade-in is written at 6.
    expect(pieces[0].fadeIn).toBe(6);
    expect(pieces[1].fadeIn).toBeUndefined();
    expect(pieces[1].fadeOut).toBe(40);
  });

  it('removes a clip that lies wholly inside a run, and pulls the rest in', () => {
    const p = withClips([
      clip('clip_1', 0, 0, 36),
      clip('clip_2', 36, 40, 55),
      clip('clip_3', 51, 60, 90),
    ]);
    const { after, plan } = cut(p);
    expect(plan.cuts).toEqual([
      { clipId: 'clip_2', startFrame: 36, length: 15 },
    ]);
    expect(clipsOf(after)).toEqual([
      clip('clip_1', 0, 0, 36),
      clip('clip_3', 36, 60, 90),
    ]);
  });

  it('shifts a later clip by everything removed before it, gaps kept', () => {
    const p = withClips([
      clip('clip_1', 0, 0, 90),
      // A 10-frame gap, then a clip of the same source, untrimmed.
      clip('clip_2', 100, 0, 90),
    ]);
    const { after } = cut(p);
    expect(clipsOf(after).map((c) => [c.id, c.startFrame])).toEqual([
      ['clip_1', 0],
      ['clip_10', 36],
      ['clip_2', 76],
      ['clip_11', 112],
    ]);
    expect(timelineDuration(after)).toBe(190 - 48);
  });

  it('takes the words with the pictures', () => {
    const p = withClips(
      [clip('clip_1', 0, 0, 90)],
      [
        { id: 'sub_1', text: '앞', startFrame: 0, endFrame: 30 },
        { id: 'sub_2', text: '가운데', startFrame: 40, endFrame: 55 },
        { id: 'sub_3', text: '뒤', startFrame: 70, endFrame: 90 },
      ],
    );
    const { after } = cut(p);
    expect(after.subtitles).toEqual([
      { id: 'sub_1', text: '앞', startFrame: 0, endFrame: 30 },
      { id: 'sub_3', text: '뒤', startFrame: 46, endFrame: 66 },
    ]);
  });

  it('takes the pictures with the footage too', () => {
    const image = (
      id: string,
      startFrame: number,
      endFrame: number,
      over: Partial<StageImage> = {},
    ): StageImage => ({
      id,
      assetId: 'asset_2',
      startFrame,
      endFrame,
      ...over,
    });
    const p = withClips(
      [clip('clip_1', 0, 0, 90)],
      [],
      [
        image('img_1', 0, 30),
        image('img_2', 40, 55),
        image('img_3', 70, 90, { size: 0.4 }),
      ],
    );
    const { after, patch } = cut(p);
    // img_2 sat wholly over the pause: gone with it. img_3 slid left by the
    // 24 frames removed before it, and kept the size it was given.
    expect(after.images).toEqual([
      image('img_1', 0, 30),
      image('img_3', 46, 66, { size: 0.4 }),
    ]);
    expect(applyOps(after, patch.inverse)).toEqual(p);
  });

  it('is undone exactly by its inverse', () => {
    const p = withClips(
      [
        clip('clip_1', 0, 0, 45, { fadeIn: 3 }),
        clip('clip_2', 45, 45, 90, { fadeOut: 3, muted: true }),
        clip('clip_3', 90, 0, 90),
      ],
      [{ id: 'sub_1', text: '말', startFrame: 30, endFrame: 130 }],
    );
    const { after, patch } = cut(p);
    expect(after).not.toEqual(p);
    expect(applyOps(after, patch.inverse)).toEqual(p);
  });

  it('refuses to build a patch from an empty plan', () => {
    const p = withClips([clip('clip_1', 0, 0, 90)]);
    const plan = silencePlan(p, peaks(pyramidOf(tone(3))));
    expect(() => silencePatch(p, plan)).toThrow();
  });
});
