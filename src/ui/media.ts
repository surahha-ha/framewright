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

/**
 * Storage keys whose bytes this page load has actually HELD — written at an
 * import (`persistMedia`) or read back at a restore (`loadSavedMedia`).
 *
 * It starts empty on every load and nothing in the saved document can fill it:
 * an `opfsKey` is only what the document REMEMBERS, and a browser that evicted
 * the file remembers it just the same. So a key is in here only because some
 * call in this session held its bytes, which is what makes it safe to answer
 * "the media is here" with. A module singleton of the same shape as `mediaRepo`
 * above, with the same caveat for two documents at once.
 */
const heldMediaKeys = new Set<string>();

/**
 * Assets whose media this page load holds although NOTHING was stored for it.
 *
 * One case, and it is the picture's: a browser that would not keep the bytes
 * gives the asset no `opfsKey`, so there is no key to hold above — and yet the
 * import decoded the file and the bitmap cache is keeping the picture for the
 * rest of the session (`ui/images.ts`, `importImageFile`). Without this the
 * bin would print 다시 선택 필요 over a picture that is right there, and the
 * export would refuse to run at all.
 */
const heldAssetIds = new Set<string>();

/**
 * Say that this asset's media is in hand with no stored file behind it. The
 * import calls it for a picture it could not keep; nothing else should, because
 * nothing else holds media that outlives the store.
 */
export function markMediaHeld(assetId: string): void {
  heldAssetIds.add(assetId);
}

/**
 * Keep only the media the document still names — `retainOnly`'s shape, called
 * from the same effect in `App.tsx` as the five caches, and for the same
 * reason: a claim that outlives what it is a claim about.
 *
 * What `heldAssetIds` says is "the BITMAP CACHE is holding this picture,
 * although no file was stored" — so its truth ends exactly where
 * `retainOnlyImages` ends, and that is why the two run together. Left
 * unswept it was a readiness flag nobody could clear: import a picture in a
 * browser that will not keep files, undo, redo, and the asset comes back with
 * the same deterministic id and still no file, while the bin draws a healthy
 * row and the export refuses nothing — and then writes a video with the
 * picture missing and a ⚠ about it afterwards.
 *
 * The other set here, `heldMediaKeys`, is keyed by `opfsKey` rather than by
 * asset id — so this could have taken the assets and swept both. It
 * deliberately does not, which is why it takes the same ids the other five
 * retainers do. That set says "these bytes were read in this page load", and
 * an asset leaving the document does not make that false: the file is still in
 * the store, because the sweep that deletes one (`sweepStoredMedia`) runs at
 * startup only — precisely so a redo still finds it. Dropping a key here would
 * answer 다시 선택 필요 for a picture whose file is right where the document
 * says it is. What DOES make it false is the file being deleted, and that is
 * where it is already swept.
 *
 * Nor can this one be narrowed to "still has no stored file of its own": a
 * re-link in a browser that will not keep files leaves the asset carrying the
 * key it remembers from a session that could, and the picture in hand is again
 * the only copy there is.
 */
export function retainOnlyMedia(assetIds: Iterable<string>): void {
  const live = new Set(assetIds);
  for (const assetId of [...heldAssetIds]) {
    if (!live.has(assetId)) heldAssetIds.delete(assetId);
  }
}

/**
 * Is this asset's media open — the one question three surfaces ask before they
 * draw, play or export.
 *
 * A VIDEO is ready when its decoder is registered, which is what it was before
 * this function existed. An IMAGE never gets a decoder, so asking the registry
 * about one answers "lost" for ever (that was the bug): its readiness is
 * whether its bytes were held in this page load, above.
 *
 * Deliberately NOT the bitmap cache's `ImageSource.ready` (`ui/images.ts`).
 * That answers a different question — "is it decoded and drawable right now" —
 * and it is filled lazily by drawing, so a document whose pictures are all
 * present would report every one of them missing until something asked for it,
 * and the stage would tell the user to go and find files that are already here.
 * This one cannot say ready for a picture whose file is gone, because the read
 * that would have marked it returns nothing.
 */
export function isMediaReady(asset: Asset): boolean {
  if (asset.kind === 'image') {
    if (heldAssetIds.has(asset.id)) return true;
    return asset.opfsKey !== undefined && heldMediaKeys.has(asset.opfsKey);
  }
  return getDecodeService(asset.id) !== null;
}

/**
 * The picture already in this document that a file of this name would re-link
 * to, or undefined — nothing of that name is missing, so the file is a new
 * import.
 *
 * Footage's half of the same question is inline in `MediaBin` and asks the
 * decode registry, because what it re-links is a decoder. A picture has none:
 * what makes one missing is that its bytes are not in hand, which is
 * `isMediaReady`'s question, above.
 *
 * **It has to be asked before the re-picked file is kept.** Keeping those
 * bytes is exactly what turns `isMediaReady` over for a picture, so a caller
 * that stored first would find nothing missing and import a second copy of a
 * picture the document already has.
 */
export function imageToRelink(
  assets: readonly Asset[],
  name: string,
): Asset | undefined {
  return assets.find(
    (a) => a.kind === 'image' && a.name === name && !isMediaReady(a),
  );
}

/**
 * What the bin's drop zone asks for, in the state the project is in.
 *
 * A picture cannot be the first thing in a project — `image.import` is refused
 * before there is any footage ("먼저 영상을 불러오세요.") and the asset is
 * never made, so a file dropped then leaves no trace and has to be found
 * again. Inviting one anyway is an offer the app does not honour, so the words
 * follow the same fact the command is refused by (`videoDuration > 0`) and the
 * store's opening sentence says (영상을 불러오세요.).
 *
 * The invitation's second line — 또는 클릭 — does not change with the state and
 * stays where it is drawn.
 */
export function dropInvitation(hasFootage: boolean): string {
  return hasFootage ? '영상이나 이미지 드래그' : '영상 드래그';
}

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
    if (await mediaRepo.has(key)) {
      heldMediaKeys.add(key);
      return key;
    }
    if (!(await mediaRepo.put(key, bytes))) return null;
    // The bytes are in hand and now in the store, so an image imported in this
    // session is ready without waiting for a reload to read it back — this is
    // the import half of what `isMediaReady` answers.
    heldMediaKeys.add(key);
    return key;
  } catch {
    return null;
  }
}

/**
 * What to call the bytes we just read back.
 *
 * The container is not recorded in the asset — only its name is — so a picture
 * is typed from its extension. Getting this right is not cosmetic: a `File`
 * handed to `<img>` through an object URL is served with the type given here,
 * so calling a PNG `video/mp4` would refuse to draw. An extension we do not
 * know gets an empty type rather than a guess: empty means "work it out from
 * the bytes", a wrong type means "do not draw this".
 */
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

function mediaTypeOf(asset: Asset): string {
  if (asset.kind !== 'image') return 'video/mp4';
  const ext = asset.name.toLowerCase().split('.').pop() ?? '';
  return IMAGE_TYPES[ext] ?? '';
}

/** Read an asset's stored file back out of the media store. */
export async function loadSavedMedia(asset: Asset): Promise<File | null> {
  if (!asset.opfsKey || !mediaRepo.available) return null;
  const bytes = await mediaRepo.get(asset.opfsKey);
  if (!bytes || bytes.byteLength === 0) return null;
  // Held, now: everything below this line has real bytes to work with, and for
  // a picture that IS the whole of being restored.
  heldMediaKeys.add(asset.opfsKey);
  return new File([bytes], asset.name, { type: mediaTypeOf(asset) });
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

/** Assets the document says were kept, but whose media is not open yet.
 *
 *  Through `isMediaReady`, so a picture leaves this list once its bytes have
 *  been read: asking the decode registry about one — which is what this did —
 *  answered "still to do" every time it was called, for ever. */
export function assetsToRestore(assets: readonly Asset[]): Asset[] {
  return assets.filter((a) => a.opfsKey && !isMediaReady(a));
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
        if (asset.kind === 'image') {
          // Reading the bytes back IS the restore for a picture: there is no
          // container to demux, no decoder to register and no audio to bind,
          // and sending one down that path would demux a PNG and report the
          // failure as a lost file. Whether those bytes can be DRAWN is the
          // bitmap cache's question, asked when something draws them, and its
          // own failure has its own answer on screen.
          report.restored.push(asset.name);
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
  return queueMediaWork(async () => {
    const removed = await sweepMedia(mediaRepo, live);
    // What was deleted is not held any more. Nothing live can be swept (the
    // sweep keeps every key the document points at), so this can never unready
    // an asset that is still in the project — it only stops the set outliving
    // the bytes, and keeps it from growing across a long session.
    for (const key of removed) heldMediaKeys.delete(key);
    return removed;
  });
}
