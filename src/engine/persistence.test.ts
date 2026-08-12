import { describe, it, expect } from 'vitest';
import {
  serialize,
  deserialize,
  pruneVersions,
  shouldAutoSnapshot,
  CURRENT_SCHEMA,
  type Version,
} from './persistence';
import { createProject } from './project';
import { createEditor } from './command';

function edited() {
  const ed = createEditor(createProject());
  ed.importAsset({ kind: 'video', name: 'a.mp4', meta: {} }, 90);
  ed.setPlayhead(30);
  ed.dispatch('clip.split');
  return ed.project;
}

function version(id: string, kind: 'auto' | 'manual', ts: number): Version {
  return { id, kind, ts, project: createProject() };
}

describe('serialize / deserialize', () => {
  it('round-trips a project exactly', () => {
    const project = edited();
    const restored = deserialize(serialize(project, [], 1));
    expect(restored).not.toBeNull();
    expect(restored!.project).toEqual(project);
  });

  it('round-trips versions', () => {
    const versions = [version('v1', 'manual', 100), version('v2', 'auto', 200)];
    const restored = deserialize(serialize(createProject(), versions, 1));
    expect(restored!.versions).toHaveLength(2);
    expect(restored!.versions[0].kind).toBe('manual');
  });

  it('carries a generation, defaulting to 0 for older data', () => {
    expect(deserialize(serialize(createProject(), [], 7))!.generation).toBe(7);
    const legacy = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA,
      project: createProject(),
      versions: [],
    });
    expect(deserialize(legacy)!.generation).toBe(0);
  });

  it('returns null for junk instead of throwing', () => {
    expect(deserialize('')).toBeNull();
    expect(deserialize('not json')).toBeNull();
    expect(deserialize('{"nope":1}')).toBeNull();
    expect(deserialize('null')).toBeNull();
  });

  it('refuses data written by a NEWER app version rather than corrupting it', () => {
    const raw = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA + 1,
      project: createProject(),
      versions: [],
    });
    expect(deserialize(raw)).toBeNull();
  });
});

describe('pruneVersions', () => {
  it('sheds automatic snapshots before named ones', () => {
    const versions = [
      version('a', 'manual', 1),
      version('b', 'auto', 2),
      version('c', 'auto', 3),
      version('d', 'auto', 4),
    ];
    const kept = pruneVersions(versions, 2);
    expect(kept.filter((v) => v.kind === 'manual')).toHaveLength(1);
    expect(kept.filter((v) => v.kind === 'auto')).toHaveLength(2);
  });

  it('also caps named versions, keeping the newest', () => {
    // Unbounded manual versions were what drove storage into the quota wall.
    const versions = [
      version('m1', 'manual', 1),
      version('m2', 'manual', 2),
      version('m3', 'manual', 3),
    ];
    const kept = pruneVersions(versions, 5, 2).map((v) => v.id);
    expect(kept).toEqual(expect.arrayContaining(['m3', 'm2']));
    expect(kept).not.toContain('m1');
  });

  it('keeps the NEWEST auto snapshots', () => {
    const versions = [
      version('old', 'auto', 1),
      version('mid', 'auto', 2),
      version('new', 'auto', 3),
    ];
    const kept = pruneVersions(versions, 2).map((v) => v.id);
    expect(kept).toContain('new');
    expect(kept).toContain('mid');
    expect(kept).not.toContain('old');
  });

  it('is a no-op when under the limit', () => {
    const versions = [version('a', 'auto', 1)];
    expect(pruneVersions(versions, 5)).toHaveLength(1);
  });
});

describe('shouldAutoSnapshot', () => {
  const MIN = 60_000;

  it('waits for both enough time AND real edits', () => {
    // edits but no time passed
    expect(shouldAutoSnapshot(1000, 1000 + 5_000, MIN, 10)).toBe(false);
    // time passed but nothing changed
    expect(shouldAutoSnapshot(1000, 1000 + MIN + 1, MIN, 0)).toBe(false);
    // both
    expect(shouldAutoSnapshot(1000, 1000 + MIN + 1, MIN, 1)).toBe(true);
  });

  it('takes the first snapshot as soon as there is an edit', () => {
    expect(shouldAutoSnapshot(null, 1000, MIN, 1)).toBe(true);
    expect(shouldAutoSnapshot(null, 1000, MIN, 0)).toBe(false);
  });
});
