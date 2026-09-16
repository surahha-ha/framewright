// framewright — images on the stage (pure, ADR-0020).
//
// An image is a picture laid over the footage for a range of timeline frames:
// a logo, a sticker, a name card. It has an asset but no window into it (there
// is only the one picture), so it is not a clip — see `StageImage` in
// `types.ts` — and it is not words either, so it is not a subtitle. What it
// shares with the words is the TIMING: it sits between neighbours, it can be
// moved, its two edges can be dragged, and every limit it runs into is named.
// That arithmetic is true of anything on the timeline that is not footage and
// lives once, in `spans.ts`; everything below that delegates keeps its name and
// its shape so a caller reads one module.
//
// What is left here is what makes it an IMAGE:
//
// - the document it reads (a Project, not a bare list), the two seconds a new
//   one lasts, the `img_<n>` id, the three image op kinds;
// - the NORMAL FORM the document stores, which is NOT the subtitle's: whole
//   percents, and 0.5 as an ABSENT field on BOTH axes, because absent means
//   the centre of the box on both (`imageRect`). A subtitle's absent `posY`
//   means the bottom stack, so an image sitting at the bottom edge is a plain
//   0.97 with nothing special about it;
// - the SNAP at the drop, which is the centre and nothing else: there are no
//   presets to snap to, and an image hung deliberately half off an edge must
//   stay where it was dropped;
// - `imageFrameAt`, the one answer to "what picture does frame N show", asked
//   by the preview and by the export plan so the two cannot disagree;
// - the seam an actual picture arrives through (`ImageSource`), and the
//   sentences.
//
// The bitmap is not the engine's, exactly as a font file is not (`FontLoader`,
// `fonts.ts`): opening one is a browser act, so it lives behind `ImageSource`
// and a Node test hands in one that says no to everything.

import type { Asset, Project, StageImage } from './types';
import { videoDuration } from './timeline';
import { secToFrame } from './time';
import type { Op } from './ops';
import type { ExportFrame } from './exportPlan';
import { DEFAULT_IMAGE_SIZE, type ImageFrame } from './imageRender';
// The stage's snap radius, defined where the first stage drag needed it
// (ADR-0019). One distance for one gesture on one surface: two copies would
// drift and the two drags would start to feel different.
import { SNAP } from './subtitlePosition';
import {
  locateSpan,
  rippleSpans,
  spanAt,
  spanDiffOps,
  spanLimits,
  spanPlan,
  splitSpanAt,
} from './spans';

/** How long a freshly placed image lasts, before the user drags its edges.
 *  The subtitle's two seconds, for the same reason: long enough to see. */
export const DEFAULT_IMAGE_SEC = 2;

/** The ends of the 크기 slider, as fractions of the box's width. The floor is
 *  not 0: an image of no width is an image that is gone, and there is a
 *  command for that. */
export const MIN_IMAGE_SIZE = 0.05;
export const MAX_IMAGE_SIZE = 1;

/** The middle of an axis — what an absent `posX` / `posY` draws at. */
const CENTRE = 0.5;

export function imageLength(i: StageImage): number {
  return i.endFrame - i.startFrame;
}

/** The image shown on this frame, if any. Half-open like everything else. */
export function imageAt(project: Project, frame: number): StageImage | null {
  return spanAt(project.images, frame);
}

export function locateImage(
  project: Project,
  id: string | null,
): { index: number; image: StageImage } | null {
  const found = locateSpan(project.images, id);
  return found ? { index: found.index, image: found.span } : null;
}

/**
 * Where a new image goes: at the playhead, for the default length, cut short
 * by whichever comes first — the next image or the end of the picture. Null
 * when there is no room at all: off the end of the video, or on a frame that
 * already has an image (this unit shows one at a time). The two seconds become
 * frames here, through `time.ts`; `spanPlan` counts frames.
 */
export function imagePlan(
  project: Project,
  playhead: number,
): { startFrame: number; endFrame: number; index: number } | null {
  return spanPlan(
    project.images,
    videoDuration(project),
    secToFrame(DEFAULT_IMAGE_SEC, project.timeline.fps),
    playhead,
  );
}

/**
 * Room an image's edges have, in timeline frames — the same four numbers a
 * subtitle gets: the neighbours on either side, the end of the picture, and
 * its own end when the video was shortened underneath it, so it can still be
 * pulled back in.
 */
export function imageLimits(
  project: Project,
  id: string,
): {
  minStart: number;
  maxStart: number;
  minEnd: number;
  maxEnd: number;
} | null {
  return spanLimits(project.images, videoDuration(project), id);
}

/**
 * Move the images the way a ripple edit moved the footage under them — a logo
 * put on a shot belongs to that shot. `rippleSpans` holds the rule, including
 * why an image straddling an insert point is split first (`splitImageAt`).
 */
export function rippleImages(
  images: StageImage[],
  at: number,
  delta: number,
): StageImage[] {
  return rippleSpans(images, at, delta);
}

/**
 * Cut the one image that straddles `at` into two: the head keeps its id and
 * ends at `at`, the tail is a new image of the same asset, in the same place
 * and at the same size, from `at` on. The id is this list's own `img_<n>`,
 * minted from the document's counter so redo is deterministic. Returns the
 * counter to store after it; unmoved when nothing straddled.
 */
export function splitImageAt(
  images: StageImage[],
  at: number,
  nextId: number,
): { images: StageImage[]; nextId: number } {
  const { spans, split } = splitSpanAt(images, at, () => `img_${nextId}`);
  return { images: spans, nextId: split ? nextId + 1 : nextId };
}

/**
 * The ops that take `before` to `after`, with their inverses — for a command
 * that moved the footage and now has to move what sits on it. The order that
 * keeps the index arithmetic honest is `spanDiffOps`'; the three op kinds are
 * this list's (`ops.ts`).
 */
export function imageDiffOps(
  before: StageImage[],
  after: StageImage[],
): { forward: Op[]; inverse: Op[] } {
  return spanDiffOps<StageImage, Op>(before, after, {
    insert: (index, image) => ({ kind: 'insertImage', index, image }),
    remove: (index) => ({ kind: 'removeImage', index }),
    retime: (imageId, startFrame, endFrame) => ({
      kind: 'updateImage',
      imageId,
      changes: { startFrame, endFrame },
    }),
  });
}

// ---- THE NORMAL FORM ----

/** Where the centre of the image sits, exactly as the document has it. */
export type ImagePosition = Pick<StageImage, 'posX' | 'posY'>;

/** Whole percents of the box, inside it. A value that is not a number at all
 *  (a hand-edited document, a slider read from nothing) reads as the middle
 *  rather than reaching the document as NaN — `imageRect` does the same. */
function percent(v: number, lo = 0, hi = 1): number {
  return Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100;
}

function axis(v: number | undefined): number | undefined {
  if (v === undefined) return undefined;
  return Number.isFinite(v) ? percent(v) : CENTRE;
}

/**
 * The form the document stores for a position: whole percents, and the centre
 * of an axis as an ABSENT field on that axis — so a drop in the middle IS the
 * centre, byte for byte, and two spellings of the same place compare equal
 * (`samePosition`). Both axes have the same rule, because absent means the
 * centre on both; a subtitle's `posY` does not work this way.
 */
export function normalizeImagePosition(p: {
  posX?: number;
  posY?: number;
}): ImagePosition {
  const x = axis(p.posX);
  const y = axis(p.posY);
  return {
    posX: x === CENTRE ? undefined : x,
    posY: y === CENTRE ? undefined : y,
  };
}

/**
 * The form the document stores for a size: a whole percent of the box's
 * width, inside the slider's ends, and the default written back as ABSENT so
 * an image never carries a number that says what nothing saying anything
 * would already draw.
 */
export function normalizeImageSize(size: number): number | undefined {
  if (!Number.isFinite(size)) return undefined;
  const v = percent(size, MIN_IMAGE_SIZE, MAX_IMAGE_SIZE);
  return v === DEFAULT_IMAGE_SIZE ? undefined : v;
}

/** How wide the image is drawn, with the default applied — the number the
 *  slider shows and the one a no-change refusal compares. */
export function imageSizeOf(i: Pick<StageImage, 'size'>): number {
  return i.size ?? DEFAULT_IMAGE_SIZE;
}

function near(v: number, target: number): boolean {
  return Math.abs(v - target) <= SNAP;
}

/**
 * The drop: each axis pulled to the centre when it lands within `SNAP` of it,
 * and to NOTHING else. The words have three presets to fall into; an image
 * has one place worth naming and is otherwise put exactly where it was let
 * go — a sticker deliberately hung off an edge must not creep. Returns the
 * normal form.
 */
export function snapImagePosition(p: {
  posX: number;
  posY: number;
}): ImagePosition {
  return normalizeImagePosition({
    posX: near(p.posX, CENTRE) ? CENTRE : p.posX,
    posY: near(p.posY, CENTRE) ? CENTRE : p.posY,
  });
}

/**
 * Whether two positions are the same PLACE — both sides through the normal
 * form, both absent axes read as the centre. What a command asks before it
 * pushes an undo entry: a drag that ends a third of a percent from where it
 * started, or on the centre an image is already at, changed nothing on screen
 * and must not cost the user a Ctrl+Z.
 */
export function samePosition(
  a: { posX?: number; posY?: number },
  b: { posX?: number; posY?: number },
): boolean {
  const x = normalizeImagePosition(a);
  const y = normalizeImagePosition(b);
  return (
    (x.posX ?? CENTRE) === (y.posX ?? CENTRE) &&
    (x.posY ?? CENTRE) === (y.posY ?? CENTRE)
  );
}

// ---- THE FRAME ----

/**
 * The picture on one frame: which asset, how big that asset is in its own
 * pixels (so the aspect — and the stage's hit test — is known before any
 * bitmap arrives), and only the place and size fields the image actually has.
 * The sibling of `subtitleFrameOf`.
 */
export function imageFrameOf(image: StageImage, asset: Asset): ImageFrame {
  return {
    assetId: image.assetId,
    // A source whose size was never recorded is reported as zero and drawn
    // square (`imageRect`) rather than not at all.
    srcWidth: asset.meta.width ?? 0,
    srcHeight: asset.meta.height ?? 0,
    ...(image.posX !== undefined ? { posX: image.posX } : {}),
    ...(image.posY !== undefined ? { posY: image.posY } : {}),
    ...(image.size !== undefined ? { size: image.size } : {}),
  };
}

/** What frame `frame` shows, or null: no image there, or one pointing at an
 *  asset this document does not have — nothing could be looked up for it, so
 *  it is not drawn and the export is never asked to open it. */
export function imageFrameAt(
  project: Project,
  frame: number,
): ImageFrame | null {
  const image = imageAt(project, frame);
  if (!image) return null;
  const asset = project.assets.find((a) => a.id === image.assetId);
  return asset ? imageFrameOf(image, asset) : null;
}

/** The pictures an export plan draws, once each, in first-use order — what
 *  the export must have open before its first frame. `fontsInPlan`'s shape. */
export function imagesInPlan(
  plan: readonly Pick<ExportFrame, 'image'>[],
): string[] {
  const out: string[] = [];
  for (const f of plan) {
    const assetId = f.image?.assetId;
    if (assetId && !out.includes(assetId)) out.push(assetId);
  }
  return out;
}

// ---- THE SEAM ----

/**
 * How a picture reaches a surface. The bitmap has ONE owner, the browser-side
 * cache (`ui/images.ts`), which opens it, hands the same long-lived object to
 * the preview and the export, and closes it when the document stops naming
 * it — so nothing here, and nothing in the exporter, ever closes one.
 *
 * `load` never throws: it resolves true when the picture can be drawn and
 * false when it cannot (the file is gone, the bytes are not an image), and
 * the caller draws without it either way.
 */
export interface ImageSource {
  ready(assetId: string): boolean;
  get(assetId: string): CanvasImageSource | null;
  load(assetId: string): Promise<boolean>;
}

/** No picture ever arrives — what a Node test, or an export with no source
 *  handed in, runs against. `NO_FONTS`' sibling. */
export const NO_IMAGES: ImageSource = {
  ready: () => false,
  get: () => null,
  load: async () => false,
};

// ---- SENTENCES ----

/** One axis in words. An absent field is the middle of that axis, and it is
 *  said as the number rather than as a word: the image has no named places
 *  but the one, so a percent is the only thing that means anything here. */
export function imageXText(posX: number | undefined): string {
  return `왼쪽에서 ${Math.round((posX ?? CENTRE) * 100)}%`;
}
export function imageYText(posY: number | undefined): string {
  return `위에서 ${Math.round((posY ?? CENTRE) * 100)}%`;
}

/** Where the image is, without a verb: the panel row's sentence. */
export function imagePositionText(p: ImagePosition): string {
  return `${imageXText(p.posX)} · ${imageYText(p.posY)}`;
}

/** The move's sentence: the centre has its own, because it is the one place
 *  a drop snaps to and saying "왼쪽에서 50% · 위에서 50%" for it would hide
 *  that the snap happened. */
export function describeImagePosition(p: ImagePosition): string {
  const now = normalizeImagePosition(p);
  if (now.posX === undefined && now.posY === undefined) {
    return '이미지를 가운데로 옮겼어요.';
  }
  return `이미지를 옮겼어요 · ${imagePositionText(now)}.`;
}

/** The size slider's sentence. A percent of the box's WIDTH; the height
 *  follows the picture's own shape and is never said. */
export function describeImageSize(size: number | undefined): string {
  return `이미지 크기를 ${Math.round(imageSizeOf({ size }) * 100)}%로 바꿨어요.`;
}

/** The export's warning for the pictures it could not open, by file name —
 *  those frames were exported with the footage and nothing over it.
 *  `missingFontsText`' shape, and its leading space. */
export function missingImagesText(names: readonly string[]): string {
  if (names.length === 0) return '';
  return ` ⚠ ${names.join(', ')} 이미지를 열지 못해 그리지 않았어요.`;
}

/** Re-exported so a caller snapping an image needs only this module — the
 *  way `subtitles.ts` re-exports `snapFrame`. */
export { SNAP };
