// framewright — a clip's sound level (ADR-0013).
import { describe, expect, it } from 'vitest';
import {
  VOLUME_MAX,
  audioNoteText,
  clipLevel,
  describeMute,
  describeVolume,
  percentToVolume,
  volumePercent,
  volumeText,
} from './volume';
import type { Clip } from './types';

const clip = (extra: Partial<Clip> = {}): Clip => ({
  id: 'a',
  assetId: 'asset_1',
  startFrame: 0,
  inFrame: 0,
  outFrame: 60,
  ...extra,
});

describe('clipLevel', () => {
  it('is as recorded when nothing is said', () => {
    expect(clipLevel(clip())).toBe(1);
  });

  it('is the volume when there is one', () => {
    expect(clipLevel(clip({ volume: 0.5 }))).toBe(0.5);
    expect(clipLevel(clip({ volume: 1.5 }))).toBe(1.5);
  });

  it('is silence when muted, whatever the volume says', () => {
    expect(clipLevel(clip({ muted: true }))).toBe(0);
    expect(clipLevel(clip({ muted: true, volume: 1.5 }))).toBe(0);
  });

  it('never trusts a document past the range the panel offers', () => {
    expect(clipLevel(clip({ volume: 9 }))).toBe(VOLUME_MAX);
    expect(clipLevel(clip({ volume: -1 }))).toBe(0);
    expect(clipLevel(clip({ volume: Number.NaN }))).toBe(1);
  });
});

describe('percent ↔ volume', () => {
  it('rounds to whole percent both ways', () => {
    expect(volumePercent(1)).toBe(100);
    expect(volumePercent(0.35)).toBe(35);
    expect(volumePercent(1.234)).toBe(123);
    expect(percentToVolume(35)).toBe(0.35);
    expect(percentToVolume(100)).toBe(1);
    expect(percentToVolume(150)).toBe(1.5);
  });

  it('clamps a percent to what a clip may hold', () => {
    expect(percentToVolume(500)).toBe(VOLUME_MAX);
    expect(percentToVolume(-5)).toBe(0);
    expect(percentToVolume(Number.NaN)).toBe(1);
  });

  it('writes a percent the way a first-time user reads one', () => {
    expect(volumeText(1)).toBe('100%');
    expect(volumeText(0.5)).toBe('50%');
    expect(volumeText(2)).toBe('200%');
  });
});

describe('what the edit says', () => {
  it('names the direction, and the level it landed on', () => {
    expect(describeVolume(1, 1.5)).toBe('소리를 150%로 키웠어요.');
    expect(describeVolume(1, 0.5)).toBe('소리를 50%로 줄였어요.');
  });

  it('calls a return to 100% what it is', () => {
    expect(describeVolume(0.5, 1)).toBe('소리를 원래 크기로 되돌렸어요.');
    expect(describeVolume(1.5, 1)).toBe('소리를 원래 크기로 되돌렸어요.');
  });

  it('says out loud that 0% is silence', () => {
    expect(describeVolume(1, 0)).toBe('소리를 0%로 줄였어요 · 들리지 않아요.');
  });

  it('says what a mute did', () => {
    expect(describeMute(true)).toBe('소리를 껐어요 · 이 클립은 들리지 않아요.');
    expect(describeMute(false)).toBe('소리를 다시 켰어요.');
  });
});

describe('the strip’s words for the sound', () => {
  it('says nothing for a clip as recorded', () => {
    expect(audioNoteText(clip())).toBe('');
    expect(audioNoteText(clip({ volume: 1 }))).toBe('');
  });

  it('says the level when it is not the recorded one', () => {
    expect(audioNoteText(clip({ volume: 0.5 }))).toBe('소리 50%');
  });

  it('says muted, and only muted, when muted', () => {
    expect(audioNoteText(clip({ muted: true, volume: 0.5 }))).toBe('소리 끔');
  });
});
