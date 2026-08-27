// framewright — attaching a file's media to an asset, and getting it back after
// a reload.
//
// This is the one place that knows the order the pieces have to happen in:
// store the bytes, demux, register a decoder, decode the audio. MediaBin used
// to own it, but restore-after-reload needs exactly the same sequence, and two
// copies of it would drift.
//
// Not in `src/engine/**` on purpose: it wires the engine's parts together for
// the app and holds no document logic.

import { demuxAudio, demuxVideo, type DemuxResult } from '../engine/demux';
import { VideoDecodeService } from '../engine/decoder';
import { getDecodeService, setDecodeService } from '../engine/registry';
import {
  decodeAudio,
  decodeAudioTrack,
  markNoAudioTrack,
  setAudioBuffer,
} from '../engine/audio';
import {
  createOpfsMediaRepository,
  mediaKeyFor,
  queueMediaWork,
  requestPersistentStorage,
  sweepMedia,
  type MediaRepository,
} from '../engine/mediaStore';
import { releaseThumbnails } from './thumbnails';
import { releasePeaks } from './waveform';
import type { Asset } from '../engine/types';

export const mediaRepo: MediaRepository = createOpfsMediaRepository();

export interface AttachedMedia {
  demux: DemuxResult;
  /** Human-readable audio outcome — a silent video is fine, a silently FAILED
   *  decode is not, so this is always reported. */
  audioReport: string;
  /** Null when there is no usable audio track. */
  audioChannels: number | null;
}

/**
 * Decode this file's audio and bind it to an asset. Tries the quick path, then
 * demux + WebCodecs (which handles files `decodeAudioData` refuses).
 *
 * Consumes `audioBytes`: `decodeAudioData` detaches the buffer it is given, so
 * anything else that needs those bytes must be finished first.
 */
async function attachAudio(
  assetId: string,
  file: File,
  audioBytes: ArrayBuffer,
): Promise<{ report: string; channels: number | null }> {
  let audio = await decodeAudio(audioBytes);
  const quickError = audio.error;
  let demuxNote = '';
  if (!audio.buffer) {
    // `demuxAudio` REJECTS on a container it cannot parse. Every other decode
    // path here turns a failure into a reported outcome, and this one must too:
    // by the time it runs, the asset is already in the document and its file is
    // already in storage, so throwing would leave the editor holding an import
    // it just told the user had failed.
    const demuxedAudio = await demuxAudio(file).catch((err: unknown) => {
      demuxNote = `오디오 트랙을 읽지 못함: ${err instanceof Error ? err.message : String(err)}`;
      return null;
    });
    if (!demuxedAudio) {
      demuxNote ||= '컨테이너에 오디오 트랙 없음';
    } else {
      demuxNote = `트랙 ${demuxedAudio.track.codec} ${demuxedAudio.track.sampleRate}Hz ${demuxedAudio.track.channelCount}ch, 샘플 ${demuxedAudio.samples.length}, desc=${demuxedAudio.description ? demuxedAudio.description.length + 'B' : '없음'}`;
      audio = await decodeAudioTrack(demuxedAudio);
    }
  }
  if (audio.buffer) setAudioBuffer(assetId, audio.buffer);
  // The answer is now known either way, and "known to have none" is a different
  // thing from "not worked out yet" to everything downstream of here.
  else markNoAudioTrack(assetId);

  const report = audio.buffer
    ? `오디오 OK · ${audio.via} · ${audio.buffer.numberOfChannels}ch ${audio.buffer.sampleRate}Hz`
    : `오디오 실패 · decodeAudioData: ${quickError ?? '-'} · demux: ${demuxNote || '-'} · webcodecs: ${audio.error ?? '-'}`;
  // eslint-disable-next-line no-console
  console.log('[framewright] audio:', report);
  return { report, channels: audio.buffer?.numberOfChannels ?? null };
}

export class UnsupportedCodecError extends Error {
  constructor(readonly codec: string) {
    super(`unsupported codec: ${codec}`);
  }
}

/**
 * Read the container and build a decoder for it. Throws
 * `UnsupportedCodecError` before anything is registered or written, so a file
 * the browser cannot play leaves no trace.
 *
 * Deliberately separate from `bindMedia`: an import does not know the asset id
 * until the command has run, and predicting it would couple this file to how
 * the document mints ids.
 */
export async function openSource(
  file: File,
): Promise<{ demux: DemuxResult; service: VideoDecodeService }> {
  const demux = await demuxVideo(file);
  const service = new VideoDecodeService(demux);
  if (!(await service.isSupported())) {
    throw new UnsupportedCodecError(demux.track.codec);
  }
  return { demux, service };
}

/**
 * Hook an opened source up to an asset: decoder first, then audio.
 *
 * `bytes` must be a copy the caller no longer needs — it is detached here.
 */
export async function bindMedia(
  assetId: string,
  source: { demux: DemuxResult; service: VideoDecodeService },
  file: File,
  bytes: ArrayBuffer,
): Promise<AttachedMedia> {
  setDecodeService(assetId, source.service);
  // AFTER the swap, not before: a thumbnail decode already in flight is
  // rejected by identity against the new service, so purging first would leave
  // a window where a picture of the OLD file could still land in the cache.
  // The document keeps the same asset id across a re-link, so nothing else
  // would ever invalidate those pictures.
  releaseThumbnails(assetId);
  // The waveform's peaks go too, and here rather than by identity: the peaks are
  // invalidated by the AudioBuffer they were reduced from, and the NEW buffer
  // does not exist until `attachAudio` below finishes. Without this, the seconds
  // in between would draw the old file's sound under the new file's pictures.
  releasePeaks(assetId);
  const audio = await attachAudio(assetId, file, bytes);
  // A file WITH audio announces itself: the peaks land and the cache notifies.
  // A file WITHOUT one has nothing to arrive, so the strips would keep drawing
  // "not worked out yet" until some unrelated change re-rendered them. This is
  // that announcement; there is nothing cached to lose, and with no buffer bound
  // it lifts the refusal set above rather than adding one.
  if (audio.channels === null) releasePeaks(assetId);
  return {
    demux: source.demux,
    audioReport: audio.report,
    audioChannels: audio.channels,
  };
}

/** Open and bind in one step — what restoring a stored file needs. */
export async function attachFileToAsset(
  assetId: string,
  file: File,
  bytes: ArrayBuffer,
): Promise<AttachedMedia> {
  return bindMedia(assetId, await openSource(file), file, bytes);
}

/**
 * Keep the file, so the next reload does not ask for it again.
 *
 * Returns the storage key, or null when it could not be stored (no OPFS, a
 * private window, a full disk). Null is not an error the user has to act on —
 * the editor still works, it just has to ask for the file next time.
 *
 * Must run BEFORE the bytes are handed to audio decoding, which detaches them.
 */
export async function persistMedia(bytes: ArrayBuffer): Promise<string | null> {
  if (!mediaRepo.available) return null;
  try {
    await requestPersistentStorage();
    const key = await mediaKeyFor(bytes);
    // Content-addressed: the same file re-imported is already there.
    if (await mediaRepo.has(key)) return key;
    return (await mediaRepo.put(key, bytes)) ? key : null;
  } catch {
    return null;
  }
}

/** Read an asset's stored file back out of the media store. */
export async function loadSavedMedia(asset: Asset): Promise<File | null> {
  if (!asset.opfsKey || !mediaRepo.available) return null;
  const bytes = await mediaRepo.get(asset.opfsKey);
  if (!bytes || bytes.byteLength === 0) return null;
  return new File([bytes], asset.name, { type: 'video/mp4' });
}

export interface RestoreReport {
  /** Assets whose media is open again. */
  restored: string[];
  /** Assets that were stored but could not be reopened — these still need the
   *  user to pick the file. */
  lost: string[];
  /** The audio outcome of the last asset restored, for the debug panel. */
  audioReport: string;
}

/** Assets the document says were kept, but whose media is not open yet. */
export function assetsToRestore(assets: readonly Asset[]): Asset[] {
  return assets.filter((a) => a.opfsKey && !getDecodeService(a.id));
}

let inFlight: Promise<RestoreReport> | null = null;

/**
 * Reopen every asset whose file we kept.
 *
 * Started once per page load, not once per mount: React StrictMode mounts twice
 * in development, and a second run would decode every source a second time.
 * Both callers await the same promise.
 */
export function restoreSavedMedia(
  assets: readonly Asset[],
  /** Called before each file is opened. Reopening is sequential and a large
   *  source is not instant — without this, several files look identical to a
   *  stuck one, and a screen reader hears nothing between start and finish. */
  onProgress?: (name: string, index: number, total: number) => void,
): Promise<RestoreReport> {
  if (inFlight) return inFlight;
  inFlight = queueMediaWork(async () => {
    const report: RestoreReport = { restored: [], lost: [], audioReport: '' };
    const pending = assetsToRestore(assets);
    let index = 0;
    for (const asset of pending) {
      onProgress?.(asset.name, ++index, pending.length);
      try {
        const file = await loadSavedMedia(asset);
        if (!file) {
          report.lost.push(asset.name);
          continue;
        }
        const bytes = await file.slice(0).arrayBuffer();
        const media = await attachFileToAsset(asset.id, file, bytes);
        report.audioReport = media.audioReport;
        report.restored.push(asset.name);
      } catch {
        // A stored file that will not open is not worth a stack trace at the
        // user: the recovery is the same either way — pick it again.
        report.lost.push(asset.name);
      }
    }
    return report;
  });
  return inFlight;
}

/**
 * Reclaim files nothing points at any more.
 *
 * Queued, so it can never decide what is live while an import is halfway
 * through committing the asset that would have kept a file alive.
 */
export function sweepStoredMedia(live: ReadonlySet<string>): Promise<string[]> {
  return queueMediaWork(() => sweepMedia(mediaRepo, live));
}
