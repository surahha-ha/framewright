// framewright — the peaks behind a clip's waveform: reduce once, hand back, forget.
//
// Sibling of `src/ui/thumbnails.ts` and deliberately much smaller, because the
// hard part is somewhere else. A thumbnail has to be fetched from a decoder that
// can fail, be slow, or be swapped underneath you; audio is already in memory
// (`engine/audio.ts` holds an `AudioBuffer` per asset), so this file has no
// queue to prioritise, nothing to close and no failure mode of its own. What it
// owns is WHEN the reduction runs and HOW it is invalidated.
//
//   1. Never during a render. `getPeaks` is a map lookup; `requestPeaks` puts
//      the asset in line and returns. A component that re-renders on every
//      scroll pixel must not start a pass over sixteen million samples.
//   2. One asset at a time, after a yield, so the frame that asked for it paints
//      first. The pass itself is synchronous — see the note on `pump`.
//   3. Invalidated by BUFFER IDENTITY, not by presence. A re-link keeps the
//      asset id and puts a NEW `AudioBuffer` under it, so
//      `getAudioBuffer(id) === theBufferIReduced` is the whole test for "are
//      these peaks still of the right file". It is the same rule the thumbnail
//      cache needed against the decode service, arrived at from the other side:
//      there the identity had to be checked by hand, here the object the peaks
//      were built from IS the receipt. The same identity also drives `refuse`,
//      which is how a file on its way OUT is kept from being reduced during the
//      moment when it is still, technically, the current one.

import { getAudioBuffer } from '../engine/audio';
import { buildPyramid, type Pyramid } from '../engine/waveform';

interface Entry {
  /** The buffer these peaks were reduced from. Compared by identity. */
  buffer: AudioBuffer;
  pyramid: Pyramid;
}

/**
 * One entry per asset. Bounded by the document rather than by a limit: the key
 * is an asset id, so this cannot outgrow the media bin, and `retainOnlyPeaks`
 * empties it as assets leave. (The thumbnail cache is keyed by asset AND frame,
 * which is why that one needs a number.)
 */
const cache = new Map<string, Entry>();
/** Assets asked for but not reduced yet. Same bound, same reason. */
const wanted = new Set<string>();
/**
 * Audio this module must NOT reduce, and the asset it is bound to. One map for
 * two reasons, because the rule they need is the same one: "while this asset's
 * current buffer is THIS object, leave it alone."
 *
 *   - a re-link in progress. `bindMedia` swaps the decoder and calls
 *     `releasePeaks` BEFORE the new audio is decoded, so at that moment
 *     `getAudioBuffer` still answers with the old buffer — and `releasePeaks`
 *     notifies, every clip re-renders, and the re-render asks again. Without
 *     this the module would reduce the file being replaced and cache it as
 *     current, which by identity it still is.
 *   - a reduction that threw. A buffer whose samples cannot be read is asked
 *     for on every render for as long as its clip is on screen, so the failure
 *     is remembered exactly like `thumbnails.ts` remembers a frame that came
 *     back empty.
 *
 * Both entries lift by themselves: the moment the asset points at a DIFFERENT
 * buffer, the identity no longer matches and the next ask goes through. Bounded
 * by the document, like the other two collections here.
 */
const refuse = new Map<string, AudioBuffer>();

function refused(assetId: string, buffer: AudioBuffer): boolean {
  return refuse.get(assetId) === buffer;
}
const listeners = new Set<() => void>();

let running = false;
let notifyScheduled = false;

function notify(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    for (const fn of [...listeners]) fn();
  });
}

/** Re-render when an asset's peaks arrive. Returns the unsubscribe. */
export function subscribeWaveforms(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The peaks for this asset, if they are already built. Never builds: a render
 * must not start work.
 *
 * Returns null once the audio underneath has been replaced — the stale entry is
 * dropped here rather than waiting for someone to ask for it again, so a
 * re-linked clip goes blank for a moment instead of showing the old file's
 * shape as if it were the new one's.
 */
export function getPeaks(assetId: string): Pyramid | null {
  const entry = cache.get(assetId);
  if (!entry) return null;
  if (getAudioBuffer(assetId) !== entry.buffer) {
    cache.delete(assetId);
    return null;
  }
  return entry.pyramid;
}

/** Ask for an asset's peaks. Cheap and idempotent — safe to call from a render. */
export function requestPeaks(assetId: string): void {
  const buffer = getAudioBuffer(assetId);
  // No audio bound yet — a project restored before its file was re-linked, or a
  // source still decoding. Not remembered as a refusal: binding the media is
  // exactly what makes this possible, and the next render asks again.
  if (!buffer) return;
  if (refused(assetId, buffer)) return;
  const entry = cache.get(assetId);
  if (entry && entry.buffer === buffer) return;
  wanted.add(assetId);
  void pump();
}

/** Forget the peaks of assets no longer in the document — the same shape as
 *  `registry.retainOnly` and `retainOnlyThumbnails`, called from the same place. */
export function retainOnlyPeaks(assetIds: Iterable<string>): void {
  const keep = new Set(assetIds);
  for (const id of [...cache.keys()]) if (!keep.has(id)) cache.delete(id);
  for (const id of [...wanted]) if (!keep.has(id)) wanted.delete(id);
  for (const id of [...refuse.keys()]) if (!keep.has(id)) refuse.delete(id);
}

/**
 * Throw away one asset's peaks, and refuse the audio that is bound right now.
 *
 * Called when its media is (re-)bound, for the same reason `releaseThumbnails`
 * is — but it cannot just drop the entry, because of WHEN it is called.
 * `bindMedia` swaps the decoder first and decodes the audio after, so between
 * the two `getAudioBuffer` still answers with the OLD buffer and the identity
 * check cannot tell yet. Dropping alone would therefore undo itself: this
 * notifies, every clip re-renders, the re-render asks again, and the file being
 * replaced is reduced and cached as current. Hence `refuse`, which the arrival
 * of the new buffer lifts by itself.
 */
export function releasePeaks(assetId: string): void {
  cache.delete(assetId);
  wanted.delete(assetId);
  // And refuse the buffer that is bound RIGHT NOW, which during a re-link is
  // still the outgoing file's. See `refuse`.
  const current = getAudioBuffer(assetId);
  if (current) refuse.set(assetId, current);
  else refuse.delete(assetId);
  notify();
}

/**
 * Reduce the queue, one asset at a time.
 *
 * The yield is the point. `buildPyramid` is a single synchronous pass over every
 * sample — about 30ms for ten minutes of stereo — and running it inside the
 * effect that asked for it would drop the frame that is trying to show the clip
 * the user just imported. Yielding first also means the buffer is read AFTER the
 * wait, so an asset re-linked while it sat in the queue is reduced from the new
 * file rather than the one that was current when it was asked for.
 *
 * There is deliberately no identity re-check after the build: nothing can happen
 * between reading the buffer and caching the result, because the pass does not
 * await. Chunking it (the fix if a long source ever makes that 30ms visible)
 * would reopen that window, and the check would have to come back with it.
 */
async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (wanted.size > 0) {
      // Yield BEFORE taking the next asset, not after. Taking it first would
      // put it beyond the reach of `retainOnlyPeaks`, and an asset deleted
      // during the wait would still be reduced and cached — the cleanup that
      // just ran, undone by work it could no longer see.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const next = wanted.values().next();
      if (next.done) break;
      const assetId = next.value;
      wanted.delete(assetId);
      const buffer = getAudioBuffer(assetId);
      if (!buffer || refused(assetId, buffer)) continue;
      try {
        const channels: Float32Array[] = [];
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          channels.push(buffer.getChannelData(c));
        }
        // Cached even when it reduces to nothing (a track with no samples), so
        // an empty source is asked for once instead of on every render.
        cache.set(assetId, {
          buffer,
          pyramid: buildPyramid(channels, buffer.sampleRate),
        });
        notify();
      } catch {
        // Nothing here may throw. `pump` is started as `void pump()`, so an
        // escaping error is an unhandled rejection that stops the queue, tells
        // nobody, and is asked for again on the very next render. A waveform is
        // decoration; it must never take the editor down or spin.
        refuse.set(assetId, buffer);
      }
    }
  } finally {
    running = false;
  }
}
