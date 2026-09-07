import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  evictionNote,
  liveMediaKeys,
  mediaKeyFor,
  queueMediaWork,
  sweepMedia,
  takeEvictionNote,
  type MediaRepository,
} from './mediaStore';
import type { Project } from './types';
import type { Version } from './persistence';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

function project(assets: Array<{ id: string; opfsKey?: string }>): Project {
  return {
    id: 'p1',
    name: 'p',
    schemaVersion: 1,
    nextId: 1,
    timeline: { fps: { num: 30, den: 1 }, width: 1920, height: 1080 },
    tracks: [{ id: 'v1', type: 'video', clips: [] }],
    subtitles: [],
    assets: assets.map((a) => ({
      id: a.id,
      kind: 'video' as const,
      name: `${a.id}.mp4`,
      opfsKey: a.opfsKey,
      meta: {},
    })),
  };
}

/** In-memory stand-in for OPFS: the sweep must be testable in Node. */
function fakeRepo(keys: string[]): MediaRepository & { store: Set<string> } {
  const store = new Set(keys);
  return {
    store,
    available: true,
    async put(key) {
      store.add(key);
      return true;
    },
    async get(key) {
      return store.has(key) ? new ArrayBuffer(0) : null;
    },
    async has(key) {
      return store.has(key);
    },
    async remove(key) {
      store.delete(key);
    },
    async keys() {
      return [...store];
    },
  };
}

describe('mediaKeyFor — content addressing', () => {
  it('is the content hash, so the same file always lands on the same key', async () => {
    const a = await mediaKeyFor(bytes('same bytes'));
    const b = await mediaKeyFor(bytes('same bytes'));
    expect(a).toBe(b);
  });

  it('separates different content', async () => {
    expect(await mediaKeyFor(bytes('a'))).not.toBe(
      await mediaKeyFor(bytes('b')),
    );
  });

  it('is a known SHA-256, so a stored key survives an implementation change', async () => {
    // Standard vectors: a key that silently changed would orphan every file
    // already written, and the user would be asked to re-link for no reason.
    expect(await mediaKeyFor(new ArrayBuffer(0))).toBe(
      'media_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(await mediaKeyFor(bytes('abc'))).toBe(
      'media_ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('liveMediaKeys — what is still referenced', () => {
  const version = (id: string, p: Project): Version => ({
    id,
    kind: 'auto',
    ts: 0,
    project: p,
  });

  it('collects the current document', () => {
    const keys = liveMediaKeys(project([{ id: 'a1', opfsKey: 'media_x' }]), []);
    expect([...keys]).toEqual(['media_x']);
  });

  it('ignores assets that were never persisted', () => {
    expect(liveMediaKeys(project([{ id: 'a1' }]), []).size).toBe(0);
  });

  it('keeps what only a saved version still points at', () => {
    // Restoring a version brings its assets back. Deleting their media because
    // the CURRENT document dropped them would make that restore a dead end.
    const keys = liveMediaKeys(project([{ id: 'a1', opfsKey: 'media_now' }]), [
      version('v1', project([{ id: 'a0', opfsKey: 'media_old' }])),
    ]);
    expect([...keys].sort()).toEqual(['media_now', 'media_old']);
  });

  it('counts one file once, however many clips or versions use it', () => {
    const keys = liveMediaKeys(
      project([
        { id: 'a1', opfsKey: 'media_x' },
        { id: 'a2', opfsKey: 'media_x' },
      ]),
      [version('v1', project([{ id: 'a3', opfsKey: 'media_x' }]))],
    );
    expect([...keys]).toEqual(['media_x']);
  });
});

describe('queueMediaWork — the races this serialises', () => {
  it('runs work in the order it was asked for, never overlapping', async () => {
    const log: string[] = [];
    const slow = (name: string, ticks: number) => async () => {
      log.push(`${name}:start`);
      for (let i = 0; i < ticks; i++) await Promise.resolve();
      log.push(`${name}:end`);
    };
    await Promise.all([
      queueMediaWork(slow('a', 5)),
      queueMediaWork(slow('b', 1)),
      queueMediaWork(slow('c', 3)),
    ]);
    expect(log).toEqual([
      'a:start',
      'a:end',
      'b:start',
      'b:end',
      'c:start',
      'c:end',
    ]);
  });

  it('a sweep cannot decide what is live while an import is committing', async () => {
    // The defect this exists for: the sweep snapshots the live key set, then
    // awaits. An import that lands in that window writes its file, and the
    // sweep — judging by a snapshot taken before the asset existed — deletes
    // it. Nothing fails that session; the next reload calls it an eviction.
    const repo = fakeRepo(['media_old']);
    const live = new Set<string>();
    const importFile = () =>
      queueMediaWork(async () => {
        await repo.put('media_new', new ArrayBuffer(0));
        live.add('media_new'); // the document now points at it
      });
    const sweep = () => queueMediaWork(() => sweepMedia(repo, new Set(live)));

    const importing = importFile();
    const swept = sweep();
    await Promise.all([importing, swept]);
    expect(repo.store.has('media_new')).toBe(true);
    expect(await swept).toEqual(['media_old']);
  });

  it('keeps running after a failure, and still rejects for that caller', async () => {
    const boom = queueMediaWork(async () => {
      throw new Error('nope');
    });
    const after = queueMediaWork(async () => 'ran');
    await expect(boom).rejects.toThrow('nope');
    expect(await after).toBe('ran');
  });
});

describe('sweepMedia — reclaiming space', () => {
  it('deletes only what nothing references any more', async () => {
    const repo = fakeRepo(['media_keep', 'media_drop']);
    const removed = await sweepMedia(repo, new Set(['media_keep']));
    expect(removed).toEqual(['media_drop']);
    expect([...repo.store]).toEqual(['media_keep']);
  });

  it('never touches a key it does not own', async () => {
    // The directory is shared with nothing today, but a stray file must not be
    // deleted on a guess — only keys this module minted are ours.
    const repo = fakeRepo(['media_drop', 'somebody-elses-file']);
    const removed = await sweepMedia(repo, new Set());
    expect(removed).toEqual(['media_drop']);
    expect(repo.store.has('somebody-elses-file')).toBe(true);
  });

  it('is a no-op when everything is still in use', async () => {
    const repo = fakeRepo(['media_a', 'media_b']);
    expect(await sweepMedia(repo, new Set(['media_a', 'media_b']))).toEqual([]);
  });
});

describe('telling the user their media can be evicted', () => {
  // Measured 2026-08-14: `navigator.storage.persist()` returns false on the dev
  // origin and Chrome never asks. So "the browser lost your file" is a real
  // path, and the editor said nothing about it until now.

  it('says so when the file was kept but the browser refused to protect it', () => {
    const note = evictionNote(true, 'refused');
    expect(note).not.toBe('');
    // It has to name the thing the user can actually do about it.
    expect(note).toContain('원본');
  });

  it('stays quiet when the browser agreed to keep it', () => {
    expect(evictionNote(true, 'granted')).toBe('');
  });

  it('stays quiet when the browser never answered', () => {
    // No `navigator.storage.persist` at all. A warning nobody can act on, about
    // a promise nobody made, is noise.
    expect(evictionNote(true, 'unknown')).toBe('');
  });

  it('stays quiet when the file was not kept in the first place', () => {
    // That case already has its own sentence ("다시 선택해야 해요"). Two
    // warnings about one file read as two separate problems.
    expect(evictionNote(false, 'refused')).toBe('');
  });

  it('says it once per page load, not once per file', () => {
    // A refusal is the DEFAULT for a first-time visitor, so "append it to every
    // import" would put a warning on the end of every success message a
    // beginner ever sees — five clips, five identical warnings, and what they
    // learn is to stop reading the status line.
    //
    // One `it` on purpose: the flag is page-lifetime state, so the sequence IS
    // the assertion.
    expect(takeEvictionNote(false, 'refused')).toBe(''); // not stored: spends nothing
    expect(takeEvictionNote(true, 'granted')).toBe(''); // no refusal: spends nothing
    expect(takeEvictionNote(true, 'refused')).toBe(
      evictionNote(true, 'refused'),
    );
    expect(takeEvictionNote(true, 'refused')).toBe('');
  });

  it('starts with a separator, because it is glued onto another sentence', () => {
    // Its only callers concatenate it straight onto the import's own line. Drop
    // the leading ' · ' and two sentences run together with nothing between
    // them — which neither a "contains 원본" check nor the e2e substring would
    // notice.
    expect(evictionNote(true, 'refused').startsWith(' · ')).toBe(true);
  });
});

describe('asking the browser to stop evicting us', () => {
  /** A fresh module: the answer is page-lifetime state, so each case needs its
   *  own page. `vi.resetModules` beats a reset export that only tests would use. */
  async function freshStore(storage: unknown) {
    vi.resetModules();
    vi.stubGlobal('navigator', { storage });
    return import('./mediaStore');
  }

  afterEach(() => vi.unstubAllGlobals());

  it('reports what the browser said', async () => {
    const store = await freshStore({
      persisted: async () => false,
      persist: async () => false,
    });
    expect(await store.requestPersistentStorage()).toBe('refused');
    expect(store.persistenceOutcome()).toBe('refused');
  });

  it('does not ask again when the origin is already persistent', async () => {
    let asked = 0;
    const store = await freshStore({
      persisted: async () => true,
      persist: async () => {
        asked++;
        return true;
      },
    });
    expect(await store.requestPersistentStorage()).toBe('granted');
    expect(asked).toBe(0);
  });

  it('says unknown — not refused — when there is no such API', async () => {
    // No promise either way is not the same as a refusal, and the difference is
    // whether the user gets told their file may vanish.
    const store = await freshStore({});
    expect(await store.requestPersistentStorage()).toBe('unknown');
  });

  it('says unknown when the browser throws', async () => {
    const store = await freshStore({
      persisted: async () => {
        throw new Error('nope');
      },
      persist: async () => true,
    });
    expect(await store.requestPersistentStorage()).toBe('unknown');
  });

  it('asks once even when two callers arrive at the same moment', async () => {
    // The in-flight promise is what is cached. Caching the settled value would
    // let both callers through, ask the browser twice, and race to write the
    // answer — a refusal could be overwritten by whatever landed last.
    let asked = 0;
    const store = await freshStore({
      persisted: async () => false,
      persist: async () => {
        asked++;
        return false;
      },
    });
    const both = await Promise.all([
      store.requestPersistentStorage(),
      store.requestPersistentStorage(),
    ]);
    expect(both).toEqual(['refused', 'refused']);
    expect(asked).toBe(1);
  });

  it('answers unknown until something has actually asked', async () => {
    const store = await freshStore({
      persisted: async () => false,
      persist: async () => false,
    });
    expect(store.persistenceOutcome()).toBe('unknown');
  });
});
