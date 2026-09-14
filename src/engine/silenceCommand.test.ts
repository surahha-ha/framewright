// framewright — 조용한 부분 없애기 as a command (ADR-0016).
//
// The arithmetic is `silence.test.ts`'s. What this file pins is the command's
// contract with the editor: it can only run when there is something to cut
// and says why otherwise, it is ONE undo step however many places it cuts,
// its sentence counts the places and the seconds, and the peaks reach it
// through the editor rather than through arguments — so a button, a palette
// row and a key all get the same answer.
import { describe, expect, it } from 'vitest';
import { createEditor } from './command';
import { createProject } from './project';
import { buildPyramid, type Pyramid } from './waveform';
import { timelineDuration, videoTrack } from './timeline';
import type { Clip, Project } from './types';
import { cutSilenceCommand } from './silenceCommand';

const SR = 48000;

function tone(sec: number): Float32Array {
  const n = Math.round(sec * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++)
    out[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / SR);
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** 1 s sound · 1.2 s quiet · 0.8 s sound — one cut of 24 frames at 30 fps. */
const ONE_GAP = buildPyramid(
  [concat(tone(1), new Float32Array(57600), tone(0.8))],
  SR,
);
/** Two 1 s gaps in 5 s — two cuts of 18 frames each. */
const TWO_GAPS = buildPyramid(
  [
    concat(
      tone(1),
      new Float32Array(48000),
      tone(1),
      new Float32Array(48000),
      tone(1),
    ),
  ],
  SR,
);
const NO_GAP = buildPyramid([tone(3)], SR);

function project(clips: Clip[]): Project {
  const p = createProject();
  return {
    ...p,
    nextId: 10,
    assets: [
      { id: 'asset_1', kind: 'video', name: 'a.mp4', meta: { durationSec: 3 } },
      { id: 'asset_2', kind: 'video', name: 'b.mp4', meta: { durationSec: 5 } },
    ],
    tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips } : t)),
  };
}

const clip = (
  id: string,
  startFrame: number,
  assetId: string,
  length: number,
  extra: Partial<Clip> = {},
): Clip => ({
  id,
  assetId,
  startFrame,
  inFrame: 0,
  outFrame: length,
  ...extra,
});

function editorWith(clips: Clip[], peaks: Record<string, Pyramid | null>) {
  const ed = createEditor(project(clips));
  ed.setPeaksSource((assetId) => peaks[assetId] ?? null);
  return ed;
}

const ID = 'timeline.cutSilence';
const reason = (ed: ReturnType<typeof createEditor>) =>
  cutSilenceCommand.disabledReason!(ed.context());
const said = (ed: ReturnType<typeof createEditor>, before = ed.context()) =>
  (cutSilenceCommand.done as (b: unknown, a: unknown) => string)(
    before,
    ed.context(),
  );

describe('timeline.cutSilence', () => {
  it('is registered, labelled in the family of 없애기, with no default key', () => {
    const ed = createEditor(createProject());
    const cmd = ed.commands().find((c) => c.id === ID);
    expect(cmd).toBeDefined();
    expect(cmd!.label).toBe('조용한 부분 없애기');
    expect(cmd!.defaultKey).toBeUndefined();
    expect(cmd!.hidden).toBeFalsy();
  });

  it('refuses an empty project and says to import first', () => {
    const ed = createEditor(createProject());
    expect(ed.canRun(ID)).toBe(false);
    expect(reason(ed)).toBe('먼저 영상을 불러오세요.');
  });

  it('waits for the peaks, and says so, when none have arrived', () => {
    const ed = editorWith([clip('clip_1', 0, 'asset_1', 90)], {});
    expect(ed.canRun(ID)).toBe(false);
    expect(reason(ed)).toBe(
      '소리를 아직 읽는 중이에요 · 잠시 뒤 다시 눌러 주세요.',
    );
  });

  it('waits the same way when no peaks source is wired at all', () => {
    const ed = createEditor(project([clip('clip_1', 0, 'asset_1', 90)]));
    expect(ed.canRun(ID)).toBe(false);
    expect(reason(ed)).toBe(
      '소리를 아직 읽는 중이에요 · 잠시 뒤 다시 눌러 주세요.',
    );
  });

  it('refuses when nothing is quiet for long enough', () => {
    const ed = editorWith([clip('clip_1', 0, 'asset_1', 90)], {
      asset_1: NO_GAP,
    });
    expect(ed.canRun(ID)).toBe(false);
    expect(reason(ed)).toBe('0.5초 넘게 조용한 부분이 없어요.');
  });

  it('refuses when every clip has its sound off, and says that is why', () => {
    const ed = editorWith([clip('clip_1', 0, 'asset_1', 90, { muted: true })], {
      asset_1: ONE_GAP,
    });
    expect(ed.canRun(ID)).toBe(false);
    expect(reason(ed)).toBe(
      '소리를 끈 클립은 건너뛰어요 · 소리를 다시 켜면 그 클립의 조용한 부분도 찾아요.',
    );
  });

  it('cuts, says how many places and how much time, and undoes in one step', () => {
    const ed = editorWith([clip('clip_1', 0, 'asset_1', 90)], {
      asset_1: ONE_GAP,
    });
    const before = ed.context();
    expect(ed.canRun(ID)).toBe(true);
    expect(ed.dispatch(ID)).toBe(true);
    expect(timelineDuration(ed.project)).toBe(66);
    expect(
      videoTrack(ed.project).clips.map((c) => [
        c.id,
        c.startFrame,
        c.inFrame,
        c.outFrame,
      ]),
    ).toEqual([
      ['clip_1', 0, 0, 36],
      ['clip_10', 36, 60, 90],
    ]);
    expect(said(ed, before)).toBe(
      '조용한 부분 1곳을 없앴어요 · 0.8초 짧아졌어요 · 앞뒤 0.2초씩은 남겨 뒀어요.',
    );

    expect(ed.undo()).toBe(true);
    expect(ed.project).toEqual(before.project);
    expect(ed.canUndo()).toBe(false);
    expect(ed.redo()).toBe(true);
    expect(timelineDuration(ed.project)).toBe(66);
  });

  it('counts every place across every clip in the one sentence', () => {
    const ed = editorWith(
      [clip('clip_1', 0, 'asset_1', 90), clip('clip_2', 90, 'asset_2', 150)],
      { asset_1: ONE_GAP, asset_2: TWO_GAPS },
    );
    const before = ed.context();
    expect(ed.dispatch(ID)).toBe(true);
    expect(timelineDuration(ed.project)).toBe(240 - 24 - 36);
    expect(said(ed, before)).toBe(
      '조용한 부분 3곳을 없앴어요 · 2초 짧아졌어요 · 앞뒤 0.2초씩은 남겨 뒀어요.',
    );
    expect(ed.undo()).toBe(true);
    expect(ed.project).toEqual(before.project);
  });

  it('cuts what it can and says which clips it had to skip', () => {
    const ed = editorWith(
      [clip('clip_1', 0, 'asset_1', 90), clip('clip_2', 90, 'asset_2', 150)],
      { asset_1: ONE_GAP },
    );
    const before = ed.context();
    expect(ed.canRun(ID)).toBe(true);
    expect(ed.dispatch(ID)).toBe(true);
    expect(said(ed, before)).toBe(
      '조용한 부분 1곳을 없앴어요 · 0.8초 짧아졌어요 · 앞뒤 0.2초씩은 남겨 뒀어요 · 소리를 아직 읽는 중인 클립은 건너뛰었어요 · 잠시 뒤 다시 누르면 찾아요.',
    );
  });

  it('says it is still reading when the measured clips have nothing but others are pending', () => {
    const ed = editorWith(
      [clip('clip_1', 0, 'asset_1', 90), clip('clip_2', 90, 'asset_2', 150)],
      { asset_1: NO_GAP },
    );
    expect(ed.canRun(ID)).toBe(false);
    expect(reason(ed)).toBe(
      '소리를 아직 읽는 중이에요 · 잠시 뒤 다시 눌러 주세요.',
    );
  });

  it('keeps the playhead inside the shorter timeline', () => {
    const ed = editorWith([clip('clip_1', 0, 'asset_1', 90)], {
      asset_1: ONE_GAP,
    });
    ed.setPlayhead(89);
    ed.dispatch(ID);
    expect(ed.playhead).toBe(65);
  });

  it('keeps the selection on a clip that survives, drops one that does not', () => {
    const ed = editorWith(
      [
        clip('clip_1', 0, 'asset_1', 36),
        clip('clip_2', 36, 'asset_1', 15, { inFrame: 40, outFrame: 55 }),
      ],
      { asset_1: ONE_GAP },
    );
    ed.select('clip_2');
    expect(ed.dispatch(ID)).toBe(true);
    expect(ed.selectedClipId).toBeNull();
    ed.undo();
    ed.select('clip_1');
    ed.redo();
    expect(ed.selectedClipId).toBe('clip_1');
  });
});
