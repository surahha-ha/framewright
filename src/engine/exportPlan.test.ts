import { describe, it, expect } from 'vitest';
import { buildExportPlan, planDuration, isContinuous } from './exportPlan';
import { createProject } from './project';
import { createEditor } from './command';
import { timelineDuration } from './timeline';
import type { Clip, Project } from './types';

function seed(frames = 100): Project {
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
    tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips: [c] } : t)),
  };
}

describe('export plan', () => {
  it('has exactly one entry per timeline frame', () => {
    const p = seed(100);
    const plan = buildExportPlan(p);
    expect(plan).toHaveLength(timelineDuration(p));
    expect(planDuration(plan)).toBe(100);
  });

  it('is empty for an empty timeline', () => {
    expect(buildExportPlan(createProject())).toHaveLength(0);
  });

  it('walks the source contiguously for an untouched clip', () => {
    const plan = buildExportPlan(seed(10));
    expect(plan.map((f) => f.sourceFrame)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(plan.every((f) => f.assetId === 'asset_1')).toBe(true);
  });

  it('skips deleted material after a cut (this is what makes an edit real)', () => {
    const ed = createEditor(seed(100));
    ed.setPlayhead(40);
    ed.dispatch('clip.split'); // [0,40) [40,100)
    ed.select(
      ed.project.tracks.find((t) => t.type === 'video')!.clips[0].id,
    );
    ed.dispatch('clip.deleteRipple'); // drop the first 40 frames

    const plan = buildExportPlan(ed.project);
    expect(plan).toHaveLength(60);
    // timeline frame 0 must now show source frame 40
    expect(plan[0].sourceFrame).toBe(40);
    expect(plan[59].sourceFrame).toBe(99);
    // timeline frames stay 0..n-1 with no holes
    expect(plan.map((f) => f.timelineFrame)).toEqual(
      Array.from({ length: 60 }, (_, i) => i),
    );
  });

  it('lets a running decoder continue across a split (no stall at cuts)', () => {
    // A split changes the clip id but not the material — keying the decode
    // session on the clip id froze playback at every cut.
    expect(isContinuous('asset_1', 39, 'asset_1', 40)).toBe(true);
    expect(isContinuous('asset_1', 39, 'asset_2', 40)).toBe(false); // other asset
    expect(isContinuous('asset_1', 80, 'asset_1', 10)).toBe(false); // backwards
    expect(isContinuous('asset_1', 10, 'asset_1', 200)).toBe(false); // long jump
    expect(isContinuous('asset_1', 10, 'asset_1', 40)).toBe(true); // short gap
    expect(isContinuous(null, -1, 'asset_1', 0)).toBe(false); // no session yet
  });

  it('marks gaps as blank frames rather than dropping them', () => {
    const p = createProject();
    const withGap: Project = {
      ...p,
      tracks: p.tracks.map((t) =>
        t.type === 'video'
          ? {
              ...t,
              clips: [
                { id: 'c1', assetId: 'a1', startFrame: 0, inFrame: 0, outFrame: 10 },
                { id: 'c2', assetId: 'a1', startFrame: 20, inFrame: 0, outFrame: 10 },
              ],
            }
          : t,
      ),
    };
    const plan = buildExportPlan(withGap);
    expect(plan).toHaveLength(30);
    expect(plan[15].assetId).toBeNull(); // gap -> blank
    expect(plan[25].sourceFrame).toBe(5);
  });
});

describe('subtitles in the plan', () => {
  it('records the words for every frame they cover, and null elsewhere', () => {
    const p: Project = {
      ...seed(10),
      subtitles: [
        { id: 'sub_1', text: '안녕', startFrame: 2, endFrame: 5 },
        { id: 'sub_2', text: '', startFrame: 7, endFrame: 9 }, // empty = nothing to burn
      ],
    };
    const plan = buildExportPlan(p);
    expect(plan.map((f) => f.subtitle)).toEqual([
      null, null, '안녕', '안녕', '안녕', null, null, null, null, null,
    ]);
  });

  it('burns a subtitle into a gap too — a hole in the picture is still time', () => {
    const p: Project = {
      ...seed(10),
      subtitles: [{ id: 'sub_1', text: '검은 화면 위 글자', startFrame: 0, endFrame: 10 }],
    };
    const ed = createEditor(p);
    ed.setPlayhead(4);
    ed.dispatch('clip.split');
    ed.select('clip_1');
    // Move the second half right to open a gap at [4, 6).
    ed.dispatch('clip.move', { clipId: 'clip_2', startFrame: 6 });
    const plan = buildExportPlan(ed.project);
    expect(plan[5].assetId).toBeNull();
    expect(plan[5].subtitle).toBe('검은 화면 위 글자');
  });
});
