import { describe, it, expect } from 'vitest';
import {
  audibleSourceRange,
  buildAudioSchedule,
  clipCeilingFor,
  gainAt,
  scheduleGain,
} from './audioSchedule';
import { buildPyramid } from './waveform';
import { createProject } from './project';
import { createEditor } from './command';
import { FPS_30 } from './time';
import type { Clip, Project } from './types';

function seed(frames = 90): Project {
  const p = createProject();
  const c: Clip = {
    id: 'clip_1',
    assetId: 'asset_1',
    startFrame: 0,
    inFrame: 0,
    outFrame: frames,
  };
  return {
    ...p,
    nextId: 2,
    timeline: { ...p.timeline, fps: FPS_30 },
    tracks: p.tracks.map((t) =>
      t.type === 'video' ? { ...t, clips: [c] } : t,
    ),
  };
}

describe('audio schedule', () => {
  it('is empty for an empty timeline', () => {
    expect(buildAudioSchedule(createProject(), 0)).toEqual([]);
  });

  it('schedules one segment for an untouched clip', () => {
    const s = buildAudioSchedule(seed(90), 0);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      assetId: 'asset_1',
      whenSec: 0,
      offsetSec: 0,
    });
    expect(s[0].durationSec).toBeCloseTo(3, 6); // 90 frames @30fps
  });

  it('starts mid-clip when playback starts mid-timeline', () => {
    const s = buildAudioSchedule(seed(90), 30); // start at 1s
    expect(s).toHaveLength(1);
    expect(s[0].whenSec).toBe(0); // immediately
    expect(s[0].offsetSec).toBeCloseTo(1, 6); // 1s into the source
    expect(s[0].durationSec).toBeCloseTo(2, 6); // 2s remaining
  });

  it('follows a cut: audio skips the deleted material', () => {
    const ed = createEditor(seed(90));
    ed.setPlayhead(30);
    ed.dispatch('clip.split'); // [0,30) [30,90)
    ed.select(ed.project.tracks.find((t) => t.type === 'video')!.clips[0].id);
    ed.dispatch('clip.deleteRipple'); // drop the first second

    const s = buildAudioSchedule(ed.project, 0);
    expect(s).toHaveLength(1);
    expect(s[0].whenSec).toBe(0);
    expect(s[0].offsetSec).toBeCloseTo(1, 6); // source starts 1s in
    expect(s[0].durationSec).toBeCloseTo(2, 6);
  });

  it('keeps two pieces separate after a split (no overlap, no gap)', () => {
    const ed = createEditor(seed(90));
    ed.setPlayhead(30);
    ed.dispatch('clip.split');
    const s = buildAudioSchedule(ed.project, 0);
    expect(s).toHaveLength(2);
    expect(s[0].whenSec).toBe(0);
    expect(s[0].durationSec).toBeCloseTo(1, 6);
    expect(s[1].whenSec).toBeCloseTo(1, 6); // exactly where the first ends
    expect(s[1].offsetSec).toBeCloseTo(1, 6);
    expect(s[1].durationSec).toBeCloseTo(2, 6);
  });

  it('skips clips entirely before the start point', () => {
    const ed = createEditor(seed(90));
    ed.setPlayhead(30);
    ed.dispatch('clip.split');
    const s = buildAudioSchedule(ed.project, 60); // start at 2s
    expect(s).toHaveLength(1);
    expect(s[0].whenSec).toBe(0);
    expect(s[0].offsetSec).toBeCloseTo(2, 6);
    expect(s[0].durationSec).toBeCloseTo(1, 6);
  });

  it('leaves silence for a gap rather than shifting audio earlier', () => {
    const p = createProject();
    const withGap: Project = {
      ...p,
      tracks: p.tracks.map((t) =>
        t.type === 'video'
          ? {
              ...t,
              clips: [
                {
                  id: 'c1',
                  assetId: 'a1',
                  startFrame: 0,
                  inFrame: 0,
                  outFrame: 30,
                },
                {
                  id: 'c2',
                  assetId: 'a1',
                  startFrame: 60,
                  inFrame: 0,
                  outFrame: 30,
                },
              ],
            }
          : t,
      ),
    };
    const s = buildAudioSchedule(withGap, 0);
    expect(s).toHaveLength(2);
    expect(s[0].whenSec).toBe(0);
    expect(s[1].whenSec).toBeCloseTo(2, 6); // 60 frames @30fps — the gap is kept
  });
});

describe('audio schedule — fades (ADR-0012)', () => {
  const sec = (frames: number) => frames / 30;

  /** Two 30-frame clips of two 3 s files, butted at frame 30. */
  function pair(a: Partial<Clip> = {}, b: Partial<Clip> = {}): Project {
    const p = createProject();
    const first: Clip = {
      id: 'clip_a',
      assetId: 'asset_a',
      startFrame: 0,
      inFrame: 0,
      outFrame: 30,
      ...a,
    };
    const second: Clip = {
      id: 'clip_b',
      assetId: 'asset_b',
      startFrame: 30,
      inFrame: 20,
      outFrame: 50,
      ...b,
    };
    return {
      ...p,
      nextId: 3,
      timeline: { ...p.timeline, fps: FPS_30 },
      assets: ['asset_a', 'asset_b'].map((id) => ({
        id,
        kind: 'video' as const,
        name: id,
        meta: { durationSec: 3 },
      })),
      tracks: p.tracks.map((t) =>
        t.type === 'video' ? { ...t, clips: [first, second] } : t,
      ),
    };
  }

  it('carries no gain for a hard cut', () => {
    const s = buildAudioSchedule(pair(), 0);
    expect(s.map((x) => x.gain)).toEqual([undefined, undefined]);
  });

  it('ramps the sound with the picture on a fade from black', () => {
    const s = buildAudioSchedule(pair({ fadeIn: 15 }), 0);
    expect(s[0].gain).toEqual([
      { atSec: 0, value: 0 },
      { atSec: sec(15), value: 1 },
    ]);
    expect(s[0].whenSec).toBe(0);
    expect(s[0].durationSec).toBeCloseTo(sec(30), 9);
  });

  it('ramps down to the last frame on a fade to black', () => {
    const s = buildAudioSchedule(pair({}, { fadeOut: 10 }), 0);
    expect(s[1].gain).toEqual([
      { atSec: sec(50), value: 1 },
      { atSec: sec(60), value: 0 },
    ]);
  });

  it('lets the previous clip’s sound run on under a dissolve, fading out', () => {
    // b fades in at the cut: a keeps playing its overhang for those frames.
    const s = buildAudioSchedule(pair({}, { fadeIn: 10 }), 0);
    expect(s[0].durationSec).toBeCloseTo(sec(40), 9);
    expect(s[0].gain).toEqual([
      { atSec: sec(30), value: 1 },
      { atSec: sec(40), value: 0 },
    ]);
    expect(s[1].gain).toEqual([
      { atSec: sec(30), value: 0 },
      { atSec: sec(40), value: 1 },
    ]);
  });

  it('starts the next clip’s sound early, fading in, when this one fades out at the cut', () => {
    const s = buildAudioSchedule(pair({ fadeOut: 10 }), 0);
    // b has 20 frames of pre-roll in its file; the fade needs 10 of them.
    expect(s[1].whenSec).toBeCloseTo(sec(20), 9);
    expect(s[1].offsetSec).toBeCloseTo(sec(10), 9);
    expect(s[1].durationSec).toBeCloseTo(sec(40), 9); // 30 of clip + 10 pre-roll
    expect(s[1].gain).toEqual([
      { atSec: sec(20), value: 0 },
      { atSec: sec(30), value: 1 },
    ]);
  });

  it('starts the sound at the cut, at full, when the file has no pre-roll', () => {
    // b starts at its file's first frame: no pre-roll possible; the picture
    // holds b's first frame and is at full weight at the cut, so the sound
    // simply starts there — no ramp, and no ramp means no pop either.
    const s = buildAudioSchedule(
      pair({ fadeOut: 10 }, { inFrame: 0, outFrame: 30 }),
      0,
    );
    expect(s[1].whenSec).toBeCloseTo(sec(30), 9);
    expect(s[1].offsetSec).toBe(0);
    expect(s[1].gain).toBeUndefined();
  });

  it('ramps over the pre-roll it has when that is shorter than the fade', () => {
    // 3 frames of pre-roll under a 10-frame fade: the ramp must reach zero
    // where the sound STARTS, not at the picture's fade start — anchored at
    // the picture's, the first audible sample would be at 70%.
    const s = buildAudioSchedule(
      pair({ fadeOut: 10 }, { inFrame: 3, outFrame: 33 }),
      0,
    );
    expect(s[1].whenSec).toBeCloseTo(sec(27), 9);
    expect(s[1].offsetSec).toBeCloseTo(sec(0), 9);
    expect(s[1].gain).toEqual([
      { atSec: sec(27), value: 0 },
      { atSec: sec(30), value: 1 },
    ]);
  });

  it('dips through black when both sides soften one cut — no overhang, no pre-roll', () => {
    const s = buildAudioSchedule(pair({ fadeOut: 10 }, { fadeIn: 10 }), 0);
    expect(s[0].durationSec).toBeCloseTo(sec(30), 9);
    expect(s[1].whenSec).toBeCloseTo(sec(30), 9);
    expect(s[0].gain).toEqual([
      { atSec: sec(20), value: 1 },
      { atSec: sec(30), value: 0 },
    ]);
    expect(s[1].gain).toEqual([
      { atSec: sec(30), value: 0 },
      { atSec: sec(40), value: 1 },
    ]);
  });

  it('keeps ramp points relative to the start, even in the past', () => {
    // Playback starting inside a fade: the ramp began before "now".
    const s = buildAudioSchedule(pair({ fadeIn: 15 }), 10);
    expect(s[0].gain).toEqual([
      { atSec: -sec(10), value: 0 },
      { atSec: sec(5), value: 1 },
    ]);
  });
});

describe('audio schedule — volume and mute (ADR-0013)', () => {
  const sec = (frames: number) => frames / 30;

  /** Two 30-frame clips of two 3 s files, butted at frame 30. */
  function pair(a: Partial<Clip> = {}, b: Partial<Clip> = {}): Project {
    const p = createProject();
    const first: Clip = {
      id: 'clip_a',
      assetId: 'asset_a',
      startFrame: 0,
      inFrame: 0,
      outFrame: 30,
      ...a,
    };
    const second: Clip = {
      id: 'clip_b',
      assetId: 'asset_b',
      startFrame: 30,
      inFrame: 20,
      outFrame: 50,
      ...b,
    };
    return {
      ...p,
      nextId: 3,
      timeline: { ...p.timeline, fps: FPS_30 },
      assets: ['asset_a', 'asset_b'].map((id) => ({
        id,
        kind: 'video' as const,
        name: id,
        meta: { durationSec: 3 },
      })),
      tracks: p.tracks.map((t) =>
        t.type === 'video' ? { ...t, clips: [first, second] } : t,
      ),
    };
  }

  it('is a flat gain at the level, from the segment’s first frame', () => {
    const s = buildAudioSchedule(pair({ volume: 0.5 }), 0);
    expect(s[0].gain).toEqual([{ atSec: 0, value: 0.5 }]);
    expect(s[1].gain).toBeUndefined();
    expect(gainAt(s[0].gain, 0.7)).toBe(0.5);
  });

  it('schedules nothing at all for a muted clip', () => {
    const s = buildAudioSchedule(pair({ muted: true }), 0);
    expect(s).toHaveLength(1);
    expect(s[0].clipId).toBe('clip_b');
  });

  it('treats 0% the same as muted', () => {
    const s = buildAudioSchedule(pair({}, { volume: 0 }), 0);
    expect(s.map((x) => x.clipId)).toEqual(['clip_a']);
  });

  it('scales a fade’s ramp by the level, so the fade still ends where it did', () => {
    const s = buildAudioSchedule(pair({ fadeIn: 15, volume: 0.5 }), 0);
    expect(s[0].gain).toEqual([
      { atSec: 0, value: 0 },
      { atSec: sec(15), value: 0.5 },
    ]);
  });

  it('plays a neighbour’s overhang at the NEIGHBOUR’s level under a dissolve', () => {
    // b fades in over a's overhang; a is at half, b is at full.
    const s = buildAudioSchedule(pair({ volume: 0.5 }, { fadeIn: 10 }), 0);
    expect(s[0].gain).toEqual([
      { atSec: sec(30), value: 0.5 },
      { atSec: sec(40), value: 0 },
    ]);
    // Before the ramp's first point the level holds — the whole clip is at half.
    expect(gainAt(s[0].gain, 0)).toBe(0.5);
    expect(gainAt(s[0].gain, sec(35))).toBeCloseTo(0.25, 9);
    expect(s[1].gain).toEqual([
      { atSec: sec(30), value: 0 },
      { atSec: sec(40), value: 1 },
    ]);
  });

  it('keeps a muted neighbour silent through a dissolve too', () => {
    const s = buildAudioSchedule(pair({ muted: true }, { fadeIn: 10 }), 0);
    expect(s.map((x) => x.clipId)).toEqual(['clip_b']);
  });

  it('holds the level under a ceiling the caller knows from the clip’s peak', () => {
    const ceiling = (c: Clip) => (c.id === 'clip_a' ? 1.1 : 2);
    const s = buildAudioSchedule(
      pair({ volume: 2 }, { volume: 2 }),
      0,
      ceiling,
    );
    expect(s[0].gain).toEqual([{ atSec: 0, value: 1.1 }]);
    expect(s[1].gain).toEqual([{ atSec: sec(30), value: 2 }]);
    // A ceiling never raises a level, and never touches a mute.
    const t = buildAudioSchedule(
      pair({ volume: 0.5 }, { muted: true }),
      0,
      () => 2,
    );
    expect(t.map((x) => x.clipId)).toEqual(['clip_a']);
    expect(t[0].gain).toEqual([{ atSec: 0, value: 0.5 }]);
  });

  it('measures the ceiling over everything a dissolve can play, not only the trim', () => {
    // asset_a is quiet inside a's trim [0,30) and has a full-scale transient
    // at frame 32 — material the trim cut away. Alone, a may go to 200%.
    const rate = 48_000;
    const samples = new Float32Array(rate * 3);
    for (let i = 0; i < samples.length; i++) samples[i] = 0.1 * Math.sin(i / 7);
    samples[Math.round(32 * (rate / 30)) + 200] = 0.95;
    const pyramid = buildPyramid([samples], rate);
    expect(clipCeilingFor(pair(), 'clip_a', pyramid)).toBe(2);
    expect(audibleSourceRange(pair(), 'clip_a')).toEqual({
      inFrame: 0,
      outFrame: 30,
    });
    // b fades in over a's overhang: frames [30,40) of a's file are played,
    // transient included, at a's level — so a's ceiling must see them.
    const p = pair({}, { fadeIn: 10 });
    expect(audibleSourceRange(p, 'clip_a')).toEqual({
      inFrame: 0,
      outFrame: 40,
    });
    expect(clipCeilingFor(p, 'clip_a', pyramid)).toBe(1.05);
    // The pre-roll side: a fades out, b's file before its in-point plays.
    const q = pair({ fadeOut: 10 });
    expect(audibleSourceRange(q, 'clip_b')).toEqual({
      inFrame: 10,
      outFrame: 50,
    });
    // Both sides softening one cut is a dip through black: nothing reaches.
    const r = pair({ fadeOut: 10 }, { fadeIn: 10 });
    expect(audibleSourceRange(r, 'clip_a')).toEqual({
      inFrame: 0,
      outFrame: 30,
    });
    expect(audibleSourceRange(r, 'clip_b')).toEqual({
      inFrame: 20,
      outFrame: 50,
    });
    // Unknown peaks, unknown clip.
    expect(clipCeilingFor(p, 'clip_a', null)).toBe(2);
    expect(audibleSourceRange(p, 'nope')).toBeNull();
  });

  it('keeps the flat point at the segment’s start, in the past, like a fade’s', () => {
    const s = buildAudioSchedule(pair({ volume: 1.5 }), 10);
    expect(s[0].gain).toEqual([{ atSec: sec(-10), value: 1.5 }]);
    // ...and the player starts the parameter where the ramp already is.
    const calls: [string, number, number][] = [];
    scheduleGain(
      {
        setValueAtTime: (v, t) => calls.push(['set', v, t]),
        linearRampToValueAtTime: (v, t) => calls.push(['ramp', v, t]),
      },
      s[0].gain,
      100,
    );
    expect(calls).toEqual([['set', 1.5, 100]]);
  });
});

describe('gain ramps', () => {
  const ramp = [
    { atSec: -1, value: 0 },
    { atSec: 1, value: 1 },
    { atSec: 3, value: 1 },
    { atSec: 4, value: 0 },
  ];

  it('interpolates, and holds the ends', () => {
    expect(gainAt(ramp, -5)).toBe(0);
    expect(gainAt(ramp, 0)).toBe(0.5);
    expect(gainAt(ramp, 2)).toBe(1);
    expect(gainAt(ramp, 3.5)).toBe(0.5);
    expect(gainAt(ramp, 9)).toBe(0);
    expect(gainAt([], 1)).toBe(1);
  });

  it('starts the parameter where the ramp already is and ramps to every later point', () => {
    const calls: string[] = [];
    const param = {
      setValueAtTime: (v: number, t: number) => calls.push(`set ${v} @${t}`),
      linearRampToValueAtTime: (v: number, t: number) =>
        calls.push(`ramp ${v} @${t}`),
    };
    scheduleGain(param, ramp, 10);
    expect(calls).toEqual([
      'set 0.5 @10',
      'ramp 1 @11',
      'ramp 1 @13',
      'ramp 0 @14',
    ]);
  });

  it('touches nothing for a segment with no ramp', () => {
    const param = {
      setValueAtTime: () => {
        throw new Error('should not be called');
      },
      linearRampToValueAtTime: () => {
        throw new Error('should not be called');
      },
    };
    expect(() => scheduleGain(param, undefined, 0)).not.toThrow();
  });
});
