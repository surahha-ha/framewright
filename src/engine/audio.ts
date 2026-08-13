// framewright — audio decoding & storage.
//
// We decode audio with `AudioContext.decodeAudioData` on the original file bytes
// rather than wiring a second WebCodecs path. It is far less code, works for any
// container/codec the browser can play, and gives us a plain AudioBuffer that
// both playback (WebAudio) and export (OfflineAudioContext) can use.
// Trade-off: the whole track is decoded into memory — fine for the short clips
// this editor targets; revisit with streaming decode if long files show up.

import type { DemuxAudioResult } from './demux';
import { timescaleToUs } from './time';

let sharedContext: AudioContext | null = null;

export function audioContext(): AudioContext | null {
  const Ctor =
    (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext) sharedContext = new Ctor();
  return sharedContext;
}

/** Browsers start the context suspended until a user gesture. */
export async function resumeAudio(): Promise<void> {
  const ctx = audioContext();
  if (ctx && ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      /* autoplay policy — playback just stays silent */
    }
  }
}

const buffers = new Map<string, AudioBuffer>();

export interface AudioDecodeOutcome {
  buffer: AudioBuffer | null;
  /** How it was decoded, or why it wasn't — surfaced instead of swallowed. */
  via: 'decodeAudioData' | 'webcodecs' | 'none';
  error?: string;
}

/**
 * Fast path: hand the whole file to `decodeAudioData`.
 * NOTE: pass a COPY of the bytes; it detaches the buffer and the demuxer holds
 * views into the original.
 */
export async function decodeAudio(
  bytes: ArrayBuffer,
): Promise<AudioDecodeOutcome> {
  const ctx = audioContext();
  if (!ctx) return { buffer: null, via: 'none', error: 'no AudioContext' };
  try {
    const buffer = await ctx.decodeAudioData(bytes);
    return { buffer, via: 'decodeAudioData' };
  } catch (e) {
    return {
      buffer: null,
      via: 'none',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Fallback: decode the demuxed audio track with WebCodecs.
 * `decodeAudioData` refuses some ordinary MP4s, so we go through the container
 * ourselves and feed AAC frames to an AudioDecoder.
 */
export async function decodeAudioTrack(
  demuxed: DemuxAudioResult,
): Promise<AudioDecodeOutcome> {
  const ctx = audioContext();
  if (!ctx) return { buffer: null, via: 'none', error: 'no AudioContext' };
  if (typeof AudioDecoder === 'undefined') {
    return { buffer: null, via: 'none', error: 'AudioDecoder unavailable' };
  }

  const { track, samples, description } = demuxed;
  const config: AudioDecoderConfig = {
    codec: track.codec,
    sampleRate: track.sampleRate,
    numberOfChannels: track.channelCount,
    ...(description ? { description } : {}),
  };

  try {
    const support = await AudioDecoder.isConfigSupported(config);
    if (!support.supported) {
      return { buffer: null, via: 'none', error: `${track.codec} 미지원` };
    }
  } catch (e) {
    return {
      buffer: null,
      via: 'none',
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const planes: Float32Array[][] = Array.from(
    { length: track.channelCount },
    () => [],
  );
  let totalFrames = 0;
  let failure: string | undefined;

  await new Promise<void>((resolve) => {
    const decoder = new AudioDecoder({
      output: (data) => {
        try {
          const frames = data.numberOfFrames;
          const channels = Math.min(data.numberOfChannels, track.channelCount);
          for (let c = 0; c < channels; c++) {
            const plane = new Float32Array(frames);
            data.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
            planes[c].push(plane);
          }
          // Mono source into a stereo config: duplicate rather than drop.
          for (let c = channels; c < track.channelCount; c++) {
            planes[c].push(planes[0][planes[0].length - 1]);
          }
          totalFrames += frames;
        } finally {
          data.close();
        }
      },
      error: (e) => {
        failure = e.message;
        resolve();
      },
    });
    decoder.configure(config);
    for (const s of samples) {
      decoder.decode(
        new EncodedAudioChunk({
          type: s.is_sync ? 'key' : 'delta',
          timestamp: timescaleToUs(s.cts, s.timescale),
          duration: timescaleToUs(s.duration, s.timescale),
          data: s.data,
        }),
      );
    }
    decoder
      .flush()
      .then(() => resolve())
      .catch((e) => {
        failure = e instanceof Error ? e.message : String(e);
        resolve();
      })
      .finally(() => {
        try {
          decoder.close();
        } catch {
          /* already closed */
        }
      });
  });

  if (totalFrames === 0) {
    return { buffer: null, via: 'none', error: failure ?? 'no audio frames' };
  }

  const buffer = ctx.createBuffer(
    track.channelCount,
    totalFrames,
    track.sampleRate,
  );
  for (let c = 0; c < track.channelCount; c++) {
    const target = buffer.getChannelData(c);
    let offset = 0;
    for (const plane of planes[c]) {
      target.set(plane, offset);
      offset += plane.length;
    }
  }
  return { buffer, via: 'webcodecs' };
}

export function setAudioBuffer(assetId: string, buffer: AudioBuffer): void {
  buffers.set(assetId, buffer);
}

export function getAudioBuffer(assetId: string): AudioBuffer | null {
  return buffers.get(assetId) ?? null;
}

export function hasAnyAudio(): boolean {
  return buffers.size > 0;
}

/**
 * Render the whole timeline's audio to a single buffer, offline and
 * deterministically (no real-time clock involved), so the exported soundtrack
 * matches what playback schedules — cuts, gaps and all.
 * Returns null when the timeline has no audio at all.
 */
export async function renderTimelineAudio(
  segments: {
    assetId: string;
    whenSec: number;
    offsetSec: number;
    durationSec: number;
  }[],
  totalDurationSec: number,
): Promise<AudioBuffer | null> {
  const OfflineCtor =
    (globalThis as any).OfflineAudioContext ??
    (globalThis as any).webkitOfflineAudioContext;
  if (!OfflineCtor || totalDurationSec <= 0) return null;

  const usable = segments.filter((s) => getAudioBuffer(s.assetId));
  if (usable.length === 0) return null;

  const first = getAudioBuffer(usable[0].assetId)!;
  const sampleRate = first.sampleRate;
  const channels = Math.max(
    1,
    ...usable.map((s) => getAudioBuffer(s.assetId)!.numberOfChannels),
  );
  const length = Math.ceil(totalDurationSec * sampleRate);

  const ctx: OfflineAudioContext = new OfflineCtor(
    channels,
    length,
    sampleRate,
  );
  for (const segment of usable) {
    const buffer = getAudioBuffer(segment.assetId)!;
    const offset = Math.min(Math.max(0, segment.offsetSec), buffer.duration);
    const duration = Math.min(segment.durationSec, buffer.duration - offset);
    if (duration <= 0) continue;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(segment.whenSec, offset, duration);
  }
  return await ctx.startRendering();
}

/** Release audio for assets no longer in the document (mirrors the decode services). */
export function retainOnlyAudio(assetIds: Iterable<string>): void {
  const keep = new Set(assetIds);
  for (const id of [...buffers.keys()]) {
    if (!keep.has(id)) buffers.delete(id);
  }
}
