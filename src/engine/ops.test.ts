// framewright — the document ops for the lists that are not a track's clips.
// An image is its own list, like a subtitle (ADR-0011's argument, applied), so
// it gets the same three ops: insert and remove by INDEX, update by ID.

import { describe, it, expect } from 'vitest';
import { applyOp, applyOps, type Op } from './ops';
import { createProject } from './project';
import type { Project, StageImage } from './types';

function img(
  id: string,
  startFrame: number,
  endFrame: number,
  extra: Partial<StageImage> = {},
): StageImage {
  return { id, assetId: 'asset_1', startFrame, endFrame, ...extra };
}

function doc(images: StageImage[] = []): Project {
  return { ...createProject(), nextId: 5, images };
}

describe('image ops', () => {
  it('inserts at an index, and the inverse leaves the document exactly as it was', () => {
    const before = doc([img('img_1', 0, 30), img('img_2', 90, 120)]);
    const forward: Op[] = [
      { kind: 'insertImage', index: 1, image: img('img_3', 40, 60) },
    ];
    const inverse: Op[] = [{ kind: 'removeImage', index: 1 }];

    const after = applyOps(before, forward);
    // sorted by startFrame: the new one goes between, not on the end
    expect(after.images.map((i) => i.id)).toEqual(['img_1', 'img_3', 'img_2']);
    expect(applyOps(after, inverse)).toEqual(before);
  });

  it('removes by index, and the inverse puts the same image back in the same place', () => {
    const before = doc([
      img('img_1', 0, 30),
      img('img_2', 40, 60),
      img('img_3', 90, 120),
    ]);
    const forward: Op[] = [{ kind: 'removeImage', index: 1 }];
    const inverse: Op[] = [
      { kind: 'insertImage', index: 1, image: img('img_2', 40, 60) },
    ];

    const after = applyOps(before, forward);
    expect(after.images.map((i) => i.id)).toEqual(['img_1', 'img_3']);
    expect(applyOps(after, inverse)).toEqual(before);
  });

  it('updates by id and touches no other image', () => {
    const before = doc([
      img('img_1', 0, 30, { size: 0.25 }),
      img('img_2', 40, 60),
    ]);
    const after = applyOp(before, {
      kind: 'updateImage',
      imageId: 'img_1',
      changes: { posX: 0.2, size: 0.5 },
    });
    expect(after.images[0]).toStrictEqual(
      img('img_1', 0, 30, { size: 0.5, posX: 0.2 }),
    );
    expect(after.images[1]).toBe(before.images[1]);
    // and back again: the update's own inverse restores the old values
    expect(
      applyOp(after, {
        kind: 'updateImage',
        imageId: 'img_1',
        changes: { posX: undefined, size: 0.25 },
      }),
    ).toEqual(before);
  });

  it('REMOVES a field set to undefined, so undo and a reload agree', () => {
    // The centre is absence, not 0.5, and a quarter of the box is absence, not
    // 0.25 — a merged-in `undefined` would survive in memory and vanish on the
    // next reload. Same rule as a clip's fades and a subtitle's look.
    const before = doc([
      img('img_1', 0, 30, { posX: 0.2, posY: 0.8, size: 0.4 }),
    ]);
    const after = applyOp(before, {
      kind: 'updateImage',
      imageId: 'img_1',
      changes: { posX: undefined, posY: undefined },
    });

    expect(after.images[0]).toStrictEqual(img('img_1', 0, 30, { size: 0.4 }));
    expect('posX' in after.images[0]).toBe(false);
    expect('posY' in after.images[0]).toBe(false);
    expect(JSON.parse(JSON.stringify(after.images[0]))).toStrictEqual(
      after.images[0],
    );
  });

  it('leaves the words alone — the two lists are independent', () => {
    const before: Project = {
      ...doc([img('img_1', 0, 30)]),
      subtitles: [{ id: 'sub_1', text: 'hi', startFrame: 0, endFrame: 30 }],
    };
    const after = applyOps(before, [
      { kind: 'removeImage', index: 0 },
      { kind: 'insertImage', index: 0, image: img('img_9', 50, 80) },
    ]);
    expect(after.subtitles).toBe(before.subtitles);
    expect(after.images.map((i) => i.id)).toEqual(['img_9']);
  });
});
