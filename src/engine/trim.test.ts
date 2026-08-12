import { describe, it, expect } from 'vitest';
import { createEditor } from './command';
import { trimLimits } from './commands';
import { createProject } from './project';
import { clipLength, snapFrame, timelineDuration } from './timeline';
import type { Clip, Project } from './types';

/** One 100-frame clip taken from the middle of a 300-frame source. */
function seed(): Project {
  const p = createProject();
  const clip: Clip = {
    id: 'clip_1',
    assetId: 'asset_1',
    startFrame: 0,
    inFrame: 50,
    outFrame: 150,
  };
  return {
    ...p,
    nextId: 2,
    assets: [
      {
        id: 'asset_1',
        kind: 'video',
        name: 'a.mp4',
        meta: { durationSec: 10 }, // 300 frames at 30fps
      },
    ],
    tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips: [clip] } : t)),
  };
}

const clips = (p: Project) => p.tracks.find((t) => t.type === 'video')!.clips;

describe('trim limits', () => {
  it('is bounded by the media and by the start of the timeline', () => {
    const limits = trimLimits(seed(), 'clip_1')!;
    expect(limits.minStart).toBe(0); // nothing exists before frame 0
    expect(limits.maxStart).toBe(99); // must keep at least one frame
    expect(limits.minEnd).toBe(1);
    expect(limits.maxEnd).toBe(250); // 150 frames of tail remain in the source
  });

  it('lets the head reach back into unused source when there is room', () => {
    // Same clip, but parked at frame 100: its 50 unused head frames are now
    // reachable, so the start may go back to 50 and no further.
    const base = seed();
    const parked: Project = {
      ...base,
      tracks: base.tracks.map((t) =>
        t.type === 'video'
          ? { ...t, clips: [{ ...clips(base)[0], startFrame: 100 }] }
          : t,
      ),
    };
    const limits = trimLimits(parked, 'clip_1')!;
    expect(limits.minStart).toBe(50);
  });

  it('is bounded by neighbours', () => {
    const base = seed();
    const withNeighbours: Project = {
      ...base,
      tracks: base.tracks.map((t) =>
        t.type === 'video'
          ? {
              ...t,
              clips: [
                { id: 'left', assetId: 'asset_1', startFrame: 0, inFrame: 0, outFrame: 10 },
                { ...clips(base)[0], startFrame: 20 },
                { id: 'right', assetId: 'asset_1', startFrame: 200, inFrame: 0, outFrame: 10 },
              ],
            }
          : t,
      ),
    };
    const limits = trimLimits(withNeighbours, 'clip_1')!;
    expect(limits.minStart).toBe(10); // cannot pass the left clip's end
    expect(limits.maxEnd).toBe(200); // cannot pass the right clip's start
  });
});

describe('clip.trimStart', () => {
  it('moves the in-point with the start, leaving the tail where it was', () => {
    const ed = createEditor(seed());
    const before = clips(ed.project)[0];
    const beforeEnd = before.startFrame + clipLength(before);

    expect(ed.dispatch('clip.trimStart', { clipId: 'clip_1', frame: 20 })).toBe(
      true,
    );

    const after = clips(ed.project)[0];
    expect(after.startFrame).toBe(20);
    expect(after.inFrame).toBe(70); // 50 + 20
    expect(after.outFrame).toBe(150); // untouched
    expect(after.startFrame + clipLength(after)).toBe(beforeEnd);
  });

  it('refuses to trim away the last frame', () => {
    const ed = createEditor(seed());
    ed.dispatch('clip.trimStart', { clipId: 'clip_1', frame: 500 });
    expect(clipLength(clips(ed.project)[0])).toBeGreaterThanOrEqual(1);
  });

  it('is undoable', () => {
    const ed = createEditor(seed());
    const before = JSON.stringify(ed.project);
    ed.dispatch('clip.trimStart', { clipId: 'clip_1', frame: 20 });
    ed.undo();
    expect(JSON.stringify(ed.project)).toBe(before);
  });
});

describe('clip.trimEnd', () => {
  it('extends only as far as the source allows', () => {
    const ed = createEditor(seed());
    ed.dispatch('clip.trimEnd', { clipId: 'clip_1', frame: 9999 });
    const c = clips(ed.project)[0];
    expect(c.outFrame).toBe(300); // the whole source, no further
    expect(c.inFrame).toBe(50); // head untouched
    expect(timelineDuration(ed.project)).toBe(250);
  });

  it('shortens without moving the head', () => {
    const ed = createEditor(seed());
    ed.dispatch('clip.trimEnd', { clipId: 'clip_1', frame: 40 });
    const c = clips(ed.project)[0];
    expect(c.startFrame).toBe(0);
    expect(clipLength(c)).toBe(40);
  });
});

describe('clip.move', () => {
  it('slides the clip without touching its media', () => {
    const ed = createEditor(seed());
    ed.dispatch('clip.move', { clipId: 'clip_1', startFrame: 60 });
    const c = clips(ed.project)[0];
    expect(c.startFrame).toBe(60);
    expect(c.inFrame).toBe(50);
    expect(c.outFrame).toBe(150);
  });

  it('never goes before zero and never overlaps a neighbour', () => {
    const base = seed();
    const two: Project = {
      ...base,
      tracks: base.tracks.map((t) =>
        t.type === 'video'
          ? {
              ...t,
              clips: [
                clips(base)[0],
                { id: 'right', assetId: 'asset_1', startFrame: 150, inFrame: 0, outFrame: 20 },
              ],
            }
          : t,
      ),
    };
    const ed = createEditor(two);
    ed.dispatch('clip.move', { clipId: 'clip_1', startFrame: -50 });
    expect(clips(ed.project)[0].startFrame).toBe(0);

    ed.dispatch('clip.move', { clipId: 'clip_1', startFrame: 9999 });
    const moved = clips(ed.project)[0];
    expect(moved.startFrame + clipLength(moved)).toBeLessThanOrEqual(150);
  });

  it('a drag that lands where it started is not an undo step', () => {
    const ed = createEditor(seed());
    expect(ed.dispatch('clip.move', { clipId: 'clip_1', startFrame: 0 })).toBe(
      false,
    );
    expect(ed.canUndo()).toBe(false);
  });
});

describe('unknown source duration', () => {
  it('can be shortened but never extended', () => {
    const base = seed();
    // No durationSec: the file's length could not be measured.
    const blind: Project = {
      ...base,
      assets: [{ id: 'asset_1', kind: 'video', name: 'a.mp4', meta: {} }],
    };
    const limits = trimLimits(blind, 'clip_1')!;
    expect(limits.maxEnd).toBe(100); // exactly where it already ends

    const ed = createEditor(blind);
    expect(ed.dispatch('clip.trimEnd', { clipId: 'clip_1', frame: 9999 })).toBe(
      false,
    );
    expect(ed.dispatch('clip.trimEnd', { clipId: 'clip_1', frame: 40 })).toBe(
      true,
    );
  });
});

describe('trim to the playhead (Q / W)', () => {
  it('needs the playhead inside the clip, past its first frame', () => {
    const ed = createEditor(seed());
    expect(ed.canRun('clip.trimStartToPlayhead')).toBe(false); // playhead at 0
    ed.setPlayhead(30);
    expect(ed.canRun('clip.trimStartToPlayhead')).toBe(true);
    expect(ed.canRun('clip.trimEndToPlayhead')).toBe(true);
  });

  it('Q cuts the head off at the playhead, W cuts the tail', () => {
    const q = createEditor(seed());
    q.setPlayhead(30);
    expect(q.dispatch('clip.trimStartToPlayhead')).toBe(true);
    expect(clips(q.project)[0].startFrame).toBe(30);
    expect(clips(q.project)[0].inFrame).toBe(80); // 50 + 30

    const w = createEditor(seed());
    w.setPlayhead(30);
    expect(w.dispatch('clip.trimEndToPlayhead')).toBe(true);
    expect(clipLength(clips(w.project)[0])).toBe(30);
  });
});

describe('coalesced nudges', () => {
  it('a held key is one undo step, two separate presses are two', () => {
    const ed = createEditor(seed());
    ed.dispatch('clip.move', { clipId: 'clip_1', startFrame: 1 }, 'nudge');
    ed.dispatch('clip.move', { clipId: 'clip_1', startFrame: 2 }, 'nudge');
    ed.dispatch('clip.move', { clipId: 'clip_1', startFrame: 3 }, 'nudge');
    expect(clips(ed.project)[0].startFrame).toBe(3);

    ed.undo();
    // One undo goes back to the start of the gesture, not one frame.
    expect(clips(ed.project)[0].startFrame).toBe(0);
    expect(ed.canUndo()).toBe(false);
  });

  it('releasing the key ends the gesture', () => {
    const ed = createEditor(seed());
    ed.dispatch('clip.move', { clipId: 'clip_1', startFrame: 4 }, 'nudge');
    ed.endCoalesce(); // key up
    ed.dispatch('clip.move', { clipId: 'clip_1', startFrame: 8 }, 'nudge');
    ed.undo();
    expect(clips(ed.project)[0].startFrame).toBe(4);
    ed.undo();
    expect(clips(ed.project)[0].startFrame).toBe(0);
  });

  it('an uncoalesced edit between presses starts a new entry', () => {
    const ed = createEditor(seed());
    ed.dispatch('clip.move', { clipId: 'clip_1', startFrame: 5 }, 'nudge');
    ed.dispatch('clip.move', { clipId: 'clip_1', startFrame: 9 }); // discrete
    ed.dispatch('clip.move', { clipId: 'clip_1', startFrame: 12 }, 'nudge');
    ed.undo();
    expect(clips(ed.project)[0].startFrame).toBe(9);
    ed.undo();
    expect(clips(ed.project)[0].startFrame).toBe(5);
  });

  it('redo replays a coalesced gesture as a whole', () => {
    const ed = createEditor(seed());
    ed.dispatch('clip.move', { clipId: 'clip_1', startFrame: 1 }, 'nudge');
    ed.dispatch('clip.move', { clipId: 'clip_1', startFrame: 7 }, 'nudge');
    ed.undo();
    ed.redo();
    expect(clips(ed.project)[0].startFrame).toBe(7);
  });
});

describe('timeline.closeGaps', () => {
  /** Two clips with a 30-frame hole between them. */
  function withGap(): Project {
    const base = seed();
    return {
      ...base,
      tracks: base.tracks.map((t) =>
        t.type === 'video'
          ? {
              ...t,
              clips: [
                clips(base)[0], // 0..100
                {
                  id: 'right',
                  assetId: 'asset_1',
                  startFrame: 130,
                  inFrame: 0,
                  outFrame: 20,
                },
              ],
            }
          : t,
      ),
    };
  }

  it('is unavailable when the timeline is already tight', () => {
    const ed = createEditor(seed());
    expect(ed.canRun('timeline.closeGaps')).toBe(false);
    expect(ed.dispatch('timeline.closeGaps')).toBe(false);
  });

  it('pulls later clips left without changing any clip length', () => {
    const ed = createEditor(withGap());
    const lengths = clips(ed.project).map(clipLength);
    expect(ed.dispatch('timeline.closeGaps')).toBe(true);

    const after = clips(ed.project);
    expect(after[0].startFrame).toBe(0);
    expect(after[1].startFrame).toBe(100);
    expect(after.map(clipLength)).toEqual(lengths);
    expect(timelineDuration(ed.project)).toBe(120);
  });

  it('is undoable', () => {
    const ed = createEditor(withGap());
    const before = JSON.stringify(ed.project);
    ed.dispatch('timeline.closeGaps');
    ed.undo();
    expect(JSON.stringify(ed.project)).toBe(before);
  });
});

describe('snapFrame', () => {
  it('snaps to the nearest target inside the threshold', () => {
    expect(snapFrame(98, [100, 40], 5)).toBe(100);
    expect(snapFrame(98, [100, 97], 5)).toBe(97); // nearest wins
  });

  it('leaves the value alone when nothing is close', () => {
    expect(snapFrame(50, [100, 200], 5)).toBe(50);
  });

  it('handles an empty target list', () => {
    expect(snapFrame(50, [], 5)).toBe(50);
  });
});
