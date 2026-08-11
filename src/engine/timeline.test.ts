import { describe, it, expect } from 'vitest';
import { clipLength, timelineDuration, resolveAt } from './timeline';
import { createProject } from './project';
import type { Clip, Project } from './types';

function clip(id: string, startFrame: number, inFrame: number, outFrame: number): Clip {
  return { id, assetId: 'a1', startFrame, inFrame, outFrame };
}

function withClips(...clips: Clip[]): Project {
  const p = createProject();
  return {
    ...p,
    tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips } : t)),
  };
}

describe('timeline', () => {
  it('clipLength uses half-open [in, out)', () => {
    expect(clipLength(clip('c1', 0, 0, 30))).toBe(30);
    expect(clipLength(clip('c1', 0, 10, 40))).toBe(30);
  });

  it('timelineDuration spans the last clip end', () => {
    expect(timelineDuration(withClips(clip('c1', 0, 0, 30)))).toBe(30);
    expect(
      timelineDuration(withClips(clip('c1', 0, 0, 30), clip('c2', 30, 30, 100))),
    ).toBe(100);
    expect(timelineDuration(createProject())).toBe(0);
  });

  it('resolveAt maps a timeline frame to the source frame', () => {
    const p = withClips(clip('c1', 0, 100, 130));
    expect(resolveAt(p, 0)?.sourceFrame).toBe(100);
    expect(resolveAt(p, 29)?.sourceFrame).toBe(129);
  });

  it('resolveAt respects the half-open end (no off-by-one)', () => {
    const p = withClips(clip('c1', 0, 0, 30));
    expect(resolveAt(p, 29)).not.toBeNull();
    expect(resolveAt(p, 30)).toBeNull();
  });

  it('resolveAt returns null inside a gap', () => {
    const p = withClips(clip('c1', 0, 0, 30), clip('c2', 60, 0, 30));
    expect(resolveAt(p, 45)).toBeNull();
    expect(resolveAt(p, 60)?.clip.id).toBe('c2');
  });
});
