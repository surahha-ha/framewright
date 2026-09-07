// framewright — the subtitle commands, through the dispatcher: every one of
// them is an undo step, none of them can put two subtitles on one frame, and
// the selection follows what the user just did.
import { describe, expect, it } from 'vitest';
import { createEditor, type Editor } from './command';
import { createProject } from './project';
import type { Clip, Project, Subtitle } from './types';
import { BUILTIN_COMMANDS } from './commands';

function seed(videoFrames = 300, subtitles: Subtitle[] = []): Project {
  const p = createProject();
  const clip: Clip = {
    id: 'clip_1',
    assetId: 'asset_1',
    startFrame: 0,
    inFrame: 0,
    outFrame: videoFrames,
  };
  return {
    ...p,
    nextId: 2,
    tracks: p.tracks.map((t) =>
      t.type === 'video' ? { ...t, clips: videoFrames ? [clip] : [] } : t,
    ),
    subtitles,
  };
}

const sub = (id: string, startFrame: number, endFrame: number): Subtitle => ({
  id,
  text: id,
  startFrame,
  endFrame,
});

function byId(id: string) {
  const cmd = BUILTIN_COMMANDS.find((c) => c.id === id);
  if (!cmd) throw new Error(`no such command: ${id}`);
  return cmd;
}

function editorWith(project: Project): Editor {
  return createEditor(project);
}

describe('subtitle.add', () => {
  it('needs footage under the playhead, and says what it is waiting for', () => {
    const empty = editorWith(seed(0));
    expect(empty.canRun('subtitle.add')).toBe(false);
    expect(byId('subtitle.add').disabledReason!(empty.context())).toContain(
      '영상을 불러오세요',
    );

    const ed = editorWith(seed(300, [sub('sub_1', 10, 50)]));
    ed.setPlayhead(20);
    expect(ed.canRun('subtitle.add')).toBe(false);
    expect(byId('subtitle.add').disabledReason!(ed.context())).toContain(
      '이미 자막이 있어요',
    );
    ed.setPlayhead(60);
    expect(ed.canRun('subtitle.add')).toBe(true);
  });

  it('puts an EMPTY subtitle at the playhead, selects it, and is one undo step', () => {
    const ed = editorWith(seed());
    ed.setPlayhead(30);
    ed.select('clip_1');
    expect(ed.dispatch('subtitle.add')).toBe(true);
    expect(ed.project.subtitles).toEqual([
      { id: 'sub_2', text: '', startFrame: 30, endFrame: 90 },
    ]);
    expect(ed.project.nextId).toBe(3);
    // The new subtitle is what the user works on next — and the clip selection
    // goes, because only one thing is selected at a time.
    expect(ed.selectedSubtitleId).toBe('sub_2');
    expect(ed.selectedClipId).toBeNull();

    expect(ed.undo()).toBe(true);
    expect(ed.project.subtitles).toEqual([]);
    expect(ed.selectedSubtitleId).toBeNull();
    expect(ed.redo()).toBe(true);
    expect(ed.project.subtitles).toHaveLength(1);
  });

  it('keeps the list sorted when adding between two others', () => {
    const ed = editorWith(seed(300, [sub('a', 0, 10), sub('c', 200, 210)]));
    ed.setPlayhead(100);
    ed.dispatch('subtitle.add');
    expect(ed.project.subtitles.map((s) => s.id)).toEqual(['a', 'sub_2', 'c']);
  });

  it('announces where it went', () => {
    const ed = editorWith(seed());
    ed.setPlayhead(30);
    const before = ed.context();
    ed.dispatch('subtitle.add');
    const done = byId('subtitle.add').done;
    expect(typeof done === 'function' ? done(before, ed.context()) : done).toBe(
      // Frame 30 at 30fps is one second, and the readout is mm:ss:ff.
      '00:01:00 위치에 자막을 넣었어요 · 내용을 적어 주세요.',
    );
  });
});

describe('subtitle.setText', () => {
  it('stores the normalised text and refuses a no-op', () => {
    const ed = editorWith(seed(300, [sub('sub_1', 10, 50)]));
    expect(
      ed.dispatch('subtitle.setText', {
        subtitleId: 'sub_1',
        text: '  안녕하세요 \n\n둘째 줄 ',
      }),
    ).toBe(true);
    expect(ed.project.subtitles[0].text).toBe('안녕하세요\n둘째 줄');
    // Same words again: not an edit, not an undo entry.
    expect(
      ed.dispatch('subtitle.setText', {
        subtitleId: 'sub_1',
        text: '안녕하세요\n둘째 줄',
      }),
    ).toBe(false);
    expect(ed.undo()).toBe(true);
    expect(ed.project.subtitles[0].text).toBe('sub_1');
    expect(ed.undo()).toBe(false);
  });

  it('is refused for a subtitle that does not exist', () => {
    const ed = editorWith(seed());
    expect(
      ed.dispatch('subtitle.setText', { subtitleId: 'x', text: 'a' }),
    ).toBe(false);
  });
});

describe('subtitle.remove', () => {
  it('removes the SELECTED subtitle, leaves the picture alone, and undoes in place', () => {
    const ed = editorWith(seed(300, [sub('a', 0, 10), sub('b', 50, 100)]));
    expect(ed.canRun('subtitle.remove')).toBe(false);
    expect(byId('subtitle.remove').disabledReason!(ed.context())).toContain(
      '자막을 먼저 골라',
    );
    ed.selectSubtitle('b');
    expect(ed.dispatch('subtitle.remove')).toBe(true);
    expect(ed.project.subtitles.map((s) => s.id)).toEqual(['a']);
    expect(ed.selectedSubtitleId).toBeNull();
    // Unlike deleting a clip, nothing ripples: the video is untouched.
    expect(ed.project.tracks[0].clips[0].outFrame).toBe(300);
    ed.undo();
    expect(ed.project.subtitles.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('subtitle.move / trimStart / trimEnd', () => {
  it('moves without changing length, clamped to the neighbours', () => {
    const ed = editorWith(seed(300, [sub('a', 0, 10), sub('b', 50, 100)]));
    expect(
      ed.dispatch('subtitle.move', { subtitleId: 'b', startFrame: 5 }),
    ).toBe(true);
    expect(ed.project.subtitles[1]).toMatchObject({
      startFrame: 10,
      endFrame: 60,
    });
    expect(
      ed.dispatch('subtitle.move', { subtitleId: 'b', startFrame: 900 }),
    ).toBe(true);
    expect(ed.project.subtitles[1]).toMatchObject({
      startFrame: 250,
      endFrame: 300,
    });
  });

  it('refuses a move that lands where it already is', () => {
    const ed = editorWith(seed(300, [sub('b', 50, 100)]));
    expect(
      ed.dispatch('subtitle.move', { subtitleId: 'b', startFrame: 50 }),
    ).toBe(false);
    expect(ed.canUndo()).toBe(false);
  });

  it('trims each edge within its limits, keeping at least one frame', () => {
    const ed = editorWith(seed(300, [sub('b', 50, 100)]));
    expect(
      ed.dispatch('subtitle.trimStart', { subtitleId: 'b', frame: 99 }),
    ).toBe(true);
    expect(ed.project.subtitles[0].startFrame).toBe(99);
    expect(
      ed.dispatch('subtitle.trimStart', { subtitleId: 'b', frame: 150 }),
    ).toBe(false); // already at the last legal frame
    expect(
      ed.dispatch('subtitle.trimEnd', { subtitleId: 'b', frame: 1000 }),
    ).toBe(true);
    expect(ed.project.subtitles[0].endFrame).toBe(300);
    ed.undo();
    ed.undo();
    expect(ed.project.subtitles[0]).toMatchObject({
      startFrame: 50,
      endFrame: 100,
    });
  });
});

describe('subtitle.startToPlayhead / endToPlayhead', () => {
  it('moves the edge of the selected subtitle to the playhead', () => {
    const ed = editorWith(seed(300, [sub('a', 0, 10), sub('b', 50, 100)]));
    ed.selectSubtitle('b');
    ed.setPlayhead(30);
    expect(ed.canRun('subtitle.startToPlayhead')).toBe(true);
    expect(ed.dispatch('subtitle.startToPlayhead')).toBe(true);
    expect(ed.project.subtitles[1].startFrame).toBe(30);

    // "끝을 재생 위치로" keeps the subtitle ON the playhead's frame: the last
    // frame it shows is the one the user is looking at.
    ed.setPlayhead(120);
    expect(ed.dispatch('subtitle.endToPlayhead')).toBe(true);
    expect(ed.project.subtitles[1].endFrame).toBe(121);
  });

  it('refuses where the edge cannot go, and says why', () => {
    const ed = editorWith(seed(300, [sub('a', 0, 10), sub('b', 50, 100)]));
    expect(ed.canRun('subtitle.startToPlayhead')).toBe(false);
    expect(
      byId('subtitle.startToPlayhead').disabledReason!(ed.context()),
    ).toContain('자막을 먼저 골라');
    ed.selectSubtitle('b');
    ed.setPlayhead(5); // inside a
    expect(ed.canRun('subtitle.startToPlayhead')).toBe(false);
    expect(
      byId('subtitle.startToPlayhead').disabledReason!(ed.context()),
    ).toContain('옆 자막');
    ed.setPlayhead(99); // the last frame: start may go to 99, end to 100 = no-op
    expect(ed.canRun('subtitle.endToPlayhead')).toBe(false);
    ed.setPlayhead(100);
    expect(ed.canRun('subtitle.startToPlayhead')).toBe(false); // past its end
  });
});

describe('subtitle.moveToPlayhead — the keyboard drag', () => {
  it('slides the whole subtitle to start at the playhead, length kept', () => {
    const ed = editorWith(seed(300, [sub('a', 0, 10), sub('b', 50, 100)]));
    ed.selectSubtitle('b');
    ed.setPlayhead(20);
    expect(ed.dispatch('subtitle.moveToPlayhead')).toBe(true);
    expect(ed.project.subtitles[1]).toMatchObject({
      startFrame: 20,
      endFrame: 70,
    });
  });

  it('is the one route that shifts a block whose edges are both pinned', () => {
    // A ends where B starts and B ends at the picture's end: neither edge of
    // B can be trimmed outward, but B as a whole can still move left.
    const ed = editorWith(seed(100, [sub('a', 0, 40), sub('b', 60, 100)]));
    ed.selectSubtitle('a');
    ed.setPlayhead(0);
    expect(ed.canRun('subtitle.moveToPlayhead')).toBe(false); // already there
    ed.selectSubtitle('b');
    ed.setPlayhead(45);
    expect(ed.dispatch('subtitle.moveToPlayhead')).toBe(true);
    expect(ed.project.subtitles[1]).toMatchObject({
      startFrame: 45,
      endFrame: 85,
    });
  });

  it('refuses with a reason when the block would not fit', () => {
    const ed = editorWith(seed(100, [sub('a', 0, 40), sub('b', 60, 100)]));
    ed.selectSubtitle('b');
    ed.setPlayhead(10); // would overlap a
    expect(ed.canRun('subtitle.moveToPlayhead')).toBe(true); // clamps to 40
    ed.dispatch('subtitle.moveToPlayhead');
    expect(ed.project.subtitles[1].startFrame).toBe(40);
    ed.setPlayhead(5);
    expect(ed.canRun('subtitle.moveToPlayhead')).toBe(false);
    expect(
      byId('subtitle.moveToPlayhead').disabledReason!(ed.context()),
    ).toContain('옆 자막');
  });
});

describe('the footage moves, the words move with it', () => {
  /** Three 100-frame clips of one source, subtitles over the 2nd and 3rd. */
  function threeClips(): Project {
    const p = createProject();
    const clip = (id: string, i: number): Clip => ({
      id,
      assetId: 'asset_1',
      startFrame: i * 100,
      inFrame: i * 100,
      outFrame: (i + 1) * 100,
    });
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
      tracks: p.tracks.map((t) =>
        t.type === 'video'
          ? {
              ...t,
              clips: [clip('clip_1', 0), clip('clip_2', 1), clip('clip_3', 2)],
            }
          : t,
      ),
      subtitles: [sub('over2', 120, 150), sub('over3', 210, 240)],
    };
  }

  it('ripple delete pulls later subtitles left and drops the ones over the cut', () => {
    const ed = editorWith(threeClips());
    ed.select('clip_2');
    expect(ed.dispatch('clip.deleteRipple')).toBe(true);
    // over2 captioned the deleted clip: gone. over3 slid left with clip_3.
    expect(ed.project.subtitles).toEqual([sub('over3', 110, 140)]);
    ed.undo();
    expect(ed.project.subtitles).toEqual([
      sub('over2', 120, 150),
      sub('over3', 210, 240),
    ]);
    ed.redo();
    expect(ed.project.subtitles).toEqual([sub('over3', 110, 140)]);
  });

  it('a paste that pushes footage right pushes its subtitles too', () => {
    const ed = editorWith(threeClips());
    ed.setClipboard({ assetId: 'asset_1', inFrame: 0, outFrame: 50 });
    ed.setPlayhead(200); // clip_3's first frame: no gap, so clip_3 is pushed
    expect(ed.dispatch('clip.paste')).toBe(true);
    expect(ed.project.subtitles).toEqual([
      sub('over2', 120, 150),
      sub('over3', 260, 290),
    ]);
    ed.undo();
    expect(ed.project.subtitles[1]).toEqual(sub('over3', 210, 240));
  });

  it('a paste INTO a subtitle splits it: the words stay with both halves of the footage', () => {
    const ed = editorWith({
      ...threeClips(),
      subtitles: [sub('straddle', 180, 230)], // across clip_2 | clip_3 at 200
    });
    ed.setClipboard({ assetId: 'asset_1', inFrame: 0, outFrame: 50 });
    ed.setPlayhead(200);
    expect(ed.dispatch('clip.paste')).toBe(true);
    // The head keeps its id and ends at the paste point; the tail is new,
    // and sits on the footage that moved right by 50.
    expect(ed.project.subtitles).toEqual([
      sub('straddle', 180, 200),
      { id: 'sub_11', text: 'straddle', startFrame: 250, endFrame: 280 },
    ]);
    // The pasted clip took `clip_10`, the tail `sub_11`: the counter moved
    // past both, so nothing later can collide with either.
    expect(ed.project.nextId).toBe(12);
    expect(ed.selectedClipId).toBe('clip_10');
    // Nothing of the words is on the pasted footage.
    for (let f = 200; f < 250; f++) {
      expect(
        ed.project.subtitles.some((s) => f >= s.startFrame && f < s.endFrame),
      ).toBe(false);
    }
    ed.undo();
    expect(ed.project.subtitles).toEqual([sub('straddle', 180, 230)]);
    ed.redo();
    expect(ed.project.subtitles).toHaveLength(2);
  });

  it('closing gaps pulls the subtitles over the later clips along', () => {
    const ed = editorWith(threeClips());
    ed.dispatch('clip.move', { clipId: 'clip_3', startFrame: 260 });
    // A subtitle over clip_3's footage, placed after the move at 270.
    ed.setPlayhead(270);
    ed.dispatch('subtitle.add');
    const added = ed.project.subtitles.find((s) => s.startFrame === 270)!;
    expect(ed.dispatch('timeline.closeGaps')).toBe(true);
    expect(ed.project.subtitles.find((s) => s.id === added.id)).toMatchObject({
      startFrame: 210,
      endFrame: added.endFrame - 60,
    });
    ed.undo();
    expect(ed.project.subtitles.find((s) => s.id === added.id)).toEqual(added);
  });
});

describe('selection', () => {
  it('is one thing at a time, and is dropped when its subtitle goes', () => {
    const ed = editorWith(seed(300, [sub('b', 50, 100)]));
    ed.selectSubtitle('b');
    expect(ed.selectedSubtitleId).toBe('b');
    ed.select('clip_1');
    expect(ed.selectedSubtitleId).toBeNull();
    expect(ed.selectedClipId).toBe('clip_1');
    ed.selectSubtitle('b');
    expect(ed.selectedClipId).toBeNull();
    ed.restoreProject(seed());
    expect(ed.selectedSubtitleId).toBeNull();
  });
});
