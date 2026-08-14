// framewright — where the imported media itself lives.
//
// The project JSON is small and goes to `storage.ts`; the FILE does not fit
// there and never did, which is why a reload used to leave every asset asking
// to be picked again. ADR-0004 chose OPFS for this; ADR-0009 is the argument
// for the shape below.
//
// Behind an interface, like the document repository, so a server media store
// drops in without touching callers. Keys are CONTENT ADDRESSES: the same file
// imported twice is stored once, and the key is deterministic — no clock, no
// randomness (CLAUDE.md rule 4).

import type { Project } from './types';
import type { Version } from './persistence';

/** Every key this module mints starts here. Anything else in the directory is
 *  not ours and is never deleted. */
export const MEDIA_KEY_PREFIX = 'media_';
const MEDIA_DIR = 'media';

export interface MediaRepository {
  /** False when the browser has no usable OPFS — callers must degrade, not throw. */
  readonly available: boolean;
  /** Returns false when the write did not happen (no space, no OPFS). */
  put(key: string, bytes: ArrayBuffer): Promise<boolean>;
  get(key: string): Promise<ArrayBuffer | null>;
  has(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The storage key for these bytes: SHA-256, hex, prefixed.
 *
 * Content addressing buys three things at once — re-importing the same file
 * costs nothing, the key can be computed BEFORE the import command runs (so the
 * document records it in the same undo entry), and two documents can share one
 * copy.
 */
export async function mediaKeyFor(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return MEDIA_KEY_PREFIX + toHex(digest);
}

/**
 * Every media key the saved state can still reach.
 *
 * Versions count. A restore brings its assets back, so reclaiming space by
 * looking only at the current document would turn "되돌아가기" into a dead end
 * that asks for the file again.
 */
export function liveMediaKeys(
  project: Project,
  versions: readonly Version[],
): Set<string> {
  const keys = new Set<string>();
  const collect = (p: Project) => {
    for (const asset of p.assets) if (asset.opfsKey) keys.add(asset.opfsKey);
  };
  collect(project);
  for (const v of versions) collect(v.project);
  return keys;
}

/** Delete stored media nothing points at any more. Returns what it removed. */
export async function sweepMedia(
  repo: MediaRepository,
  live: ReadonlySet<string>,
): Promise<string[]> {
  if (!repo.available) return [];
  const removed: string[] = [];
  for (const key of await repo.keys()) {
    if (!key.startsWith(MEDIA_KEY_PREFIX)) continue;
    if (live.has(key)) continue;
    await repo.remove(key);
    removed.push(key);
  }
  return removed;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Run media work one piece at a time, in the order it was asked for.
 *
 * Everything that touches the media store or the decode registry goes through
 * here, because every pair of them races otherwise, and all three races end the
 * same way — a file that is gone, or a decoder nobody released:
 *
 *  - **restore vs import**: the import finds the asset "missing" (its decoder
 *    is not registered yet), opens the file a second time and registers a
 *    second `VideoDecodeService` over the first, which holds every encoded
 *    sample of the source and is never released.
 *  - **sweep vs import**: the sweep decides what is live BEFORE the import
 *    commits the asset, so it deletes the file that was just written. Nothing
 *    fails this session — the decoder came from the `File`, not from storage —
 *    and the next reload reports it as an eviction the browser never did.
 *  - **import vs import** (a double-fired picker, a duplicated drop): both see
 *    the same pre-import document, both import, and the document ends up with
 *    two clips for one file.
 *
 * A failed piece must not stop the queue, so the chain swallows rejections —
 * the caller still gets the real promise.
 */
export function queueMediaWork<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

function opfsRoot(): Promise<FileSystemDirectoryHandle> | null {
  const storage = (globalThis as { navigator?: Navigator }).navigator?.storage;
  if (!storage || typeof storage.getDirectory !== 'function') return null;
  return storage.getDirectory();
}

export function isMediaStoreAvailable(): boolean {
  return opfsRoot() !== null;
}

/**
 * OPFS-backed media. Nothing here throws: a browser with no OPFS, a private
 * window, or a full disk all degrade to "not stored", and the caller falls back
 * to asking for the file. Losing the media is recoverable; a crash on import is
 * not.
 */
export function createOpfsMediaRepository(): MediaRepository {
  const available = isMediaStoreAvailable();

  async function dir(
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | null> {
    const root = opfsRoot();
    if (!root) return null;
    try {
      return await (await root).getDirectoryHandle(MEDIA_DIR, { create });
    } catch {
      return null;
    }
  }

  return {
    available,

    async put(key, bytes) {
      const d = await dir(true);
      if (!d) return false;
      try {
        const handle = await d.getFileHandle(key, { create: true });
        const writable = await handle.createWritable();
        try {
          await writable.write(bytes);
          await writable.close();
        } catch (err) {
          // A half-written file is worse than none: it would restore as a
          // corrupt source and look like a decoder bug.
          try {
            await writable.abort();
          } catch {
            /* already gone */
          }
          try {
            await d.removeEntry(key);
          } catch {
            /* nothing to clean up */
          }
          throw err;
        }
        return true;
      } catch {
        return false;
      }
    },

    async get(key) {
      const d = await dir(false);
      if (!d) return null;
      try {
        const handle = await d.getFileHandle(key);
        return await (await handle.getFile()).arrayBuffer();
      } catch {
        return null;
      }
    },

    async has(key) {
      const d = await dir(false);
      if (!d) return false;
      try {
        await d.getFileHandle(key);
        return true;
      } catch {
        return false;
      }
    },

    async remove(key) {
      const d = await dir(false);
      if (!d) return;
      try {
        await d.removeEntry(key);
      } catch {
        /* already gone */
      }
    },

    async keys() {
      const d = await dir(false);
      if (!d) return [];
      try {
        const names: string[] = [];
        for await (const name of d.keys()) names.push(name);
        return names;
      } catch {
        return [];
      }
    },
  };
}
