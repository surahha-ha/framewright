// framewright — the sound commands through the dispatcher (ADR-0013).
import { describe, expect, it } from 'vitest';
import { createEditor } from './command';
import { createProject } from './project';
import { FPS_30 } from './time';
import { videoTrack } from './timeline';
import { copyEntry } from './clipboard';
import { serialize, deserialize } from './persistence';
import type { Clip, Project } from './types';

function seed(clips: Clip[]): Project {
  const p = createProject(FPS_30);
  const ids = [...new Set(clips.map((c) => c.assetId))];
  return {
    ...p,
    nextId: 10,
    assets: ids.map((id) => ({
      id,
      kind: 'video' as const,
      name: `${id}.mp4`,
      meta: { durationSec: 3 },
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

describe('clip.mute', () => {
  it('wants a clip chosen, and says so', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60)]));
    expect(ed.canRun('clip.mute')).toBe(false);
    const cmd = ed.commands().find((c) => c.id === 'clip.mute')!;
    expect(cmd.disabledReason!(ed.context())).toBe('클립을 먼저 골라 주세요.');
    expect(cmd.defaultKey).toBe('m');
  });

  it('toggles off and on again, one undo step each, and leaves no key behind', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60)]));
    ed.select('a');
    expect(sentence(ed, 'clip.mute')).toBe(
      '소리를 껐어요 · 이 클립은 들리지 않아요.',
    );
    expect(clips(ed)[0].muted).toBe(true);
    expect(sentence(ed, 'clip.mute')).toBe('소리를 다시 켰어요.');
    expect('muted' in clips(ed)[0]).toBe(false);
    ed.undo();
    expect(clips(ed)[0].muted).toBe(true);
    ed.undo();
    expect(JSON.stringify(clips(ed)[0])).not.toContain('muted');
  });

  it('acts on the clip named, not the selection', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60), clip('b', 60, 0, 60)]));
    ed.select('a');
    expect(ed.dispatch('clip.mute', { clipId: 'b' })).toBe(true);
    expect(clips(ed)[0].muted).toBeUndefined();
    expect(clips(ed)[1].muted).toBe(true);
  });

  it('keeps the volume for when the sound comes back', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60, { volume: 0.5 })]));
    ed.select('a');
    ed.dispatch('clip.mute');
    expect(clips(ed)[0].volume).toBe(0.5);
    ed.dispatch('clip.mute');
    expect(clips(ed)[0]).toMatchObject({ volume: 0.5 });
    expect('muted' in clips(ed)[0]).toBe(false);
  });
});

describe('clip.volume', () => {
  it('needs a level, so it is not a palette row', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60)]));
    const cmd = ed.commands().find((c) => c.id === 'clip.volume')!;
    expect(cmd.requiresArgs).toBe(true);
    expect(cmd.hidden).toBe(true);
    ed.select('a');
    expect(ed.canRun('clip.volume')).toBe(false);
    expect(ed.canRun('clip.volume', { volume: 0.5 })).toBe(true);
  });

  it('sets the level, says which way it went, and undoes exactly', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60)]));
    ed.select('a');
    expect(sentence(ed, 'clip.volume', { volume: 1.5 })).toBe(
      '소리를 150%로 키웠어요.',
    );
    expect(clips(ed)[0].volume).toBe(1.5);
    expect(sentence(ed, 'clip.volume', { volume: 0.5 })).toBe(
      '소리를 50%로 줄였어요.',
    );
    ed.undo();
    expect(clips(ed)[0].volume).toBe(1.5);
    ed.undo();
    expect(JSON.stringify(clips(ed)[0])).not.toContain('volume');
  });

  it('writes 100% as no field at all, and says it went back', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60, { volume: 0.5 })]));
    expect(sentence(ed, 'clip.volume', { clipId: 'a', volume: 1 })).toBe(
      '소리를 원래 크기로 되돌렸어요.',
    );
    expect('volume' in clips(ed)[0]).toBe(false);
  });

  it('is not an edit when the level is the one already there', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60, { volume: 0.5 })]));
    expect(ed.canRun('clip.volume', { clipId: 'a', volume: 0.5 })).toBe(false);
    expect(ed.canRun('clip.volume', { clipId: 'a', volume: 0.504 })).toBe(
      false,
    );
    const fresh = createEditor(seed([clip('a', 0, 0, 60)]));
    expect(fresh.canRun('clip.volume', { clipId: 'a', volume: 1 })).toBe(false);
  });

  it('clamps to the range the panel offers and rounds to a percent', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60)]));
    expect(ed.dispatch('clip.volume', { clipId: 'a', volume: 7 })).toBe(true);
    expect(clips(ed)[0].volume).toBe(2);
    expect(ed.dispatch('clip.volume', { clipId: 'a', volume: 0.333 })).toBe(
      true,
    );
    expect(clips(ed)[0].volume).toBe(0.33);
    expect(ed.dispatch('clip.volume', { clipId: 'a', volume: -3 })).toBe(true);
    expect(clips(ed)[0].volume).toBe(0);
  });

  it('refuses a level that is not a number', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60)]));
    expect(ed.canRun('clip.volume', { clipId: 'a', volume: Number.NaN })).toBe(
      false,
    );
  });
});

describe('the sound travels with the clip', () => {
  it('survives a split on both pieces', () => {
    const ed = createEditor(
      seed([clip('a', 0, 0, 60, { volume: 0.5, muted: true })]),
    );
    ed.setPlayhead(30);
    expect(ed.dispatch('clip.split')).toBe(true);
    expect(clips(ed)[0]).toMatchObject({ volume: 0.5, muted: true });
    expect(clips(ed)[1]).toMatchObject({ volume: 0.5, muted: true });
    ed.undo();
    expect(clips(ed)).toHaveLength(1);
    expect(clips(ed)[0]).toMatchObject({ volume: 0.5, muted: true });
  });

  it('is copied and pasted with the clip, and absent stays absent', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60, { volume: 0.5 })]));
    const entry = copyEntry(ed.project, 'a')!;
    expect(entry).toMatchObject({ volume: 0.5 });
    expect('muted' in entry).toBe(false);
    ed.setClipboard(entry);
    ed.setPlayhead(60);
    expect(ed.dispatch('clip.paste')).toBe(true);
    expect(clips(ed)[1].volume).toBe(0.5);
    expect('muted' in clips(ed)[1]).toBe(false);
  });

  it('round-trips through a save', () => {
    const project = seed([
      clip('a', 0, 0, 60, { volume: 0.35, muted: true }),
      clip('b', 60, 0, 60),
    ]);
    const restored = deserialize(serialize(project, [], 1));
    expect(restored!.project).toEqual(project);
  });
});
