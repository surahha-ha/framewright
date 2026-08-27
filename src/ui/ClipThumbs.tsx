// framewright — the pictures drawn inside one clip.
//
// Three parts, and they are deliberately in three places: WHERE each picture
// goes is `src/engine/thumbnails.ts` (pure, tested in Node), WHAT the picture is
// is `src/ui/thumbnails.ts` (decode + cache), and this file is only the canvas
// and the effect that keeps the two in step.
//
// The canvas is a child of the clip button and is never wider than the window,
// whatever the zoom: a canvas as wide as a zoomed-in ten-minute clip would be
// hundreds of thousands of pixels across, which browsers silently refuse to
// allocate — the element stays, the drawing disappears, and nothing reports it.
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { thumbStrip, type ThumbSpan } from '../engine/thumbnails';
import type { View } from '../engine/timelineView';
import type { Rational } from '../engine/types';
import {
  getThumbnail,
  requestThumbnail,
  subscribeThumbnails,
} from './thumbnails';

interface Props {
  view: View;
  clip: ThumbSpan;
  assetId: string;
  fps: Rational;
}

function ClipThumbsView({ view, clip, assetId, fps }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Pictures arrive one at a time, out of band. This is the only state here:
  // something new landed, draw again.
  const [arrived, setArrived] = useState(0);

  useEffect(() => subscribeThumbnails(() => setArrived((n) => n + 1)), []);

  const strip = thumbStrip(view, clip);

  // Asking is done in an effect, not during the render: a render that starts
  // work starts it again on every scroll pixel. No dependency array on purpose
  // — the set of wanted frames changes with scroll, zoom and the drag preview,
  // and `requestThumbnail` is a map lookup for everything already in hand. It
  // is also what makes this self-healing: a clip whose media is re-linked later
  // asks again on the next render instead of staying blank forever.
  useEffect(() => {
    if (!strip) return;
    for (const slot of strip.slots) {
      requestThumbnail(assetId, slot.sourceFrame, fps);
    }
  });

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !strip) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, Math.round(strip.widthPx));
    const cssH = Math.max(1, canvas.clientHeight);
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    for (const slot of strip.slots) {
      // Under half a pixel there is nothing to see and `drawImage` with a zero
      // width throws; a fitted long document is full of these.
      if (slot.widthPx < 0.5) continue;
      const bitmap = getThumbnail(assetId, slot.sourceFrame);
      if (!bitmap) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(slot.x, 0, slot.widthPx, cssH);
      ctx.clip();
      // Cover, not contain: a letterboxed picture inside a 44px strip is mostly
      // letterbox. The centre of the frame is what identifies a shot.
      const cover = Math.max(slot.widthPx / bitmap.width, cssH / bitmap.height);
      const dw = bitmap.width * cover;
      const dh = bitmap.height * cover;
      ctx.drawImage(
        bitmap,
        slot.x + (slot.widthPx - dw) / 2,
        (cssH - dh) / 2,
        dw,
        dh,
      );
      ctx.restore();
    }
    // `arrived` is read so the draw re-runs when a picture lands. It has no
    // other use, and removing it would leave the strip blank until something
    // else happened to re-render the timeline.
    void arrived;
  });

  if (!strip) return null;
  return (
    <canvas
      ref={canvasRef}
      className="clip-thumbs"
      aria-hidden="true"
      // `.clip` has a 1px border and an absolutely positioned child is laid out
      // from its parent's PADDING box, so left:0 is one pixel inside the clip's
      // own left edge. Every x here is measured from that edge, so the pixel is
      // given back. (The same trap moved the timeline's border to the scroll
      // container — see the note in styles.css.)
      style={{
        left: strip.offsetPx - 1 + 'px',
        width: Math.max(1, Math.round(strip.widthPx)) + 'px',
      }}
    />
  );
}

/**
 * Redraw only when something that changes the PICTURE changes.
 *
 * The timeline re-renders on every playhead tick — sixty times a second during
 * playback — and both effects below deliberately have no dependency array, so
 * without this every visible clip cleared and re-drew its whole canvas on every
 * one of those ticks, on the same main thread that is decoding the playback.
 * The props are rebuilt fresh each render (`view` and `clip` are object
 * literals), so the comparison has to be on the values, not on identity.
 */
export const ClipThumbs = memo(
  ClipThumbsView,
  (a, b) =>
    a.assetId === b.assetId &&
    a.fps.num === b.fps.num &&
    a.fps.den === b.fps.den &&
    a.view.scale === b.view.scale &&
    a.view.scrollPx === b.view.scrollPx &&
    a.view.widthPx === b.view.widthPx &&
    a.view.total === b.view.total &&
    a.clip.start === b.clip.start &&
    a.clip.length === b.clip.length &&
    a.clip.inFrame === b.clip.inFrame,
);
