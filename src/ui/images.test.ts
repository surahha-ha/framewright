// framewright — the image cache and the lifetime of an `ImageBitmap`.
//
// Everything browser-shaped here is reachable through one seam each — the
// global `createImageBitmap`, and the stored bytes behind `mediaRepo.get` — so
// the rules that matter can be pinned in Node. The rules that matter are the
// ones that are wrong without looking wrong: a picture nobody closes (the tab
// dies, slowly), and a picture drawn for a file the asset no longer points at
// (the wrong logo, confidently, with nothing to report).
//
// What is NOT here: whether a PNG's pixels come out right. That is
// `createImageBitmap`'s job and it does not exist in Node — the export's e2e
// covers it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The document this module reads asset keys out of. */
const doc = vi.hoisted(() => ({
  assets: [] as { id: string; opfsKey?: string }[],
}));
/** What OPFS holds, by key. A key with no entry is a file that is gone. */
const files = vi.hoisted(() => ({
  bytes: new Map<string, ArrayBuffer>(),
  reads: [] as string[],
}));

vi.mock('../store/projectStore', () => ({
  editor: {
    get project() {
      return { assets: doc.assets };
    },
  },
}));

vi.mock('./media', () => ({
  mediaRepo: {
    available: true,
    get: async (key: string) => {
      files.reads.push(key);
      return files.bytes.get(key) ?? null;
    },
  },
}));

import {
  browserImages,
  importImageFile,
  releaseImage,
  retainOnlyImages,
  subscribeImages,
} from './images';

/** Stands in for the picked file. Nothing reads it: the stubbed
 *  `createImageBitmap` decides what the bytes are. */
const PICKED = new Blob([new Uint8Array([1])]);

/** Every bitmap this suite hands out, so a leak is visible as one that was
 *  never closed. */
interface FakeBitmap {
  id: string;
  closed: boolean;
  /** The pixel size a real one carries — what the import reads off it. */
  width: number;
  height: number;
  close: () => void;
}
let handed: FakeBitmap[] = [];

function fakeBitmap(id: string): FakeBitmap {
  const bitmap: FakeBitmap = {
    id,
    closed: false,
    width: 200,
    height: 120,
    close: () => {
      bitmap.closed = true;
    },
  };
  handed.push(bitmap);
  return bitmap;
}

/** Hold the next `createImageBitmap` open, so a test can move the document
 *  underneath a load that is still reading. */
let gate: (() => void) | null = null;
let made = 0;

function openFile(key: string, byte = 1): void {
  files.bytes.set(key, new Uint8Array([byte]).buffer);
}

function setAssets(...assets: { id: string; opfsKey?: string }[]): void {
  doc.assets = assets;
}

async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  handed = [];
  made = 0;
  gate = null;
  files.bytes.clear();
  files.reads = [];
  doc.assets = [];
  vi.stubGlobal('createImageBitmap', async () => {
    const bitmap = fakeBitmap(`bmp#${made++}`);
    if (gate) await new Promise<void>((resolve) => (gate = resolve));
    return bitmap as unknown as ImageBitmap;
  });
});

afterEach(async () => {
  // The document losing every asset must leave nothing open. Asserted after
  // EVERY test, so a leak on any path shows up as the test that opened it.
  setAssets();
  retainOnlyImages([]);
  await settle();
  expect(handed.filter((b) => !b.closed)).toEqual([]);
  vi.unstubAllGlobals();
});

describe('browserImages', () => {
  it('opens a picture once and hands the same one back', async () => {
    setAssets({ id: 'a1', opfsKey: 'media_aa' });
    openFile('media_aa');

    expect(browserImages.ready('a1')).toBe(false);
    expect(await browserImages.load('a1')).toBe(true);
    expect(browserImages.ready('a1')).toBe(true);
    expect(browserImages.get('a1')).toBe(handed[0]);

    expect(await browserImages.load('a1')).toBe(true);
    expect(made).toBe(1);
    expect(files.reads).toEqual(['media_aa']);
  });

  it('reads the file once for two loads asked at the same time', async () => {
    setAssets({ id: 'a1', opfsKey: 'media_aa' });
    openFile('media_aa');

    const [first, second] = await Promise.all([
      browserImages.load('a1'),
      browserImages.load('a1'),
    ]);

    expect([first, second]).toEqual([true, true]);
    expect(made).toBe(1);
    expect(files.reads).toEqual(['media_aa']);
  });

  it('says no — without throwing — for an asset the document has not got, and for one whose bytes were never kept', async () => {
    setAssets({ id: 'a1' });

    expect(await browserImages.load('a1')).toBe(false);
    expect(await browserImages.load('ghost')).toBe(false);
    expect(browserImages.ready('a1')).toBe(false);
    expect(browserImages.get('a1')).toBe(null);
    // No key to read, so the store was never asked.
    expect(files.reads).toEqual([]);
  });

  it('remembers a file it could not read, so the draw path stops asking', async () => {
    setAssets({ id: 'a1', opfsKey: 'media_gone' });

    expect(await browserImages.load('a1')).toBe(false);
    expect(await browserImages.load('a1')).toBe(false);
    expect(await browserImages.load('a1')).toBe(false);
    expect(files.reads).toEqual(['media_gone']);
  });

  it('remembers bytes that are not a picture the same way', async () => {
    setAssets({ id: 'a1', opfsKey: 'media_text' });
    openFile('media_text');
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('not an image');
    });

    expect(await browserImages.load('a1')).toBe(false);
    expect(browserImages.ready('a1')).toBe(false);
    expect(await browserImages.load('a1')).toBe(false);
    expect(files.reads).toEqual(['media_text']);
  });

  it('closes the pictures of assets the document no longer names, and keeps the rest', async () => {
    setAssets(
      { id: 'a1', opfsKey: 'media_aa' },
      { id: 'a2', opfsKey: 'media_bb' },
    );
    openFile('media_aa');
    openFile('media_bb');
    await browserImages.load('a1');
    await browserImages.load('a2');
    const [first, second] = handed;

    setAssets({ id: 'a2', opfsKey: 'media_bb' });
    retainOnlyImages(['a2']);

    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(browserImages.get('a1')).toBe(null);
    expect(browserImages.get('a2')).toBe(second);
  });

  it('closes a picture that lands after its asset has left the document', async () => {
    setAssets({ id: 'a1', opfsKey: 'media_aa' });
    openFile('media_aa');
    gate = () => {};

    const load = browserImages.load('a1');
    await settle();
    // The import is undone while the bytes are being read.
    setAssets();
    retainOnlyImages([]);
    gate?.();

    expect(await load).toBe(false);
    expect(handed).toHaveLength(1);
    expect(handed[0].closed).toBe(true);
    expect(browserImages.get('a1')).toBe(null);
  });

  it('leaves the current picture alone when a load for the old file lands late', async () => {
    // Unreachable until an image could be re-linked: every import minted a
    // fresh asset id, so no second picture ever arrived for an id a load was
    // already reading for. A re-link keeps the id, which is what opens this.
    setAssets({ id: 'a1', opfsKey: 'media_old' });
    openFile('media_old', 1);
    gate = () => {};
    const late = browserImages.load('a1');
    await settle();
    // Let go of the gate before the next decode, or the re-link's own picture
    // would hang on it too.
    const release = gate!;
    gate = null;

    // The re-link: the same asset id, a file of its own, and the picture that
    // proved the bytes are a picture cached for it.
    setAssets({ id: 'a1', opfsKey: 'media_new' });
    openFile('media_new', 2);
    await importImageFile(PICKED, () => 'a1');
    const shown = browserImages.get('a1');
    expect(shown).toBe(handed[1]);

    // The late one finishes reading a file the document has stopped naming.
    // It closes what IT opened and touches nothing else: closing the picture
    // on screen to put its own stale one there, and then dropping that too,
    // left the cache empty and the stage blank with nothing to say.
    release();
    expect(await late).toBe(false);
    expect(browserImages.get('a1')).toBe(shown);
    expect(browserImages.ready('a1')).toBe(true);
    expect(handed[0].closed).toBe(true);
    expect(handed[1].closed).toBe(false);
  });

  it('draws nothing from the old file after a re-link, and opens the new one', async () => {
    setAssets({ id: 'a1', opfsKey: 'media_old' });
    openFile('media_old', 1);
    await browserImages.load('a1');
    const old = handed[0];

    // The same asset id, a different file — what `bindMedia` leaves behind.
    setAssets({ id: 'a1', opfsKey: 'media_new' });
    openFile('media_new', 2);
    expect(browserImages.ready('a1')).toBe(false);
    expect(browserImages.get('a1')).toBe(null);

    expect(await browserImages.load('a1')).toBe(true);
    expect(old.closed).toBe(true);
    expect(browserImages.get('a1')).toBe(handed[1]);
  });

  it('lets a failure be retried: releaseImage clears the refusal', async () => {
    setAssets({ id: 'a1', opfsKey: 'media_aa' });

    expect(await browserImages.load('a1')).toBe(false);
    // The file is there on the second attempt (a re-link of the same bytes).
    openFile('media_aa');
    expect(await browserImages.load('a1')).toBe(false);

    releaseImage('a1');
    expect(await browserImages.load('a1')).toBe(true);
    expect(browserImages.ready('a1')).toBe(true);
  });

  it('releaseImage closes what it drops', async () => {
    setAssets({ id: 'a1', opfsKey: 'media_aa' });
    openFile('media_aa');
    await browserImages.load('a1');

    releaseImage('a1');

    expect(handed[0].closed).toBe(true);
    expect(browserImages.ready('a1')).toBe(false);
  });

  it('tells subscribers when a picture lands and when one does not', async () => {
    setAssets({ id: 'a1', opfsKey: 'media_aa' }, { id: 'a2', opfsKey: 'gone' });
    openFile('media_aa');
    let beats = 0;
    const off = subscribeImages(() => beats++);

    await browserImages.load('a1');
    expect(beats).toBe(1);
    await browserImages.load('a2');
    expect(beats).toBe(2);

    off();
    await browserImages.load('a2');
    expect(beats).toBe(2);
  });

  it('says no where there is no createImageBitmap at all', async () => {
    setAssets({ id: 'a1', opfsKey: 'media_aa' });
    openFile('media_aa');
    vi.stubGlobal('createImageBitmap', undefined);

    expect(await browserImages.load('a1')).toBe(false);
    expect(browserImages.ready('a1')).toBe(false);
  });
});

describe('importImageFile', () => {
  it('keeps the picture for a file the browser would not store', async () => {
    // The hole it exists for: no `opfsKey`, so `load` has nothing to read the
    // picture back out of, for the whole session. Footage does not have it —
    // its decode service holds the file in memory.
    const result = await importImageFile(PICKED, ({ width, height }) => {
      expect([width, height]).toEqual([200, 120]);
      setAssets({ id: 'a1' });
      return 'a1';
    });

    expect(result).toEqual({ opened: true, assetId: 'a1' });
    expect(browserImages.ready('a1')).toBe(true);
    expect(browserImages.get('a1')).toBe(handed[0]);
    // The export asks exactly this, and a no here is a ⚠ on the done sentence
    // about a picture that is right there.
    expect(await browserImages.load('a1')).toBe(true);
    // There was no key, so the store was never asked for one.
    expect(files.reads).toEqual([]);
  });

  it('closes the picture when the document does not take it', async () => {
    // The import refused for want of room at the playhead. Nothing holds the
    // bitmap after this call, so nothing else could ever close it.
    const result = await importImageFile(PICKED, () => null);

    expect(result).toEqual({ opened: true, assetId: null });
    expect(handed).toHaveLength(1);
    expect(handed[0].closed).toBe(true);
  });

  it('closes it when the placement names an asset that is not there', async () => {
    const result = await importImageFile(PICKED, () => 'ghost');

    expect(result).toEqual({ opened: true, assetId: null });
    expect(handed[0].closed).toBe(true);
    expect(browserImages.get('ghost')).toBe(null);
  });

  it('closes it when the placement throws, and lets the throw out', async () => {
    const boom = new Error('the document said no');

    await expect(
      importImageFile(PICKED, () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(handed[0].closed).toBe(true);
  });

  it('says a file that is not a picture is not one, and asks the document nothing', async () => {
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('not an image');
    });
    let asked = 0;

    const result = await importImageFile(PICKED, () => {
      asked++;
      return 'a1';
    });

    expect(result).toEqual({ opened: false, assetId: null });
    // Nothing may reach the document before the bytes have been read: that is
    // what keeps an unopenable file from leaving an asset behind.
    expect(asked).toBe(0);
  });

  it('says the same where there is no createImageBitmap at all', async () => {
    vi.stubGlobal('createImageBitmap', undefined);

    expect(await importImageFile(PICKED, () => 'a1')).toEqual({
      opened: false,
      assetId: null,
    });
  });

  it('replaces — and closes — a picture the asset already had', async () => {
    setAssets({ id: 'a1', opfsKey: 'media_aa' });
    openFile('media_aa');
    await browserImages.load('a1');

    await importImageFile(PICKED, () => 'a1');

    expect(handed[0].closed).toBe(true);
    expect(browserImages.get('a1')).toBe(handed[1]);
  });

  it('lets a seeded picture go when the asset gets a stored file of its own', async () => {
    setAssets({ id: 'a1' });
    await importImageFile(PICKED, () => 'a1');
    expect(browserImages.get('a1')).toBe(handed[0]);

    // A re-link: the same asset id, and now a file behind it. What is in hand
    // is a picture of the file that is NOT that one.
    setAssets({ id: 'a1', opfsKey: 'media_new' });
    openFile('media_new', 2);
    expect(browserImages.ready('a1')).toBe(false);

    expect(await browserImages.load('a1')).toBe(true);
    expect(handed[0].closed).toBe(true);
    expect(browserImages.get('a1')).toBe(handed[1]);
  });
});
