// framewright — the image commands, through the dispatcher (ADR-0020).
//
// The same three promises the subtitle commands make, for the other thing that
// sits on the footage: every command is ONE undo step, no two images ever land
// on one frame, and every refusal says what it is waiting for. Plus the one
// promise only an image makes — its import is a registry command, so the asset
// and the picture on the timeline arrive and leave together.
//
// The last block is the ripple: an image follows the footage exactly as the
// words do, through all four commands that move footage under it.
import { describe, expect, it } from 'vitest';
import { createEditor, type Editor } from './command';
import { createProject } from './project';
import { BUILTIN_COMMANDS, type Command } from './commands';
import { imageTimingReason } from './imageCommands';
import type { Clip, Project, StageImage } from './types';

/** A 300-frame video and one 400×200 picture already imported. */
function seed(videoFrames = 300, images: StageImage[] = []): Project {
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
    nextId: 3,
    assets: [
      {
        id: 'asset_1',
        kind: 'video',
        name: 'a.mp4',
        meta: { durationSec: 10 },
      },
      {
        id: 'asset_2',
        kind: 'image',
        name: 'logo.png',
        meta: { width: 400, height: 200 },
      },
    ],
    tracks: p.tracks.map((t) =>
      t.type === 'video' ? { ...t, clips: videoFrames ? [clip] : [] } : t,
    ),
    images,
  };
}

const img = (
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

function byId(id: string): Command<any> {
  const cmd = BUILTIN_COMMANDS.find((c) => c.id === id);
  if (!cmd) throw new Error(`no such command: ${id}`);
  return cmd;
}

function editorWith(project: Project): Editor {
  return createEditor(project);
}

/** The sentence a command says after it ran, as the UI would read it. */
function doneText(id: string, ed: Editor, args?: unknown): string {
  const d = byId(id).done;
  return typeof d === 'function'
    ? d(ed.context(), ed.context(), args)
    : (d ?? '');
}

describe('the eight image commands are in the registry', () => {
  it('registers every one of them exactly once', () => {
    const ids = BUILTIN_COMMANDS.map((c) => c.id).filter((id) =>
      id.startsWith('image.'),
    );
    expect(ids.slice().sort()).toEqual([
      'image.add',
      'image.endToPlayhead',
      'image.import',
      'image.moveToPlayhead',
      'image.remove',
      'image.setPosition',
      'image.setSize',
      'image.startToPlayhead',
    ]);
  });
});

describe('image.import', () => {
  const file = { name: 'logo.png', opfsKey: 'k1', width: 400, height: 200 };

  it('needs footage under the playhead, and says what it is waiting for', () => {
    const empty = editorWith(seed(0));
    expect(empty.canRun('image.import', file)).toBe(false);
    expect(byId('image.import').disabledReason!(empty.context())).toBe(
      '먼저 영상을 불러오세요.',
    );

    const taken = editorWith(seed(300, [img('img_1', 10, 50)]));
    taken.setPlayhead(20);
    expect(taken.canRun('image.import', file)).toBe(false);
    expect(byId('image.import').disabledReason!(taken.context())).toContain(
      '이미 이미지가 있어요',
    );

    taken.setPlayhead(60);
    expect(taken.canRun('image.import', file)).toBe(true);
  });

  it('adds the asset AND the picture in one undo step, and says where', () => {
    const ed = editorWith(seed());
    ed.setPlayhead(30);
    expect(ed.dispatch('image.import', file)).toBe(true);

    expect(ed.project.assets).toHaveLength(3);
    expect(ed.project.assets[2]).toEqual({
      id: 'asset_3',
      kind: 'image',
      name: 'logo.png',
      opfsKey: 'k1',
      meta: { width: 400, height: 200 },
    });
    // Two seconds at 30fps, at the playhead; the centre and the default size
    // are ABSENCE, so a fresh image carries only its timing.
    expect(ed.project.images).toEqual([
      { id: 'img_4', assetId: 'asset_3', startFrame: 30, endFrame: 90 },
    ]);
    expect(ed.project.nextId).toBe(5);
    expect(doneText('image.import', ed, file)).toBe(
      '00:01:00 위치에 이미지를 넣었어요.',
    );

    // ONE Ctrl+Z takes back both halves.
    expect(ed.undo()).toBe(true);
    expect(ed.project.images).toEqual([]);
    expect(ed.project.assets).toHaveLength(2);
    // ...and the counter does NOT rewind: `asset_3` must never be handed out
    // twice in one session (the `importAsset` rule).
    expect(ed.project.nextId).toBe(5);

    ed.redo();
    expect(ed.project.images).toHaveLength(1);
    expect(ed.project.assets).toHaveLength(3);
  });

  it('is cut short by the end of the video and by the next image', () => {
    const ed = editorWith(seed(300));
    ed.setPlayhead(280);
    ed.dispatch('image.import', file);
    expect(ed.project.images[0]).toMatchObject({
      startFrame: 280,
      endFrame: 300,
    });

    const crowded = editorWith(seed(300, [img('img_1', 100, 150)]));
    crowded.setPlayhead(80);
    crowded.dispatch('image.import', file);
    expect(crowded.project.images[0]).toMatchObject({
      startFrame: 80,
      endFrame: 100,
    });
  });
});

describe('image.add', () => {
  it('places an already-imported picture again, and rewinds its own id', () => {
    const ed = editorWith(seed());
    ed.setPlayhead(100);
    expect(ed.dispatch('image.add', { assetId: 'asset_2' })).toBe(true);
    expect(ed.project.images).toEqual([
      { id: 'img_3', assetId: 'asset_2', startFrame: 100, endFrame: 160 },
    ]);
    expect(ed.project.assets).toHaveLength(2); // nothing imported
    expect(ed.project.nextId).toBe(4);

    // No asset was made, so unlike the import this one DOES give its id back.
    ed.undo();
    expect(ed.project.images).toEqual([]);
    expect(ed.project.nextId).toBe(3);
  });

  it('refuses an asset this document does not have', () => {
    const ed = editorWith(seed());
    ed.setPlayhead(100);
    expect(ed.canRun('image.add', { assetId: 'asset_9' })).toBe(false);
    expect(ed.dispatch('image.add', { assetId: 'asset_9' })).toBe(false);
  });

  it('refuses a frame that already holds an image, with a way out', () => {
    const ed = editorWith(seed(300, [img('img_1', 90, 140)]));
    ed.setPlayhead(120);
    expect(ed.canRun('image.add', { assetId: 'asset_2' })).toBe(false);
    expect(byId('image.add').disabledReason!(ed.context())).toBe(
      '이 자리에는 이미 이미지가 있어요. 그 이미지를 지우거나, 재생 위치를 옮겨 주세요.',
    );
  });
});

describe('image.remove', () => {
  it('puts the picture back exactly, fields and all', () => {
    const before = img('img_1', 40, 100, { posX: 0.2, size: 0.4 });
    const ed = editorWith(seed(300, [before]));
    expect(ed.dispatch('image.remove', { imageId: 'img_1' })).toBe(true);
    expect(ed.project.images).toEqual([]);
    ed.undo();
    expect(ed.project.images).toEqual([before]);
  });

  it('refuses an image that is not there, and says what to do first', () => {
    const ed = editorWith(seed());
    expect(ed.canRun('image.remove', { imageId: 'img_9' })).toBe(false);
    expect(byId('image.remove').disabledReason!(ed.context())).toBe(
      '지울 이미지를 먼저 골라 주세요.',
    );
  });
});

describe('image.setPosition', () => {
  it('stores whole percents, and the centre as an absent field', () => {
    const ed = editorWith(seed(300, [img('img_1', 0, 60)]));
    expect(
      ed.dispatch(
        'image.setPosition',
        { imageId: 'img_1', posX: 0.3237, posY: 0.7 },
        'imgpos:img_1',
      ),
    ).toBe(true);
    expect(ed.project.images[0]).toEqual({
      id: 'img_1',
      assetId: 'asset_2',
      startFrame: 0,
      endFrame: 60,
      posX: 0.32,
      posY: 0.7,
    });

    // Back to the middle: BOTH fields go away, so the document that means
    // "the centre" has exactly one spelling.
    ed.dispatch(
      'image.setPosition',
      { imageId: 'img_1', posX: 0.5, posY: 0.5 },
      'imgpos:img_1',
    );
    expect(ed.project.images[0]).toEqual({
      id: 'img_1',
      assetId: 'asset_2',
      startFrame: 0,
      endFrame: 60,
    });
  });

  it('refuses a move to where the picture already is', () => {
    const ed = editorWith(seed(300, [img('img_1', 0, 60, { posX: 0.32 })]));
    // 0.3237 rounds to the 0.32 it already has; the missing posY already
    // means the centre. Neither is a move, so neither costs a Ctrl+Z.
    expect(
      ed.canRun('image.setPosition', {
        imageId: 'img_1',
        posX: 0.3237,
        posY: 0.5,
      }),
    ).toBe(false);
    expect(
      ed.canRun('image.setPosition', { imageId: 'img_9', posX: 0.1 }),
    ).toBe(false);
    expect(
      ed.canRun('image.setPosition', { imageId: 'img_1', posX: Number.NaN }),
    ).toBe(false);
  });

  it('says where it went, and names the centre when it lands there', () => {
    const ed = editorWith(seed(300, [img('img_1', 0, 60)]));
    expect(
      doneText('image.setPosition', ed, {
        imageId: 'img_1',
        posX: 0.32,
        posY: 0.7,
      }),
    ).toBe('이미지를 옮겼어요 · 왼쪽에서 32% · 위에서 70%.');
    expect(
      doneText('image.setPosition', ed, {
        imageId: 'img_1',
        posX: 0.5,
        posY: 0.5,
      }),
    ).toBe('이미지를 가운데로 옮겼어요.');
  });

  it('is exactly undone', () => {
    const before = img('img_1', 0, 60, { posY: 0.9 });
    const ed = editorWith(seed(300, [before]));
    ed.dispatch('image.setPosition', {
      imageId: 'img_1',
      posX: 0.1,
      posY: 0.2,
    });
    ed.undo();
    expect(ed.project.images).toEqual([before]);
  });

  // PIN, not a fix: a single-axis call silently drops the OTHER axis to the
  // centre (`normalizeImagePosition` returns `undefined` for the omitted
  // axis, `dropUndefined` in `applyOp` deletes that key). Deliberate — it is
  // `subtitle.setPosition`'s own semantics carried over — so a caller MUST
  // pass both axes on every dispatch. The image panel's two sliders (E10
  // step 5, not built yet) are exactly where a naive "one slider, one axis,
  // one dispatch" wiring will trip this and silently re-centre the other
  // axis. This test pins today's behaviour so that step trips on a RED test
  // instead of a live bug.
  it('setting only posX silently clears posY to centre — a real trap, not a bug', () => {
    const before = img('img_1', 0, 60, { posY: 0.9 });
    const ed = editorWith(seed(300, [before]));
    expect(
      ed.dispatch('image.setPosition', { imageId: 'img_1', posX: 0.4 }),
    ).toBe(true);

    const after = ed.project.images[0];
    // The moved axis landed; the untouched axis's KEY is gone, not merely
    // undefined — `dropUndefined` deletes it. `toMatchObject` would pass
    // whether the key survived or not, so only an exact-shape assertion
    // pins this.
    expect(after).toStrictEqual(img('img_1', 0, 60, { posX: 0.4 }));
    expect('posY' in after).toBe(false);
    expect('posX' in after).toBe(true);

    // A caller who trips this is one Ctrl+Z from safety: undo restores the
    // original posY exactly, and the posX this command wrote is gone again.
    ed.undo();
    const restored = ed.project.images[0];
    expect(restored).toStrictEqual(before);
    expect('posX' in restored).toBe(false);
    expect(restored.posY).toBe(0.9);
  });
});

describe('image.setSize', () => {
  it('holds the picture between the slider ends, at a whole percent', () => {
    const ed = editorWith(seed(300, [img('img_1', 0, 60)]));
    ed.dispatch('image.setSize', { imageId: 'img_1', size: 2 }, 'size:img_1');
    expect(ed.project.images[0].size).toBe(1);
    ed.dispatch(
      'image.setSize',
      { imageId: 'img_1', size: 0.001 },
      'size:img_1',
    );
    expect(ed.project.images[0].size).toBe(0.05);
    ed.dispatch(
      'image.setSize',
      { imageId: 'img_1', size: 0.4004 },
      'size:img_1',
    );
    expect(ed.project.images[0].size).toBe(0.4);
    expect(doneText('image.setSize', ed, { imageId: 'img_1', size: 0.4 })).toBe(
      '이미지 크기를 40%로 바꿨어요.',
    );
  });

  it('writes the default back as absence, and refuses the size it already draws', () => {
    const ed = editorWith(seed(300, [img('img_1', 0, 60, { size: 0.4 })]));
    expect(ed.dispatch('image.setSize', { imageId: 'img_1', size: 0.25 })).toBe(
      true,
    );
    expect('size' in ed.project.images[0]).toBe(false);
    // ...and now a quarter is what it already draws, so asking again is not
    // an edit.
    expect(ed.canRun('image.setSize', { imageId: 'img_1', size: 0.25 })).toBe(
      false,
    );
    expect(
      ed.canRun('image.setSize', { imageId: 'img_1', size: Number.NaN }),
    ).toBe(false);
    ed.undo();
    expect(ed.project.images[0].size).toBe(0.4);
  });
});

describe('the keyboard times an image', () => {
  it('slides the whole picture to the playhead, length unchanged', () => {
    const ed = editorWith(seed(300, [img('img_1', 30, 90)]));
    ed.setPlayhead(200);
    expect(ed.dispatch('image.moveToPlayhead', { imageId: 'img_1' })).toBe(
      true,
    );
    expect(ed.project.images[0]).toMatchObject({
      startFrame: 200,
      endFrame: 260,
    });
    expect(doneText('image.moveToPlayhead', ed, { imageId: 'img_1' })).toBe(
      '이미지 전체를 00:06:20 위치로 옮겼어요.',
    );
    ed.undo();
    expect(ed.project.images[0]).toMatchObject({
      startFrame: 30,
      endFrame: 90,
    });
  });

  it('keeps the picture ON the playhead frame when the end is set', () => {
    const ed = editorWith(seed(300, [img('img_1', 30, 90)]));
    ed.setPlayhead(120);
    expect(ed.dispatch('image.endToPlayhead', { imageId: 'img_1' })).toBe(true);
    // The last frame shown is the one being looked at, so the exclusive end
    // is one past it.
    expect(ed.project.images[0].endFrame).toBe(121);
    expect(doneText('image.endToPlayhead', ed, { imageId: 'img_1' })).toBe(
      '이미지 끝을 재생 위치로 맞췄어요 · 길이 00:03:01',
    );
  });

  it('pulls the start back to the playhead, and refuses to cross its own end', () => {
    const ed = editorWith(seed(300, [img('img_1', 30, 90)]));
    ed.setPlayhead(50);
    expect(ed.dispatch('image.startToPlayhead', { imageId: 'img_1' })).toBe(
      true,
    );
    expect(ed.project.images[0].startFrame).toBe(50);

    ed.setPlayhead(200);
    expect(ed.canRun('image.startToPlayhead', { imageId: 'img_1' })).toBe(
      false,
    );
    expect(imageTimingReason(ed.context(), 'img_1', 'start')).toBe(
      '재생 위치가 이미지 끝을 지났어요. 이미지 안으로 옮겨 주세요.',
    );
  });

  it('names the wall it ran into', () => {
    const ed = editorWith(
      seed(300, [img('img_1', 0, 60), img('img_2', 60, 90)]),
    );
    expect(imageTimingReason(ed.context(), null, 'move')).toBe(
      '옮길 이미지를 먼저 골라 주세요.',
    );

    // img_2 pressed with the playhead inside img_1: its neighbour is there.
    ed.setPlayhead(30);
    expect(ed.canRun('image.moveToPlayhead', { imageId: 'img_2' })).toBe(false);
    expect(imageTimingReason(ed.context(), 'img_2', 'move')).toBe(
      '옆 이미지와 겹쳐요. 재생 위치를 옆 이미지 뒤로 옮겨 주세요.',
    );
    expect(imageTimingReason(ed.context(), 'img_2', 'start')).toBe(
      '옆 이미지와 겹쳐요. 재생 위치를 옆 이미지 뒤로 옮겨 주세요.',
    );

    // img_1's end cannot pass img_2's start.
    ed.setPlayhead(200);
    expect(ed.canRun('image.endToPlayhead', { imageId: 'img_1' })).toBe(false);
    expect(imageTimingReason(ed.context(), 'img_1', 'end')).toBe(
      '옆 이미지와 겹쳐요. 재생 위치를 옆 이미지 앞으로 옮겨 주세요.',
    );

    // The one image there is, already where it is asked to go.
    const alone = editorWith(seed(300, [img('img_1', 0, 60)]));
    expect(alone.canRun('image.moveToPlayhead', { imageId: 'img_1' })).toBe(
      false,
    );
    expect(imageTimingReason(alone.context(), 'img_1', 'move')).toBe(
      '이미 재생 위치에서 시작해요.',
    );
    alone.setPlayhead(299);
    expect(imageTimingReason(alone.context(), 'img_1', 'move')).toBe(
      '영상 끝을 넘어가요. 재생 위치를 더 앞으로 옮겨 주세요.',
    );
  });
});

// ---------------------------------------------------------------------------
// The ripple: an image belongs to the frames it was put on.

/** Three 100-frame clips of one source, and a picture asset to hang on them. */
function threeClips(images: StageImage[] = []): Project {
  const p = createProject();
  const clip = (id: string, i: number): Clip => ({
    id,
    assetId: 'asset_1',
    startFrame: i * 100,
    inFrame: 0,
    outFrame: 100,
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
      {
        id: 'asset_2',
        kind: 'image',
        name: 'logo.png',
        meta: { width: 400, height: 200 },
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
    images,
  };
}

describe('the footage moves, the pictures move with it', () => {
  it('ripple delete drops the picture over the cut and pulls the later one left', () => {
    const ed = editorWith(
      threeClips([img('img_1', 120, 150), img('img_2', 210, 240)]),
    );
    ed.select('clip_2');
    expect(ed.dispatch('clip.deleteRipple')).toBe(true);
    expect(ed.project.images).toEqual([img('img_2', 110, 140)]);
    ed.undo();
    expect(ed.project.images).toEqual([
      img('img_1', 120, 150),
      img('img_2', 210, 240),
    ]);
    ed.redo();
    expect(ed.project.images).toEqual([img('img_2', 110, 140)]);
  });

  it('a paste that pushes footage right pushes its pictures too', () => {
    const ed = editorWith(
      threeClips([img('img_1', 120, 150), img('img_2', 210, 240)]),
    );
    ed.setClipboard({ assetId: 'asset_1', inFrame: 0, outFrame: 50 });
    ed.setPlayhead(200); // clip_3's first frame: no gap, so clip_3 is pushed
    expect(ed.dispatch('clip.paste')).toBe(true);
    expect(ed.project.images).toEqual([
      img('img_1', 120, 150),
      img('img_2', 260, 290),
    ]);
    ed.undo();
    expect(ed.project.images[1]).toEqual(img('img_2', 210, 240));
  });

  it('a paste INTO a picture splits it, and neither half covers the new footage', () => {
    const ed = editorWith(threeClips([img('img_1', 180, 230, { size: 0.4 })]));
    ed.setClipboard({ assetId: 'asset_1', inFrame: 0, outFrame: 50 });
    ed.setPlayhead(200);
    expect(ed.dispatch('clip.paste')).toBe(true);
    // The head keeps its id and ends at the paste point; the tail is new, is
    // the same picture at the same size, and rode the footage 50 frames right.
    expect(ed.project.images).toEqual([
      img('img_1', 180, 200, { size: 0.4 }),
      img('img_11', 250, 280, { size: 0.4 }),
    ]);
    // The pasted clip took `clip_10` and the tail `img_11`, so the counter is
    // past both and nothing later can collide with either.
    expect(ed.project.nextId).toBe(12);
    for (let f = 200; f < 250; f++) {
      expect(
        ed.project.images.some((i) => f >= i.startFrame && f < i.endFrame),
      ).toBe(false);
    }
    ed.undo();
    expect(ed.project.images).toEqual([img('img_1', 180, 230, { size: 0.4 })]);
    ed.redo();
    expect(ed.project.images).toHaveLength(2);
  });

  it('closing gaps pulls the picture over a later clip along', () => {
    const ed = editorWith(threeClips());
    ed.dispatch('clip.move', { clipId: 'clip_3', startFrame: 260 });
    ed.setPlayhead(270);
    expect(ed.dispatch('image.add', { assetId: 'asset_2' })).toBe(true);
    expect(ed.project.images[0]).toMatchObject({
      startFrame: 270,
      endFrame: 330,
    });
    expect(ed.dispatch('timeline.closeGaps')).toBe(true);
    expect(ed.project.images[0]).toMatchObject({
      startFrame: 210,
      endFrame: 270,
    });
    ed.undo();
    expect(ed.project.images[0]).toMatchObject({
      startFrame: 270,
      endFrame: 330,
    });
  });
});

// ---- the chosen picture (ADR-0020) ----
//
// `selectedImageId` is the THIRD exclusive selection id, beside the clip's and
// the subtitle's: one thing is chosen at a time, and the choice is dropped the
// moment the thing it points at leaves the document.

describe('selection', () => {
  it('lands on the picture a placing command just made, and the clip lets go', () => {
    const ed = editorWith(seed());
    ed.select('clip_1');
    ed.setPlayhead(30);
    expect(ed.dispatch('image.add', { assetId: 'asset_2' })).toBe(true);
    expect(ed.project.images.map((i) => i.id)).toEqual(['img_3']);
    expect(ed.selectedImageId).toBe('img_3');
    expect(ed.selectedClipId).toBeNull();
  });

  it('lands on the picture an import brought in', () => {
    const ed = editorWith(seed());
    ed.setPlayhead(30);
    expect(
      ed.dispatch('image.import', {
        name: 'logo.png',
        width: 400,
        height: 200,
      }),
    ).toBe(true);
    // `asset_3` for the file, `img_4` for what went on the timeline.
    expect(ed.selectedImageId).toBe('img_4');
  });

  it('is what every command reads out of the ctx', () => {
    const ed = editorWith(seed(300, [img('img_1', 0, 60)]));
    ed.selectImage('img_1');
    expect(ed.context().selectedImageId).toBe('img_1');
    ed.selectImage(null);
    expect(ed.context().selectedImageId).toBeNull();
  });

  it('is one thing at a time — a picture, a clip and words push each other out', () => {
    const ed = editorWith({
      ...seed(300, [img('img_1', 0, 60)]),
      subtitles: [{ id: 'sub_9', text: 'x', startFrame: 100, endFrame: 160 }],
    });
    ed.select('clip_1');
    ed.selectImage('img_1');
    expect(ed.selectedImageId).toBe('img_1');
    expect(ed.selectedClipId).toBeNull();

    ed.selectSubtitle('sub_9');
    expect(ed.selectedImageId).toBeNull();

    ed.selectImage('img_1');
    expect(ed.selectedSubtitleId).toBeNull();

    ed.select('clip_1');
    expect(ed.selectedImageId).toBeNull();
  });

  it('is dropped when the chosen picture is taken off the timeline', () => {
    const ed = editorWith(
      seed(300, [img('img_1', 0, 60), img('img_2', 90, 150)]),
    );
    ed.selectImage('img_2');
    // Another picture leaving changes nothing about this choice.
    expect(ed.dispatch('image.remove', { imageId: 'img_1' })).toBe(true);
    expect(ed.selectedImageId).toBe('img_2');
    expect(ed.dispatch('image.remove', { imageId: 'img_2' })).toBe(true);
    expect(ed.selectedImageId).toBeNull();
  });

  it('is dropped by an undo that takes the picture back, and redo does not re-choose it', () => {
    const ed = editorWith(seed());
    ed.setPlayhead(30);
    expect(ed.dispatch('image.add', { assetId: 'asset_2' })).toBe(true);
    expect(ed.selectedImageId).toBe('img_3');

    expect(ed.undo()).toBe(true);
    expect(ed.project.images).toEqual([]);
    expect(ed.selectedImageId).toBeNull();

    // Redo replays the patch; it does not re-run the command, so nothing
    // chooses the picture again.
    expect(ed.redo()).toBe(true);
    expect(ed.project.images.map((i) => i.id)).toEqual(['img_3']);
    expect(ed.selectedImageId).toBeNull();
  });

  it('is cleared by a version restore', () => {
    const ed = editorWith(seed(300, [img('img_1', 0, 60)]));
    ed.selectImage('img_1');
    ed.restoreProject(seed());
    expect(ed.selectedImageId).toBeNull();
  });
});
