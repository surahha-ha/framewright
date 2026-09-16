import { describe, it, expect } from 'vitest';
import { createProject } from './project';
import { buildExportPlan } from './exportPlan';
import { DEFAULT_IMAGE_SIZE } from './imageRender';
import {
  DEFAULT_IMAGE_SEC,
  MAX_IMAGE_SIZE,
  MIN_IMAGE_SIZE,
  NO_IMAGES,
  SNAP,
  describeImagePosition,
  describeImageSize,
  imageAt,
  imageFrameAt,
  imageLimits,
  imagePlan,
  imageSizeOf,
  imagesInPlan,
  locateImage,
  missingImagesText,
  normalizeImagePosition,
  normalizeImageSize,
  samePosition,
  snapImagePosition,
} from './images';
import type { Asset, Clip, Project, StageImage } from './types';

function img(over: Partial<StageImage> = {}): StageImage {
  return {
    id: 'img_1',
    assetId: 'asset_2',
    startFrame: 0,
    endFrame: 30,
    ...over,
  };
}

/** A 100-frame video, a video asset and a 400×200 picture to hang on it. */
function seed(frames = 100, images: StageImage[] = []): Project {
  const p = createProject();
  const clip: Clip = {
    id: 'clip_1',
    assetId: 'asset_1',
    startFrame: 0,
    inFrame: 0,
    outFrame: frames,
  };
  const assets: Asset[] = [
    { id: 'asset_1', kind: 'video', name: 'a.mp4', meta: {} },
    {
      id: 'asset_2',
      kind: 'image',
      name: 'logo.png',
      meta: { width: 400, height: 200 },
    },
    {
      id: 'asset_3',
      kind: 'image',
      name: 'sticker.png',
      meta: { width: 100, height: 100 },
    },
  ];
  return {
    ...p,
    nextId: 4,
    assets,
    tracks: p.tracks.map((t) =>
      t.type === 'video' ? { ...t, clips: [clip] } : t,
    ),
    images,
  };
}

describe('imageAt / locateImage', () => {
  it('is half-open: the end frame already shows nothing', () => {
    const p = seed(100, [img({ startFrame: 10, endFrame: 20 })]);
    expect(imageAt(p, 9)).toBeNull();
    expect(imageAt(p, 10)?.id).toBe('img_1');
    expect(imageAt(p, 19)?.id).toBe('img_1');
    expect(imageAt(p, 20)).toBeNull();
  });

  it('finds an image by id, with its index, and nothing for null', () => {
    const p = seed(100, [
      img({ id: 'img_1', startFrame: 0, endFrame: 10 }),
      img({ id: 'img_2', startFrame: 20, endFrame: 30 }),
    ]);
    expect(locateImage(p, 'img_2')).toEqual({
      index: 1,
      image: p.images[1],
    });
    expect(locateImage(p, 'img_9')).toBeNull();
    expect(locateImage(p, null)).toBeNull();
  });
});

describe('imagePlan — where a new image goes', () => {
  it('lasts the default seconds from the playhead', () => {
    const p = seed(300);
    expect(DEFAULT_IMAGE_SEC).toBe(2);
    // 2 s at 30 fps is 60 frames.
    expect(imagePlan(p, 0)).toEqual({
      startFrame: 0,
      endFrame: 60,
      index: 0,
    });
  });

  it('is cut short by the end of the video', () => {
    const p = seed(100);
    expect(imagePlan(p, 80)).toEqual({
      startFrame: 80,
      endFrame: 100,
      index: 0,
    });
  });

  it('is cut short by the next image, and lands after it in the list', () => {
    const p = seed(300, [img({ id: 'img_1', startFrame: 50, endFrame: 70 })]);
    expect(imagePlan(p, 20)).toEqual({
      startFrame: 20,
      endFrame: 50,
      index: 0,
    });
    expect(imagePlan(p, 100)).toEqual({
      startFrame: 100,
      endFrame: 160,
      index: 1,
    });
  });

  it('refuses off the end of the video and on a frame that already has one', () => {
    const p = seed(100, [img({ id: 'img_1', startFrame: 50, endFrame: 70 })]);
    expect(imagePlan(p, 100)).toBeNull();
    expect(imagePlan(p, -1)).toBeNull();
    expect(imagePlan(p, 55)).toBeNull();
  });
});

describe('imageLimits — how far an edge may travel', () => {
  it('stops at the neighbours and at the end of the video', () => {
    const p = seed(100, [
      img({ id: 'img_1', startFrame: 10, endFrame: 30 }),
      img({ id: 'img_2', startFrame: 60, endFrame: 80 }),
    ]);
    expect(imageLimits(p, 'img_1')).toEqual({
      minStart: 0,
      maxStart: 29,
      minEnd: 11,
      maxEnd: 60,
    });
    expect(imageLimits(p, 'img_2')).toEqual({
      minStart: 30,
      maxStart: 79,
      minEnd: 61,
      maxEnd: 100,
    });
    expect(imageLimits(p, 'img_9')).toBeNull();
  });

  it('keeps its own end reachable when the video was shortened under it', () => {
    const p = seed(100, [img({ id: 'img_1', startFrame: 90, endFrame: 140 })]);
    expect(imageLimits(p, 'img_1')?.maxEnd).toBe(140);
  });
});

describe('the image normal form — whole percents, the centre absent', () => {
  it('stores 0.5 as absent on BOTH axes', () => {
    expect(normalizeImagePosition({ posX: 0.5, posY: 0.5 })).toStrictEqual({
      posX: undefined,
      posY: undefined,
    });
  });

  it('keeps the bottom edge as a number — an image has no bottom stack', () => {
    expect(normalizeImagePosition({ posX: 0.2, posY: 0.97 })).toStrictEqual({
      posX: 0.2,
      posY: 0.97,
    });
  });

  it('rounds to whole percents and clamps to the box', () => {
    expect(
      normalizeImagePosition({ posX: 0.3249, posY: 0.7051 }),
    ).toStrictEqual({ posX: 0.32, posY: 0.71 });
    expect(normalizeImagePosition({ posX: -0.4, posY: 1.8 })).toStrictEqual({
      posX: 0,
      posY: 1,
    });
  });

  it('never lets a value that is not a number reach the document', () => {
    expect(normalizeImagePosition({ posX: NaN, posY: 0.7 })).toStrictEqual({
      posX: undefined,
      posY: 0.7,
    });
    expect(normalizeImageSize(NaN)).toBeUndefined();
  });

  it('leaves an axis the caller did not name absent', () => {
    expect(normalizeImagePosition({ posY: 0.7 })).toStrictEqual({
      posX: undefined,
      posY: 0.7,
    });
  });

  it('stores the default size as absent, and reads an absent size as it', () => {
    expect(DEFAULT_IMAGE_SIZE).toBe(0.25);
    expect(normalizeImageSize(DEFAULT_IMAGE_SIZE)).toBeUndefined();
    expect(normalizeImageSize(0.4)).toBe(0.4);
    expect(imageSizeOf(img())).toBe(DEFAULT_IMAGE_SIZE);
    expect(imageSizeOf(img({ size: 0.4 }))).toBe(0.4);
  });

  it('rounds a size to whole percents and clamps it to the slider ends', () => {
    expect(normalizeImageSize(0.4049)).toBe(0.4);
    expect(normalizeImageSize(9)).toBe(MAX_IMAGE_SIZE);
    expect(normalizeImageSize(0)).toBe(MIN_IMAGE_SIZE);
    expect(MIN_IMAGE_SIZE).toBe(0.05);
    expect(MAX_IMAGE_SIZE).toBe(1);
  });
});

describe('the centre snap — the centre and nothing else', () => {
  it('pulls a drop within SNAP of the centre to the centre', () => {
    expect(SNAP).toBe(0.03);
    expect(snapImagePosition({ posX: 0.52, posY: 0.48 })).toStrictEqual({
      posX: undefined,
      posY: undefined,
    });
    // Just inside the radius on each side. Not 0.5 ± SNAP exactly: in binary
    // floating point 0.5 + 0.03 lands a hair OUTSIDE 0.03 of 0.5, so the
    // exact edge is a coin flip and pinning it would pin the coin, not the
    // rule. The subtitle's snap has the same edge, by the same `near`.
    expect(snapImagePosition({ posX: 0.529, posY: 0.471 })).toStrictEqual({
      posX: undefined,
      posY: undefined,
    });
  });

  it('snaps each axis on its own', () => {
    expect(snapImagePosition({ posX: 0.2, posY: 0.49 })).toStrictEqual({
      posX: 0.2,
      posY: undefined,
    });
  });

  it('snaps to nothing else — not to the subtitle presets, not to an edge', () => {
    expect(snapImagePosition({ posX: 0.16, posY: 0.97 })).toStrictEqual({
      posX: 0.16,
      posY: 0.97,
    });
    expect(snapImagePosition({ posX: 0.54, posY: 0.02 })).toStrictEqual({
      posX: 0.54,
      posY: 0.02,
    });
  });
});

describe('samePosition — the no-change refusal, by value', () => {
  it('reads an absent axis and a stored 0.5 as the same place', () => {
    expect(samePosition({ posX: 0.5, posY: 0.5 }, {})).toBe(true);
    expect(samePosition({ posX: 0.5 }, { posY: 0.5 })).toBe(true);
  });

  it('reads two spellings of the same whole percent as the same place', () => {
    expect(samePosition({ posX: 0.324 }, { posX: 0.32 })).toBe(true);
  });

  it('sees a move of one percent', () => {
    expect(samePosition({ posX: 0.32 }, { posX: 0.33 })).toBe(false);
    expect(samePosition({ posY: 0.5 }, { posY: 0.51 })).toBe(false);
  });
});

describe('imageFrameAt — what one frame shows', () => {
  it('carries the asset, its pixel size and only the fields the image has', () => {
    const p = seed(100, [img({ startFrame: 10, endFrame: 20 })]);
    expect(imageFrameAt(p, 10)).toEqual({
      assetId: 'asset_2',
      srcWidth: 400,
      srcHeight: 200,
    });
    expect(imageFrameAt(p, 9)).toBeNull();
    expect(imageFrameAt(p, 20)).toBeNull();
  });

  it('carries the place and the size when the image has them', () => {
    const p = seed(100, [
      img({ startFrame: 0, endFrame: 10, posX: 0.32, posY: 0.7, size: 0.4 }),
    ]);
    expect(imageFrameAt(p, 5)).toEqual({
      assetId: 'asset_2',
      srcWidth: 400,
      srcHeight: 200,
      posX: 0.32,
      posY: 0.7,
      size: 0.4,
    });
  });

  it('says nothing for an image whose asset is not in the document', () => {
    const p = seed(100, [img({ assetId: 'asset_9' })]);
    expect(imageFrameAt(p, 0)).toBeNull();
  });

  it('reports a source with no recorded size as zero, so the draw squares it', () => {
    const p = seed(100, [img({ assetId: 'asset_1' })]);
    expect(imageFrameAt(p, 0)).toEqual({
      assetId: 'asset_1',
      srcWidth: 0,
      srcHeight: 0,
    });
  });
});

// What the plan RECORDS per frame is pinned beside the words, in
// `exportPlan.test.ts`; this is the question asked of a finished plan.
describe('imagesInPlan — what the export must open before frame 0', () => {
  it('names each asset once, in first-use order', () => {
    const p = seed(30, [
      img({ id: 'img_1', assetId: 'asset_3', startFrame: 0, endFrame: 5 }),
      img({ id: 'img_2', assetId: 'asset_2', startFrame: 5, endFrame: 10 }),
      img({ id: 'img_3', assetId: 'asset_3', startFrame: 10, endFrame: 15 }),
    ]);
    expect(imagesInPlan(buildExportPlan(p))).toEqual(['asset_3', 'asset_2']);
  });

  it('names nothing for a plan with no image on any frame', () => {
    expect(imagesInPlan(buildExportPlan(seed(10)))).toEqual([]);
  });
});

describe('NO_IMAGES — the Node-side seam', () => {
  it('never has a picture and never gets one', async () => {
    expect(NO_IMAGES.ready('asset_2')).toBe(false);
    expect(NO_IMAGES.get('asset_2')).toBeNull();
    await expect(NO_IMAGES.load('asset_2')).resolves.toBe(false);
  });
});

describe('the sentences this module owns', () => {
  it('names the centre when the image is in it', () => {
    expect(describeImagePosition({})).toBe('이미지를 가운데로 옮겼어요.');
    expect(describeImagePosition({ posX: 0.5, posY: 0.5 })).toBe(
      '이미지를 가운데로 옮겼어요.',
    );
  });

  it('says where the image went, as two whole percents', () => {
    expect(describeImagePosition({ posX: 0.32, posY: 0.7 })).toBe(
      '이미지를 옮겼어요 · 왼쪽에서 32% · 위에서 70%.',
    );
    // An axis the document leaves absent is the middle of that axis.
    expect(describeImagePosition({ posY: 0.7 })).toBe(
      '이미지를 옮겼어요 · 왼쪽에서 50% · 위에서 70%.',
    );
  });

  it('says the new size as a percent of the box width', () => {
    expect(describeImageSize(0.4)).toBe('이미지 크기를 40%로 바꿨어요.');
    expect(describeImageSize(undefined)).toBe('이미지 크기를 25%로 바꿨어요.');
  });

  it('warns about the pictures the export could not open, by file name', () => {
    expect(missingImagesText([])).toBe('');
    expect(missingImagesText(['logo.png'])).toBe(
      ' ⚠ logo.png 이미지를 열지 못해 그리지 않았어요.',
    );
    expect(missingImagesText(['logo.png', 'sticker.png'])).toBe(
      ' ⚠ logo.png, sticker.png 이미지를 열지 못해 그리지 않았어요.',
    );
  });
});
