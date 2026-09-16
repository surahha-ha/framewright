// framewright — export pipeline (H.264 / MP4, video only for now — ADR-0005).
//
// Deterministic by construction: it renders the EXPORT PLAN frame by frame
// (never a wall clock), so the output matches the preview exactly. Encoder
// support is probed up front, dimensions are forced even, keyframes are inserted
// at a fixed interval, and the muxer receives the encoder's own avcC description.

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { Clip, Project, Rational, SubtitleFont } from './types';
import { buildExportPlan, evenDimensions } from './exportPlan';
import { NO_FONTS, fontsInPlan, type FontLoader } from './fonts';
import { raceAbort } from './abort';
import { avcCodecString, type AvcProfile } from './exportConfig';
import { fpsToNumber, frameToSec, secToUs } from './time';
import type { VideoDecodeService } from './decoder';
import { buildAudioSchedule } from './audioSchedule';
import { renderTimelineAudio } from './audio';
import { FeedPool } from './feeds';
import { composeFrame, type BlendLayer } from './compose';

export interface ExportOptions {
  bitrate?: number;
  /** Seconds between forced keyframes — keeps the output seekable. */
  keyframeIntervalSec?: number;
  onProgress?: (done: number, total: number, phase?: string) => void;
  signal?: AbortSignal;
  /** The most each clip may be heard at, from its peak (ADR-0013). The UI
   *  owns the peaks; the exporter only applies the bound. */
  levelCeiling?: (clip: Clip) => number;
  /** How the subtitle faces the plan names reach the page (ADR-0018).
   *  Absent = none can (`NO_FONTS`): every face is drawn with the
   *  fallback and reported in `missingFonts`. */
  fonts?: FontLoader;
}

export interface ExportResult {
  blob: Blob;
  frames: number;
  durationSec: number;
  /** Frames the source could not supply (reported, never silently ignored). */
  missingFrames: number;
  hasAudio: boolean;
  /** Faces the plan named that could not be loaded, so were drawn with
   *  the fallback stack (reported, never silently ignored). */
  missingFonts: SubtitleFont[];
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
      if (support.supported)
        return (support.config as VideoEncoderConfig) ?? config;
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

  // The faces the words are set in must be on the page before frame 0 is
  // drawn, or the first frames go out in the fallback and the rest in the
  // face (ADR-0018). One await per face, in first-use order; a face that
  // does not come is drawn with the fallback and named in the result.
  const fonts = options.fonts ?? NO_FONTS;
  const missingFonts: SubtitleFont[] = [];
  const wantedFonts = fontsInPlan(plan);
  if (wantedFonts.length > 0) {
    // Counted per FACE, not per frame: with three faces on a cold cache the
    // bar sat at 0% for seconds with only the phase word to say why.
    options.onProgress?.(0, wantedFonts.length, 'fonts');
    for (const [i, font] of wantedFonts.entries()) {
      // A load cannot be broken into, so the cancel is raced against it:
      // otherwise 취소 waits for a fetch that may never end.
      if (!(await raceAbort(fonts.load(font), options.signal)))
        missingFonts.push(font);
      options.onProgress?.(i + 1, wantedFonts.length, 'fonts');
    }
  }

  // Audio is rendered first: the muxer must be told up front whether the file
  // has an audio track, and rendering offline is fast and deterministic.
  options.onProgress?.(0, plan.length, 'audio');
  const audioBuffer = await renderTimelineAudio(
    buildAudioSchedule(project, 0, options.levelCeiling),
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

  // One canvas, composed from scratch every frame: black, the footage, the
  // other side of a fade at its weight, the words (`composeFrame` — the same
  // function the preview uses, so the file matches the screen). The pictures
  // themselves are held by the feed pool, which is what lets a HOLD frame
  // keep its footage while the words and the fade move on.
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('캔버스를 만들 수 없어요.');

  // Reuses a running decoder whenever the source is still continuous — a
  // split changes the clip id but not the material — and runs two at once
  // through a dissolve (ADR-0012).
  const pool = new FeedPool(
    (assetId) => getService(assetId)?.createPlaybackSession(fail) ?? null,
    fps,
  );
  let missingFrames = 0;

  const cleanup = () => {
    pool.stopAll();
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
      pool.begin();

      let primary: VideoFrame | null = null;
      if (entry.assetId && entry.clipId) {
        const feed = pool.feed({
          assetId: entry.assetId,
          sourceFrame: entry.sourceFrame,
        });
        if (!feed) {
          missingFrames++; // the source is gone — black, not a frozen leftover
        } else {
          const got = await pool.pullWait(
            feed,
            frameToSec(entry.sourceFrame, fps),
            options.signal,
          );
          abortIfRequested();
          if (got === 'missing') missingFrames++;
          // 'hold': the source repeats this picture — the feed still has it.
          primary = feed.current;
        }
      }
      // else: a gap is black, not missing time.

      let blend: BlendLayer | null = null;
      if (entry.blend) {
        if (entry.blend.assetId === null) {
          blend = { frame: null, weight: entry.blend.weight };
        } else {
          const feed = pool.feed({
            assetId: entry.blend.assetId,
            sourceFrame: entry.blend.sourceFrame,
          });
          // A neighbour whose file is gone, or has no such frame, fades to
          // black instead — and that is a frame the source could not supply,
          // so it is COUNTED, like a missing primary. "Nothing wrong" over a
          // dissolve that came out black would be a false report.
          if (!feed) {
            missingFrames++;
          } else {
            const got = await pool.pullWait(
              feed,
              frameToSec(entry.blend.sourceFrame, fps),
              options.signal,
            );
            abortIfRequested();
            if (got === 'missing') missingFrames++;
          }
          blend = {
            frame: feed?.current ?? null,
            weight: entry.blend.weight,
            transform: entry.blend.transform,
          };
        }
      }

      // Draw, THEN drop what this frame did not ask for — the same order as
      // the preview, so a change to what `end()` closes can never leave one
      // surface drawing from a closed frame while the other is fine.
      composeFrame(
        ctx,
        width,
        height,
        primary,
        blend,
        entry.subtitle,
        entry.transform,
      );
      pool.end();

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
      missingFonts,
    };
  } finally {
    cleanup();
  }
}
