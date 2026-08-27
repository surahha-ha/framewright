// framewright — the peak cache behind the waveform.
//
// The reduction itself is specified in `src/engine/waveform.test.ts`. This is
// the half that can be wrong without looking wrong, and it is the same shape of
// wrong the thumbnail cache had: peaks built from one file, kept under an asset
// id, and then drawn under a clip that now points at a different file. A stale
// waveform does not throw and does not look broken — it looks like the audio.
//
// It runs in Node because the only browser-shaped thing involved reaches this
// module through one seam: `engine/audio`'s buffer registry, which takes any
// object with `sampleRate`, `numberOfChannels` and `getChannelData`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { retainOnlyAudio, setAudioBuffer } from '../engine/audio';
import { BASE_BUCKET } from '../engine/waveform';
import {
  getPeaks,
  releasePeaks,
  requestPeaks,
  retainOnlyPeaks,
  subscribeWaveforms,
} from './waveform';

/** An AudioBuffer in the only three respects this module touches, plus a count
 *  of how often its samples were actually walked. */
function fakeBuffer(peak: number, samples = BASE_BUCKET * 4, channels = 1) {
  const data = new Float32Array(samples);
  // One spike per channel-full, so two different buffers are told apart by the
  // number that comes back out of the pyramid.
  data[1] = peak;
  const buffer = {
    reads: 0,
    sampleRate: 48_000,
    numberOfChannels: channels,
    length: samples,
    getChannelData(_c: number) {
      buffer.reads++;
      return data;
    },
  };
  return buffer;
}

type Fake = ReturnType<typeof fakeBuffer>;

function bind(assetId: string, buffer: Fake): void {
  setAudioBuffer(assetId, buffer as unknown as AudioBuffer);
}

/** Let the pump's yield run. It waits one macrotask per asset. */
async function settle(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  retainOnlyPeaks([]);
  retainOnlyAudio([]);
});

afterEach(() => {
  retainOnlyPeaks([]);
  retainOnlyAudio([]);
});

describe('peaks are reduced once and then remembered', () => {
  it('reduces on the first ask and serves the cache on the second', async () => {
    const buffer = fakeBuffer(0.5);
    bind('a1', buffer);

    expect(getPeaks('a1')).toBeNull(); // a lookup never starts work
    expect(buffer.reads).toBe(0);

    requestPeaks('a1');
    await settle();

    const peaks = getPeaks('a1');
    expect(peaks).not.toBeNull();
    expect(peaks!.levels[0].max[0]).toBeCloseTo(0.5, 6);
    expect(buffer.reads).toBe(1);

    requestPeaks('a1');
    requestPeaks('a1');
    await settle();
    expect(buffer.reads).toBe(1);
    expect(getPeaks('a1')).toBe(peaks); // the same object, not an equal one
  });

  it('does nothing at all for an asset with no audio bound', async () => {
    requestPeaks('nothing-here');
    await settle();
    expect(getPeaks('nothing-here')).toBeNull();
  });

  it('asks again once the audio does arrive', async () => {
    requestPeaks('late');
    await settle();
    expect(getPeaks('late')).toBeNull();

    const buffer = fakeBuffer(0.25);
    bind('late', buffer);
    requestPeaks('late');
    await settle();
    expect(getPeaks('late')).not.toBeNull();
  });

  it('remembers a track with no samples instead of reducing it forever', async () => {
    const empty = fakeBuffer(0, 0);
    bind('silent', empty);
    requestPeaks('silent');
    await settle();

    const peaks = getPeaks('silent');
    expect(peaks).not.toBeNull();
    expect(peaks!.levels).toHaveLength(0);

    requestPeaks('silent');
    await settle();
    expect(empty.reads).toBe(1);
  });

  it('reduces several assets, each from its own audio', async () => {
    bind('a1', fakeBuffer(0.5));
    bind('a2', fakeBuffer(0.9));
    requestPeaks('a1');
    requestPeaks('a2');
    await settle();

    expect(getPeaks('a1')!.levels[0].max[0]).toBeCloseTo(0.5, 6);
    expect(getPeaks('a2')!.levels[0].max[0]).toBeCloseTo(0.9, 6);
  });
});

describe('peaks never outlive the audio they came from', () => {
  it('drops them the moment the asset points at a different buffer', async () => {
    const first = fakeBuffer(0.5);
    bind('a1', first);
    requestPeaks('a1');
    await settle();
    expect(getPeaks('a1')).not.toBeNull();

    // A re-link: same asset id, a new file, a new AudioBuffer under it.
    bind('a1', fakeBuffer(0.9));
    expect(getPeaks('a1')).toBeNull();
  });

  it('rebuilds from the NEW audio after a re-link', async () => {
    bind('a1', fakeBuffer(0.5));
    requestPeaks('a1');
    await settle();

    bind('a1', fakeBuffer(0.9));
    requestPeaks('a1');
    await settle();
    expect(getPeaks('a1')!.levels[0].max[0]).toBeCloseTo(0.9, 6);
  });

  it('reduces the audio that is current when the queue reaches it, not when it was asked for', async () => {
    // The pump yields before it reads the buffer, so an asset re-linked while
    // it was waiting is reduced from the file it points at NOW.
    const stale = fakeBuffer(0.5);
    bind('a1', stale);
    requestPeaks('a1');
    bind('a1', fakeBuffer(0.9));
    await settle();

    expect(getPeaks('a1')!.levels[0].max[0]).toBeCloseTo(0.9, 6);
    expect(stale.reads).toBe(0);
  });

  it('refuses to reduce the audio of a file that is being replaced', async () => {
    // The window `releasePeaks` exists for, and the way it can defeat itself.
    // `bindMedia` swaps the decoder and releases the peaks BEFORE it decodes the
    // new audio, so at that moment `getAudioBuffer` still answers with the OLD
    // buffer. `releasePeaks` notifies, every clip re-renders, and the re-render
    // asks again — which would reduce the file that is being replaced and cache
    // it as current, because by identity it IS current.
    const stale = fakeBuffer(0.5);
    bind('a1', stale);
    requestPeaks('a1');
    await settle();
    expect(getPeaks('a1')).not.toBeNull();
    const readsBefore = stale.reads;

    releasePeaks('a1');
    requestPeaks('a1');
    await settle();
    expect(getPeaks('a1')).toBeNull();
    expect(stale.reads).toBe(readsBefore);

    // ...and the moment the new audio lands, the refusal lifts by itself.
    bind('a1', fakeBuffer(0.9));
    requestPeaks('a1');
    await settle();
    expect(getPeaks('a1')!.levels[0].max[0]).toBeCloseTo(0.9, 6);
  });

  it('refuses it even when the ask is already in the queue', async () => {
    const stale = fakeBuffer(0.5);
    bind('a1', stale);
    requestPeaks('a1');
    releasePeaks('a1');
    await settle();
    expect(stale.reads).toBe(0);
    expect(getPeaks('a1')).toBeNull();
  });

  it('forgets one asset on demand, and leaves the others alone', async () => {
    bind('a1', fakeBuffer(0.5));
    bind('a2', fakeBuffer(0.9));
    requestPeaks('a1');
    requestPeaks('a2');
    await settle();

    releasePeaks('a1');
    expect(getPeaks('a1')).toBeNull();
    expect(getPeaks('a2')).not.toBeNull();
  });

  it('forgets the assets that left the document', async () => {
    bind('a1', fakeBuffer(0.5));
    bind('a2', fakeBuffer(0.9));
    requestPeaks('a1');
    requestPeaks('a2');
    await settle();

    retainOnlyPeaks(['a2']);
    // The audio is still bound, so a null here is the cache having dropped it
    // rather than the identity check firing.
    expect(getPeaks('a1')).toBeNull();
    expect(getPeaks('a2')).not.toBeNull();
  });

  it('drops a queued asset that leaves before it is reduced', async () => {
    const buffer = fakeBuffer(0.5);
    bind('a1', buffer);
    requestPeaks('a1');
    retainOnlyPeaks([]);
    await settle();
    expect(buffer.reads).toBe(0);
    expect(getPeaks('a1')).toBeNull();
  });
});

describe('telling the strip that peaks have arrived', () => {
  it('notifies once when they land, and stops on unsubscribe', async () => {
    let calls = 0;
    const stop = subscribeWaveforms(() => calls++);

    bind('a1', fakeBuffer(0.5));
    requestPeaks('a1');
    await settle();
    expect(calls).toBeGreaterThan(0);

    const seen = calls;
    stop();
    bind('a2', fakeBuffer(0.9));
    requestPeaks('a2');
    await settle();
    expect(calls).toBe(seen);
  });
});

describe('a reduction that goes wrong', () => {
  /** An AudioBuffer whose samples cannot be read at all. */
  function brokenBuffer() {
    const buffer = {
      attempts: 0,
      sampleRate: 48_000,
      numberOfChannels: 1,
      length: BASE_BUCKET,
      getChannelData(_c: number): Float32Array {
        buffer.attempts++;
        throw new Error('this buffer cannot be read');
      },
    };
    return buffer;
  }

  it('does not take the editor down, and does not retry forever', async () => {
    // `pump` is started as `void pump()`, so anything that escapes it is an
    // unhandled rejection: nothing reaches the user, and the next render asks
    // again, and again, for as long as the clip is on screen.
    const bad = brokenBuffer();
    bind('bad', bad as unknown as Fake);
    requestPeaks('bad');
    await settle();
    expect(getPeaks('bad')).toBeNull();
    expect(bad.attempts).toBe(1);

    requestPeaks('bad');
    requestPeaks('bad');
    await settle();
    expect(bad.attempts).toBe(1);
  });

  it('tries again for a DIFFERENT file under the same asset', async () => {
    const bad = brokenBuffer();
    bind('bad', bad as unknown as Fake);
    requestPeaks('bad');
    await settle();

    // A file that could not be read says nothing about the one replacing it.
    bind('bad', fakeBuffer(0.7));
    requestPeaks('bad');
    await settle();
    expect(getPeaks('bad')!.levels[0].max[0]).toBeCloseTo(0.7, 6);
  });

  it('keeps reducing the other assets after one of them fails', async () => {
    bind('bad', brokenBuffer() as unknown as Fake);
    bind('good', fakeBuffer(0.6));
    requestPeaks('bad');
    requestPeaks('good');
    await settle(6);
    expect(getPeaks('good')).not.toBeNull();
  });
});
