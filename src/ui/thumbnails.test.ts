// framewright — the thumbnail cache and its decode queue.
//
// The placement arithmetic is `src/engine/thumbnails.test.ts`. This is the
// other half, and it is the half that can be wrong without looking wrong: a
// picture cached under an asset id that has since been pointed at a different
// file shows the WRONG footage, confidently, with nothing to report.
//
// It runs in Node because everything browser-shaped here is reachable through
// one seam each — `registry.setDecodeService` for the decoder, and the global
// `createImageBitmap` — so the concurrency and lifetime rules can be pinned
// without WebCodecs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FPS_30 } from '../engine/time';
import { setDecodeService, retainOnly } from '../engine/registry';
import type { VideoDecodeService } from '../engine/decoder';
import {
  getThumbnail,
  releaseThumbnails,
  requestThumbnail,
  retainOnlyThumbnails,
} from './thumbnails';

/** Every bitmap this test suite hands out, so a leak is visible as one that
 *  was never closed. */
interface FakeBitmap {
  id: string;
  closed: boolean;
  width: number;
  height: number;
  close: () => void;
}
let handed: FakeBitmap[] = [];

function fakeBitmap(id: string): FakeBitmap {
  const bitmap: FakeBitmap = {
    id,
    closed: false,
    width: 160,
    height: 88,
    close: () => {
      bitmap.closed = true;
    },
  };
  handed.push(bitmap);
  return bitmap;
}

/** A decoder that answers instantly and says which service it was. */
function fakeService(
  tag: string,
  answer: 'frame' | 'none' | 'throw' = 'frame',
) {
  const closedFrames: number[] = [];
  const service = {
    tag,
    closedFrames,
    decodeAtSec: async (sec: number) => {
      if (answer === 'none') return null;
      if (answer === 'throw') throw new Error('undecodable');
      return {
        tag,
        sec,
        close() {
          closedFrames.push(sec);
        },
      } as unknown as VideoFrame;
    },
  };
  return service as unknown as VideoDecodeService & {
    tag: string;
    closedFrames: number[];
  };
}

/** Let the serial queue drain. Nothing here does real work, so a handful of
 *  turns is enough — but it is a loop, not a single `await`, because a decode
 *  is two awaits deep and the queue starts the next one only when it is done. */
async function settle(turns = 12): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0));
}

let bitmapCount = 0;

beforeEach(() => {
  bitmapCount = 0;
  handed = [];
  vi.stubGlobal('createImageBitmap', async (source: { tag?: string }) =>
    fakeBitmap(`${source?.tag ?? '?'}#${bitmapCount++}`),
  );
});

afterEach(async () => {
  await settle();
  // Wipe every module-level collection between tests: these are singletons.
  retainOnlyThumbnails([]);
  retainOnly([]);
  vi.unstubAllGlobals();
});

describe('a picture is decoded once and then remembered', () => {
  it('decodes on the first ask and serves the cache on the second', async () => {
    const service = fakeService('a');
    setDecodeService('asset1', service);
    expect(getThumbnail('asset1', 0)).toBeNull();

    requestThumbnail('asset1', 0, FPS_30);
    await settle();
    const first = getThumbnail('asset1', 0);
    expect(first).not.toBeNull();

    requestThumbnail('asset1', 0, FPS_30);
    await settle();
    // Same object, and no second bitmap was ever built.
    expect(getThumbnail('asset1', 0)).toBe(first);
    expect(handed).toHaveLength(1);
  });

  it('closes the VideoFrame it decoded, on the success path too', async () => {
    const service = fakeService('a');
    setDecodeService('asset1', service);
    requestThumbnail('asset1', 12, FPS_30);
    await settle();
    expect(service.closedFrames).toHaveLength(1);
  });

  it('asks once for a frame the source cannot give back', async () => {
    const service = fakeService('a', 'none');
    setDecodeService('asset1', service);
    const spy = vi.spyOn(service, 'decodeAtSec');
    requestThumbnail('asset1', 5, FPS_30);
    await settle();
    requestThumbnail('asset1', 5, FPS_30);
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('survives a decoder that throws, and does not retry it either', async () => {
    const service = fakeService('a', 'throw');
    setDecodeService('asset1', service);
    const spy = vi.spyOn(service, 'decodeAtSec');
    requestThumbnail('asset1', 5, FPS_30);
    await settle();
    requestThumbnail('asset1', 5, FPS_30);
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(getThumbnail('asset1', 5)).toBeNull();
  });

  it('does nothing at all for an asset with no media bound', async () => {
    requestThumbnail('nomedia', 0, FPS_30);
    await settle();
    expect(getThumbnail('nomedia', 0)).toBeNull();
    // NOT remembered as missing: binding the media is exactly what makes this
    // decodable, so it must be asked again once the file comes back.
    const service = fakeService('a');
    setDecodeService('nomedia', service);
    requestThumbnail('nomedia', 0, FPS_30);
    await settle();
    expect(getThumbnail('nomedia', 0)).not.toBeNull();
  });
});

describe('a picture never outlives the file it came from', () => {
  it('drops and CLOSES the pictures of an asset that left the document', async () => {
    setDecodeService('gone', fakeService('a'));
    requestThumbnail('gone', 0, FPS_30);
    await settle();
    expect(getThumbnail('gone', 0)).not.toBeNull();

    retainOnlyThumbnails(['other']);
    expect(getThumbnail('gone', 0)).toBeNull();
    expect(handed.every((b) => b.closed)).toBe(true);
  });

  it('refuses a decode that lands AFTER its asset was removed', async () => {
    // The race the queue makes possible: a decode is two awaits long, and the
    // document can change during it. Caching the result would quietly undo the
    // cleanup that just ran.
    let release!: (frame: VideoFrame | null) => void;
    const slow = {
      decodeAtSec: () =>
        new Promise<VideoFrame | null>((resolve) => {
          release = resolve;
        }),
    } as unknown as VideoDecodeService;
    setDecodeService('doomed', slow);
    requestThumbnail('doomed', 0, FPS_30);
    await settle(2);

    retainOnly([]); // the asset leaves the document mid-decode
    retainOnlyThumbnails([]);
    release({ tag: 'doomed', close: () => {} } as unknown as VideoFrame);
    await settle();

    expect(getThumbnail('doomed', 0)).toBeNull();
    // And the picture that was built for it was closed, not left to the
    // collector: an ImageBitmap holds memory GC is in no hurry to release.
    expect(handed.every((b) => b.closed)).toBe(true);
  });

  it('refuses a decode that lands after the media was RE-LINKED', async () => {
    // The bug this whole section exists for. A re-link keeps the asset id and
    // swaps the decoder, so a picture from the old file would look exactly like
    // a correct one — and the editor would be cut against footage that is not
    // in the file any more.
    let release!: (frame: VideoFrame | null) => void;
    const oldService = {
      decodeAtSec: () =>
        new Promise<VideoFrame | null>((resolve) => {
          release = resolve;
        }),
    } as unknown as VideoDecodeService;
    setDecodeService('same-id', oldService);
    requestThumbnail('same-id', 0, FPS_30);
    await settle(2);

    setDecodeService('same-id', fakeService('new-file'));
    release({ tag: 'old-file', close: () => {} } as unknown as VideoFrame);
    await settle();

    expect(getThumbnail('same-id', 0)).toBeNull();
    expect(handed.every((b) => b.closed)).toBe(true);
  });

  it('forgets an asset’s pictures and its refusals when the media is re-bound', async () => {
    const service = fakeService('a');
    setDecodeService('relinked', service);
    requestThumbnail('relinked', 0, FPS_30);
    requestThumbnail('relinked', 30, FPS_30);
    await settle();
    expect(getThumbnail('relinked', 0)).not.toBeNull();

    releaseThumbnails('relinked');
    expect(getThumbnail('relinked', 0)).toBeNull();
    expect(handed.every((b) => b.closed)).toBe(true);

    // Asking again really does decode again, rather than being short-circuited
    // by a leftover "already had that one".
    requestThumbnail('relinked', 0, FPS_30);
    await settle();
    expect(getThumbnail('relinked', 0)).not.toBeNull();
  });

  it('leaves other assets alone when one is released', async () => {
    setDecodeService('keep', fakeService('k'));
    setDecodeService('drop', fakeService('d'));
    requestThumbnail('keep', 0, FPS_30);
    await settle();
    requestThumbnail('drop', 0, FPS_30);
    await settle();

    releaseThumbnails('drop');
    expect(getThumbnail('drop', 0)).toBeNull();
    expect(getThumbnail('keep', 0)).not.toBeNull();
  });
});
