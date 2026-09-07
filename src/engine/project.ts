// framewright — project factory.
import type { Project, Rational } from './types';
import { FPS_30 } from './time';

export function createProject(
  fps: Rational = FPS_30,
  width = 1280,
  height = 720,
): Project {
  return {
    id: 'proj_1',
    name: 'Untitled',
    schemaVersion: 1,
    nextId: 1,
    timeline: { fps, width, height },
    tracks: [
      { id: 'v1', type: 'video', clips: [] },
      { id: 'a1', type: 'audio', clips: [] },
    ],
    assets: [],
    subtitles: [],
  };
}
