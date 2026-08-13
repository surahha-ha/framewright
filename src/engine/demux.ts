// framewright — MP4 demux via mp4box.js.
// Extracts the video track's samples (encoded chunks) + decoder description,
// so the decode service can feed them to WebCodecs.

import MP4Box from 'mp4box';
import { secToTimescale, timescaleToSec } from './time';

export interface VideoTrackInfo {
  id: number;
  codec: string;
  width: number;
  height: number;
  timescale: number;
  nbSamples: number;
  durationSec: number;
}

/**
 * One encoded sample. `cts` is REBASED: it is measured from this track's first
 * presented sample, not from the container's clock. Everything downstream
 * (decoder, playback, export) matches `frame / fps` seconds against it, so a
 * source that starts late in its own container must not drag that offset along
 * — see `rebaseToPresentationStart` and ADR-0008.
 */
export interface DemuxSample {
  cts: number;
  dts: number;
  duration: number;
  timescale: number;
  is_sync: boolean;
  data: Uint8Array;
}

/**
 * Take the track's presentation start out of its samples, so `cts` 0 is the
 * first picture the file shows.
 *
 * A file with B-frames and no edit list presents its first picture one reorder
 * delay in — `e2e/fixtures/sample-h264.mp4` starts at cts 1024 at timescale
 * 15360, two frames at 30fps. The timeline maps frame n to n/fps seconds, so
 * leaving that offset in place renders every frame two early AND puts the last
 * two frames of the media past the end of the timeline, where nothing can reach
 * them. This is ffmpeg's default behaviour too (each stream is rebased to its
 * own earliest timestamp unless `-copyts` says otherwise).
 *
 * The offset is corrected in BOTH directions. A signed composition offset
 * (`ctts` version 1) puts the first picture *before* zero, which strands it
 * exactly the way a late start strands the tail: no non-negative timeline
 * position can ever ask for it.
 *
 * Pure and non-mutating; the sample bytes are shared, not copied.
 */
export function rebaseToPresentationStart(samples: DemuxSample[]): {
  samples: DemuxSample[];
  startOffsetSec: number;
} {
  if (samples.length === 0) return { samples, startOffsetSec: 0 };
  // The EARLIEST presentation time, which is not the first sample in decode
  // order once B-frames are involved.
  let base: DemuxSample | null = null;
  let startOffsetSec = Infinity;
  for (const s of samples) {
    // A corrupt box must strand one sample, not poison every timestamp with
    // Infinity.
    if (!(s.timescale > 0)) continue;
    const sec = timescaleToSec(s.cts, s.timescale);
    if (sec < startOffsetSec) {
      startOffsetSec = sec;
      base = s;
    }
  }
  if (!base || startOffsetSec === 0 || !isFinite(startOffsetSec)) {
    return { samples, startOffsetSec: 0 };
  }
  // A track carries ONE timescale (it lives in mdhd), so this is the same
  // integer for every sample; the per-sample branch exists only so a mixed
  // input cannot be shifted by the wrong amount.
  const baseTimescale = base.timescale;
  const baseOffset = secToTimescale(startOffsetSec, baseTimescale);
  return {
    samples: samples.map((s) => {
      const offset =
        s.timescale === baseTimescale
          ? baseOffset
          : secToTimescale(startOffsetSec, s.timescale);
      return { ...s, cts: s.cts - offset, dts: s.dts - offset };
    }),
    startOffsetSec,
  };
}

/**
 * How far the rebased samples actually reach, and whether that number can be
 * trusted as the media's duration.
 *
 * `trusted` is false as soon as one sample has no duration, because then the
 * span understates the media by at least a frame — and shortening a clip is a
 * worse failure than believing the container header.
 */
export function presentationSpan(samples: DemuxSample[]): {
  spanSec: number;
  trusted: boolean;
} {
  let spanSec = 0;
  let trusted = samples.length > 0;
  for (const s of samples) {
    if (!(s.duration > 0) || !(s.timescale > 0)) {
      trusted = false;
      continue;
    }
    const end = timescaleToSec(s.cts + s.duration, s.timescale);
    if (end > spanSec) spanSec = end;
  }
  return { spanSec, trusted };
}

export interface DemuxResult {
  track: VideoTrackInfo;
  samples: DemuxSample[];
  description?: Uint8Array;
  isVFR: boolean;
  nominalFps: number;
  /** false when sample extraction timed out — the clip would be truncated. */
  complete: boolean;
  /** How late in its own container this track's first picture sat, before the
   *  samples were rebased. Diagnostics only — `samples` already has it out. */
  startOffsetSec: number;
}

export async function demuxVideo(file: File): Promise<DemuxResult> {
  const mp4: any = (MP4Box as any).createFile();
  const samples: DemuxSample[] = [];
  let track: VideoTrackInfo | null = null;
  let description: Uint8Array | undefined;

  const ready = new Promise<void>((resolve, reject) => {
    mp4.onError = (e: string) => reject(new Error('mp4box: ' + e));
    mp4.onReady = (info: any) => {
      const t = info.videoTracks && info.videoTracks[0];
      if (!t) {
        reject(new Error('no video track found'));
        return;
      }
      track = {
        id: t.id,
        codec: t.codec,
        width: t.video.width,
        height: t.video.height,
        timescale: t.timescale,
        nbSamples: t.nb_samples,
        durationSec: t.duration / t.timescale,
      };
      description = getDescription(mp4, t.id);
      mp4.setExtractionOptions(t.id, null, { nbSamples: 1_000_000 });
      mp4.start();
      resolve();
    };
  });

  const done = new Promise<void>((resolve) => {
    mp4.onSamples = (_id: number, _user: unknown, ss: any[]) => {
      for (const s of ss) {
        samples.push({
          cts: s.cts,
          dts: s.dts,
          duration: s.duration,
          timescale: s.timescale,
          is_sync: s.is_sync,
          data: s.data,
        });
      }
      if (track && samples.length >= track.nbSamples) resolve();
    };
  });

  const buf: any = await file.arrayBuffer();
  buf.fileStart = 0;
  mp4.appendBuffer(buf);
  mp4.flush();
  await ready;

  // Safety net: never hang if mp4box stops emitting. A timeout means the clip
  // would be TRUNCATED, so we surface it rather than silently importing a short clip.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((r) => {
    timer = setTimeout(() => r('timeout'), 15000);
  });
  const outcome = await Promise.race([
    done.then(() => 'done' as const),
    timedOut,
  ]);
  if (timer !== undefined) clearTimeout(timer);

  if (!track) throw new Error('demux failed: no track');
  // Assigned inside a callback, so narrow it once here for the rest of the fn.
  const info = track as VideoTrackInfo;
  const complete = outcome === 'done' || samples.length >= info.nbSamples;

  // Everything past this point works in PRESENTATION time, counted from this
  // track's first picture — see rebaseToPresentationStart.
  const { samples: rebased, startOffsetSec } =
    rebaseToPresentationStart(samples);

  // The header is the container's word for how long the track is; the samples
  // ARE the media. Where we have all of them and they carry durations, they win
  // — the header is not reduced by the offset just removed, and a timeline that
  // claims frames the media cannot fill freezes on the last picture in preview
  // and writes it again in export, silently and at the right frame count.
  const { spanSec, trusted } = presentationSpan(rebased);
  if (complete && trusted) {
    info.durationSec = spanSec;
  } else if (!info.durationSec || !isFinite(info.durationSec)) {
    info.durationSec = spanSec;
  }

  const { isVFR, nominalFps } = analyzeFrameRate(rebased);
  return {
    track: info,
    samples: rebased,
    description,
    isVFR,
    nominalFps,
    complete,
    startOffsetSec,
  };
}

export interface AudioTrackInfo {
  id: number;
  codec: string;
  sampleRate: number;
  channelCount: number;
  durationSec: number;
}

export interface DemuxAudioResult {
  track: AudioTrackInfo;
  samples: DemuxSample[];
  description?: Uint8Array;
  /** As on DemuxResult: what was taken out, for diagnostics only. */
  startOffsetSec: number;
}

/**
 * Extract the audio track's encoded samples so WebCodecs can decode them.
 * Used as a fallback when `decodeAudioData` cannot handle the file — which does
 * happen for perfectly ordinary MP4s.
 * Returns null when the file simply has no audio.
 */
export async function demuxAudio(file: File): Promise<DemuxAudioResult | null> {
  const mp4: any = (MP4Box as any).createFile();
  const samples: DemuxSample[] = [];
  let track: AudioTrackInfo | null = null;
  let description: Uint8Array | undefined;
  let noAudio = false;

  const ready = new Promise<void>((resolve, reject) => {
    mp4.onError = (e: string) => reject(new Error('mp4box(audio): ' + e));
    mp4.onReady = (info: any) => {
      const t = info.audioTracks && info.audioTracks[0];
      if (!t) {
        noAudio = true;
        resolve();
        return;
      }
      track = {
        id: t.id,
        codec: t.codec,
        sampleRate: t.audio?.sample_rate ?? 48000,
        channelCount: t.audio?.channel_count ?? 2,
        durationSec: t.duration / t.timescale,
      };
      description =
        getAudioDescription(mp4, t.id) ??
        (String(t.codec).startsWith('mp4a')
          ? synthesizeAacDescription(track.sampleRate, track.channelCount)
          : undefined);
      mp4.setExtractionOptions(t.id, null, { nbSamples: 1_000_000 });
      mp4.start();
      resolve();
    };
  });

  const done = new Promise<void>((resolve) => {
    mp4.onSamples = (_id: number, _user: unknown, ss: any[]) => {
      for (const s of ss) {
        samples.push({
          cts: s.cts,
          dts: s.dts,
          duration: s.duration,
          timescale: s.timescale,
          is_sync: s.is_sync,
          data: s.data,
        });
      }
      resolve();
    };
  });

  const buf: any = await file.arrayBuffer();
  buf.fileStart = 0;
  mp4.appendBuffer(buf);
  mp4.flush();
  await ready;
  if (noAudio || !track) return null;
  const info = track as AudioTrackInfo; // assigned in a callback
  await Promise.race([done, new Promise<void>((r) => setTimeout(r, 5000))]);
  if (samples.length === 0) return null;
  // Same rule as video: cts counts from this track's own first sample, so both
  // tracks answer in presentation time and neither drags a container offset in.
  const { samples: rebased, startOffsetSec } =
    rebaseToPresentationStart(samples);
  return { track: info, samples: rebased, description, startOffsetSec };
}

/** AAC needs its AudioSpecificConfig (inside esds) as the decoder description. */
function getAudioDescription(
  mp4: any,
  trackId: number,
): Uint8Array | undefined {
  try {
    const trak = mp4.getTrackById(trackId);
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      // mp4box exposes this at a couple of shapes depending on the file.
      const candidates = [
        entry?.esds?.esd?.descs?.[0]?.descs?.[0]?.data,
        entry?.esds?.esd?.descs?.[0]?.data,
        entry?.esds?.data,
      ];
      for (const asc of candidates) {
        if (asc && asc.length) return new Uint8Array(asc);
      }
    }
  } catch {
    /* fall through to synthesis */
  }
  return undefined;
}

const AAC_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025,
  8000, 7350,
];

/**
 * Build a minimal AAC-LC AudioSpecificConfig from the track's sample rate and
 * channel count. AudioDecoder REQUIRES a description for `mp4a.*`, and some
 * files don't expose a parseable esds — without this the fallback would refuse
 * perfectly decodable audio.
 */
export function synthesizeAacDescription(
  sampleRate: number,
  channels: number,
): Uint8Array | undefined {
  const freqIndex = AAC_SAMPLE_RATES.indexOf(sampleRate);
  if (freqIndex < 0 || channels < 1 || channels > 7) return undefined;
  const objectType = 2; // AAC-LC
  return new Uint8Array([
    (objectType << 3) | (freqIndex >> 1),
    ((freqIndex & 1) << 7) | (channels << 3),
  ]);
}

// Detect VFR by looking at the spread of cts intervals.
export function analyzeFrameRate(samples: DemuxSample[]): {
  isVFR: boolean;
  nominalFps: number;
} {
  if (samples.length < 3) return { isVFR: false, nominalFps: 0 };
  const cts = samples
    .map((s) => timescaleToSec(s.cts, s.timescale))
    .sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < cts.length; i++) intervals.push(cts[i] - cts[i - 1]);
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)] || 0;
  const min = intervals[0] || 0;
  const max = intervals[intervals.length - 1] || 0;
  const jitter = median ? (max - min) / median : 0;
  return { isVFR: jitter > 0.02, nominalFps: median ? 1 / median : 0 };
}

function getDescription(mp4: any, trackId: number): Uint8Array | undefined {
  try {
    const g = globalThis as any;
    const DS = g.DataStream || (MP4Box as any).DataStream;
    if (!DS) return undefined;
    const trak = mp4.getTrackById(trackId);
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
      if (box) {
        const stream = new DS(undefined, 0, DS.BIG_ENDIAN);
        box.write(stream);
        return new Uint8Array(stream.buffer, 8); // strip 8-byte box header
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}
