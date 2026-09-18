// framewright — the picture an image on the stage is drawn with (ADR-0020).
//
// The browser half of `ImageSource` (`engine/images.ts`), and the sibling of
// `ui/fonts.ts`: the engine owns the interface, the UI implements it, and the
// preview and the export ask the same object for the same picture, so the two
// cannot disagree about what a frame shows.
//
// It is not a copy of `fonts.ts`, because an `ImageBitmap` is a RESOURCE and a
// font face is not (golden rule 6 — a leak crashes the tab). Three rules
// follow, and they are most of the file:
//
//   1. One picture per asset, closed when the document stops wanting it.
//      `ImageBitmap.close()` is written in exactly one function,
//      `closeBitmap`. Everything the cache holds reaches it through `forget`;
//      the pictures that do not are the two that never became a cache entry —
//      the import the document refused, in `importImageFile`, and a load whose
//      file stopped being the current one while it was reading.
//   2. A cached picture is identified by the FILE it came from, not by the
//      asset id. `opfsKey` is content-addressed (`mediaStore.mediaKeyFor`), so
//      comparing it answers "is this still the right picture" for all three
//      ways it stops being one: the asset was re-linked to another file, the
//      document was swapped for a version whose `asset_3` is a different file,
//      or either of those happened while a load was still in flight.
//   3. A file that could not be read is remembered, so the draw path does not
//      ask again on every frame — but remembered UNDER ITS KEY, so a re-link
//      or another document retries by itself, and `releaseImage` clears it
//      outright. (`fonts.ts` remembers a failure per face for the life of the
//      page, which is why "a face that failed in one document stays failed for
//      the next" is in CLAUDE.md's debt list. Not inherited here.)
//
// `load` never throws: an asset the document does not have, a file that was
// never kept, bytes that are not a picture, an OPFS that is not there — all of
// them resolve false, and the stage draws the footage with nothing over it.

import { editor } from '../store/projectStore';
import { mediaRepo } from './media';
import type { ImageSource } from '../engine/images';
import type { Asset } from '../engine/types';

interface Cached {
  /** The stored file this picture was decoded from, or null when there is no
   *  stored file at all: a browser that would not keep the bytes still gets a
   *  picture, seeded at the import (`importImageFile`). Null is a VALUE here,
   *  not "unknown" — it matches an asset with no `opfsKey` and nothing else,
   *  so the same comparison still decides whether a cached picture is current. */
  key: string | null;
  bitmap: ImageBitmap;
}

/** One picture per asset — bounded by the document, like the peaks cache and
 *  unlike the thumbnail cache, which is keyed by asset AND frame. */
const cache = new Map<string, Cached>();
/** Loads started and not finished, with the file each one is reading. */
const pending = new Map<string, { key: string; run: Promise<boolean> }>();
/** Assets whose file could not be turned into a picture, and WHICH file. */
const failed = new Map<string, string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of [...listeners]) fn();
}

/** Redraw when a picture arrives — or fails to. Returns the unsubscribe. */
export function subscribeImages(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * The asset the document has under this id, or undefined. One pass over the
 * media bin, which is the same cost `Preview` already pays per render to
 * resolve the clip under the playhead.
 */
function assetOf(assetId: string): Asset | undefined {
  return editor.project.assets.find((a) => a.id === assetId);
}

/**
 * The stored file this asset's picture comes from, or null: the document has
 * no such asset, or nothing was kept for it (no OPFS when it was imported).
 */
function keyOf(assetId: string): string | null {
  return assetOf(assetId)?.opfsKey ?? null;
}

/**
 * **The one place `ImageBitmap.close()` is written.** A picture has one owner
 * and one end, and keeping the call in a single named function is what makes
 * that checkable by reading rather than by hoping.
 */
function closeBitmap(bitmap: ImageBitmap): void {
  bitmap.close();
}

/**
 * Forget this asset's picture, closing it.
 *
 * Every picture the cache holds leaves through here: both public drops, and
 * the one other moment a picture stops being the right one — a load about to
 * put a newer picture where an older one is.
 */
function forget(assetId: string): void {
  const entry = cache.get(assetId);
  if (!entry) return;
  closeBitmap(entry.bitmap);
  cache.delete(assetId);
}

/** The cached picture, if it is still of the file the document names now —
 *  and only while the document still has the asset at all, so a picture
 *  waiting for the retain sweep is never handed out for something that has
 *  been undone. */
function current(assetId: string): ImageBitmap | null {
  const entry = cache.get(assetId);
  if (!entry) return null;
  const asset = assetOf(assetId);
  if (!asset) return null;
  return entry.key === (asset.opfsKey ?? null) ? entry.bitmap : null;
}

export const browserImages: ImageSource = {
  ready: (assetId) => current(assetId) !== null,
  get: (assetId) => current(assetId),
  load(assetId) {
    // A picture already in hand IS the answer, and it is asked first: an
    // import seeds one for an asset the browser would not store a file for
    // (`importImageFile`), and going to the store for its key — which there
    // is none of — would call a perfectly drawable picture missing, on the
    // export's warning line.
    if (current(assetId) !== null) return Promise.resolve(true);
    const key = keyOf(assetId);
    // Nothing to open. Not remembered as a failure — there is no file to
    // remember it against — and the answer costs one lookup, no I/O.
    if (key === null) return Promise.resolve(false);
    if (failed.get(assetId) === key) return Promise.resolve(false);
    // A load already reading THIS file is the same question; one reading an
    // older file is not, and answering with it would hand back the picture the
    // document has just stopped naming.
    const inFlight = pending.get(assetId);
    if (inFlight && inFlight.key === key) return inFlight.run;

    const run = (async () => {
      try {
        // Node, or a browser too old for it: no picture, no throw.
        if (typeof createImageBitmap === 'undefined') return false;
        const bytes = await mediaRepo.get(key);
        if (!bytes) {
          failed.set(assetId, key);
          return false;
        }
        const bitmap = await createImageBitmap(new Blob([bytes]));
        // Reading the bytes takes long enough for the document to move on, so
        // the question is asked BEFORE the cache is touched: whatever is in
        // there now is the picture of the file the document names NOW — a
        // re-link or a re-import that landed while this read was in flight —
        // and putting this one in its place would close the right picture to
        // install a stale one. This bitmap never becomes a cache entry, so it
        // goes through the door directly; an asset that has left the document
        // is the same answer (`keyOf` is null), closed here rather than waiting
        // for a retain that will never name it again.
        if (keyOf(assetId) !== key) {
          closeBitmap(bitmap);
          return false;
        }
        // Whatever was cached is of another file (a re-link, a restore): this
        // is the only moment one picture replaces another, and the older one
        // is closed rather than dropped on the floor.
        forget(assetId);
        cache.set(assetId, { key, bitmap });
        failed.delete(assetId);
        return true;
      } catch {
        // Bytes that are not a picture, or a store that threw.
        failed.set(assetId, key);
        return false;
      } finally {
        // Only if it is still OURS: a newer load for a different file has
        // already replaced the entry, and deleting it would cost that one its
        // dedupe. Compared by key rather than by the promise, which is still in
        // its own temporal dead zone on the paths that never awaited.
        if (pending.get(assetId)?.key === key) pending.delete(assetId);
        notify();
      }
    })();

    pending.set(assetId, { key, run });
    return run;
  },
};

/** What `importImageFile` answers with. */
export interface ImportedImage {
  /** Whether the file is a picture at all. False is the only outcome the
   *  caller has to explain: a placement the document refused has already said
   *  why, in its own words. */
  opened: boolean;
  /** The asset the picture is being kept for, or null — the file was not a
   *  picture, or `place` did not take it. */
  assetId: string | null;
}

/**
 * Open a file the user has just picked, and keep the picture for the asset the
 * import makes out of it.
 *
 * It exists because of a hole the footage does not have. A video that could not
 * be stored is still playable for the session — its decode service holds the
 * demuxed file in memory — but a picture is looked up BY ITS STORED FILE, so a
 * browser that refuses to keep the bytes (a private window, no OPFS, a full
 * disk) would leave `load` with no key to read and the stage blank until the
 * user picked the file again. The bytes were already decoded here, to find out
 * whether the file is a picture at all and how big it is, so the picture that
 * proved it is the one the document gets.
 *
 * `place` is handed the picture's pixel size, does whatever putting it in the
 * document takes (it may store the file, and it may be refused), and answers
 * with the asset id — or null. The bitmap never leaves this module: it is
 * cached for the id that comes back, and closed when none does, so no caller
 * can be the second owner of a resource.
 */
export async function importImageFile(
  file: Blob,
  place: (size: {
    width: number;
    height: number;
  }) => Promise<string | null> | string | null,
): Promise<ImportedImage> {
  // Node, or a browser too old for it. Nothing can say whether these bytes are
  // a picture, so nothing pretends to.
  if (typeof createImageBitmap === 'undefined') {
    return { opened: false, assetId: null };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // The one thing that can decide this: a name, an extension and a media
    // type are all guesses, and a decoder is the only reader of the bytes.
    return { opened: false, assetId: null };
  }
  let assetId: string | null = null;
  try {
    assetId = await place({ width: bitmap.width, height: bitmap.height });
  } catch (err) {
    closeBitmap(bitmap);
    throw err;
  }
  if (assetId === null || !assetOf(assetId)) {
    // Nothing to hang it on: the document refused the import, or it was gone
    // again by the time `place` answered. This picture was never a cache
    // entry, so it is the one that does not leave through `forget`.
    closeBitmap(bitmap);
    return { opened: true, assetId: null };
  }
  // Whatever this asset had is of another file (a re-import over a picture
  // that was re-linked) and goes through the one door.
  forget(assetId);
  cache.set(assetId, { key: keyOf(assetId), bitmap });
  failed.delete(assetId);
  notify();
  return { opened: true, assetId };
}

/**
 * Forget the pictures for assets that are no longer in the document — the
 * shape of `registry.retainOnly` and `retainOnlyThumbnails`, called from the
 * same place, for the same reason: an `ImageBitmap` holds memory the collector
 * is in no hurry to release.
 *
 * Silent on purpose. It runs inside the effect that watches the document's
 * assets, so everything that could look at a picture is re-rendering already.
 */
export function retainOnlyImages(assetIds: Iterable<string>): void {
  const keep = new Set(assetIds);
  for (const assetId of [...cache.keys()]) {
    if (!keep.has(assetId)) forget(assetId);
  }
  for (const assetId of [...failed.keys()]) {
    if (!keep.has(assetId)) failed.delete(assetId);
  }
  // A load still reading for a departed asset is left to finish; it closes
  // what it opened when it finds the document no longer names its file.
  for (const assetId of [...pending.keys()]) {
    if (!keep.has(assetId)) pending.delete(assetId);
  }
}

/**
 * Throw away everything held for ONE asset, and let it be asked for again.
 * Called when its media is (re-)bound: the document keeps the asset id across
 * a re-link, so without this the stage would keep drawing the file that was
 * replaced — and a file that could not be read says nothing about the one
 * replacing it, which is why the refusal goes too.
 */
export function releaseImage(assetId: string): void {
  forget(assetId);
  failed.delete(assetId);
  pending.delete(assetId);
  notify();
}
