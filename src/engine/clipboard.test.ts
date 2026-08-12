import { describe, it, expect } from 'vitest';
import { copyEntry, pastePlan } from './clipboard';
import { createEditor } from './command';
import { createProject } from './project';
import { clipLength, timelineDuration, videoTrack } from './timeline';
import type { Clip, Project } from './types';

function build(clips: Clip[]): Project {
  const p = createProject();
  return {
    ...p,
    nextId: 10,
    assets: [
      {
        id: 'asset_1',
        kind: 'video',
        name: 'a.mp4',
        meta: { durationSec: 20 },
      },
    ],
    tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips } : t)),
  };
}

const clip = (id: string, startFrame: number, length: number): Clip => ({
  id,
  assetId: 'asset_1',
  startFrame,
  inFrame: 0,
  outFrame: length,
});

describe('copyEntry', () => {
  it('takes the media range, not the timeline position', () => {
    // What is on the clipboard is "this piece of that file" — where it used to
    // sit is the paste's business, not the copy's.
    const p = build([{ ...clip('clip_1', 40, 10), inFrame: 5, outFrame: 15 }]);
    expect(copyEntry(p, 'clip_1')).toEqual({
      assetId: 'asset_1',
      inFrame: 5,
      outFrame: 15,
    });
  });

  it('is null for a clip that is not there', () => {
    expect(copyEntry(build([]), 'clip_9')).toBeNull();
  });
});

describe('pastePlan', () => {
  it('drops the clip at the playhead when the space is free', () => {
    const p = build([clip('clip_1', 0, 10)]);
    expect(pastePlan(p, 10, 30)).toEqual({
      startFrame: 10,
      pushBy: 0,
      snapped: 'none',
    });
  });

  it('starts at zero on an empty timeline', () => {
    expect(pastePlan(build([]), 0, 30)).toEqual({
      startFrame: 0,
      pushBy: 0,
      snapped: 'none',
    });
  });

  it('snaps to the nearer edge when the playhead is inside a clip', () => {
    // Nothing is ever split or overwritten by a paste: the insert point moves to
    // a boundary, and the status bar says which one.
    const p = build([clip('clip_1', 0, 100)]);
    expect(pastePlan(p, 20, 30).startFrame).toBe(0);
    expect(pastePlan(p, 20, 30).snapped).toBe('start');
    expect(pastePlan(p, 80, 30).startFrame).toBe(100);
    expect(pastePlan(p, 80, 30).snapped).toBe('end');
  });

  it('prefers the end of the clip on an exact tie', () => {
    const p = build([clip('clip_1', 0, 100)]);
    expect(pastePlan(p, 50, 30).startFrame).toBe(100);
  });

  it('does not call it a snap when the playhead is already on the edge', () => {
    const p = build([clip('clip_1', 0, 100)]);
    expect(pastePlan(p, 0, 30)).toEqual({
      startFrame: 0,
      pushBy: 30,
      snapped: 'none',
    });
  });

  it('pushes later clips only as far as the gap falls short', () => {
    // A 10-frame hole and a 30-frame clip: everything after moves 20, so the
    // rest of the timeline keeps the spacing the user gave it.
    const p = build([clip('clip_1', 0, 10), clip('clip_2', 20, 10)]);
    expect(pastePlan(p, 10, 30)).toEqual({
      startFrame: 10,
      pushBy: 20,
      snapped: 'none',
    });
  });

  it('never pushes when there is nothing to the right', () => {
    const p = build([clip('clip_1', 0, 10)]);
    expect(pastePlan(p, 10, 999).pushBy).toBe(0);
  });
});

/** The paste command itself: it must be exactly reversible and never overlap. */
describe('clip.paste', () => {
  function editorWith(clips: Clip[]) {
    return createEditor(build(clips));
  }

  it('refuses when the clipboard is empty, and says nothing happened', () => {
    const ed = editorWith([clip('clip_1', 0, 10)]);
    expect(ed.canRun('clip.paste')).toBe(false);
    expect(ed.dispatch('clip.paste')).toBe(false);
  });

  it('inserts a clip with a deterministic id and advances the counter', () => {
    const ed = editorWith([clip('clip_1', 0, 10)]);
    ed.setClipboard({ assetId: 'asset_1', inFrame: 0, outFrame: 10 });
    ed.setPlayhead(9);
    expect(ed.dispatch('clip.paste')).toBe(true);
    const clips = videoTrack(ed.project).clips;
    expect(clips.map((c) => c.id)).toEqual(['clip_1', 'clip_10']);
    expect(ed.project.nextId).toBe(11);
  });

  it('adds exactly the pasted length to the timeline', () => {
    const ed = editorWith([clip('clip_1', 0, 10)]);
    ed.setClipboard({ assetId: 'asset_1', inFrame: 4, outFrame: 24 });
    ed.setPlayhead(9);
    ed.dispatch('clip.paste');
    expect(timelineDuration(ed.project)).toBe(30);
    const pasted = videoTrack(ed.project).clips[1];
    expect(clipLength(pasted)).toBe(20);
    expect(pasted.inFrame).toBe(4);
  });

  it('keeps clips in start order and never overlapping', () => {
    const ed = editorWith([clip('clip_1', 0, 10), clip('clip_2', 10, 10)]);
    ed.setClipboard({ assetId: 'asset_1', inFrame: 0, outFrame: 30 });
    ed.setPlayhead(10);
    ed.dispatch('clip.paste');
    const clips = videoTrack(ed.project).clips;
    let cursor = 0;
    for (const c of clips) {
      expect(c.startFrame).toBeGreaterThanOrEqual(cursor);
      cursor = c.startFrame + clipLength(c);
    }
    expect(clips.map((c) => c.startFrame)).toEqual([0, 10, 40]);
  });

  it('undoes back to exactly the document it started from', () => {
    const before = build([clip('clip_1', 0, 10), clip('clip_2', 10, 10)]);
    const ed = createEditor(before);
    ed.setClipboard({ assetId: 'asset_1', inFrame: 0, outFrame: 30 });
    ed.setPlayhead(10);
    ed.dispatch('clip.paste');
    ed.undo();
    expect(ed.project).toEqual(before);
  });

  it('selects what it just made, so the new clip is not a guess', () => {
    // A paste can push several clips sideways. Without this, nothing on screen
    // says which of the clips that moved is the one you just added.
    const ed = editorWith([clip('clip_1', 0, 10)]);
    ed.setClipboard({ assetId: 'asset_1', inFrame: 0, outFrame: 10 });
    ed.setPlayhead(9);
    ed.dispatch('clip.paste');
    expect(ed.selectedClipId).toBe('clip_10');
  });

  it('refuses once the copied source is gone — or quietly replaced', () => {
    // The clipboard deliberately survives undo, so it can outlive the asset it
    // points at. If a later import were handed the same id, a paste would
    // insert frames measured against a completely different video and nothing
    // would look wrong. Both halves of that are checked here.
    const ed = createEditor(createProject());
    const first = ed.importAsset(
      { kind: 'video', name: 'a.mp4', meta: { durationSec: 10 } },
      300,
    );
    ed.setClipboard(copyEntry(ed.project, first.clipId));
    expect(ed.canRun('clip.paste')).toBe(true);

    ed.undo(); // the import is gone; the clipboard is not
    expect(ed.canRun('clip.paste')).toBe(false);

    const second = ed.importAsset(
      { kind: 'video', name: 'b.mp4', meta: { durationSec: 1 } },
      30,
    );
    expect(second.assetId).not.toBe(first.assetId);
    expect(ed.canRun('clip.paste')).toBe(false);
  });

  it('refuses a range the source cannot cover', () => {
    // 10s at 30fps is 300 frames; frame 400 was never in the file.
    const ed = createEditor(createProject());
    ed.importAsset(
      { kind: 'video', name: 'a.mp4', meta: { durationSec: 10 } },
      300,
    );
    ed.setClipboard({ assetId: 'asset_1', inFrame: 350, outFrame: 400 });
    expect(ed.canRun('clip.paste')).toBe(false);
  });

  it('pastes onto an empty timeline', () => {
    const ed = editorWith([]);
    ed.setClipboard({ assetId: 'asset_1', inFrame: 0, outFrame: 12 });
    expect(ed.dispatch('clip.paste')).toBe(true);
    expect(timelineDuration(ed.project)).toBe(12);
  });
});
