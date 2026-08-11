import { describe, it, expect } from 'vitest';
import { buildAudioSchedule } from './audioSchedule';
import { createProject } from './project';
import { createEditor } from './command';
import { FPS_30 } from './time';
import type { Clip, Project } from './types';

function seed(frames = 90): Project {
  const p = createProject();
  const c: Clip = {
    id: 'clip_1',
    assetId: 'asset_1',
    startFrame: 0,
    inFrame: 0,
    outFrame: frames,
  };
  return {
    ...p,
    nextId: 2,
    timeline: { ...p.timeline, fps: FPS_30 },
    tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips: [c] } : t)),
  };
}

describe('audio schedule', () => {
  it('is empty for an empty timeline', () => {
    expect(buildAudioSchedule(createProject(), 0)).toEqual([]);
  });

  it('schedules one segment for an untouched clip', () => {
    const s = buildAudioSchedule(seed(90), 0);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      assetId: 'asset_1',
      whenSec: 0,
      offsetSec: 0,
    });
    expect(s[0].durationSec).toBeCloseTo(3, 6); // 90 frames @30fps
  });

  it('starts mid-clip when playback starts mid-timeline', () => {
    const s = buildAudioSchedule(seed(90), 30); // start at 1s
    expect(s).toHaveLength(1);
    expect(s[0].whenSec).toBe(0); // immediately
    expect(s[0].offsetSec).toBeCloseTo(1, 6); // 1s into the source
    expect(s[0].durationSec).toBeCloseTo(2, 6); // 2s remaining
  });

  it('follows a cut: audio skips the deleted material', () => {
    const ed = createEditor(seed(90));
    ed.setPlayhead(30);
    ed.dispatch('clip.split'); // [0,30) [30,90)
    ed.select(
      ed.project.tracks.find((t) => t.type === 'video')!.clips[0].id,
    );
    ed.dispatch('clip.deleteRipple'); // drop the first second

    const s = buildAudioSchedule(ed.project, 0);
    expect(s).toHaveLength(1);
    expect(s[0].whenSec).toBe(0);
    expect(s[0].offsetSec).toBeCloseTo(1, 6); // source starts 1s in
    expect(s[0].durationSec).toBeCloseTo(2, 6);
  });

  it('keeps two pieces separate after a split (no overlap, no gap)', () => {
    const ed = createEditor(seed(90));
    ed.setPlayhead(30);
    ed.dispatch('clip.split');
    const s = buildAudioSchedule(ed.project, 0);
    expect(s).toHaveLength(2);
    expect(s[0].whenSec).toBe(0);
    expect(s[0].durationSec).toBeCloseTo(1, 6);
    expect(s[1].whenSec).toBeCloseTo(1, 6); // exactly where the first ends
    expect(s[1].offsetSec).toBeCloseTo(1, 6);
    expect(s[1].durationSec).toBeCloseTo(2, 6);
  });

  it('skips clips entirely before the start point', () => {
    const ed = createEditor(seed(90));
    ed.setPlayhead(30);
    ed.dispatch('clip.split');
    const s = buildAudioSchedule(ed.project, 60); // start at 2s
    expect(s).toHaveLength(1);
    expect(s[0].whenSec).toBe(0);
    expect(s[0].offsetSec).toBeCloseTo(2, 6);
    expect(s[0].durationSec).toBeCloseTo(1, 6);
  });

  it('leaves silence for a gap rather than shifting audio earlier', () => {
    const p = createProject();
    const withGap: Project = {
      ...p,
      tracks: p.tracks.map((t) =>
        t.type === 'video'
          ? {
              ...t,
              clips: [
                { id: 'c1', assetId: 'a1', startFrame: 0, inFrame: 0, outFrame: 30 },
                { id: 'c2', assetId: 'a1', startFrame: 60, inFrame: 0, outFrame: 30 },
              ],
            }
          : t,
      ),
    };
    const s = buildAudioSchedule(withGap, 0);
    expect(s).toHaveLength(2);
    expect(s[0].whenSec).toBe(0);
    expect(s[1].whenSec).toBeCloseTo(2, 6); // 60 frames @30fps — the gap is kept
  });
});
