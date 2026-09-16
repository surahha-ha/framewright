// framewright — where an image sits on the picture, and the one draw for
// both surfaces (ADR-0020).
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_SIZE,
  drawImageFrame,
  imageRect,
  type ImageContext,
  type ImageLayer,
} from './imageRender';

function fakeCtx() {
  const calls: string[] = [];
  const ctx = {
    drawImage(img: unknown, x: number, y: number, w: number, h: number) {
      calls.push(`img ${(img as { tag: string }).tag} ${x},${y} ${w}x${h}`);
    },
  };
  return { ctx: ctx as unknown as ImageContext, calls };
}

/** A picture the engine only ever hands back to `drawImage`. */
const picture = (tag: string) => ({ tag }) as unknown as CanvasImageSource;

const layer = (over: Partial<ImageLayer> = {}): ImageLayer => ({
  assetId: 'asset_1',
  srcWidth: 160,
  srcHeight: 90,
  picture: picture('logo'),
  ...over,
});

describe('imageRect', () => {
  it('draws a quarter of the box wide, centred, when the document says nothing', () => {
    expect(imageRect({}, 160, 90, 320, 180)).toEqual({
      x: 120,
      y: 67.5,
      width: 80,
      height: 45,
    });
    expect(DEFAULT_IMAGE_SIZE).toBe(0.25);
  });

  it('takes its width from `size` and its height from the asset aspect', () => {
    // A tall source at half the box's width is taller than the box itself:
    // 160 wide × 320 high, which is what "the aspect decides the height"
    // means — the box never squashes it.
    expect(imageRect({ size: 0.5 }, 100, 200, 320, 180)).toEqual({
      x: 80,
      y: -70,
      width: 160,
      height: 320,
    });
  });

  it('puts the centre at `pos × box`, and lets the rectangle hang off the edge', () => {
    expect(imageRect({ posX: 1, posY: 1 }, 160, 90, 320, 180)).toEqual({
      x: 280,
      y: 157.5,
      width: 80,
      height: 45,
    });
  });

  it('clamps the CENTRE to the box, and nothing else', () => {
    expect(imageRect({ posX: 2, posY: -1 }, 160, 90, 320, 180)).toEqual(
      imageRect({ posX: 1, posY: 0 }, 160, 90, 320, 180),
    );
    // Still off the edge on both axes — clamping the centre is not
    // clamping the picture.
    expect(imageRect({ posX: 2, posY: -1 }, 160, 90, 320, 180).x).toBe(280);
  });

  it('draws a source of no size square, rather than not at all', () => {
    expect(imageRect({}, 0, 0, 320, 180)).toEqual({
      x: 120,
      y: 50,
      width: 80,
      height: 80,
    });
  });
});

describe('drawImageFrame', () => {
  it('draws the picture at its rectangle', () => {
    const { ctx, calls } = fakeCtx();
    drawImageFrame(ctx, layer({ posX: 0.25, size: 0.5 }), 320, 180);
    expect(calls).toEqual(['img logo 0,45 160x90']);
  });

  it('draws nothing while the picture has not arrived', () => {
    const { ctx, calls } = fakeCtx();
    drawImageFrame(ctx, layer({ picture: null }), 320, 180);
    expect(calls).toEqual([]);
  });

  it('draws nothing for a size of zero', () => {
    const { ctx, calls } = fakeCtx();
    drawImageFrame(ctx, layer({ size: 0 }), 320, 180);
    expect(calls).toEqual([]);
  });
});
