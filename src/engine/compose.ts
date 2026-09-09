// framewright — one output frame from its parts (ADR-0011, ADR-0012).
//
// The preview and the export used to draw a frame each in their own way, and
// agreed only because both were simple. A frame now has up to four parts —
// black, the footage, a second picture at some strength, the words — and the
// order and the letterboxing must be the same on screen and in the file, so
// there is one function for both. The subtitle is optional here because the
// preview keeps the words on their own layer (they must change on the exact
// frame without waiting for a picture); the export burns them in.

import { containRect } from './exportConfig';
import { drawSubtitle, type SubtitleContext } from './subtitleRender';

/** The 2D context — an `OffscreenCanvas`'s or a canvas's. */
export type FrameContext = SubtitleContext;

export interface Picture {
  displayWidth: number;
  displayHeight: number;
}

export interface BlendLayer {
  /** The second picture, or null for black. */
  frame: (CanvasImageSource & Picture) | null;
  /** How much of it shows, (0, 1]. */
  weight: number;
}

/**
 * Draw one timeline frame into a `width`×`height` box: black, then the
 * footage letterboxed into the box, then the blend at its weight (black or
 * another picture, letterboxed the same way), then the words.
 */
export function composeFrame(
  ctx: FrameContext,
  width: number,
  height: number,
  primary: (CanvasImageSource & Picture) | null,
  blend: BlendLayer | null,
  subtitle: string | null,
): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  if (primary) {
    const r = containRect(
      primary.displayWidth,
      primary.displayHeight,
      width,
      height,
    );
    ctx.drawImage(primary, r.x, r.y, r.width, r.height);
  }
  if (blend && blend.weight > 0) {
    ctx.globalAlpha = Math.min(1, blend.weight);
    if (blend.frame) {
      const r = containRect(
        blend.frame.displayWidth,
        blend.frame.displayHeight,
        width,
        height,
      );
      ctx.drawImage(blend.frame, r.x, r.y, r.width, r.height);
    } else {
      ctx.fillRect(0, 0, width, height);
    }
    ctx.globalAlpha = 1;
  }
  if (subtitle) drawSubtitle(ctx, subtitle, width, height);
}
