// framewright — "is this asset's media here?", and what a reload restores.
//
// The decode registry answers that question for footage and cannot answer it
// for a picture: an image asset never gets a decoder, so a registry test calls
// every restored picture lost, for ever, on a document that is perfectly
// intact. These tests pin the replacement — and, just as important, pin that it
// did NOT become "the document says it kept a file", which a browser that
// evicted the bytes would still happily agree with.
//
// Node, like the rest of the unit suite: the media store is behind one seam
// (`createOpfsMediaRepository`), so a Map stands in for OPFS and every rule
// here is reachable without a browser. What a picture LOOKS like when drawn is
// not reachable that way and is not asserted here.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset } from '../engine/types';
import type { MediaRepository } from '../engine/mediaStore';
import type { VideoDecodeService } from '../engine/decoder';
// The real one, through the mock below: the key is the content's, and two of
// the tests here need to know it in advance.
import { mediaKeyFor } from '../engine/mediaStore';

/** Stands in for OPFS. Cleared between tests, like a fresh browser profile. */
const stored = new Map<string, ArrayBuffer>();
let storeAvailable = true;

const fakeRepo: MediaRepository = {
  get available() {
    return storeAvailable;
  },
  async put(key, bytes) {
    stored.set(key, bytes.slice(0));
    return true;
  },
  async get(key) {
    return stored.get(key) ?? null;
  },
  async has(key) {
    return stored.has(key);
  },
  async remove(key) {
    stored.delete(key);
  },
  async keys() {
    return [...stored.keys()];
  },
};

vi.mock('../engine/mediaStore', async () => {
  const actual = await vi.importActual<typeof import('../engine/mediaStore')>(
    '../engine/mediaStore',
  );
  return { ...actual, createOpfsMediaRepository: () => fakeRepo };
});

/**
 * A page load's worth of modules.
 *
 * `media.ts` holds two per-load facts — which keys this load has held, and the
 * one in-flight restore — so a test that shared them with the previous test
 * would be testing the previous test's leftovers.
 */
async function pageLoad() {
  vi.resetModules();
  const media = await import('./media');
  const registry = await import('../engine/registry');
  return { media, registry };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  .buffer;

function picture(over: Partial<Asset> = {}): Asset {
  return {
    id: 'asset_1',
    kind: 'image',
    name: 'logo.png',
    opfsKey: 'media_abc',
    meta: { width: 200, height: 120 },
    ...over,
  };
}

function footage(over: Partial<Asset> = {}): Asset {
  return {
    id: 'asset_2',
    kind: 'video',
    name: 'take.mp4',
    opfsKey: 'media_def',
    meta: {},
    ...over,
  };
}

/** A decoder as far as the registry is concerned — nothing here calls it. */
const FAKE_SERVICE = {} as VideoDecodeService;

beforeEach(() => {
  stored.clear();
  storeAvailable = true;
});

describe('isMediaReady', () => {
  it('holds a picture to be missing until its bytes have actually been read', async () => {
    const { media } = await pageLoad();
    const asset = picture();
    // The document remembers where the file went; the file is not there.
    expect(media.isMediaReady(asset)).toBe(false);

    stored.set(asset.opfsKey!, PNG);
    // Still false: remembering the key is not the same as having the bytes.
    expect(media.isMediaReady(asset)).toBe(false);

    await media.restoreSavedMedia([asset]);
    expect(media.isMediaReady(asset)).toBe(true);
  });

  it('never answers for footage from the store — only its decoder counts', async () => {
    const { media, registry } = await pageLoad();
    const asset = footage();
    stored.set(asset.opfsKey!, PNG);

    // The bytes are readable, and that is NOT what makes a video playable.
    await media.loadSavedMedia(asset);
    expect(media.isMediaReady(asset)).toBe(false);

    registry.setDecodeService(asset.id, FAKE_SERVICE);
    expect(media.isMediaReady(asset)).toBe(true);
  });

  it('takes the import at its word for a picture nothing could be stored for', async () => {
    const { media } = await pageLoad();
    // No `opfsKey` at all: the browser would not keep the bytes. The bitmap
    // cache is holding the picture for the session (ui/images.ts), and without
    // this the bin would print 다시 선택 필요 over a picture that is on screen
    // and the export would refuse to run.
    const asset = picture({ opfsKey: undefined });
    expect(media.isMediaReady(asset)).toBe(false);

    media.markMediaHeld(asset.id);

    expect(media.isMediaReady(asset)).toBe(true);
  });

  it('does not let that stand in for a decoder', async () => {
    const { media } = await pageLoad();
    const asset = footage();

    media.markMediaHeld(asset.id);

    // Footage is playable when it has a decode service and at no other time;
    // holding its bytes is not the same claim and must not answer for it.
    expect(media.isMediaReady(asset)).toBe(false);
  });

  it('forgets a picture whose file was swept away', async () => {
    const { media } = await pageLoad();
    const key = await media.persistMedia(PNG.slice(0));
    expect(key).not.toBeNull();
    const asset = picture({ opfsKey: key! });
    // Imported in this session: ready without a reload, because the import
    // itself held the bytes.
    expect(media.isMediaReady(asset)).toBe(true);

    await media.sweepStoredMedia(new Set<string>());
    expect(media.isMediaReady(asset)).toBe(false);
  });
});

describe('restoring a picture', () => {
  it('reads its bytes back and registers no decoder for it', async () => {
    const { media, registry } = await pageLoad();
    const asset = picture();
    stored.set(asset.opfsKey!, PNG);

    const report = await media.restoreSavedMedia([asset]);

    expect(report.restored).toEqual(['logo.png']);
    expect(report.lost).toEqual([]);
    // A picture has no container to demux and no audio to bind. Sending one
    // down the footage path would have failed and reported the file lost.
    expect(registry.getDecodeService(asset.id)).toBeNull();
  });

  it('reports one whose file is gone as lost, and leaves it not ready', async () => {
    const { media } = await pageLoad();
    const asset = picture();

    const report = await media.restoreSavedMedia([asset]);

    expect(report.lost).toEqual(['logo.png']);
    expect(report.restored).toEqual([]);
    expect(media.isMediaReady(asset)).toBe(false);
  });
});

describe('assetsToRestore', () => {
  it('drops a picture once it has been restored, and keeps one that has not', async () => {
    const { media } = await pageLoad();
    const here = picture();
    const gone = picture({
      id: 'asset_3',
      name: 'sign.png',
      opfsKey: 'media_x',
    });
    stored.set(here.opfsKey!, PNG);

    expect(media.assetsToRestore([here, gone]).map((a) => a.id)).toEqual([
      'asset_1',
      'asset_3',
    ]);

    await media.restoreSavedMedia([here, gone]);

    // The restored one is done; the one whose file is missing still needs the
    // user, and would be picked up by a later pass.
    expect(media.assetsToRestore([here, gone]).map((a) => a.id)).toEqual([
      'asset_3',
    ]);
  });

  it('leaves out footage whose decoder is already registered', async () => {
    const { media, registry } = await pageLoad();
    const asset = footage();
    expect(media.assetsToRestore([asset])).toHaveLength(1);

    registry.setDecodeService(asset.id, FAKE_SERVICE);
    expect(media.assetsToRestore([asset])).toEqual([]);
  });
});

describe('loadSavedMedia', () => {
  it('types a picture by its name, so an object URL can draw it', async () => {
    const { media } = await pageLoad();
    stored.set('media_abc', PNG);

    const png = await media.loadSavedMedia(picture());
    expect(png?.type).toBe('image/png');

    const jpeg = await media.loadSavedMedia(picture({ name: 'Shot.JPEG' }));
    expect(jpeg?.type).toBe('image/jpeg');

    // An extension we do not know: say nothing rather than say something
    // wrong, and let the bytes speak.
    const odd = await media.loadSavedMedia(picture({ name: 'scan.tiff' }));
    expect(odd?.type).toBe('');
  });

  it('still calls footage an mp4, whatever its name', async () => {
    const { media } = await pageLoad();
    stored.set('media_def', PNG);

    const file = await media.loadSavedMedia(footage({ name: 'take.mov' }));
    expect(file?.type).toBe('video/mp4');
  });

  it('returns nothing when the browser has no media store', async () => {
    const { media } = await pageLoad();
    storeAvailable = false;
    stored.set('media_abc', PNG);

    expect(await media.loadSavedMedia(picture())).toBeNull();
    expect(media.isMediaReady(picture())).toBe(false);
  });
});

describe('retainOnlyMedia', () => {
  it('drops the held flag for a picture the document no longer has', async () => {
    const { media } = await pageLoad();
    const asset = picture({ opfsKey: undefined });
    media.markMediaHeld(asset.id);
    expect(media.isMediaReady(asset)).toBe(true);

    // The retain effect, with the asset gone from the document. Beside this
    // call, `retainOnlyImages` has just closed the very picture the flag was
    // speaking for.
    media.retainOnlyMedia([]);

    expect(media.isMediaReady(asset)).toBe(false);
  });

  it('keeps it for one the document still names', async () => {
    const { media } = await pageLoad();
    const kept = picture({ opfsKey: undefined });
    const gone = picture({ id: 'asset_9', opfsKey: undefined });
    media.markMediaHeld(kept.id);
    media.markMediaHeld(gone.id);

    media.retainOnlyMedia([kept.id]);

    expect(media.isMediaReady(kept)).toBe(true);
    expect(media.isMediaReady(gone)).toBe(false);
  });

  it('leaves an import → undo → redo picture that nothing was stored for NOT ready', async () => {
    const { media } = await pageLoad();
    // A browser that will not keep files: a private window, no OPFS, a full
    // disk. The picture is in hand and nowhere else.
    storeAvailable = false;
    const asset = picture({ id: 'asset_3', opfsKey: undefined });
    expect(await media.persistMedia(PNG.slice(0))).toBeNull();
    media.markMediaHeld(asset.id);
    expect(media.isMediaReady(asset)).toBe(true);

    // Ctrl+Z: the asset leaves the document and the retain effect runs.
    media.retainOnlyMedia([]);
    // Ctrl+Shift+Z: the stored patch replays, so the SAME id comes back — and
    // still with no file behind it.
    media.retainOnlyMedia([asset.id]);

    // There is nothing anywhere left to read, so the honest answer is the one
    // the bin prints as 다시 선택 필요 and the export refuses to run on. Saying
    // ready here is what wrote a video with the picture missing and only
    // mentioned it afterwards.
    expect(media.isMediaReady(asset)).toBe(false);
  });

  it('does not unready a picture whose stored file is still there', async () => {
    const { media } = await pageLoad();
    const key = await media.persistMedia(PNG.slice(0));
    const asset = picture({ opfsKey: key! });

    // Undo took the asset out of the document — but the file it points at is
    // untouched, because the sweep that deletes one runs at startup, exactly
    // so a redo finds it. Sweeping the held KEYS by what the document names
    // would answer 다시 선택 필요 for a picture that is right there.
    media.retainOnlyMedia([]);

    expect(media.isMediaReady(asset)).toBe(true);
  });
});

describe('imageToRelink', () => {
  it('finds the picture of that name whose file is gone, and no other', async () => {
    const { media } = await pageLoad();
    const lost = picture({ id: 'asset_3', name: 'logo.png' });
    // Footage of the same name is not a picture's re-link target: what that
    // one is missing is a decoder, and the other branch answers for it.
    const sameName = footage({ name: 'logo.png' });
    const assets = [sameName, lost];

    expect(media.imageToRelink(assets, 'logo.png')).toBe(lost);
    expect(media.imageToRelink(assets, 'sign.png')).toBeUndefined();
  });

  it('leaves out a picture whose bytes are already in hand', async () => {
    const { media } = await pageLoad();
    const here = picture();
    stored.set(here.opfsKey!, PNG);
    await media.restoreSavedMedia([here]);

    expect(media.imageToRelink([here], 'logo.png')).toBeUndefined();
  });

  it('has to be asked before the re-picked file is kept', async () => {
    const { media } = await pageLoad();
    // The document remembers where these bytes went in an earlier session.
    // The file is not there, so the picture is missing.
    const lost = picture({ opfsKey: await mediaKeyFor(PNG.slice(0)) });
    expect(media.imageToRelink([lost], 'logo.png')).toBe(lost);

    // The user drops the same file again, and keeping it is what makes the
    // picture ready — the whole of an image re-link.
    await media.persistMedia(PNG.slice(0));
    expect(media.isMediaReady(lost)).toBe(true);

    // Asked in the wrong order, nothing reads as missing and the caller goes
    // down the import path: a second copy of a picture already in the
    // document, with its own asset and its own place on the timeline.
    expect(media.imageToRelink([lost], 'logo.png')).toBeUndefined();
  });
});

describe('dropInvitation', () => {
  it('asks for footage alone until there is some, then for either kind', async () => {
    const { media } = await pageLoad();

    // A picture cannot be the first thing in a project — the command that
    // places one is refused with 먼저 영상을 불러오세요., and the refused file
    // leaves no trace to come back to — so the bin does not offer it yet.
    expect(media.dropInvitation(false)).toBe('영상 드래그');
    expect(media.dropInvitation(true)).toBe('영상이나 이미지 드래그');
  });
});
