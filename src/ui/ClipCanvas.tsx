// framewright — what is drawn inside one clip: its pictures, and its sound.
//
// Five parts in four places, and the split is deliberate. WHERE each picture
// goes is `src/engine/thumbnails.ts` and WHICH peaks a clip draws is
// `src/engine/waveform.ts` — both pure, both tested in Node. WHAT a picture is
// (decode + cache) is `src/ui/thumbnails.ts`, and the peaks behind the wave are
// `src/ui/waveform.ts`. This file is the canvas and the effect that keeps the
// four in step, and nothing else.
//
// ONE canvas, not two. The pictures and the wave want the same geometry, the
// same memo and the same "something arrived, draw again" signal, and the wave is
// drawn OVER the footage — a second absolutely positioned canvas would have to
// re-derive all of that and would layer by z-index rather than by draw order.
// One clear, one pass, one element.
//
// That canvas is a child of the clip button and is never wider than the window,
// whatever the zoom: a canvas as wide as a zoomed-in ten-minute clip would be
// hundreds of thousands of pixels across, which browsers silently refuse to
// allocate — the element stays, the drawing disappears, and nothing reports it.
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { thumbStrip, type ThumbSpan } from '../engine/thumbnails';
import { waveAmplitude, wavePlan } from '../engine/waveform';
import { hasNoAudioTrack } from '../engine/audio';
import type { View } from '../engine/timelineView';
import type { Rational } from '../engine/types';
import {
  getThumbnail,
  requestThumbnail,
  subscribeThumbnails,
} from './thumbnails';
import { getPeaks, requestPeaks, subscribeWaveforms } from './waveform';

interface Props {
  view: View;
  clip: ThumbSpan;
  assetId: string;
  fps: Rational;
}

/**
 * How much of the clip's height the waveform band takes, along the bottom.
 *
 * The convention every editor shares when one strip has to carry both: pictures
 * identify the shot, the wave says where the sound is, and the wave is the one
 * that reads fine in a sliver. At a 44px clip this is 18px.
 */
const WAVE_BAND = 0.42;

/**
 * Colours read from the stylesheet rather than written here, so the one place
 * with a contrast problem — a wave drawn over whatever the footage happens to
 * be — has its answer next to the rest of the palette.
 *
 * Read once. `getComputedStyle` resolves style, and this runs per visible clip
 * per draw; during a scroll drag that is hundreds of calls a second. There is no
 * runtime theme switch to invalidate it.
 */
let palette: { ink: string; ground: string; quiet: string } | null = null;

function wavePalette(): { ink: string; ground: string; quiet: string } {
  if (palette) return palette;
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  palette = {
    ink: read('--wave-ink', '#7ff3e4'),
    ground: read('--wave-ground', 'rgba(6, 16, 24, 0.72)'),
    quiet: read('--wave-quiet', 'rgba(157, 178, 199, 0.6)'),
  };
  return palette;
}

function ClipCanvasView({ view, clip, assetId, fps }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Pictures and peaks both arrive out of band, one at a time. This is the only
  // state here: something new landed, draw again.
  const [arrived, setArrived] = useState(0);

  useEffect(() => {
    const bump = () => setArrived((n) => n + 1);
    const stopThumbs = subscribeThumbnails(bump);
    const stopWaves = subscribeWaveforms(bump);
    return () => {
      stopThumbs();
      stopWaves();
    };
  }, []);

  const strip = thumbStrip(view, clip);

  // Asking is done in an effect, not during the render: a render that starts
  // work starts it again on every scroll pixel. No dependency array on purpose
  // — the set of wanted frames changes with scroll, zoom and the drag preview,
  // and both request functions are a map lookup for everything already in hand.
  // It is also what makes this self-healing: a clip whose media is re-linked
  // later asks again on the next render instead of staying blank forever.
  useEffect(() => {
    if (!strip) return;
    for (const slot of strip.slots) {
      requestThumbnail(assetId, slot.sourceFrame, fps);
    }
    requestPeaks(assetId);
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

    // The wave, over the pictures.
    //
    // Three states, and they are drawn as three things on purpose. A band with
    // a shape in it: here is the sound. A band with a dim line and no shape:
    // this file HAS no sound, and we know that. Nothing at all: the answer is
    // not in yet — which is the only one of the three that goes away by itself.
    // Before this, the first and the last were the same picture, one of them
    // for ever, and a silent screen recording was indistinguishable from a
    // source still decoding.
    const peaks = getPeaks(assetId);
    const plan = peaks ? wavePlan(view, clip, fps, peaks) : null;
    const knownSilent = !plan && hasNoAudioTrack(assetId);
    if (plan || knownSilent) {
      const colours = wavePalette();
      const bandH = Math.max(6, Math.round(cssH * WAVE_BAND));
      const top = cssH - bandH;
      const mid = top + bandH / 2;
      // A ground under the band. Without it the wave is drawn over whatever the
      // footage happens to be, and there is no colour that reads on both a white
      // sky and a black night.
      ctx.fillStyle = colours.ground;
      ctx.fillRect(0, top, cssW, bandH);

      if (!plan) {
        // Known to have no sound: the band, and a dim line through it. No
        // shape, because there is none — and a colour that is plainly not the
        // wave's, because "nothing to draw" and "silence" are different claims.
        ctx.fillStyle = colours.quiet;
        ctx.fillRect(0, mid - 0.5, cssW, 1);
        return;
      }

      // Positions are the CLIP's coordinates; the canvas starts at the strip's
      // origin, which is a thumbnail slot boundary at or before the clip's
      // visible edge.
      const originPx = plan.offsetPx - strip.offsetPx;
      const half = bandH / 2 - 1;
      const level = peaks!.levels[plan.level];
      ctx.fillStyle = colours.ink;
      ctx.beginPath();
      // Out along the peaks, back along the troughs: one filled path, not one
      // rectangle per bucket. At a bucket a pixel wide that is the difference
      // between a shape and nine hundred draw calls.
      for (let i = 0; i < plan.count; i++) {
        const v = waveAmplitude(level.max[plan.firstBucket + i]);
        ctx.lineTo(originPx + i * plan.bucketPx, mid - v * half);
      }
      for (let i = plan.count - 1; i >= 0; i--) {
        const v = waveAmplitude(level.min[plan.firstBucket + i]);
        ctx.lineTo(originPx + i * plan.bucketPx, mid - v * half);
      }
      ctx.closePath();
      ctx.fill();
      // A hairline through the middle, so silence is a line rather than an
      // empty band that reads as "still loading".
      ctx.fillRect(originPx, mid - 0.5, plan.widthPx, 1);
    }
    // `arrived` is read so the draw re-runs when a picture or a set of peaks
    // lands. It has no other use, and removing it would leave the strip blank
    // until something else happened to re-render the timeline.
    void arrived;
  });

  if (!strip) return null;
  return (
    <canvas
      ref={canvasRef}
      className="clip-canvas"
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
export const ClipCanvas = memo(
  ClipCanvasView,
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
