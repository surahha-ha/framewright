import { describe, it, expect } from 'vitest';
import { createProject } from './project';
import { clipLength, timelineDuration, resolveAt } from './timeline';
import { createEditor } from './command';
import type { Clip, Project } from './types';

function seed(): Project {
  const p = createProject();
  const c: Clip = {
    id: 'clip_1',
    assetId: 'asset_1',
    startFrame: 0,
    inFrame: 0,
    outFrame: 100,
  };
  return {
    ...p,
    nextId: 2,
    tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips: [c] } : t)),
  };
}

function videoClips(p: Project): Clip[] {
  return p.tracks.find((t) => t.type === 'video')!.clips;
}

function frameSum(p: Project): number {
  return videoClips(p).reduce((n, c) => n + clipLength(c), 0);
}

describe('command registry — dispatch & history', () => {
  it('ignores unknown commands', () => {
    const ed = createEditor(seed());
    const before = ed.project;
    expect(ed.dispatch('does.not.exist')).toBe(false);
    expect(ed.project).toBe(before);
  });

  it('canRun gates commands (no split at a clip boundary)', () => {
    const ed = createEditor(seed());
    ed.setPlayhead(0);
    expect(ed.canRun('clip.split')).toBe(false); // start of clip
    ed.setPlayhead(40);
    expect(ed.canRun('clip.split')).toBe(true);
  });

  it('nothing to split on an empty timeline', () => {
    const ed = createEditor(createProject());
    expect(ed.canRun('clip.split')).toBe(false);
    expect(ed.canRun('clip.deleteRipple')).toBe(false);
  });

  it('clamps the playhead to the timeline', () => {
    const ed = createEditor(seed()); // 100 frames -> last index 99
    ed.setPlayhead(500);
    expect(ed.playhead).toBe(99);
    ed.setPlayhead(-10);
    expect(ed.playhead).toBe(0);
  });
});

describe('clip.split', () => {
  it('produces contiguous half-open ranges and preserves the frame sum', () => {
    const ed = createEditor(seed());
    const totalBefore = frameSum(ed.project);
    ed.setPlayhead(40);
    expect(ed.dispatch('clip.split')).toBe(true);

    const clips = videoClips(ed.project);
    expect(clips).toHaveLength(2);
    const [left, right] = clips;
    // no gap, no overlap on the timeline
    expect(left.startFrame).toBe(0);
    expect(left.startFrame + clipLength(left)).toBe(right.startFrame);
    expect(right.startFrame).toBe(40);
    // source ranges are contiguous too
    expect(left.outFrame).toBe(right.inFrame);
    // not a single frame lost or gained
    expect(frameSum(ed.project)).toBe(totalBefore);
    expect(timelineDuration(ed.project)).toBe(100);
  });

  it('the frame under the playhead is unchanged by the split', () => {
    const ed = createEditor(seed());
    const before = resolveAt(ed.project, 40)!.sourceFrame;
    ed.setPlayhead(40);
    ed.dispatch('clip.split');
    expect(resolveAt(ed.project, 40)!.sourceFrame).toBe(before);
    expect(resolveAt(ed.project, 39)!.sourceFrame).toBe(39);
  });

  it('assigns deterministic ids (no Date.now/Math.random)', () => {
    const a = createEditor(seed());
    a.setPlayhead(40);
    a.dispatch('clip.split');
    const b = createEditor(seed());
    b.setPlayhead(40);
    b.dispatch('clip.split');
    expect(videoClips(a.project).map((c) => c.id)).toEqual(
      videoClips(b.project).map((c) => c.id),
    );
  });
});

describe('clip.deleteRipple', () => {
  it('removes the clip and pulls later clips back by exactly its length', () => {
    const ed = createEditor(seed());
    ed.setPlayhead(40);
    ed.dispatch('clip.split'); // [0,40) [40,100)
    ed.select(videoClips(ed.project)[0].id);
    expect(ed.dispatch('clip.deleteRipple')).toBe(true);

    const clips = videoClips(ed.project);
    expect(clips).toHaveLength(1);
    expect(clips[0].startFrame).toBe(0); // pulled back by 40
    expect(clipLength(clips[0])).toBe(60);
    expect(timelineDuration(ed.project)).toBe(60);
  });
});

describe('import defines the sequence', () => {
  it('the first import sets timeline resolution and fps; undo restores them', () => {
    const ed = createEditor(createProject());
    const before = JSON.stringify(ed.project.timeline);
    ed.importAsset({ kind: 'video', name: 'v.mp4', meta: {} }, 100, {
      width: 1080,
      height: 1920,
      fps: { num: 25, den: 1 },
    });
    expect(ed.project.timeline.width).toBe(1080);
    expect(ed.project.timeline.height).toBe(1920);
    expect(ed.project.timeline.fps).toEqual({ num: 25, den: 1 });
    ed.undo();
    expect(JSON.stringify(ed.project.timeline)).toBe(before);
  });

  it('a later import does not re-define the sequence', () => {
    const ed = createEditor(createProject());
    ed.importAsset({ kind: 'video', name: 'a.mp4', meta: {} }, 100, {
      width: 1080,
      height: 1920,
      fps: { num: 25, den: 1 },
    });
    ed.importAsset({ kind: 'video', name: 'b.mp4', meta: {} }, 50, {
      width: 640,
      height: 480,
      fps: { num: 60, den: 1 },
    });
    expect(ed.project.timeline.width).toBe(1080);
    expect(ed.project.timeline.fps).toEqual({ num: 25, den: 1 });
  });
});

describe('undo / redo', () => {
  it('undo restores the document exactly', () => {
    const ed = createEditor(seed());
    const snapshot = JSON.stringify(ed.project);
    ed.setPlayhead(40);
    ed.dispatch('clip.split');
    expect(JSON.stringify(ed.project)).not.toBe(snapshot);
    ed.undo();
    expect(JSON.stringify(ed.project)).toBe(snapshot); // includes the id counter
  });

  it('redo is deterministic — same ids as the original run', () => {
    const ed = createEditor(seed());
    ed.setPlayhead(40);
    ed.dispatch('clip.split');
    const after = JSON.stringify(ed.project);
    ed.undo();
    ed.redo();
    expect(JSON.stringify(ed.project)).toBe(after);
  });

  it('undoes a multi-op ripple delete as one step', () => {
    const ed = createEditor(seed());
    ed.setPlayhead(40);
    ed.dispatch('clip.split');
    const afterSplit = JSON.stringify(ed.project);
    ed.select(videoClips(ed.project)[0].id);
    ed.dispatch('clip.deleteRipple');
    ed.undo();
    expect(JSON.stringify(ed.project)).toBe(afterSplit);
  });

  it('a new edit clears the redo stack', () => {
    const ed = createEditor(seed());
    ed.setPlayhead(40);
    ed.dispatch('clip.split');
    ed.undo();
    expect(ed.canRedo()).toBe(true);
    ed.setPlayhead(60);
    ed.dispatch('clip.split');
    expect(ed.canRedo()).toBe(false);
  });

  it('undo/redo at the ends of history are safe no-ops', () => {
    const ed = createEditor(seed());
    expect(ed.canUndo()).toBe(false);
    ed.undo();
    ed.redo();
    expect(videoClips(ed.project)).toHaveLength(1);
  });
});
