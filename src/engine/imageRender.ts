// framewright — drawing an image onto a picture (ADR-0020).
//
// One function draws the sticker for BOTH the preview and the export, at
// whatever size the picture is, so the two can never disagree about where it
// sits or how big it is — the same reason `subtitleRender.ts` exists, and the
// same shape: the arithmetic (`imageRect`) is separated from the one canvas
// call so it can be unit-tested in Node, and so the stage can ask where the
// image IS for its hit test with the numbers the draw used.
//
// Everything is relative to the box: the centre is a pair of fractions of it
// (the same language as a clip's pan, ADR-0014, and a subtitle's place,
// ADR-0019) and the width is a fraction of its width, with the height
// following the ASSET's aspect. That is what makes a press on the stage work
// before the bitmap has arrived: the rectangle comes from the asset's
// recorded size, not from the picture.
//
// The bitmap is not the engine's. An image arrives here as a
// `CanvasImageSource` — the same seam the footage and the blend come through
// — and this module never opens, measures or closes one.

/** How wide an image is drawn when the document does not say: a quarter of
 *  the box's width. `StageImage.size` absent means exactly this, and the
 *  document is never rewritten to hold it. */
export const DEFAULT_IMAGE_SIZE = 0.25;

/** The 2D context both a `<canvas>` and an `OffscreenCanvas` hand out — the
 *  same seam `drawSubtitle` draws through (`SubtitleContext`), narrowed to
 *  nothing this module does not call. */
export type ImageContext =
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Where an image sits and how big it is drawn: fractions of the box, each
 *  optional exactly as the document has them — see `StageImage` in
 *  `types.ts`. The stage's hit test passes the document's own fields. */
export interface ImagePlace {
  posX?: number;
  posY?: number;
  size?: number;
}

/**
 * The per-frame answer for one image: which asset's picture, how big that
 * picture is in its own pixels (so the aspect is known before any bitmap
 * arrives), and where it goes. The sibling of `SubtitleFrame` — built once
 * per frame from the document, for both surfaces, and carrying no bitmap:
 * the export plan is made long before any picture is opened.
 */
export interface ImageFrame extends ImagePlace {
  /** The asset whose picture this is — what a surface looks a bitmap up by. */
  assetId: string;
  /** The asset's own pixel size, from `meta.width` / `meta.height`. */
  srcWidth: number;
  srcHeight: number;
}

/**
 * A frame with the picture the surface found for it, or null when that
 * picture has not arrived (or could not be opened, which the export reports
 * and draws as nothing). The composer's input, mirroring `BlendLayer`: the
 * same object carries the picture and how to draw it.
 */
export interface ImageLayer extends ImageFrame {
  picture: CanvasImageSource | null;
}

export interface ImageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp01 = (v: number): number =>
  Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;

/**
 * Where an image of `srcWidth`×`srcHeight` is drawn in a `boxWidth`×
 * `boxHeight` box: `size` of the box's width, the height following the
 * source's aspect, centred on `posX`/`posY` of the box.
 *
 * Only the CENTRE is clamped, to inside the box — a sticker deliberately
 * hung half off the edge is a normal thing to want, so the RECTANGLE is
 * returned as it falls, even when it is bigger than the box on either axis.
 * A source with no recorded size is drawn square rather than not at all.
 */
export function imageRect(
  frame: ImagePlace,
  srcWidth: number,
  srcHeight: number,
  boxWidth: number,
  boxHeight: number,
): ImageRect {
  const share = frame.size ?? DEFAULT_IMAGE_SIZE;
  const width = Number.isFinite(share) ? share * boxWidth : 0;
  const aspect =
    srcWidth > 0 && srcHeight > 0 ? srcHeight / srcWidth : /* square */ 1;
  const height = width * aspect;
  const cx = clamp01(frame.posX ?? 0.5) * boxWidth;
  const cy = clamp01(frame.posY ?? 0.5) * boxHeight;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/**
 * Draw the image onto a picture of the given size. Draws nothing when its
 * picture has not arrived or its rectangle has no area. The caller owns the
 * canvas: this neither clears it nor changes any context state — one
 * `drawImage`, at the caller's alpha.
 */
export function drawImageFrame(
  ctx: ImageContext,
  image: ImageLayer,
  width: number,
  height: number,
): void {
  if (!image.picture) return;
  const r = imageRect(image, image.srcWidth, image.srcHeight, width, height);
  if (!(r.width > 0) || !(r.height > 0)) return;
  ctx.drawImage(image.picture, r.x, r.y, r.width, r.height);
}
