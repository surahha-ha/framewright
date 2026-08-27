// framewright — the pictures in the thumbnail strip: decode, cache, hand back.
//
// Not in `src/engine/**`: this touches WebCodecs through the decode registry
// and builds `ImageBitmap`s, and it holds no document logic. Where each picture
// GOES is `src/engine/thumbnails.ts`, which is pure and tested in Node; this
// file only answers "do I have that frame yet, and if not, go and get it".
//
// Three rules that are not obvious and are expensive to rediscover:
//
//   1. Every `VideoFrame` is closed on every path. A strip re-decodes on every
//      scroll and zoom, which makes this the easiest place in the app to leak
//      one per pointer event.
//   2. Decodes are SERIAL. `decodeAtSec` builds a `VideoDecoder`, seeks to a
//      keyframe and decodes forward; a screenful of those started at once is a
//      screenful of decoders, and the tab stops answering.
//   3. The newest request wins. A user who drags the scrollbar across a long
//      clip queues hundreds of frames they will never look at — so the queue is
//      a stack, and what is on screen now is decoded first.

import { frameToSec } from '../engine/time';
import { getDecodeService } from '../engine/registry';
import type { Rational } from '../engine/types';

/**
 * How tall a cached picture is, in device pixels. Twice the 44px a clip is
 * drawn at, so the strip stays sharp on a 2x display; the width follows from
 * the source's aspect ratio.
 */
const THUMB_BITMAP_H = 88;

/**
 * How many pictures are kept. A window holds at most ~14 at a time, so this is
 * a few screenfuls of scrolling and of zoom history — enough that going back to
 * where you were is instant, and bounded so a long clip cannot grow it without
 * limit. At roughly 60KB each this is about 15MB.
 */
const CACHE_LIMIT = 240;

/**
 * How many pictures may be waiting to be decoded. A little over two screenfuls:
 * enough that a zoom step does not throw away work already asked for, small
 * enough that a fast scroll cannot leave the decoder minutes behind the view.
 */
const QUEUE_LIMIT = 32;

type Key = string;

/** Insertion-ordered, so the oldest key is simply the first one. */
const cache = new Map<Key, ImageBitmap>();
/** Frames asked for but not decoded yet. A Map, so re-asking re-prioritises. */
const queue = new Map<
  Key,
  { assetId: string; sourceFrame: number; fps: Rational }
>();
/** Frames that came back empty. Remembered so a missing frame is asked for
 *  once, not on every render for as long as the clip is on screen. Bounded for
 *  the same reason the other two are: a long session scrubbing a partly
 *  unreadable source would otherwise grow it without limit. */
const missing = new Set<Key>();
const MISSING_LIMIT = 2048;

function rememberMissing(key: Key): void {
  missing.add(key);
  while (missing.size > MISSING_LIMIT) {
    const oldest = missing.values().next();
    if (oldest.done) break;
    missing.delete(oldest.value);
  }
}
const listeners = new Set<() => void>();

let running = false;
let notifyScheduled = false;

function keyOf(assetId: string, sourceFrame: number): Key {
  return assetId + ':' + sourceFrame;
}

/**
 * Tell the UI that new pictures have arrived — once per batch, not once per
 * decode. A screenful is a dozen decodes; re-rendering the timeline a dozen
 * times in a row makes the strip flicker while it fills in.
 */
function notify(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    for (const fn of [...listeners]) fn();
  });
}

/** Re-render when a picture arrives. Returns the unsubscribe. */
export function subscribeThumbnails(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The picture for this source frame, if it is already decoded. Never decodes:
 * a render must not start work, or a component that re-renders on every scroll
 * pixel starts work on every scroll pixel.
 */
export function getThumbnail(
  assetId: string,
  sourceFrame: number,
): ImageBitmap | null {
  const key = keyOf(assetId, sourceFrame);
  const hit = cache.get(key);
  if (!hit) return null;
  // Touch: re-inserting moves it to the end, which is what makes the Map an LRU
  // rather than a first-in-first-out.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

/** Ask for a frame. Cheap and idempotent — safe to call from a render. */
export function requestThumbnail(
  assetId: string,
  sourceFrame: number,
  fps: Rational,
): void {
  const key = keyOf(assetId, sourceFrame);
  if (cache.has(key) || missing.has(key)) return;
  // Delete first: re-inserting moves this to the END of the queue, and the
  // queue is drained from the end. A frame asked for again is a frame the user
  // is looking at right now.
  queue.delete(key);
  queue.set(key, { assetId, sourceFrame, fps });
  // Dragging the scrollbar across a long clip asks for hundreds of frames the
  // user will never look at. The queue is drained from the END, so the entries
  // at the front are the stalest — drop those rather than decode them.
  while (queue.size > QUEUE_LIMIT) {
    const oldest = queue.keys().next();
    if (oldest.done) break;
    queue.delete(oldest.value);
  }
  void pump();
}

/**
 * Forget the pictures for assets that are no longer in the document — the same
 * shape as `registry.retainOnly`, and called from the same place. An
 * `ImageBitmap` holds GPU-side memory that garbage collection does not hurry
 * to release, so they are closed explicitly.
 */
export function retainOnlyThumbnails(assetIds: Iterable<string>): void {
  const keep = new Set(assetIds);
  for (const [key, bitmap] of [...cache]) {
    if (!keep.has(key.slice(0, key.lastIndexOf(':')))) {
      bitmap.close();
      cache.delete(key);
    }
  }
  for (const key of [...queue.keys()]) {
    if (!keep.has(key.slice(0, key.lastIndexOf(':')))) queue.delete(key);
  }
  for (const key of [...missing]) {
    if (!keep.has(key.slice(0, key.lastIndexOf(':')))) missing.delete(key);
  }
}

/**
 * Throw away everything cached for ONE asset. Called when its media is
 * (re-)bound: the document keeps the same asset id across a re-link, so
 * without this the strip would keep showing frames decoded from the file that
 * was replaced — the same trap `Preview` already avoids with `mediaVersion`,
 * except a stale picture looks correct instead of failing loudly.
 */
export function releaseThumbnails(assetId: string): void {
  const prefix = assetId + ':';
  for (const [key, bitmap] of [...cache]) {
    if (key.startsWith(prefix)) {
      bitmap.close();
      cache.delete(key);
    }
  }
  for (const key of [...queue.keys()]) if (key.startsWith(prefix)) queue.delete(key);
  // A frame that could not be read from the OLD file says nothing about the new
  // one, so the refusals are forgotten too.
  for (const key of [...missing]) if (key.startsWith(prefix)) missing.delete(key);
  notify();
}

function evict(): void {
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    cache.get(oldest.value)?.close();
    cache.delete(oldest.value);
  }
}

/**
 * Drain the queue, newest first, one decode at a time.
 *
 * Nothing here throws: a source the browser cannot decode, an asset whose media
 * was never re-linked, a frame past the end of the file — all of them mean "no
 * picture", which the strip draws as the plain clip it drew before this
 * existed. A thumbnail is decoration; it must never take the editor down.
 */
async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.size > 0) {
      const key = lastKey(queue);
      if (key === null) return;
      const job = queue.get(key)!;
      queue.delete(key);
      const service = getDecodeService(job.assetId);
      if (!service) {
        // No media bound yet (a project restored before its file was
        // re-linked). Not remembered as missing: binding the media is exactly
        // what makes this decodable, and it can happen at any moment.
        continue;
      }
      let frame: VideoFrame | null = null;
      try {
        frame = await service.decodeAtSec(frameToSec(job.sourceFrame, job.fps));
        if (!frame) {
          if (isStillCurrent(job.assetId, service)) rememberMissing(key);
          continue;
        }
        const bitmap = await createImageBitmap(frame, {
          resizeHeight: THUMB_BITMAP_H,
          resizeQuality: 'low',
        });
        // A decode takes long enough for the asset to be removed, or its media
        // re-linked, while it is in flight. Either way this picture is of a
        // file the clip no longer points at: caching it would undo the cleanup
        // that just ran, and after a re-link it would be a picture of the wrong
        // footage presented as the right one.
        if (!isStillCurrent(job.assetId, service)) {
          bitmap.close();
          continue;
        }
        cache.set(key, bitmap);
        evict();
        notify();
      } catch {
        if (isStillCurrent(job.assetId, service)) rememberMissing(key);
      } finally {
        frame?.close();
      }
    }
  } finally {
    running = false;
  }
}

/** Is this still the service the asset decodes with? Identity, not presence:
 *  a re-link swaps a NEW service in under the same asset id. */
function isStillCurrent(assetId: string, service: unknown): boolean {
  return getDecodeService(assetId) === service;
}

function lastKey(map: Map<Key, unknown>): Key | null {
  let last: Key | null = null;
  for (const key of map.keys()) last = key;
  return last;
}
