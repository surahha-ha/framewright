// framewright — persistence (pure).
// The project is plain JSON, so saving is cheap and versions are just snapshots.
// No clock in here: callers pass timestamps (the engine must stay deterministic
// and Node-testable — see CLAUDE.md).

import type { Project } from './types';

/**
 * 1 → 2: the document gained a `subtitles` list. An older file simply has none,
 * so reading it means filling the list in — see `upgradeProject`.
 */
export const CURRENT_SCHEMA = 2;

export interface Version {
  id: string;
  label?: string;
  kind: 'auto' | 'manual';
  /** epoch ms, supplied by the caller */
  ts: number;
  project: Project;
}

export interface PersistedState {
  schemaVersion: number;
  project: Project;
  versions: Version[];
  /** Increments on every write. Lets a second tab notice it would clobber work
   *  it never saw — silent cross-tab overwrite is the worst way to lose a day. */
  generation: number;
}

export function serialize(
  project: Project,
  versions: Version[],
  generation: number,
): string {
  const state: PersistedState = {
    schemaVersion: CURRENT_SCHEMA,
    project,
    versions,
    generation,
  };
  return JSON.stringify(state);
}

function looksLikeProject(value: unknown): value is Project {
  const p = value as Project | null;
  return (
    !!p &&
    typeof p === 'object' &&
    Array.isArray(p.tracks) &&
    Array.isArray(p.assets) &&
    !!p.timeline &&
    typeof p.nextId === 'number'
  );
}

/**
 * Bring a document written by an older schema up to the current one. Every
 * project that comes out of `deserialize` — the live one AND every version's
 * snapshot — goes through here, so nothing downstream has to ask "does this
 * one have the list yet".
 */
export function upgradeProject(project: Project): Project {
  return Array.isArray(project.subtitles)
    ? project
    : { ...project, subtitles: [] };
}

/**
 * Read saved state. Returns null (never throws) for anything we cannot trust —
 * losing an autosave is bad, but loading a corrupted document is worse.
 */
export function deserialize(raw: string): PersistedState | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const state = parsed as PersistedState | null;
  if (!state || typeof state !== 'object') return null;
  if (typeof state.schemaVersion !== 'number') return null;
  // Written by a newer build: refuse rather than silently mangle it.
  if (state.schemaVersion > CURRENT_SCHEMA) return null;
  if (!looksLikeProject(state.project)) return null;
  const versions = Array.isArray(state.versions)
    ? state.versions
        .filter((v) => v && looksLikeProject(v.project))
        .map((v) => ({ ...v, project: upgradeProject(v.project) }))
    : [];
  return {
    schemaVersion: state.schemaVersion,
    project: upgradeProject(state.project),
    versions,
    generation: typeof state.generation === 'number' ? state.generation : 0,
  };
}

/**
 * Keep the newest `maxAuto` automatic versions and the newest `maxManual` named
 * ones. Automatic snapshots are dropped first: a name means the user asked for
 * that state to survive.
 */
export function pruneVersions(
  versions: Version[],
  maxAuto: number,
  maxManual = 20,
): Version[] {
  const newestFirst = (a: Version, b: Version) => b.ts - a.ts;
  const keep = new Set([
    ...versions
      .filter((v) => v.kind === 'auto')
      .sort(newestFirst)
      .slice(0, maxAuto)
      .map((v) => v.id),
    ...versions
      .filter((v) => v.kind === 'manual')
      .sort(newestFirst)
      .slice(0, maxManual)
      .map((v) => v.id),
  ]);
  return versions.filter((v) => keep.has(v.id));
}

/**
 * Take an automatic snapshot only when time has passed AND something actually
 * changed — otherwise idle sessions fill the history with identical entries.
 */
export function shouldAutoSnapshot(
  lastSnapshotTs: number | null,
  nowTs: number,
  intervalMs: number,
  editsSinceLast: number,
): boolean {
  if (editsSinceLast <= 0) return false;
  if (lastSnapshotTs === null) return true;
  return nowTs - lastSnapshotTs >= intervalMs;
}
