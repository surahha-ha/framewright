import { describe, it, expect } from 'vitest';
import {
  analyzeFrameRate,
  presentationSpan,
  rebaseToPresentationStart,
} from './demux';
import type { DemuxSample } from './demux';

const TS = 90000;

function sample(cts: number, dts = cts): DemuxSample {
  return {
    cts,
    dts,
    duration: 0,
    timescale: TS,
    is_sync: true,
    data: new Uint8Array(),
  };
}

// Build samples from a list of inter-frame intervals (seconds).
function fromIntervals(intervalsSec: number[]): DemuxSample[] {
  const out: DemuxSample[] = [sample(0)];
  let t = 0;
  for (const dt of intervalsSec) {
    t += dt;
    out.push(sample(Math.round(t * TS)));
  }
  return out;
}

describe('analyzeFrameRate (VFR detection)', () => {
  it('flags constant 30fps as CFR', () => {
    const r = analyzeFrameRate(fromIntervals(Array(60).fill(1 / 30)));
    expect(r.isVFR).toBe(false);
    expect(r.nominalFps).toBeCloseTo(30, 0);
  });

  it('flags irregular intervals as VFR', () => {
    const intervals: number[] = [];
    for (let i = 0; i < 60; i++) intervals.push(i % 5 === 0 ? 1 / 15 : 1 / 60);
    const r = analyzeFrameRate(fromIntervals(intervals));
    expect(r.isVFR).toBe(true);
  });

  it('is safe on too-few samples', () => {
    expect(analyzeFrameRate([sample(0)]).isVFR).toBe(false);
  });
});

/**
 * A file with B-frames and no edit list presents its first picture at a cts of
 * one reorder delay, not at zero. `e2e/fixtures/sample-h264.mp4` is exactly that
 * — first cts 1024 at timescale 15360, i.e. two frames at 30fps. Everything
 * downstream matches `frame / fps` seconds against these numbers, so unless the
 * offset is taken out here, every frame renders two early and the last two
 * frames of the media cannot be reached at all.
 */
describe('rebaseToPresentationStart', () => {
  const FIXTURE_TS = 15360;
  const FRAME = 512; // one frame at 30fps, in FIXTURE_TS units
  const OFFSET = 2 * FRAME; // 1024 — what the real fixture carries

  function shifted(count: number, offset: number): DemuxSample[] {
    return Array.from({ length: count }, (_, i) => ({
      cts: offset + i * FRAME,
      dts: offset + i * FRAME,
      duration: FRAME,
      timescale: FIXTURE_TS,
      is_sync: i % 30 === 0,
      data: new Uint8Array(),
    }));
  }

  it('leaves a source that already starts at zero alone', () => {
    const input = shifted(10, 0);
    const out = rebaseToPresentationStart(input);
    expect(out.startOffsetSec).toBe(0);
    expect(out.samples).toBe(input); // no needless copy
  });

  it('takes the offset out so frame 0 of the timeline is frame 0 of the media', () => {
    const out = rebaseToPresentationStart(shifted(90, OFFSET));
    expect(out.startOffsetSec).toBeCloseTo(2 / 30, 9);
    expect(out.samples[0].cts).toBe(0);
    // ...and the LAST frame of the media is now reachable at the last timeline
    // frame: 89/30s, which is where the two-frame defect used to land on 87.
    expect(out.samples[89].cts).toBe(89 * FRAME);
  });

  it('keeps every interval, duration and sync flag untouched', () => {
    const input = shifted(30, OFFSET);
    const out = rebaseToPresentationStart(input);
    for (let i = 0; i < input.length; i++) {
      expect(out.samples[i].cts - out.samples[0].cts).toBe(
        input[i].cts - input[0].cts,
      );
      expect(out.samples[i].duration).toBe(input[i].duration);
      expect(out.samples[i].is_sync).toBe(input[i].is_sync);
      expect(out.samples[i].data).toBe(input[i].data); // bytes are not copied
    }
    expect(analyzeFrameRate(out.samples)).toEqual(analyzeFrameRate(input));
  });

  it('shifts dts by the same amount, even where that makes it negative', () => {
    // What a real B-frame stream looks like: the first picture is presented at
    // the reorder delay, but decoded first.
    const input = [sample(OFFSET, 0), sample(OFFSET + FRAME, FRAME)];
    const out = rebaseToPresentationStart(input);
    expect(out.samples[0].cts).toBe(0);
    expect(out.samples[0].dts).toBe(-OFFSET);
    expect(out.samples[1].cts - out.samples[1].dts).toBe(
      input[1].cts - input[1].dts,
    );
  });

  it('uses the EARLIEST presentation time, not the first sample in decode order', () => {
    // B-frames make decode order != presentation order; the first sample fed is
    // not necessarily the first one shown.
    const out = rebaseToPresentationStart([
      sample(3 * FRAME),
      sample(1 * FRAME),
      sample(2 * FRAME),
    ]);
    expect(out.samples.map((s) => s.cts)).toEqual([2 * FRAME, 0, FRAME]);
  });

  it('pulls a source that starts BEFORE zero forward too', () => {
    // `ctts` version 1 offsets are signed, so an encoder can present its first
    // picture before the track's zero instead of shifting the whole track up.
    // Left alone, that picture is unreachable: every non-negative timeline
    // position resolves to a later sample. Same defect, mirrored.
    const out = rebaseToPresentationStart(shifted(10, -OFFSET));
    expect(out.startOffsetSec).toBeCloseTo(-2 / 30, 9);
    expect(out.samples[0].cts).toBe(0);
    expect(out.samples[9].cts).toBe(9 * FRAME);
  });

  it('reports the offset it actually removed, in both directions', () => {
    // The one field that exists so the correction is not silent must not say
    // "nothing was removed" when something was.
    expect(rebaseToPresentationStart(shifted(4, -FRAME)).startOffsetSec).toBe(
      -1 / 30,
    );
    expect(rebaseToPresentationStart(shifted(4, FRAME)).startOffsetSec).toBe(
      1 / 30,
    );
  });

  it('strands a corrupt sample instead of poisoning the whole track', () => {
    // timescale 0 would make every conversion Infinity/NaN and shift every
    // timestamp into nonsense.
    const input = shifted(3, OFFSET);
    input[1] = { ...input[1], timescale: 0 };
    const out = rebaseToPresentationStart(input);
    expect(out.startOffsetSec).toBeCloseTo(2 / 30, 9);
    expect(out.samples[0].cts).toBe(0);
    expect(Number.isFinite(out.samples[1].cts)).toBe(true);
  });

  it('never mutates the samples it was given', () => {
    const input = shifted(5, OFFSET);
    rebaseToPresentationStart(input);
    expect(input[0].cts).toBe(OFFSET);
  });

  it('is safe on an empty track', () => {
    expect(rebaseToPresentationStart([]).startOffsetSec).toBe(0);
  });

  /**
   * The container header is NOT reduced by the offset the rebase removes. Where
   * the two disagree, a timeline sized from the header claims frames the media
   * cannot fill — which freeze on the last picture in preview and get written
   * again in export, at the right frame count, silently.
   */
  describe('presentationSpan (how far the media actually reaches)', () => {
    it('measures to the end of the last sample, not to its start', () => {
      const { spanSec, trusted } = presentationSpan(shifted(90, 0));
      expect(trusted).toBe(true);
      expect(spanSec).toBeCloseTo(3, 9); // 90 frames at 30fps
    });

    it('refuses to be trusted when a sample has no duration', () => {
      const input = shifted(5, 0);
      input[4] = { ...input[4], duration: 0 };
      const { trusted } = presentationSpan(input);
      // Believing it here would cut a frame off the clip, which is worse than
      // believing the header.
      expect(trusted).toBe(false);
    });

    it('is not trusted on an empty track', () => {
      expect(presentationSpan([])).toEqual({ spanSec: 0, trusted: false });
    });
  });
});
