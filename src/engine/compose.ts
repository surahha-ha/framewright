// framewright — one output frame from its parts (ADR-0011, ADR-0012).
//
// The preview and the export used to draw a frame each in their own way, and
// agreed only because both were simple. A frame now has up to five parts —
// black, the footage, a second picture at some strength, an image, the words
// — and the order and the letterboxing must be the same on screen and in the
// file, so there is one function for both. The subtitle and the image are
// optional here because the preview keeps each on its own layer (the words
// must change on the exact frame without waiting for a picture, and the
// image's bitmap arrives when it arrives); the export burns both in.

import {
  drawSubtitle,
  type SubtitleContext,
  type SubtitleFrame,
} from './subtitleRender';
import { drawImageFrame, type ImageLayer } from './imageRender';
import { AS_SHOT, pictureRect, type PictureTransform } from './picture';

/** The 2D context — an `OffscreenCanvas`'s or a canvas's. The turn needs
 *  the transform calls a plain subtitle never did (and a subtitle with an
 *  effect now does, ADR-0017). */
export type FrameContext = SubtitleContext & {
  translate(x: number, y: number): void;
  rotate(angle: number): void;
};

export interface Picture {
  displayWidth: number;
  displayHeight: number;
}

export interface BlendLayer {
  /** The second picture, or null for black. */
  frame: (CanvasImageSource & Picture) | null;
  /** How much of it shows, (0, 1]. */
  weight: number;
  /** How the second picture's CLIP sits in the box (ADR-0014). As shot
   *  when absent. */
  transform?: PictureTransform;
}

/**
 * One picture, where its clip puts it (ADR-0014): fitted, zoomed and moved
 * by `pictureRect`, and turned about its own centre when the clip says so.
 * The unturned case draws the plain rectangle, so a picture as shot goes
 * through exactly the calls it always did.
 */
function drawPicture(
  ctx: FrameContext,
  picture: CanvasImageSource & Picture,
  width: number,
  height: number,
  t: PictureTransform,
): void {
  const r = pictureRect(
    picture.displayWidth,
    picture.displayHeight,
    width,
    height,
    t,
  );
  if (r.rotation === 0) {
    ctx.drawImage(picture, r.x, r.y, r.width, r.height);
    return;
  }
  ctx.save();
  ctx.translate(r.x + r.width / 2, r.y + r.height / 2);
  ctx.rotate((r.rotation * Math.PI) / 180);
  ctx.drawImage(picture, -r.width / 2, -r.height / 2, r.width, r.height);
  ctx.restore();
}

/**
 * Draw one timeline frame into a `width`×`height` box: black, then the
 * footage where its clip puts it (fitted into the box when as shot), then
 * the blend at its weight (black, or another picture where ITS clip puts
 * it), then the image, then the words.
 *
 * The image goes over the whole picture and under the words (ADR-0020): a
 * sticker belongs on the footage, and the words are what must always be
 * readable, so nothing may be laid over them.
 */
export function composeFrame(
  ctx: FrameContext,
  width: number,
  height: number,
  primary: (CanvasImageSource & Picture) | null,
  blend: BlendLayer | null,
  subtitle: SubtitleFrame | null,
  transform: PictureTransform = AS_SHOT,
  image: ImageLayer | null = null,
): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  if (primary) drawPicture(ctx, primary, width, height, transform);
  if (blend && blend.weight > 0) {
    ctx.globalAlpha = Math.min(1, blend.weight);
    if (blend.frame) {
      drawPicture(ctx, blend.frame, width, height, blend.transform ?? AS_SHOT);
    } else {
      ctx.fillRect(0, 0, width, height);
    }
    ctx.globalAlpha = 1;
  }
  if (image) drawImageFrame(ctx, image, width, height);
  if (subtitle) drawSubtitle(ctx, subtitle, width, height);
}
