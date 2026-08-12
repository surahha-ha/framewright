import { describe, it, expect } from 'vitest';
import { createEditor, type Editor } from './command';
import { NUDGE_COMMANDS } from './commands';
import { createProject } from './project';
import { clipLength, videoTrack } from './timeline';
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
        meta: { durationSec: 10 },
      },
    ],
    tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips } : t)),
  };
}

/** A 100-frame clip taken from the middle of a 300-frame source. */
const main: Clip = {
  id: 'clip_1',
  assetId: 'asset_1',
  startFrame: 20,
  inFrame: 50,
  outFrame: 150,
};

function editorWith(clips: Clip[], selected: string | null = 'clip_1'): Editor {
  const ed = createEditor(build(clips));
  ed.select(selected);
  return ed;
}

const clipOf = (ed: Editor) => videoTrack(ed.project).clips[0];
const reasonFor = (ed: Editor, id: string) =>
  NUDGE_COMMANDS.find((c) => c.id === id)!.disabledReason!(ed.context());

describe('nudge commands', () => {
  it('moves the SELECTED clip, not the one under the playhead', () => {
    // The keyboard path has no pointer, so selection is the only thing that can
    // say which clip an edit is about.
    const other: Clip = { ...main, id: 'clip_2', startFrame: 200 };
    const ed = editorWith([main, other], 'clip_2');
    ed.setPlayhead(25);
    expect(ed.dispatch('clip.moveRight')).toBe(true);
    expect(videoTrack(ed.project).clips[0].startFrame).toBe(20);
    expect(videoTrack(ed.project).clips[1].startFrame).toBe(201);
  });

  it('moves by exactly one frame and never changes the clip length', () => {
    const ed = editorWith([main]);
    const before = clipLength(clipOf(ed));
    ed.dispatch('clip.moveLeft');
    expect(clipOf(ed).startFrame).toBe(19);
    expect(clipLength(clipOf(ed))).toBe(before);
  });

  it('trims the head without moving the rest of the clip', () => {
    const ed = editorWith([main]);
    expect(ed.dispatch('clip.headShrink')).toBe(true);
    const c = clipOf(ed);
    expect(c.startFrame).toBe(21);
    expect(c.inFrame).toBe(51);
    expect(c.outFrame).toBe(150); // the tail stayed exactly where it was
  });

  it('trims the tail without moving the head', () => {
    const ed = editorWith([main]);
    expect(ed.dispatch('clip.tailShrink')).toBe(true);
    const c = clipOf(ed);
    expect(c.startFrame).toBe(20);
    expect(clipLength(c)).toBe(99);
  });

  it('refuses to invent media the source does not have', () => {
    // outFrame 150 of a 300-frame source has room; a clip already at the end has
    // none, and the refusal has to say which wall it hit.
    const atEnd: Clip = { ...main, inFrame: 0, outFrame: 300 };
    const ed = editorWith([atEnd]);
    expect(ed.dispatch('clip.tailExtend')).toBe(false);
    expect(reasonFor(ed, 'clip.tailExtend')).toBe('원본 영상이 여기까지예요.');
  });

  it('stops at the neighbour and says so', () => {
    const right: Clip = { ...main, id: 'clip_2', startFrame: 120 };
    const ed = editorWith([main, right]);
    expect(ed.dispatch('clip.moveRight')).toBe(false);
    expect(reasonFor(ed, 'clip.moveRight')).toBe('옆 클립에 닿았어요.');
  });

  it('reports itself unavailable at a wall, not merely refuses', () => {
    // `canRun` is what the toolbar greys out and what the palette lists as
    // runnable. If it says yes where `run` will throw, the palette offers a row
    // that closes and does nothing — indistinguishable from a broken app.
    const right: Clip = { ...main, id: 'clip_2', startFrame: 120 };
    const ed = editorWith([main, right]);
    expect(ed.canRun('clip.moveRight')).toBe(false);
    expect(ed.canRun('clip.moveLeft')).toBe(true);

    const atZero = editorWith([{ ...main, startFrame: 0 }]);
    expect(atZero.canRun('clip.moveLeft')).toBe(false);

    const wholeSource = editorWith([{ ...main, inFrame: 0, outFrame: 300 }]);
    expect(wholeSource.canRun('clip.tailExtend')).toBe(false);
    expect(wholeSource.canRun('clip.tailShrink')).toBe(true);
  });

  it('canRun and run never disagree, at any position', () => {
    // The property the bug above violated, checked directly: if `canRun` says
    // yes the dispatch must land, and if it says no it must not.
    for (const id of NUDGE_COMMANDS.map((c) => c.id)) {
      for (const start of [0, 1, 20]) {
        for (const [inF, outF] of [
          [0, 300],
          [50, 150],
          [299, 300],
        ]) {
          const ed = editorWith([
            { ...main, startFrame: start, inFrame: inF, outFrame: outF },
          ]);
          const expected = ed.canRun(id);
          expect({ id, start, inF, outF, ran: ed.dispatch(id) }).toEqual({
            id,
            start,
            inF,
            outF,
            ran: expected,
          });
        }
      }
    }
  });

  it('stops at the start of the timeline and says so', () => {
    const ed = editorWith([{ ...main, startFrame: 0 }]);
    expect(ed.dispatch('clip.moveLeft')).toBe(false);
    expect(reasonFor(ed, 'clip.moveLeft')).toBe(
      '맨 앞이에요. 더 앞으로는 갈 수 없어요.',
    );
  });

  it('asks for a clip when nothing is selected', () => {
    const ed = editorWith([main], null);
    expect(ed.canRun('clip.moveRight')).toBe(false);
    expect(reasonFor(ed, 'clip.moveRight')).toBe(
      '옮길 클립을 먼저 골라 주세요.',
    );
  });

  it('folds a held key into ONE undo step', () => {
    // Same promise as a drag: one gesture, one entry. Ten repeats then one undo
    // must land back where the clip started, not nine frames along.
    const ed = editorWith([main]);
    for (let i = 0; i < 10; i++) {
      expect(ed.dispatch('clip.moveRight', undefined, 'hold')).toBe(true);
    }
    expect(clipOf(ed).startFrame).toBe(30);
    ed.undo();
    expect(clipOf(ed).startFrame).toBe(20);
    expect(ed.canUndo()).toBe(false);
  });

  it('starts a new undo step after the key is released', () => {
    const ed = editorWith([main]);
    ed.dispatch('clip.moveRight', undefined, 'hold');
    ed.endCoalesce();
    ed.dispatch('clip.moveRight', undefined, 'hold');
    expect(clipOf(ed).startFrame).toBe(22);
    ed.undo();
    expect(clipOf(ed).startFrame).toBe(21);
  });

  it('every nudge is marked repeatable — coalescing is only sound for those', () => {
    expect(NUDGE_COMMANDS.every((c) => c.repeatable)).toBe(true);
  });
});
