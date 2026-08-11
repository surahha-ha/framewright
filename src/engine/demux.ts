// framewright — MP4 demux via mp4box.js.
// Extracts the video track's samples (encoded chunks) + decoder description,
// so the decode service can feed them to WebCodecs.

import MP4Box from 'mp4box';

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
  await Promise.race([done, new Promise<void>((r) => setTimeout(r, 2000))]);

  if (!track) throw new Error('demux failed: no track');

  // Fallback duration from samples if header duration is missing/zero.
  if (!track.durationSec || !isFinite(track.durationSec)) {
    let maxEnd = 0;
    for (const s of samples) {
      const e = (s.cts + s.duration) / s.timescale;
      if (e > maxEnd) maxEnd = e;
    }
    track.durationSec = maxEnd;
  }

  const { isVFR, nominalFps } = analyzeFrameRate(samples);
  return { track, samples, description, isVFR, nominalFps };
}

// Detect VFR by looking at the spread of cts intervals.
export function analyzeFrameRate(samples: DemuxSample[]): {
  isVFR: boolean;
  nominalFps: number;
} {
  if (samples.length < 3) return { isVFR: false, nominalFps: 0 };
  const cts = samples.map((s) => s.cts / s.timescale).sort((a, b) => a - b);
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
  const DS = (window as any).DataStream || (MP4Box as any).DataStream;
  try {
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
