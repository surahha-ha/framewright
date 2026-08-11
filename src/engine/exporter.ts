// framewright — export pipeline (H.264 / MP4, video only for now — ADR-0005).
//
// Deterministic by construction: it renders the EXPORT PLAN frame by frame
// (never a wall clock), so the output matches the preview exactly. Encoder
// support is probed up front, dimensions are forced even, keyframes are inserted
// at a fixed interval, and the muxer receives the encoder's own avcC description.

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { Project, Rational } from './types';
import { buildExportPlan, evenDimensions, isContinuous } from './exportPlan';
import { avcCodecString, containRect, type AvcProfile } from './exportConfig';
import { fpsToNumber, frameToSec, secToUs } from './time';
import type { VideoDecodeService } from './decoder';
import { HOLD, type PlaybackSession } from './playbackSession';
import { buildAudioSchedule } from './audioSchedule';
import { renderTimelineAudio } from './audio';

export interface ExportOptions {
  bitrate?: number;
  /** Seconds between forced keyframes — keeps the output seekable. */
  keyframeIntervalSec?: number;
  onProgress?: (done: number, total: number, phase?: string) => void;
  signal?: AbortSignal;
}

export interface ExportResult {
  blob: Blob;
  frames: number;
  durationSec: number;
  /** Frames the source could not supply (reported, never silently ignored). */
  missingFrames: number;
  hasAudio: boolean;
}

const AUDIO_CODEC = 'mp4a.40.2'; // AAC-LC
const AUDIO_BITRATE = 128_000;
const AUDIO_CHUNK_FRAMES = 1024;

/** Slice a rendered buffer into AudioData and push it through the encoder. */
async function encodeAudioTrack(
  buffer: AudioBuffer,
  encoder: AudioEncoder,
  signal?: AbortSignal,
): Promise<void> {
  const { numberOfChannels: channels, sampleRate, length } = buffer;
  const planes: Float32Array[] = [];
  for (let c = 0; c < channels; c++) planes.push(buffer.getChannelData(c));

  for (let start = 0; start < length; start += AUDIO_CHUNK_FRAMES) {
    if (signal?.aborted) throw new DOMException('취소됨', 'AbortError');
    const count = Math.min(AUDIO_CHUNK_FRAMES, length - start);
    // f32-planar: channel 0's samples, then channel 1's, ...
    const data = new Float32Array(count * channels);
    for (let c = 0; c < channels; c++) {
      data.set(planes[c].subarray(start, start + count), c * count);
    }
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: count,
      numberOfChannels: channels,
      timestamp: Math.round((start / sampleRate) * 1e6),
      data,
    });
    try {
      encoder.encode(audioData);
    } finally {
      audioData.close();
    }
    if (encoder.encodeQueueSize > 16) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await encoder.flush();
}

export class ExportUnsupportedError extends Error {}

/** Encoders differ in which profiles they expose; try the best first. */
const PROFILE_ORDER: AvcProfile[] = ['high', 'main', 'baseline'];

async function pickEncoderConfig(
  width: number,
  height: number,
  fpsNum: number,
  bitrate: number,
): Promise<VideoEncoderConfig> {
  let lastReason = '';
  for (const profile of PROFILE_ORDER) {
    const config: VideoEncoderConfig = {
      codec: avcCodecString(profile, width, height, fpsNum),
      width,
      height,
      bitrate,
      framerate: fpsNum,
      // avcC (length-prefixed) — annexB would produce an unplayable MP4.
      avc: { format: 'avc' },
      // WebCodecs exposes only a presentation timestamp, so B-frames could not
      // be muxed with correct composition offsets. 'realtime' suppresses them.
      latencyMode: 'realtime',
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) return (support.config as VideoEncoderConfig) ?? config;
      lastReason = `${profile} 프로파일 미지원`;
    } catch (e) {
      lastReason = e instanceof Error ? e.message : String(e);
    }
  }
  throw new ExportUnsupportedError(
    `이 해상도로는 내보내기를 할 수 없어요. (${width}×${height}) ${lastReason}`,
  );
}

export async function exportProject(
  project: Project,
  getService: (assetId: string) => VideoDecodeService | null,
  options: ExportOptions = {},
): Promise<ExportResult> {
  if (typeof VideoEncoder === 'undefined') {
    throw new ExportUnsupportedError(
      '이 브라우저는 영상 내보내기를 지원하지 않아요. 최신 Chrome/Edge에서 시도해 주세요.',
    );
  }

  const plan = buildExportPlan(project);
  if (plan.length === 0) throw new Error('내보낼 영상이 없어요.');

  const fps: Rational = project.timeline.fps;
  const fpsNum = fpsToNumber(fps);
  const { width, height } = evenDimensions(
    project.timeline.width,
    project.timeline.height,
  );
  const bitrate = options.bitrate ?? Math.round(width * height * 4);
  const gop = Math.max(
    1,
    Math.round((options.keyframeIntervalSec ?? 2) * fpsNum),
  );

  const config = await pickEncoderConfig(width, height, fpsNum, bitrate);

  // Audio is rendered first: the muxer must be told up front whether the file
  // has an audio track, and rendering offline is fast and deterministic.
  options.onProgress?.(0, plan.length, 'audio');
  const audioBuffer = await renderTimelineAudio(
    buildAudioSchedule(project, 0),
    frameToSec(plan.length, fps),
  );
  let audioConfig: AudioEncoderConfig | null = null;
  if (audioBuffer && typeof AudioEncoder !== 'undefined') {
    const candidate: AudioEncoderConfig = {
      codec: AUDIO_CODEC,
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels,
      bitrate: AUDIO_BITRATE,
    };
    try {
      const support = await AudioEncoder.isConfigSupported(candidate);
      if (support.supported) audioConfig = candidate;
    } catch {
      audioConfig = null; // export video-only rather than failing outright
    }
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
    ...(audioConfig
      ? {
          audio: {
            codec: 'aac',
            numberOfChannels: audioConfig.numberOfChannels,
            sampleRate: audioConfig.sampleRate,
          },
        }
      : {}),
    fastStart: 'in-memory', // moov at the front — plays while streaming
  });

  let encodeError: Error | null = null;
  const fail = (e: unknown) => {
    encodeError = e instanceof Error ? e : new Error(String(e));
  };

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: fail,
  });
  encoder.configure(config);

  let audioEncoder: AudioEncoder | null = null;
  if (audioConfig && audioBuffer) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: fail,
    });
    audioEncoder.configure(audioConfig);
    await encodeAudioTrack(audioBuffer, audioEncoder, options.signal);
    if (encodeError) throw encodeError;
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('캔버스를 만들 수 없어요.');
  const blank = () => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
  };
  blank(); // start opaque black, never transparent

  let session: PlaybackSession | null = null;
  let sessionAssetId: string | null = null;
  let lastSourceFrame = -1;
  let missingFrames = 0;

  const cleanup = () => {
    session?.stop();
    session = null;
    for (const codec of [encoder, audioEncoder]) {
      try {
        codec?.close();
      } catch {
        /* already closed */
      }
    }
  };

  const abortIfRequested = () => {
    if (options.signal?.aborted) {
      throw new DOMException('취소됨', 'AbortError');
    }
  };

  try {
    for (let i = 0; i < plan.length; i++) {
      abortIfRequested();
      if (encodeError) throw encodeError;

      const entry = plan[i];

      if (entry.assetId && entry.clipId) {
        const service = getService(entry.assetId);
        if (!service) {
          blank(); // the source is gone — black, not a frozen leftover frame
          missingFrames++;
        } else {
          // Reuse the running decoder whenever the source is still continuous —
          // a split changes the clip id but not the material.
          if (
            !session ||
            !isContinuous(
              sessionAssetId,
              lastSourceFrame,
              entry.assetId,
              entry.sourceFrame,
            )
          ) {
            session?.stop();
            session = service.createPlaybackSession(fail);
            session.start(frameToSec(entry.sourceFrame, fps));
            sessionAssetId = entry.assetId;
          }
          lastSourceFrame = entry.sourceFrame;
          const decoded = await session!.awaitFrameFor(
            frameToSec(entry.sourceFrame, fps),
            options.signal,
          );
          abortIfRequested();
          if (decoded === null) {
            blank();
            missingFrames++;
          } else if (decoded !== HOLD) {
            try {
              // Letterbox exactly like the preview does (preview == export).
              const r = containRect(
                decoded.displayWidth,
                decoded.displayHeight,
                width,
                height,
              );
              blank();
              ctx.drawImage(decoded, r.x, r.y, r.width, r.height);
            } finally {
              decoded.close();
            }
          }
          // HOLD: the source repeats this picture — keep the canvas as it is.
        }
      } else {
        blank(); // a gap is black, not missing time
      }

      // Per-sample duration must match the gap to the NEXT timestamp, otherwise
      // fractional rates (29.97) drift against the declared duration.
      const tsUs = secToUs(frameToSec(i, fps));
      const nextUs = secToUs(frameToSec(i + 1, fps));
      const outFrame = new VideoFrame(canvas, {
        timestamp: tsUs,
        duration: nextUs - tsUs,
        alpha: 'discard',
      });
      try {
        encoder.encode(outFrame, { keyFrame: i % gop === 0 });
      } finally {
        outFrame.close();
      }

      // Backpressure: don't let the encoder input queue (and memory) run away.
      while (encoder.encodeQueueSize > 8 && !encodeError) {
        abortIfRequested();
        await new Promise((r) => setTimeout(r, 0));
      }

      if (i % 5 === 0 || i === plan.length - 1) {
        options.onProgress?.(i + 1, plan.length, 'encoding');
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    options.onProgress?.(plan.length, plan.length, 'finalizing');
    await encoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();

    const { buffer } = muxer.target as ArrayBufferTarget;
    return {
      blob: new Blob([buffer], { type: 'video/mp4' }),
      frames: plan.length,
      durationSec: frameToSec(plan.length, fps),
      missingFrames,
      hasAudio: !!audioConfig,
    };
  } finally {
    cleanup();
  }
}
