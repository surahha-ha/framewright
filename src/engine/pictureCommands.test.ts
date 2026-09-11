// framewright — the picture commands through the dispatcher (ADR-0014).
import { describe, expect, it } from 'vitest';
import { createEditor } from './command';
import { createProject } from './project';
import { FPS_30 } from './time';
import { videoTrack } from './timeline';
import { copyEntry } from './clipboard';
import { serialize, deserialize } from './persistence';
import type { Clip, Project } from './types';

function seed(
  clips: Clip[],
  meta: Project['assets'][number]['meta'] = { durationSec: 3 },
): Project {
  const p = createProject(FPS_30);
  const ids = [...new Set(clips.map((c) => c.assetId))];
  return {
    ...p,
    nextId: 10,
    // A 16:9 box, so a 16:9 source fills it and a turned one does not.
    timeline: { ...p.timeline, width: 320, height: 180 },
    assets: ids.map((id) => ({
      id,
      kind: 'video' as const,
      name: `${id}.mp4`,
      meta,
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
  assetId: 'asset_1',
  startFrame,
  inFrame,
  outFrame,
  ...extra,
});

const clips = (ed: ReturnType<typeof createEditor>) =>
  videoTrack(ed.project).clips;

function sentence(
  ed: ReturnType<typeof createEditor>,
  id: string,
  args?: unknown,
) {
  const before = ed.context();
  const cmd = ed.commands().find((c) => c.id === id)!;
  expect(ed.dispatch(id, args)).toBe(true);
  const done = cmd.done;
  return typeof done === 'function' ? done(before, ed.context(), args) : done;
}

describe('clip.rotate', () => {
  it('wants a clip chosen, is on R, and turns a quarter each press', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60)]));
    const cmd = ed.commands().find((c) => c.id === 'clip.rotate')!;
    expect(cmd.defaultKey).toBe('r');
    expect(cmd.hidden).toBe(true);
    expect(ed.canRun('clip.rotate')).toBe(false);
    ed.select('a');
    expect(sentence(ed, 'clip.rotate')).toBe('화면을 90° 돌렸어요.');
    expect(clips(ed)[0].rotation).toBe(90);
    ed.dispatch('clip.rotate');
    ed.dispatch('clip.rotate');
    expect(clips(ed)[0].rotation).toBe(270);
    expect(sentence(ed, 'clip.rotate')).toBe(
      '화면을 원래 방향으로 되돌렸어요.',
    );
    expect('rotation' in clips(ed)[0]).toBe(false);
    ed.undo();
    expect(clips(ed)[0].rotation).toBe(270);
  });

  it('sets an exact turn on the clip named', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60), clip('b', 60, 0, 60)]));
    expect(ed.dispatch('clip.rotate', { clipId: 'b', rotation: 180 })).toBe(
      true,
    );
    expect(clips(ed)[1].rotation).toBe(180);
    expect(clips(ed)[0].rotation).toBeUndefined();
    expect(ed.canRun('clip.rotate', { clipId: 'b', rotation: 180 })).toBe(
      false,
    );
  });

  it('pulls a pan inside the turned picture’s limit, says so, and undoes both at once', () => {
    const ed = createEditor(
      seed([clip('a', 0, 0, 60, { panX: 0.5, panY: -0.5 })], {
        durationSec: 3,
        width: 160,
        height: 90,
      }),
    );
    ed.select('a');
    // Stood up, the 16:9 picture is 101.25 of 320 wide: sideways it may go
    // 15%, up and down still half a box.
    expect(sentence(ed, 'clip.rotate')).toBe(
      '화면을 90° 돌렸어요 · 위치는 보이는 범위 안으로 맞췄어요.',
    );
    expect(clips(ed)[0]).toMatchObject({
      rotation: 90,
      panX: 0.15,
      panY: -0.5,
    });
    ed.undo();
    expect(clips(ed)[0]).toMatchObject({ panX: 0.5, panY: -0.5 });
    expect('rotation' in clips(ed)[0]).toBe(false);
    // A turn that changes nothing about the pan says only the turn.
    ed.dispatch('clip.pan', { x: 0.1, y: 0 });
    expect(sentence(ed, 'clip.rotate')).toBe('화면을 90° 돌렸어요.');
  });
});

describe('clip.zoom and clip.pan', () => {
  it('need their numbers, so they are not palette rows', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60)]));
    for (const id of ['clip.zoom', 'clip.pan']) {
      const cmd = ed.commands().find((c) => c.id === id)!;
      expect(cmd.requiresArgs).toBe(true);
      expect(cmd.hidden).toBe(true);
    }
    ed.select('a');
    expect(ed.canRun('clip.zoom')).toBe(false);
    expect(ed.canRun('clip.zoom', { zoom: 2 })).toBe(true);
    expect(ed.canRun('clip.pan', { x: 0.1, y: 0 })).toBe(true);
  });

  it('zooms, says which way, clamps, and writes the fit as no field', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60)]));
    ed.select('a');
    expect(sentence(ed, 'clip.zoom', { zoom: 2 })).toBe(
      '화면을 200%로 확대했어요.',
    );
    expect(clips(ed)[0].zoom).toBe(2);
    expect(ed.dispatch('clip.zoom', { zoom: 9 })).toBe(true);
    expect(clips(ed)[0].zoom).toBe(4);
    expect(ed.dispatch('clip.zoom', { zoom: 1.333 })).toBe(true);
    expect(clips(ed)[0].zoom).toBe(1.33);
    expect(sentence(ed, 'clip.zoom', { zoom: 1 })).toBe(
      '화면 확대를 풀었어요.',
    );
    expect('zoom' in clips(ed)[0]).toBe(false);
    expect(ed.canRun('clip.zoom', { zoom: 1 })).toBe(false);
    expect(ed.canRun('clip.zoom', { zoom: Number.NaN })).toBe(false);
  });

  it('moves the picture, rounds to a percent, and writes the centre as no field', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60)]));
    ed.select('a');
    expect(sentence(ed, 'clip.pan', { x: 0.204, y: -0.1 })).toBe(
      '화면을 옮겼어요 (오른쪽으로 20%, 위로 10%).',
    );
    expect(clips(ed)[0]).toMatchObject({ panX: 0.2, panY: -0.1 });
    // Half a box either way, at every zoom.
    expect(ed.dispatch('clip.pan', { x: 5, y: -5 })).toBe(true);
    expect(clips(ed)[0]).toMatchObject({ panX: 0.5, panY: -0.5 });
    expect(sentence(ed, 'clip.pan', { x: 0, y: 0 })).toBe(
      '화면을 가운데로 되돌렸어요.',
    );
    expect('panX' in clips(ed)[0]).toBe(false);
    expect('panY' in clips(ed)[0]).toBe(false);
    expect(ed.canRun('clip.pan', { x: 0, y: 0 })).toBe(false);
  });

  it('stops a pan where the picture’s own edge reaches the centre of the box', () => {
    const ed = createEditor(
      seed([clip('a', 0, 0, 60, { rotation: 90 })], {
        durationSec: 3,
        width: 160,
        height: 90,
      }),
    );
    ed.select('a');
    expect(sentence(ed, 'clip.pan', { x: 0.5, y: 0.5 })).toBe(
      '화면을 옮겼어요 (오른쪽으로 15%, 아래로 50%).',
    );
    expect(clips(ed)[0]).toMatchObject({ panX: 0.15, panY: 0.5 });
    // Already at the limit: asking for more is nothing to do.
    expect(ed.canRun('clip.pan', { x: 0.4, y: 0.5 })).toBe(false);
  });
});

describe('clip.pictureReset', () => {
  it('puts everything back in one step, and is unavailable when there is nothing to put back', () => {
    const ed = createEditor(
      seed([clip('a', 0, 0, 60, { zoom: 2, panX: 0.5, rotation: 90 })]),
    );
    const cmd = ed.commands().find((c) => c.id === 'clip.pictureReset')!;
    expect(cmd.hidden).toBe(true);
    expect(cmd.requiresArgs).toBeFalsy();
    expect(ed.canRun('clip.pictureReset')).toBe(false);
    ed.select('a');
    expect(ed.canRun('clip.pictureReset')).toBe(true);
    expect(sentence(ed, 'clip.pictureReset')).toBe(
      '화면을 찍은 그대로 되돌렸어요.',
    );
    expect(JSON.stringify(clips(ed)[0])).not.toMatch(/zoom|panX|panY|rotation/);
    expect(ed.canRun('clip.pictureReset')).toBe(false);
    expect(cmd.disabledReason!(ed.context())).toBe(
      '화면이 이미 찍은 그대로예요.',
    );
    ed.undo();
    expect(clips(ed)[0]).toMatchObject({ zoom: 2, panX: 0.5, rotation: 90 });
  });
});

describe('clip.pictureFill', () => {
  const sized = { durationSec: 3, width: 320, height: 180 };

  it('wants a clip, and has nothing to do for a picture the shape of the box', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60)], sized));
    const cmd = ed.commands().find((c) => c.id === 'clip.pictureFill')!;
    expect(cmd.hidden).toBe(true);
    expect(ed.canRun('clip.pictureFill')).toBe(false);
    expect(cmd.disabledReason!(ed.context())).toBe('클립을 먼저 골라 주세요.');
    ed.select('a');
    expect(ed.canRun('clip.pictureFill')).toBe(false);
    expect(cmd.disabledReason!(ed.context())).toBe('화면이 이미 꽉 차 있어요.');
  });

  it('grows the picture to the notch that covers a box of another shape, once', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60)], sized));
    ed.select('a');
    expect(ed.dispatch('frame.portrait')).toBe(true);
    expect(sentence(ed, 'clip.pictureFill')).toBe(
      '화면을 320%로 확대해 꽉 채웠어요.',
    );
    expect(clips(ed)[0].zoom).toBe(3.2);
    expect(ed.canRun('clip.pictureFill')).toBe(false);
    ed.undo();
    expect('zoom' in clips(ed)[0]).toBe(false);
    ed.redo();
    expect(clips(ed)[0].zoom).toBe(3.2);
  });

  it('blames the position, not the zoom, when that is what leaves the black', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60, { panX: 0.5 })], sized));
    ed.select('a');
    const cmd = ed.commands().find((c) => c.id === 'clip.pictureFill')!;
    expect(ed.canRun('clip.pictureFill')).toBe(false);
    expect(cmd.disabledReason!(ed.context())).toBe(
      '확대는 충분해요 · 위치를 가운데로 옮기면 꽉 차요.',
    );
  });

  it('keeps the pan and says what it leaves empty', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60, { panX: 0.5 })], sized));
    ed.select('a');
    ed.dispatch('frame.portrait');
    expect(sentence(ed, 'clip.pictureFill')).toBe(
      '화면을 320%로 확대했어요 · 옮겨 둔 위치 때문에 화면 왼쪽이 비어요',
    );
    expect(clips(ed)[0]).toMatchObject({ zoom: 3.2, panX: 0.5 });
  });

  it('stops at the slider’s end for a picture too wide to fill the box, and says so', () => {
    const ed = createEditor(
      seed([clip('a', 0, 0, 60)], { durationSec: 3, width: 2100, height: 900 }),
    );
    ed.select('a');
    ed.dispatch('frame.portrait');
    expect(sentence(ed, 'clip.pictureFill')).toBe(
      '화면을 400%까지 확대했어요 · 더는 키울 수 없어 화면 위아래가 비어요',
    );
    expect(clips(ed)[0].zoom).toBe(4);
    // Pressed again: the picture is centred and at the slider's end, so
    // neither "already full" nor "move it to the centre" is true (QA).
    const cmd = ed.commands().find((c) => c.id === 'clip.pictureFill')!;
    expect(ed.canRun('clip.pictureFill')).toBe(false);
    expect(cmd.disabledReason!(ed.context())).toBe(
      '더는 키울 수 없어요 · 화면 위아래가 비어요',
    );
    // Moved off centre at the cap, the black is the cap's, not the pan's:
    // centred it would STILL not cover, so the reason stays the cap's.
    ed.dispatch('clip.pan', { clipId: 'a', x: 0.3, y: 0 });
    expect(cmd.disabledReason!(ed.context())).toBe(
      '더는 키울 수 없어요 · 화면 위아래가 비어요',
    );
  });
});

describe('the picture travels with the clip', () => {
  it('survives a split on both pieces, a copy and a paste, and a save', () => {
    const fields = { zoom: 2, panX: 0.5, panY: -0.25, rotation: 90 as const };
    const ed = createEditor(seed([clip('a', 0, 0, 60, fields)]));
    ed.setPlayhead(30);
    expect(ed.dispatch('clip.split')).toBe(true);
    expect(clips(ed)[0]).toMatchObject(fields);
    expect(clips(ed)[1]).toMatchObject(fields);
    const entry = copyEntry(ed.project, clips(ed)[1].id)!;
    expect(entry).toMatchObject(fields);
    ed.setClipboard(entry);
    ed.setPlayhead(60);
    expect(ed.dispatch('clip.paste')).toBe(true);
    expect(clips(ed)[2]).toMatchObject(fields);
    const restored = deserialize(serialize(ed.project, [], 1));
    expect(restored!.project).toEqual(ed.project);
  });
});
