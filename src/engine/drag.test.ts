import { describe, it, expect } from 'vitest';
import {
  dragBounds,
  dragCommand,
  dragTargets,
  limitHit,
  planDrag,
  previewGeometry,
} from './drag';
import { createProject } from './project';
import type { Clip, Project } from './types';

/** A 100-frame clip from a 300-frame source, optionally with a neighbour. */
function build(clips: Clip[]): Project {
  const p = createProject();
  return {
    ...p,
    nextId: 10,
    assets: [
      { id: 'asset_1', kind: 'video', name: 'a.mp4', meta: { durationSec: 10 } },
    ],
    tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips } : t)),
  };
}

const main: Clip = {
  id: 'clip_1',
  assetId: 'asset_1',
  startFrame: 0,
  inFrame: 50,
  outFrame: 150,
};

describe('dragTargets', () => {
  it('never offers an edge the clip already sits on', () => {
    // A lone clip owns both 0 and the timeline end, so there is nothing to snap
    // to — otherwise every nudge would spring back home.
    expect(dragTargets(build([main]), 'clip_1', 'move', 0)).toEqual([]);
  });

  it('offers the playhead when trimming, but not when moving', () => {
    const p = build([main]);
    expect(dragTargets(p, 'clip_1', 'trimEnd', 40)).toContain(40);
    expect(dragTargets(p, 'clip_1', 'move', 40)).not.toContain(40);
  });

  it('offers a neighbour’s edges', () => {
    const right: Clip = {
      id: 'right',
      assetId: 'asset_1',
      startFrame: 200,
      inFrame: 0,
      outFrame: 20,
    };
    const targets = dragTargets(build([main, right]), 'clip_1', 'move', 0);
    expect(targets).toContain(200);
    expect(targets).toContain(220);
  });
});

describe('dragBounds', () => {
  it('stops a move at zero and at the next clip', () => {
    const right: Clip = {
      id: 'right',
      assetId: 'asset_1',
      startFrame: 150,
      inFrame: 0,
      outFrame: 20,
    };
    const b = dragBounds(build([main, right]), 'clip_1', 'move')!;
    expect(b.min).toBe(0);
    expect(b.max).toBe(50); // 150 - 100 frames of clip
  });

  it('is null for a clip that is not there', () => {
    expect(dragBounds(build([main]), 'nope', 'move')).toBeNull();
  });

  it('says WHY it stopped, so the UI can explain the wall', () => {
    const right: Clip = {
      id: 'right',
      assetId: 'asset_1',
      startFrame: 150,
      inFrame: 0,
      outFrame: 20,
    };
    const p = build([main, right]);
    const move = dragBounds(p, 'clip_1', 'move')!;
    expect(move.minReason).toBe('timelineStart');
    expect(move.maxReason).toBe('neighbour');
    expect(dragBounds(p, 'clip_1', 'trimEnd')!.maxReason).toBe('neighbour');
    expect(limitHit(move.max, move)).toBe('neighbour');
    expect(limitHit(25, move)).toBe('none');
  });
});

describe('planDrag', () => {
  const base = {
    originStart: 0,
    originEnd: 100,
    targets: [] as number[],
    snapThreshold: 5,
    bounds: {
      min: 0,
      max: 1000,
      minReason: 'none',
      maxReason: 'none',
    },
  } as const;

  it('moves by the pointer delta when nothing is near', () => {
    expect(planDrag({ ...base, mode: 'move', deltaFrames: 37 })).toBe(37);
  });

  it('snaps a moving clip by its TRAILING edge too', () => {
    // Dragging right so the clip's end (100 + 47) lands near 150: the head must
    // follow to 50, not stay at 47. Without trailing-edge snapping a clip can
    // never sit flush against the one on its right.
    expect(
      planDrag({
        ...base,
        mode: 'move',
        deltaFrames: 47,
        targets: [150],
      }),
    ).toBe(50);
  });

  it('prefers the nearer of the two edges', () => {
    // The head is 2 from 40; the tail is 5 from 145. The head wins.
    expect(
      planDrag({
        ...base,
        mode: 'move',
        deltaFrames: 42,
        targets: [40, 145],
      }),
    ).toBe(40);
  });

  it('clamps inside the bounds, snap or no snap', () => {
    expect(
      planDrag({
        ...base,
        mode: 'move',
        deltaFrames: 9999,
        bounds: {
          min: 0,
          max: 60,
          minReason: 'none',
          maxReason: 'none',
        } as const,
      }),
    ).toBe(60);
    expect(
      planDrag({
        ...base,
        mode: 'move',
        deltaFrames: -9999,
        bounds: {
          min: 10,
          max: 60,
          minReason: 'none',
          maxReason: 'none',
        } as const,
      }),
    ).toBe(10);
  });

  it('anchors a trim to the edge being dragged', () => {
    expect(planDrag({ ...base, mode: 'trimStart', deltaFrames: 20 })).toBe(20);
    expect(planDrag({ ...base, mode: 'trimEnd', deltaFrames: 20 })).toBe(120);
  });
});

describe('dragCommand', () => {
  it('is null when the gesture lands where it started', () => {
    expect(dragCommand('move', 'clip_1', 0, 0, 100)).toBeNull();
    expect(dragCommand('trimStart', 'clip_1', 0, 0, 100)).toBeNull();
    expect(dragCommand('trimEnd', 'clip_1', 100, 0, 100)).toBeNull();
  });

  it('maps each mode onto its command and argument shape', () => {
    expect(dragCommand('move', 'clip_1', 20, 0, 100)).toEqual({
      id: 'clip.move',
      args: { clipId: 'clip_1', startFrame: 20 },
    });
    expect(dragCommand('trimStart', 'clip_1', 20, 0, 100)).toEqual({
      id: 'clip.trimStart',
      args: { clipId: 'clip_1', frame: 20 },
    });
    expect(dragCommand('trimEnd', 'clip_1', 80, 0, 100)).toEqual({
      id: 'clip.trimEnd',
      args: { clipId: 'clip_1', frame: 80 },
    });
  });
});

describe('previewGeometry', () => {
  it('keeps the length while moving', () => {
    expect(previewGeometry('move', 30, 0, 100)).toEqual({
      start: 30,
      length: 100,
    });
  });

  it('moves the head and shortens, leaving the tail put', () => {
    expect(previewGeometry('trimStart', 30, 0, 100)).toEqual({
      start: 30,
      length: 70,
    });
  });

  it('moves the tail only', () => {
    expect(previewGeometry('trimEnd', 60, 0, 100)).toEqual({
      start: 0,
      length: 60,
    });
  });
});
