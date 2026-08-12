// framewright — where saved work lives.
//
// Behind an interface on purpose (ADR-0004, local-first / sync-ready): today it
// is browser storage, later a server document store drops in without touching
// callers. Only the small JSON document is stored — media stays out of it.

import type { Project } from './types';
import {
  deserialize,
  pruneVersions,
  serialize,
  type PersistedState,
  type Version,
} from './persistence';

export interface SaveResult {
  ok: boolean;
  /** What was actually persisted — the caller must adopt this so the UI never
   *  lists versions that are not really saved. */
  versions: Version[];
  /** True when another tab has written since we loaded: we refuse to overwrite. */
  conflict?: boolean;
  error?: string;
}

export interface ProjectRepository {
  load(): PersistedState | null;
  save(
    project: Project,
    versions: Version[],
    generation: number,
  ): SaveResult;
  /** Generation currently on disk (0 when nothing is stored). */
  storedGeneration(): number;
  clear(): void;
}

export const STORAGE_KEY = 'framewright:project';
const MAX_AUTO_VERSIONS = 10;
const MAX_MANUAL_VERSIONS = 20;

function storage(): Storage | null {
  try {
    const s = (globalThis as any).localStorage as Storage | undefined;
    if (!s) return null;
    // Some privacy modes expose localStorage but throw on write.
    const probe = '__framewright_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function isStorageAvailable(): boolean {
  return storage() !== null;
}

export function createLocalRepository(): ProjectRepository {
  const read = (): PersistedState | null => {
    const s = storage();
    if (!s) return null;
    try {
      const raw = s.getItem(STORAGE_KEY);
      return raw ? deserialize(raw) : null;
    } catch {
      return null;
    }
  };

  return {
    load: read,

    storedGeneration() {
      return read()?.generation ?? 0;
    },

    save(project, versions, generation) {
      const s = storage();
      if (!s) {
        return {
          ok: false,
          versions,
          error: '이 브라우저에서는 저장할 수 없어요. (비공개 모드일 수 있어요)',
        };
      }

      // Another tab wrote after we loaded — overwriting would erase work we
      // never saw. Refuse and let the caller tell the user.
      const current = read();
      if (current && current.generation > generation) {
        return {
          ok: false,
          versions,
          conflict: true,
          error:
            '다른 탭에서 저장한 내용이 있어서 덮어쓰지 않았어요. 한 탭만 열어 주세요.',
        };
      }

      const pruned = pruneVersions(
        versions,
        MAX_AUTO_VERSIONS,
        MAX_MANUAL_VERSIONS,
      );
      try {
        s.setItem(STORAGE_KEY, serialize(project, pruned, generation + 1));
        return { ok: true, versions: pruned };
      } catch {
        // Out of space. Keep the CURRENT document — that is the thing you cannot
        // afford to lose — and shed history oldest-automatic-first.
        const manualOnly = pruned.filter((v) => v.kind === 'manual');
        for (const attempt of [manualOnly, [] as Version[]]) {
          try {
            s.setItem(STORAGE_KEY, serialize(project, attempt, generation + 1));
            return {
              ok: true,
              versions: attempt,
              error:
                attempt.length > 0
                  ? '저장 공간이 부족해 자동 기록을 정리했어요.'
                  : '저장 공간이 부족해 이전 기록을 모두 정리했어요.',
            };
          } catch {
            /* try the next, smaller payload */
          }
        }
        return {
          ok: false,
          versions,
          error: '저장 공간이 부족해 저장하지 못했어요. 브라우저 저장 공간을 비워 주세요.',
        };
      }
    },

    clear() {
      try {
        storage()?.removeItem(STORAGE_KEY);
      } catch {
        /* nothing to do */
      }
    },
  };
}
