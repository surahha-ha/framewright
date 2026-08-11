// framewright — MP4 demux via mp4box.js.
// Extracts the video track's samples (encoded chunks) + decoder description,
// so the decode service can feed them to WebCodecs.

import MP4Box from 'mp4box';
import { timescaleToSec } from './time';

export interface VideoTrackInfo {
  id: number;
  codec: string;
  width: number;
  height: number;
  timescale: number;
  nbSamples: number;
  durationSec: number;
}

export interface DemuxSample {
  cts: number;
  dts: number;
  duration: number;
  timescale: number;
  is_sync: boolean;
  data: Uint8Array;
}

export interface DemuxResult {
  track: VideoTrackInfo;
  samples: DemuxSample[];
  description?: Uint8Array;
  isVFR: boolean;
  nominalFps: number;
  /** false when sample extraction timed out — the clip would be truncated. */
  complete: boolean;
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
  const outcome = await Promise.race([done.then(() => 'done' as const), timedOut]);
  if (timer !== undefined) clearTimeout(timer);

  if (!track) throw new Error('demux failed: no track');
  const complete =
    outcome === 'done' || samples.length >= (track as VideoTrackInfo).nbSamples;

  // Fallback duration from samples if header duration is missing/zero.
  if (!track.durationSec || !isFinite(track.durationSec)) {
    let maxEnd = 0;
    for (const s of samples) {
      const e = timescaleToSec(s.cts + s.duration, s.timescale);
      if (e > maxEnd) maxEnd = e;
    }
    track.durationSec = maxEnd;
  }

  const { isVFR, nominalFps } = analyzeFrameRate(samples);
  return { track, samples, description, isVFR, nominalFps, complete };
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
  await Promise.race([done, new Promise<void>((r) => setTimeout(r, 5000))]);
  if (samples.length === 0) return null;
  return { track, samples, description };
}

/** AAC needs its AudioSpecificConfig (inside esds) as the decoder description. */
function getAudioDescription(mp4: any, trackId: number): Uint8Array | undefined {
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
