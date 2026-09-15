// framewright — a subtitle's look, place and effect: the time half (ADR-0017).
//
// The pixels are `subtitleRender.test.ts`. This file pins what the DOCUMENT
// stores for each choice, and the one arithmetic that turns a frame number
// into "how far in is the effect" — the number both surfaces draw from.
import { describe, expect, it } from 'vitest';
import { FPS_2997, FPS_30 } from './time';
import { createProject } from './project';
import type { Clip, Project, Subtitle } from './types';
import {
  describeEffect,
  describeLook,
  describePlace,
  effectFrames,
  effectOf,
  lookOf,
  placeFields,
  placeOf,
  subtitleFrameAt,
  subtitleFrameOf,
  subtitlePhase,
  toward,
} from './subtitleStyle';

const sub = (extra: Partial<Subtitle> = {}): Subtitle => ({
  id: 'sub_1',
  text: '예능 자막',
  startFrame: 100,
  endFrame: 160, // 60 frames = 2 s at 30 fps
  ...extra,
});

describe('what the document stores', () => {
  it('reads absent fields as the plain, bottom, effectless subtitle', () => {
    const s = sub();
    expect(lookOf(s)).toBe('plain');
    expect(placeOf(s)).toBe('bottom');
    expect(effectOf(s)).toBe('none');
  });

  it('names the place presets from the stored fractions, and nothing else', () => {
    expect(placeOf({ posX: 0.5, posY: 0.5 })).toBe('middle');
    expect(placeOf({ posX: 0.5, posY: 0.15 })).toBe('top');
    // A drag (E8-2c) will write values no preset names: no radio is checked.
    expect(placeOf({ posX: 0.2, posY: 0.5 })).toBeNull();
    expect(placeOf({ posX: 0.5, posY: 0.3 })).toBeNull();
    // By VALUE since E8-2c (ADR-0019): posX 0.5 with no posY draws exactly
    // where the bottom stack draws — the bottom centre — so it IS 아래.
    expect(placeOf({ posX: 0.5 })).toBe('bottom');
    expect(placeOf({ posX: 0.49 })).toBeNull();
  });

  it('writes the bottom preset as ABSENT fields, so an old document and a new one draw alike', () => {
    expect(placeFields('bottom')).toEqual({ posX: undefined, posY: undefined });
    expect(placeFields('middle')).toEqual({ posX: 0.5, posY: 0.5 });
    expect(placeOf(placeFields('top'))).toBe('top');
  });
});

describe('effectFrames', () => {
  it('is a quarter second at the timeline fps', () => {
    expect(effectFrames(sub(), FPS_30)).toBe(8); // 7.5 → 8
    expect(effectFrames(sub(), FPS_2997)).toBe(7); // 7.49 → 7
  });

  it('never exceeds half the subtitle, so the way in and out cannot overlap', () => {
    expect(effectFrames(sub({ endFrame: 110 }), FPS_30)).toBe(5);
    expect(effectFrames(sub({ endFrame: 103 }), FPS_30)).toBe(1);
    expect(effectFrames(sub({ endFrame: 101 }), FPS_30)).toBe(0);
  });
});

describe('subtitlePhase', () => {
  it('is 1 on every frame when there is no effect', () => {
    const s = sub();
    expect(subtitlePhase(s, 100, FPS_30)).toBe(1);
    expect(subtitlePhase(s, 159, FPS_30)).toBe(1);
  });

  it('rises over the first frames, holds, and falls over the last — mirrored', () => {
    const s = sub({ effect: 'fade' }); // n = 8
    expect(subtitlePhase(s, 100, FPS_30)).toBeCloseTo(1 / 8);
    expect(subtitlePhase(s, 103, FPS_30)).toBeCloseTo(4 / 8);
    expect(subtitlePhase(s, 107, FPS_30)).toBe(1);
    expect(subtitlePhase(s, 130, FPS_30)).toBe(1);
    expect(subtitlePhase(s, 152, FPS_30)).toBe(1);
    expect(subtitlePhase(s, 153, FPS_30)).toBeCloseTo(7 / 8);
    expect(subtitlePhase(s, 159, FPS_30)).toBeCloseTo(1 / 8);
  });

  it('shows something on every frame the subtitle owns — never 0 inside the range', () => {
    const s = sub({ effect: 'pop' });
    for (let f = s.startFrame; f < s.endFrame; f++) {
      expect(subtitlePhase(s, f, FPS_30)).toBeGreaterThan(0);
    }
  });

  it('is simply shown when there is no room for an effect', () => {
    expect(
      subtitlePhase(sub({ effect: 'rise', endFrame: 101 }), 100, FPS_30),
    ).toBe(1);
    // n = 1: the first and last frame are already "1 / 1".
    expect(
      subtitlePhase(sub({ effect: 'rise', endFrame: 103 }), 100, FPS_30),
    ).toBe(1);
    expect(
      subtitlePhase(sub({ effect: 'rise', endFrame: 103 }), 102, FPS_30),
    ).toBe(1);
  });

  it('rounds the effect through the timeline fps, 29.97 included', () => {
    const s = sub({ effect: 'fade' }); // n = 7 at 29.97
    expect(subtitlePhase(s, 100, FPS_2997)).toBeCloseTo(1 / 7);
    expect(subtitlePhase(s, 106, FPS_2997)).toBe(1);
  });
});

describe('subtitleFrameOf / subtitleFrameAt', () => {
  it('carries only the fields the subtitle has, plus the phase', () => {
    expect(subtitleFrameOf(sub(), 120, FPS_30)).toEqual({
      text: '예능 자막',
      t: 1,
    });
    expect(
      subtitleFrameOf(
        sub({ look: 'bold', posX: 0.5, posY: 0.15, effect: 'rise' }),
        100,
        FPS_30,
      ),
    ).toEqual({
      text: '예능 자막',
      look: 'bold',
      posX: 0.5,
      posY: 0.15,
      effect: 'rise',
      t: 1 / 8,
    });
  });

  it('lets the preview substitute the words being typed, keeping the look', () => {
    const f = subtitleFrameOf(sub({ look: 'shout' }), 120, FPS_30, '입력 중');
    expect(f.text).toBe('입력 중');
    expect(f.look).toBe('shout');
  });

  it('answers per frame from the project, null off the words and for empty words', () => {
    const p = createProject();
    const clip: Clip = {
      id: 'clip_1',
      assetId: 'asset_1',
      startFrame: 0,
      inFrame: 0,
      outFrame: 300,
    };
    const project: Project = {
      ...p,
      tracks: p.tracks.map((t) =>
        t.type === 'video' ? { ...t, clips: [clip] } : t,
      ),
      subtitles: [
        sub({ effect: 'fade' }),
        { id: 'sub_2', text: '', startFrame: 200, endFrame: 220 },
      ],
    };
    expect(subtitleFrameAt(project, 99)).toBeNull();
    expect(subtitleFrameAt(project, 100)).toEqual({
      text: '예능 자막',
      effect: 'fade',
      t: 1 / 8,
    });
    expect(subtitleFrameAt(project, 130)?.t).toBe(1);
    expect(subtitleFrameAt(project, 160)).toBeNull();
    expect(subtitleFrameAt(project, 205)).toBeNull();
  });
});

describe('the sentences', () => {
  it('pick 로 or 으로 by the last syllable, so no choice is announced as 톡로', () => {
    expect(toward('위')).toBe('위로');
    expect(toward('아래')).toBe('아래로');
    expect(toward('강조')).toBe('강조로');
    expect(toward('서서히')).toBe('서서히로');
    expect(toward('톡')).toBe('톡으로');
    expect(toward('외침')).toBe('외침으로');
    expect(toward('기본')).toBe('기본으로');
  });

  it('name the choice', () => {
    expect(describeLook('shout')).toBe('자막 모양을 외침으로 바꿨어요.');
    expect(describePlace('middle')).toBe('자막 자리를 가운데로 옮겼어요.');
    expect(describeEffect('pop')).toBe(
      '자막 효과를 톡으로 바꿨어요 · 작았다가 톡 커지며 나타나요.',
    );
    expect(describeEffect('rise')).toBe(
      '자막 효과를 올라오기로 바꿨어요 · 아래에서 올라오며 나타나요.',
    );
  });
});
