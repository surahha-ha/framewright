// framewright — the box's shape through the dispatcher (ADR-0015).
import { describe, expect, it } from 'vitest';
import { createEditor } from './command';
import { createProject } from './project';
import { FPS_30 } from './time';
import { videoTrack } from './timeline';
import type { Clip, Project } from './types';
import { frameHints } from './frameCommands';

/** A project with a 16:9 box, an asset of the given size, and its clips. */
function seed(
  clips: Clip[],
  size: { width: number; height: number } | null = { width: 320, height: 180 },
  box = { width: 320, height: 180 },
): Project {
  const p = createProject(FPS_30);
  return {
    ...p,
    nextId: 10,
    timeline: { ...p.timeline, ...box },
    assets: size
      ? [
          {
            id: 'asset_1',
            kind: 'video' as const,
            name: 'asset_1.mp4',
            meta: { durationSec: 3, ...size },
          },
        ]
      : [],
    tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips } : t)),
  };
}

const clip = (id: string, extra: Partial<Clip> = {}): Clip => ({
  id,
  assetId: 'asset_1',
  startFrame: 0,
  inFrame: 0,
  outFrame: 60,
  ...extra,
});

function sentence(ed: ReturnType<typeof createEditor>, id: string) {
  const before = ed.context();
  const cmd = ed.commands().find((c) => c.id === id)!;
  expect(ed.dispatch(id)).toBe(true);
  const done = cmd.done;
  return typeof done === 'function' ? done(before, ed.context()) : done;
}

describe('the frame commands', () => {
  it('are three palette rows, off the toolbar, refused on an empty project', () => {
    const ed = createEditor(seed([], null));
    const ids = ['frame.landscape', 'frame.portrait', 'frame.square'];
    for (const id of ids) {
      const cmd = ed.commands().find((c) => c.id === id)!;
      expect(cmd.hidden).toBe(true);
      expect(cmd.requiresArgs).toBeUndefined();
      // A shape chosen before the first import would be overwritten by it.
      expect(ed.canRun(id)).toBe(false);
      expect(cmd.disabledReason!(ed.context())).toBe(
        '영상을 먼저 넣어 주세요.',
      );
    }
    expect(
      ids.map((id) => ed.commands().find((c) => c.id === id)!.label),
    ).toEqual([
      '가로 영상으로 바꾸기',
      '세로 영상으로 바꾸기',
      '정사각 영상으로 바꾸기',
    ]);
  });

  it('refuses the shape the box already has, and says which it is', () => {
    const ed = createEditor(seed([clip('a')]));
    const cmd = ed.commands().find((c) => c.id === 'frame.landscape')!;
    expect(ed.canRun('frame.landscape')).toBe(false);
    expect(cmd.disabledReason!(ed.context())).toBe('지금 가로 영상이에요.');
    expect(ed.canRun('frame.portrait')).toBe(true);
    expect(ed.canRun('frame.square')).toBe(true);
  });

  it('stands the box up, keeps the frame rate, and is one undo step', () => {
    const ed = createEditor(seed([clip('a')]));
    expect(sentence(ed, 'frame.portrait')).toBe(
      '세로 영상(9:16 · 180×320)으로 바꿨어요 · 비는 클립을 고르고 화면 채우기를 누르면 꽉 차요.',
    );
    expect(ed.project.timeline).toEqual({
      fps: FPS_30,
      width: 180,
      height: 320,
    });
    // Nothing on the clip was touched: the box moved, the picture followed.
    expect(videoTrack(ed.project).clips[0]).toEqual(clip('a'));
    expect(ed.canRun('frame.portrait')).toBe(false);
    ed.undo();
    expect(ed.project.timeline).toEqual({
      fps: FPS_30,
      width: 320,
      height: 180,
    });
    ed.redo();
    expect(ed.project.timeline).toEqual({
      fps: FPS_30,
      width: 180,
      height: 320,
    });
  });

  it('leaves the hint out when every picture still covers the new box', () => {
    // Already at the fill zoom for a 9:16 box: nothing goes black.
    const ed = createEditor(seed([clip('a', { zoom: 3.2 })]));
    expect(sentence(ed, 'frame.portrait')).toBe(
      '세로 영상(9:16 · 180×320)으로 바꿨어요.',
    );
    expect(frameHints(ed.project)).toEqual({
      uncovered: false,
      overzoomed: false,
    });
    // And with no clips at all, there is nothing to warn about.
    const empty = createEditor(seed([]));
    expect(sentence(empty, 'frame.square')).toBe(
      '정사각 영상(1:1 · 180×180)으로 바꿨어요.',
    );
  });

  it('offers every preset to a box that is none of them', () => {
    const ed = createEditor(
      seed([clip('a')], null, { width: 640, height: 480 }),
    );
    // (no asset → refused; with one → a 4:3 box can go to any preset)
    expect(ed.canRun('frame.landscape')).toBe(false);
    const withAsset = createEditor(
      seed(
        [clip('a')],
        { width: 640, height: 480 },
        { width: 640, height: 480 },
      ),
    );
    expect(withAsset.canRun('frame.landscape')).toBe(true);
    expect(sentence(withAsset, 'frame.landscape')).toBe(
      '가로 영상(16:9 · 854×480)으로 바꿨어요 · 비는 클립을 고르고 화면 채우기를 누르면 꽉 차요.',
    );
  });

  it('says that a clip filled for the last shape is now zoomed past this one', () => {
    // Filled for 세로 (320%), then back to 가로: the 16:9 picture needs no
    // zoom at all in a 16:9 box, so 320% is a crop to a third with no black
    // to show it (novice reviewer). The sentence says so; the zoom stays.
    const ed = createEditor(seed([clip('a')]));
    ed.select('a');
    ed.dispatch('frame.portrait');
    ed.dispatch('clip.pictureFill');
    expect(videoTrack(ed.project).clips[0].zoom).toBe(3.2);
    expect(sentence(ed, 'frame.landscape')).toBe(
      '가로 영상(16:9 · 320×180)으로 바꿨어요 · 크게 확대된 클립은 화면 원래대로로 되돌릴 수 있어요.',
    );
    expect(videoTrack(ed.project).clips[0].zoom).toBe(3.2);
    expect(frameHints(ed.project)).toEqual({
      uncovered: false,
      overzoomed: true,
    });
    // A zoom that a box still needs is not "past it": 정사각 needs 180%,
    // and the clip has 320% — still over. Back in 세로 it is exactly right.
    ed.dispatch('frame.portrait');
    expect(frameHints(ed.project)).toEqual({
      uncovered: false,
      overzoomed: false,
    });
  });

  it('survives a version restore and a save', () => {
    const ed = createEditor(seed([clip('a')]));
    ed.dispatch('frame.portrait');
    const snapshot = ed.project;
    ed.dispatch('frame.square');
    ed.restoreProject(snapshot);
    expect(ed.project.timeline).toMatchObject({ width: 180, height: 320 });
  });
});
