// framewright — one word, one meaning.
//
// Five controls used to say 자르기 / 잘라내기 and they meant three different
// things: putting a clip on the clipboard (`clip.cut`), dragging a clip's edge
// (`clip.trimStart` / `clip.trimEnd`), and trimming to the playhead (Q / W).
// Someone who wants to "앞의 30초를 없애기" had no way to tell which one to
// press, and `✂` (split) next to `✁` (cut) is the same glyph at toolbar size.
//
// The words are partitioned now: **잘라내기 belongs to the clipboard alone**,
// trimming borrows the nudges' 늘리기 / 줄이기, and splitting keeps 나누기.
//
// This file guards the ENGINE half only — `BUILTIN_COMMANDS`. The app actions
// (`clip.cut`, `clip.copy`, undo/redo …) live in `ui/actions.ts` behind the
// store singleton and cannot be imported in Node, so a collision between an
// action and a command is caught one layer out, by the toolbar and shortcut-list
// scans in `e2e/personas.spec.ts`. Neither half is sufficient alone; say so
// rather than let this file's name imply a coverage it does not have.
import { describe, expect, it } from 'vitest';
import { BUILTIN_COMMANDS, describeEdit } from './commands';
import { createProject } from './project';
import type { Clip, Project } from './types';

function byId(id: string) {
  const cmd = BUILTIN_COMMANDS.find((c) => c.id === id);
  if (!cmd) throw new Error(`no such command: ${id}`);
  return cmd;
}

/** Two 50-frame clips with `gap` empty frames between them. */
function pair(gap: number): Project {
  const p = createProject();
  const first: Clip = {
    id: 'clip_1',
    assetId: 'asset_1',
    startFrame: 0,
    inFrame: 0,
    outFrame: 50,
  };
  const second: Clip = { ...first, id: 'clip_2', startFrame: 50 + gap };
  return {
    ...p,
    nextId: 3,
    tracks: p.tracks.map((t) =>
      t.type === 'video' ? { ...t, clips: [first, second] } : t,
    ),
  };
}

describe('label vocabulary', () => {
  it('leaves the clipboard word to the clipboard', () => {
    const offenders = BUILTIN_COMMANDS.filter((c) => /자르|잘라/.test(c.label));
    expect(offenders.map((c) => `${c.id}: ${c.label}`)).toEqual([]);
  });

  it('uses one verb for trimming, however the trim was asked for', () => {
    // Q/W and the one-frame nudges are the same edit at different sizes, so a
    // reader of the shortcut list should see them as one family.
    expect(byId('clip.trimStartToPlayhead').label).toContain('줄이기');
    expect(byId('clip.headShrink').label).toContain('줄이기');
    expect(byId('clip.trimEndToPlayhead').label).toContain('줄이기');
    expect(byId('clip.tailShrink').label).toContain('줄이기');
  });

  it('keeps splitting a word of its own', () => {
    expect(byId('clip.split').label).toBe('나누기');
  });

  it('never lets one name be, or contain, another', () => {
    // Compared BY POSITION. Filtering with `l !== label` would let two commands
    // carrying the identical string cancel each other out and pass.
    const labels = BUILTIN_COMMANDS.map((c) => c.label);
    const collisions: string[] = [];
    labels.forEach((label, i) => {
      labels.forEach((other, j) => {
        if (i !== j && other.includes(label)) {
          collisions.push(
            `${BUILTIN_COMMANDS[i].id} ⊂ ${BUILTIN_COMMANDS[j].id}`,
          );
        }
      });
    });
    expect(collisions).toEqual([]);
  });
});

describe('what an edit says it did', () => {
  it('hedges only when the caller could not say which way it went', () => {
    // A drag handle runs both ways, so 조절 is the honest word until told.
    expect(describeEdit('trimEnd', pair(0), 'clip_1')).toContain('조절했어요');
    expect(describeEdit('trimEnd', pair(0), 'clip_1', 80)).toContain(
      '줄였어요',
    );
    expect(describeEdit('trimEnd', pair(0), 'clip_1', 20)).toContain(
      '늘렸어요',
    );
    // Ending where it started is not a direction.
    expect(describeEdit('trimEnd', pair(0), 'clip_1', 50)).toContain(
      '조절했어요',
    );
  });

  it('reports the hole a trim of the TAIL opens behind the clip', () => {
    // W (and a tail drag) can only ever leave the gap on the far side, and it
    // used to say nothing at all — a keyboard user had no way to learn it.
    expect(describeEdit('trimEnd', pair(10), 'clip_1', 60)).toContain(
      '뒤에 빈 곳이 생겼어요',
    );
  });

  it('never blames a trim for a hole it could not have opened', () => {
    // Trimming the head cannot put a gap behind the clip; the one in this
    // fixture was already there, and calling it "생겼어요" is a lie.
    expect(describeEdit('trimStart', pair(10), 'clip_1', 60)).not.toContain(
      '빈 곳',
    );
  });
});

describe('toolbar icons', () => {
  const shown = BUILTIN_COMMANDS.filter((c) => !c.hidden);

  it('never repeats a glyph, because a toolbar is read by shape', () => {
    const icons = shown.map((c) => c.icon).filter(Boolean);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('leaves the scissors to the clipboard cut', () => {
    // ✂ is what every OS puts on Ctrl+X; framewright's split had taken it, so
    // the two most destructive-looking buttons on the toolbar were twins.
    const scissors = BUILTIN_COMMANDS.filter(
      (c) => c.icon === '✂' || c.icon === '✁',
    );
    expect(scissors.map((c) => c.id)).toEqual([]);
  });
});
