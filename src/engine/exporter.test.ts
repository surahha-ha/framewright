// framewright — the exporter's IMAGES phase, in Node (ADR-0020).
//
// The export pipeline itself is a browser thing (WebCodecs, OffscreenCanvas,
// a muxer) and is covered end to end by `e2e/`. What CAN be pinned here is
// the one piece of it that is pure sequencing: every picture the plan lays
// over a frame is opened BEFORE frame 0, one at a time, in first-use order,
// a cancel is answered while one is on its way, and a picture that will not
// open is named in the result and costs the footage under it nothing.
//
// So the browser's parts are stood in for by the smallest fakes that let the
// real `exportProject` run: an encoder that records the order it was asked to
// encode in, a canvas whose context records what was drawn on it, and a muxer
// that keeps nothing. Everything the test asserts is the exporter's own code.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('mp4-muxer', () => {
  class ArrayBufferTarget {
    buffer = new ArrayBuffer(8);
  }
  class Muxer {
    target: ArrayBufferTarget;
    constructor(opts: { target: ArrayBufferTarget }) {
      this.target = opts.target;
    }
    addVideoChunk(): void {}
    addAudioChunk(): void {}
    finalize(): void {}
  }
  return { Muxer, ArrayBufferTarget };
});

import { exportProject } from './exporter';
import { createProject } from './project';
import type { Asset, Clip, Project, StageImage } from './types';
import type { ImageSource } from './images';
import type { VideoDecodeService } from './decoder';

// ---- what the exporter did, in order ----

let log: string[] = [];
/** Everything the fake canvas was asked to draw, in order. */
let drawn: string[] = [];

// ---- the browser, stood in for ----

const fakeCtx = {
  globalAlpha: 1,
  fillStyle: '',
  font: '',
  textAlign: 'left',
  textBaseline: 'alphabetic',
  fillRect(): void {},
  drawImage(source: unknown): void {
    drawn.push(String((source as { tag?: string }).tag ?? 'unknown'));
  },
  fillText(): void {},
  strokeText(): void {},
  measureText: (text: string) => ({ width: text.length * 10 }),
  save(): void {},
  restore(): void {},
  translate(): void {},
  rotate(): void {},
  scale(): void {},
  beginPath(): void {},
  roundRect(): void {},
  fill(): void {},
};

class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(): typeof fakeCtx {
    return fakeCtx;
  }
}

class FakeOutputFrame {
  constructor(
    _source: unknown,
    _init: { timestamp: number; duration: number },
  ) {}
  close(): void {}
}

class FakeVideoEncoder {
  encodeQueueSize = 0;
  constructor(_init: { output: unknown; error: unknown }) {}
  static async isConfigSupported(
    config: unknown,
  ): Promise<{ supported: boolean; config: unknown }> {
    return { supported: true, config };
  }
  configure(): void {}
  encode(): void {
    log.push('encode');
  }
  async flush(): Promise<void> {}
  close(): void {}
}

/** A source that always has the next picture ready, so nothing about the
 *  FOOTAGE is missing and `missingFrames` measures only what it should. */
function fakeService(): VideoDecodeService {
  return {
    createPlaybackSession: () => ({
      start(): void {},
      frameFor: () => null,
      awaitFrameFor: async () => ({
        tag: 'footage',
        displayWidth: 160,
        displayHeight: 90,
        close(): void {},
      }),
      stop(): void {},
    }),
  } as unknown as VideoDecodeService;
}

// ---- the pictures ----

/**
 * A stand-in for `ui/images.ts`: it records when each picture was asked for
 * and when it arrived, so "one at a time, in first-use order" is readable
 * off the log rather than inferred. `refuse` is a picture that will not open.
 */
function fakeImages(
  opts: {
    refuse?: string[];
    hold?: (assetId: string) => Promise<void>;
  } = {},
): ImageSource {
  const open = new Set<string>();
  return {
    ready: (assetId) => open.has(assetId),
    get: (assetId) =>
      open.has(assetId)
        ? ({ tag: `picture:${assetId}` } as unknown as CanvasImageSource)
        : null,
    load: async (assetId) => {
      log.push(`asking:${assetId}`);
      await opts.hold?.(assetId);
      if (opts.refuse?.includes(assetId)) {
        log.push(`refused:${assetId}`);
        return false;
      }
      open.add(assetId);
      log.push(`opened:${assetId}`);
      return true;
    },
  };
}

// ---- the document ----

const imageAsset = (id: string, name: string): Asset => ({
  id,
  kind: 'image',
  name,
  meta: { width: 200, height: 100 },
});

const stageImage = (
  id: string,
  assetId: string,
  startFrame: number,
  endFrame: number,
): StageImage => ({ id, assetId, startFrame, endFrame });

/** Nine frames of footage with three stickers on them: the same picture at
 *  the start and at the end, another in the middle. First-use order is
 *  therefore logo, star — and logo is named twice but opened once. */
function seed(): Project {
  const p = createProject();
  const clip: Clip = {
    id: 'clip_1',
    assetId: 'asset_1',
    startFrame: 0,
    inFrame: 0,
    outFrame: 9,
  };
  return {
    ...p,
    nextId: 10,
    tracks: p.tracks.map((t) =>
      t.type === 'video' ? { ...t, clips: [clip] } : t,
    ),
    assets: [
      {
        id: 'asset_1',
        kind: 'video',
        name: 'movie.mp4',
        meta: { width: 160, height: 90 },
      },
      imageAsset('asset_logo', 'logo.png'),
      imageAsset('asset_star', 'star.png'),
    ],
    images: [
      stageImage('img_1', 'asset_logo', 0, 3),
      stageImage('img_2', 'asset_star', 3, 6),
      stageImage('img_3', 'asset_logo', 6, 9),
    ],
  };
}

beforeEach(() => {
  log = [];
  drawn = [];
  vi.stubGlobal('VideoEncoder', FakeVideoEncoder);
  vi.stubGlobal('VideoFrame', FakeOutputFrame);
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the export's images phase", () => {
  it('opens each picture the plan names once, in first-use order, before the first frame is encoded', async () => {
    const phases: string[] = [];
    const result = await exportProject(seed(), fakeService, {
      images: fakeImages(),
      onProgress: (done, total, phase) =>
        phases.push(`${phase} ${done}/${total}`),
    });

    // One at a time: nothing is asked for while the one before it is out.
    expect(log.slice(0, 4)).toEqual([
      'asking:asset_logo',
      'opened:asset_logo',
      'asking:asset_star',
      'opened:asset_star',
    ]);
    // Named on three frames ranges, asked for twice — never twice.
    expect(log.filter((e) => e === 'asking:asset_logo')).toHaveLength(1);
    // And all of it before frame 0 reached the encoder.
    expect(log.indexOf('encode')).toBe(4);
    expect(log.filter((e) => e === 'encode')).toHaveLength(9);

    expect(phases.slice(0, 3)).toEqual([
      'images 0/2',
      'images 1/2',
      'images 2/2',
    ]);
    expect(result.missingImages).toEqual([]);
    expect(result.missingFrames).toBe(0);

    // Every frame drew its picture, and the middle three drew the other one:
    // proof the opened bitmap actually reached `composeFrame`.
    const pictures = drawn.filter((d) => d.startsWith('picture:'));
    expect(pictures).toEqual([
      'picture:asset_logo',
      'picture:asset_logo',
      'picture:asset_logo',
      'picture:asset_star',
      'picture:asset_star',
      'picture:asset_star',
      'picture:asset_logo',
      'picture:asset_logo',
      'picture:asset_logo',
    ]);
  });

  it('names a picture that would not open by its file name, and counts none of its frames as missing', async () => {
    const result = await exportProject(seed(), fakeService, {
      images: fakeImages({ refuse: ['asset_star'] }),
    });

    expect(result.missingImages).toEqual(['star.png']);
    // The footage under it was there — those frames went out whole, with
    // nothing over them. Counting them as missing would be a false report.
    expect(result.missingFrames).toBe(0);
    expect(result.frames).toBe(9);

    const pictures = drawn.filter((d) => d.startsWith('picture:'));
    expect(pictures).toHaveLength(6); // the six logo frames, none of the star
    expect(pictures).not.toContain('picture:asset_star');
    // The one that did open is still drawn: a refusal stops that picture,
    // not the phase.
    expect(drawn.filter((d) => d === 'footage')).toHaveLength(9);
  });

  it('answers a cancel while a picture is still on its way, like a face', async () => {
    const controller = new AbortController();
    const images = fakeImages({
      hold: async (assetId) => {
        if (assetId !== 'asset_logo') return;
        // The cancel must arrive while the wait is ON, not before it starts:
        // aborting synchronously would take `raceAbort`'s already-aborted
        // shortcut and prove nothing about the race. Yielding once first
        // lets the exporter attach its listener, so this is the real path —
        // the first picture then never arrives at all.
        await Promise.resolve();
        controller.abort();
        await new Promise(() => {});
      },
    });

    await expect(
      exportProject(seed(), fakeService, {
        images,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    // It stopped where it was: the second picture was never asked for, and
    // no frame was encoded.
    expect(log).toEqual(['asking:asset_logo']);
  });

  it('exports a plan with a picture on it when no source of pictures was handed in', async () => {
    // The Node default (`NO_IMAGES`): nothing can be opened. The file is
    // still whole — every frame of footage, nothing drawn over it, and an
    // honest list of what could not be opened.
    const result = await exportProject(seed(), fakeService);

    expect(result.frames).toBe(9);
    expect(result.missingFrames).toBe(0);
    expect(result.missingImages).toEqual(['logo.png', 'star.png']);
    expect(drawn.filter((d) => d.startsWith('picture:'))).toEqual([]);
    expect(drawn.filter((d) => d === 'footage')).toHaveLength(9);
  });
});
