// framewright — what the app knows about an asset's SOUND, as opposed to its
// samples.
//
// Decoding needs a real `AudioContext` and is covered in `e2e/`. This is the
// small registry around it, and it exists because of a distinction that is
// invisible until someone looks at a clip: "no audio buffer" is two different
// situations. A source still decoding has none yet; a screen recording made
// without a microphone will never have one. Drawn the same way, the first looks
// permanently broken and the second looks permanently unfinished.
import { afterEach, describe, expect, it } from 'vitest';
import {
  getAudioBuffer,
  hasNoAudioTrack,
  markNoAudioTrack,
  retainOnlyAudio,
  setAudioBuffer,
} from './audio';

/** An AudioBuffer in the only respect this registry touches: its identity. */
const fakeBuffer = () => ({}) as unknown as AudioBuffer;

afterEach(() => retainOnlyAudio([]));

describe('knowing that an asset has no sound', () => {
  it('says nothing until someone has actually looked', () => {
    expect(hasNoAudioTrack('a1')).toBe(false);
    expect(getAudioBuffer('a1')).toBeNull();
  });

  it('remembers the verdict once the file has been opened', () => {
    markNoAudioTrack('a1');
    expect(hasNoAudioTrack('a1')).toBe(true);
  });

  it('is cancelled by audio actually arriving', () => {
    // A re-link keeps the asset id, so the previous file's verdict must not
    // outlive it: a clip whose new file HAS sound would otherwise keep saying
    // it has none, in the strip and to a screen reader both.
    markNoAudioTrack('a1');
    setAudioBuffer('a1', fakeBuffer());
    expect(hasNoAudioTrack('a1')).toBe(false);
  });

  it('never contradicts a buffer that is already bound', () => {
    setAudioBuffer('a1', fakeBuffer());
    markNoAudioTrack('a1');
    expect(hasNoAudioTrack('a1')).toBe(false);
  });

  it('is forgotten with the asset it belongs to', () => {
    markNoAudioTrack('a1');
    markNoAudioTrack('a2');
    retainOnlyAudio(['a2']);
    expect(hasNoAudioTrack('a1')).toBe(false);
    expect(hasNoAudioTrack('a2')).toBe(true);
  });

  it('keeps each asset’s answer to itself', () => {
    markNoAudioTrack('a1');
    setAudioBuffer('a2', fakeBuffer());
    expect(hasNoAudioTrack('a1')).toBe(true);
    expect(hasNoAudioTrack('a2')).toBe(false);
  });
});
