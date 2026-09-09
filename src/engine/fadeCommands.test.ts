// framewright — the fade commands through the dispatcher (ADR-0012).
import { describe, expect, it } from 'vitest';
import { createEditor } from './command';
import { createProject } from './project';
import { FPS_30 } from './time';
import { videoTrack } from './timeline';
import { copyEntry } from './clipboard';
import type { Clip, Project } from './types';

function seed(clips: Clip[]): Project {
  const p = createProject(FPS_30);
  const ids = [...new Set(clips.map((c) => c.assetId))];
  return {
    ...p,
    nextId: 10,
    assets: ids.map((id) => ({
      id,
      kind: 'video' as const,
      name: `${id}.mp4`,
      meta: { durationSec: 3 },
    })),
    tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips } : t)),
  };
}

const clip = (
  id: string,
  startFrame: number,
  inFrame: number,
  outFrame: number,
  extra: Partial<Clip> = {},
): Clip => ({
  id,
  assetId: 'asset_1',
  startFrame,
  inFrame,
  outFrame,
  ...extra,
});

const clips = (ed: ReturnType<typeof createEditor>) =>
  videoTrack(ed.project).clips;

describe('clip.fadeIn / clip.fadeOut', () => {
  it('wants a clip chosen, and says so', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60)]));
    expect(ed.canRun('clip.fadeIn')).toBe(false);
    const cmd = ed.commands().find((c) => c.id === 'clip.fadeIn')!;
    expect(cmd.disabledReason!(ed.context())).toBe('클립을 먼저 골라 주세요.');
  });

  it('toggles on with half a second, and off again — one undo step each', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60)]));
    ed.select('a');
    expect(ed.dispatch('clip.fadeIn')).toBe(true);
    expect(clips(ed)[0].fadeIn).toBe(15);
    expect(ed.dispatch('clip.fadeIn')).toBe(true);
    expect('fadeIn' in clips(ed)[0]).toBe(false);
    ed.undo();
    expect(clips(ed)[0].fadeIn).toBe(15);
    ed.undo();
    // Undo puts the document back EXACTLY: no key, not a key set to undefined.
    expect('fadeIn' in clips(ed)[0]).toBe(false);
    expect(JSON.stringify(clips(ed)[0])).not.toContain('fadeIn');
  });

  it('sets an exact length when asked, on the clip named', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 60), clip('b', 60, 0, 60)]));
    expect(ed.dispatch('clip.fadeOut', { clipId: 'b', frames: 30 })).toBe(true);
    expect(clips(ed)[1].fadeOut).toBe(30);
    expect(clips(ed)[0].fadeOut).toBeUndefined();
    // Same value again is not an edit.
    expect(ed.canRun('clip.fadeOut', { clipId: 'b', frames: 30 })).toBe(false);
    // Zero turns it off.
    expect(ed.dispatch('clip.fadeOut', { clipId: 'b', frames: 0 })).toBe(true);
    expect('fadeOut' in clips(ed)[1]).toBe(false);
  });

  it('clamps to the room the other edge leaves, and says so', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 20, { fadeOut: 10 })]));
    ed.select('a');
    expect(ed.dispatch('clip.fadeIn', { frames: 30 })).toBe(true);
    expect(clips(ed)[0].fadeIn).toBe(10);
  });

  it('refuses when the other edge already takes the whole clip, and explains', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 20, { fadeOut: 20 })]));
    ed.select('a');
    expect(ed.canRun('clip.fadeIn')).toBe(false);
    const cmd = ed.commands().find((c) => c.id === 'clip.fadeIn')!;
    expect(cmd.disabledReason!(ed.context())).toBe(
      '뒷부분의 서서히 사라지기가 클립 전체를 쓰고 있어요. 그쪽을 줄이면 앞부분에도 자리가 생겨요.',
    );
  });

  it('is never a toolbar button, and is in the palette under its own name', () => {
    const ed = createEditor(seed([]));
    const fadeIn = ed.commands().find((c) => c.id === 'clip.fadeIn')!;
    const fadeOut = ed.commands().find((c) => c.id === 'clip.fadeOut')!;
    expect(fadeIn.hidden).toBe(true);
    expect(fadeOut.hidden).toBe(true);
    expect(fadeIn.label).toBe('서서히 나타나기');
    expect(fadeOut.label).toBe('서서히 사라지기');
  });
});

describe('what the other commands do with a fade', () => {
  it('split: the head keeps the fade-in, the tail keeps the fade-out, the new cut is hard', () => {
    const ed = createEditor(
      seed([clip('a', 0, 0, 60, { fadeIn: 10, fadeOut: 12 })]),
    );
    ed.setPlayhead(30);
    ed.dispatch('clip.split');
    const [head, tail] = clips(ed);
    expect(head).toMatchObject({ outFrame: 30, fadeIn: 10 });
    expect('fadeOut' in head).toBe(false);
    expect(tail).toMatchObject({ inFrame: 30, fadeOut: 12 });
    expect('fadeIn' in tail).toBe(false);
    ed.undo();
    expect(clips(ed)).toHaveLength(1);
    expect(clips(ed)[0]).toMatchObject({
      outFrame: 60,
      fadeIn: 10,
      fadeOut: 12,
    });
  });

  it('split inside a fade: each piece keeps what fits, the document says so, undo is exact', () => {
    const ed = createEditor(seed([clip('a', 0, 0, 30, { fadeIn: 20 })]));
    ed.setPlayhead(5);
    const cmd = ed.commands().find((c) => c.id === 'clip.split')!;
    const before = ed.context();
    ed.dispatch('clip.split');
    const [head, tail] = clips(ed);
    // The head is 5 frames: its fade-in is written at 5, not left at 20 for
    // the reader to clamp — the document says what the picture does.
    expect(head).toMatchObject({ outFrame: 5, fadeIn: 5 });
    expect('fadeIn' in tail).toBe(false);
    const done = cmd.done;
    expect(typeof done === 'function' ? done(before, ed.context()) : done).toBe(
      '재생 위치에서 두 개로 나눴어요 · 서서히 구간도 나뉘어 짧아졌어요.',
    );
    ed.undo();
    expect(clips(ed)[0]).toMatchObject({ outFrame: 30, fadeIn: 20 });
    // A split outside the fade says nothing of the sort.
    const outside = { ...ed.context(), playhead: 25 };
    expect(
      typeof done === 'function' ? done(outside, ed.context()) : done,
    ).toBe('재생 위치에서 두 개로 나눴어요.');
  });

  it('copy carries the fades, so a pasted clip looks like the one it came from', () => {
    const p = seed([clip('a', 0, 0, 60, { fadeIn: 10 })]);
    expect(copyEntry(p, 'a')).toEqual({
      assetId: 'asset_1',
      inFrame: 0,
      outFrame: 60,
      fadeIn: 10,
    });
    // ...and not as `fadeOut: undefined`, which would survive in memory and
    // vanish on reload.
    expect('fadeOut' in copyEntry(p, 'a')!).toBe(false);

    const ed = createEditor(p);
    ed.setClipboard(copyEntry(p, 'a'));
    ed.setPlayhead(59);
    expect(ed.dispatch('clip.paste')).toBe(true);
    const pasted = clips(ed)[1];
    expect(pasted).toMatchObject({ startFrame: 60, fadeIn: 10 });
    expect('fadeOut' in pasted).toBe(false);
  });

  it('a ripple delete takes the fade with the clip and undo brings it back', () => {
    const ed = createEditor(
      seed([clip('a', 0, 0, 30, { fadeOut: 5 }), clip('b', 30, 0, 30)]),
    );
    ed.select('a');
    ed.dispatch('clip.deleteRipple');
    expect(clips(ed)).toHaveLength(1);
    ed.undo();
    expect(clips(ed)[0]).toMatchObject({ id: 'a', fadeOut: 5 });
  });
});
