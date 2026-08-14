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

/** What the browser answered when asked to stop evicting this origin.
 *  `unknown` covers "no such API" and "it threw" — both mean no promise either
 *  way, which is not the same as a refusal. */
export type PersistenceOutcome = 'granted' | 'refused' | 'unknown';

let persistenceRequest: Promise<PersistenceOutcome> | null = null;
let persistence: PersistenceOutcome | null = null;

/**
 * Ask the browser to stop evicting us, once, and remember what it said.
 *
 * Without this the media store is best-effort: Chrome clears best-effort
 * origins under storage pressure, and the user's answer to "why is my project
 * asking for the file again?" would be "the browser felt like it".
 *
 * **The in-flight promise is what gets cached, not the settled value.** Caching
 * the value only guards a caller that arrives after the first has finished; two
 * that arrive together would both ask the browser and race to write the answer,
 * so a refusal could be overwritten by a later `unknown`. The media queue does
 * serialise the one call site today, but that safety lives in the caller, and a
 * "try again" button would quietly take it away.
 */
export function requestPersistentStorage(): Promise<PersistenceOutcome> {
  if (persistenceRequest) return persistenceRequest;
  persistenceRequest = (async (): Promise<PersistenceOutcome> => {
    try {
      const storage = (globalThis as { navigator?: Navigator }).navigator
        ?.storage;
      if (!storage?.persist || !storage.persisted) return 'unknown';
      if (await storage.persisted()) return 'granted';
      return (await storage.persist()) ? 'granted' : 'refused';
    } catch {
      return 'unknown';
    }
  })().then((outcome) => {
    persistence = outcome;
    return outcome;
  });
  return persistenceRequest;
}

/** What the browser answered, or `unknown` before anything has asked. */
export function persistenceOutcome(): PersistenceOutcome {
  return persistence ?? 'unknown';
}

/**
 * The one extra sentence an import adds when the browser refused to protect the
 * file it just kept.
 *
 * Measured on 2026-08-14: `navigator.storage.persist()` returns false on a
 * freshly-visited origin and Chrome never asks the user — persistence is
 * granted on engagement heuristics (bookmarked, installed, high engagement).
 * So eviction is a real path, not a hypothetical one, and the editor said
 * nothing about it.
 *
 * Empty in every other case, deliberately: a file that was not kept already has
 * its own sentence, and a browser that never answered gives the user nothing to
 * act on. This is a hint, not a banner — the whole point is that it appears
 * only when it is true.
 */
export function evictionNote(
  stored: boolean,
  outcome: PersistenceOutcome,
): string {
  if (!stored || outcome !== 'refused') return '';
  return ' · 저장 공간이 부족해지면 이 브라우저가 영상을 지울 수 있어요. 원본 파일은 지우지 말고 그대로 두세요.';
}

let evictionWarned = false;

/**
 * The same sentence, but **at most once per page load**.
 *
 * A refusal is not the rare case — it is the DEFAULT for a first-time visitor,
 * because the heuristics that grant persistence (bookmarked, installed, high
 * engagement) take days to earn. Appending it to every import would put a
 * warning on the end of every success message a beginner ever sees, five times
 * over while they assemble one edit from five clips, and the thing they would
 * learn is to stop reading the status line.
 *
 * Page-lifetime state rather than a React ref: StrictMode mounts twice in
 * development, and a ref would let the second mount say it again.
 */
export function takeEvictionNote(
  stored: boolean,
  outcome: PersistenceOutcome,
): string {
  const note = evictionNote(stored, outcome);
  if (!note || evictionWarned) return '';
  evictionWarned = true;
  return note;
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
