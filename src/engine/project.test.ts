// framewright — the project factory. A new document carries every list the
// rest of the engine indexes, already present and empty: nothing downstream
// should ever have to ask "does this one have the list yet".

import { describe, it, expect } from 'vitest';
import { createProject } from './project';

describe('createProject', () => {
  it('starts with an empty words list AND an empty images list', () => {
    const p = createProject();
    expect(p.subtitles).toEqual([]);
    expect(p.images).toEqual([]);
  });

  it('starts the deterministic id counter at 1, never a clock', () => {
    expect(createProject().nextId).toBe(1);
  });
});
