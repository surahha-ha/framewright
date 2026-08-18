// framewright — the timeline's coordinate system, specified before it exists.
//
// Until now the timeline had no scale of its own: every position was a
// percentage of the container, so "one pixel" meant a different number of frames
// in every document and zoom was impossible to express. This module replaces
// that with pixels-per-frame plus a scroll offset, which is the thing ticks,
// thumbnails and a waveform will all be drawn against.
//
// The invariants below are the ones that are impossible to see in a screenshot
// and expensive to discover by hand.
import { describe, expect, it } from 'vitest';
import { FPS_2997, FPS_30, secToFrame } from './time';
import {
  MAX_SCALE,
  MIN_MAJOR_TICK_PX,
  MIN_MINOR_TICK_PX,
  centerOn,
  clampScale,
  clampScroll,
  contentWidth,
  deltaFrames,
  fitScale,
  frameAtX,
  frameToX,
  keepVisible,
  maxScroll,
  ticks,
  tickSteps,
  visibleRange,
  visibleSpan,
  xToFrame,
  zoomedScale,
  type View,
} from './timelineView';

/** A minute of 30fps footage in a 900px strip, fitted — today's default. */
const MINUTE = 60 * 30;
const WIDTH = 900;

function fitted(total = MINUTE, widthPx = WIDTH): View {
  return {
    total,
    widthPx,
    scale: fitScale(total, widthPx),
    scrollPx: 0,
  };
}

/** The same document zoomed in by `times`, still scrolled to the start. */
function zoomed(times: number, total = MINUTE, widthPx = WIDTH): View {
  const base = fitted(total, widthPx);
  return {
    ...base,
    scale: clampScale(base.scale * times, total, widthPx),
  };
}

describe('the fitted default reproduces what the timeline did before', () => {
  it('draws the whole document across the strip, exactly', () => {
    const view = fitted();
    expect(frameToX(view, 0)).toBe(0);
    expect(frameToX(view, MINUTE)).toBeCloseTo(WIDTH, 6);
  });

  it('has nowhere to scroll, so nothing can drift off screen', () => {
    const view = fitted();
    expect(maxScroll(view)).toBe(0);
    expect(clampScroll(view, 500)).toBe(0);
    expect(visibleRange(view)).toEqual({ from: 0, to: MINUTE });
  });

  it('never divides by an empty document', () => {
    // An empty timeline still has to answer "which frame is under this click?".
    const view = fitted(0);
    expect(Number.isFinite(view.scale)).toBe(true);
    expect(xToFrame(view, 400)).toBe(0);
    expect(contentWidth(view)).toBe(WIDTH);
    expect(ticks(view, FPS_30)).toEqual([]);
  });
});

describe('frames and pixels convert back to each other', () => {
  it('round-trips every frame once a frame is at least a pixel wide', () => {
    const view = zoomed(8); // 0.5 -> 4 px/frame
    expect(view.scale).toBeGreaterThanOrEqual(1);
    for (const frame of [0, 1, 17, 500, MINUTE - 1]) {
      expect(xToFrame(view, frameToX(view, frame))).toBe(frame);
    }
  });

  it('stays monotonic even when a frame is thinner than a pixel', () => {
    // Fitted, a minute of footage puts 2 frames in every pixel. The mapping
    // cannot be injective there, but it must never go backwards — a playhead
    // that jitters left as you drag right reads as a broken control.
    const view = fitted();
    let last = -1;
    for (let x = 0; x <= WIDTH; x += 3) {
      const frame = xToFrame(view, x);
      expect(frame).toBeGreaterThanOrEqual(last);
      last = frame;
    }
  });

  it('resolves a boundary the timeline itself drew to the frame it drew', () => {
    // Plain `Math.floor(x / scale)` is off by one here: 30 frames across 301px
    // puts frame 29 at x = 290.9666…, which divides back to 28.999999999999996.
    // A frame-accurate editor that cannot hit a boundary it has drawn is
    // telling the user their aim was wrong.
    const trap = 301 / 30;
    expect((29 * trap) / trap).toBeLessThan(29); // the trap itself
    for (const [total, widthPx] of [
      [30, 301],
      [7, 304],
      [1800, 303],
      [1799, 900],
      [90, 1241],
    ]) {
      const view = fitted(total, widthPx);
      for (const frame of [0, 1, Math.floor(total / 3), total - 1]) {
        expect(xToFrame(view, frameToX(view, frame))).toBe(frame);
      }
    }
  });

  it('never answers with a frame the document does not have', () => {
    const view = fitted();
    expect(xToFrame(view, -50)).toBe(0);
    expect(xToFrame(view, WIDTH * 3)).toBe(MINUTE - 1);
  });

  it('keeps the anchor exact, so zooming does not accumulate drift', () => {
    // `frameAtX` is deliberately fractional: rounding it before using it as a
    // zoom anchor is how a timeline walks away from the frame you pointed at
    // after a dozen zoom steps.
    const view = zoomed(4);
    expect(frameAtX(view, frameToX(view, 100) + view.scale / 2)).toBeCloseTo(
      100.5,
      6,
    );
  });
});

describe('the numbers a gesture and a readout ask for', () => {
  it('converts pointer travel to frames at the scale in force', () => {
    // The drag used to divide by hand in the component, which put the one
    // conversion this module exists to own in two places.
    expect(deltaFrames(zoomed(8), 40)).toBe(10); // 4 px/frame
    expect(deltaFrames(zoomed(8), -40)).toBe(-10);
    expect(deltaFrames(zoomed(8), 2)).toBe(1); // rounds, never truncates to 0
    expect(deltaFrames({ ...fitted(), scale: 0 }, 100)).toBe(0);
  });

  it('says how much footage the strip can show at once', () => {
    expect(visibleSpan(fitted())).toBeCloseTo(MINUTE, 6);
    expect(visibleSpan(zoomed(4))).toBeCloseTo(MINUTE / 4, 6);
    expect(visibleSpan({ ...fitted(), scale: 0 })).toBe(0);
  });

  it('refuses a coordinate that is not a number rather than passing it on', () => {
    // `xToFrame` feeds `seekTo`. `Math.max(0, NaN)` is NaN, not 0, so without
    // this a degenerate rect would put the playhead at NaN and the document
    // would stop agreeing with itself.
    const view = fitted();
    expect(xToFrame(view, NaN)).toBe(0);
    expect(xToFrame(view, Infinity)).toBe(MINUTE - 1);
    expect(xToFrame({ ...view, scale: NaN }, 100)).toBe(0);
  });
});

describe('zoom has a floor and a ceiling, and both are meaningful', () => {
  it('will not zoom out past the whole document', () => {
    const view = fitted();
    expect(clampScale(view.scale / 10, MINUTE, WIDTH)).toBeCloseTo(
      fitScale(MINUTE, WIDTH),
      6,
    );
    expect(zoomedScale(view, 'out')).toBeCloseTo(view.scale, 6);
  });

  it('will not zoom in past one frame being a comfortable target', () => {
    const view = { ...fitted(), scale: MAX_SCALE };
    expect(zoomedScale(view, 'in')).toBe(MAX_SCALE);
  });

  it('lets a document shorter than the strip stay bigger than the ceiling', () => {
    // Five frames in 900px is 180 px/frame — already past MAX_SCALE. Clamping
    // down to the ceiling would shrink the document away from the edges it
    // has always filled.
    const scale = clampScale(1, 5, WIDTH);
    expect(scale).toBeCloseTo(fitScale(5, WIDTH), 6);
    expect(scale).toBeGreaterThan(MAX_SCALE);
  });

  it('is reversible: in then out lands back where it started', () => {
    const view = zoomed(4);
    const inThenOut = zoomedScale(
      { ...view, scale: zoomedScale(view, 'in') },
      'out',
    );
    expect(inThenOut).toBeCloseTo(view.scale, 6);
  });
});

describe('scrolling cannot lose the document', () => {
  it('clamps to the two ends, whatever it is handed', () => {
    const view = zoomed(4);
    expect(clampScroll(view, -1000)).toBe(0);
    expect(clampScroll(view, 1e9)).toBeCloseTo(maxScroll(view), 6);
    expect(maxScroll(view)).toBeCloseTo(contentWidth(view) - WIDTH, 6);
  });

  it('reports a visible range that is always inside the document', () => {
    const view = { ...zoomed(4), scrollPx: 1e9 };
    const range = visibleRange({ ...view, scrollPx: clampScroll(view, 1e9) });
    expect(range.from).toBeGreaterThanOrEqual(0);
    expect(range.to).toBe(MINUTE);
    expect(range.to - range.from).toBeLessThan(MINUTE);
  });

  it('centres on a frame, and that frame is then visible', () => {
    const view = zoomed(8);
    for (const frame of [0, 900, MINUTE - 1]) {
      const scrolled = { ...view, scrollPx: centerOn(view, frame) };
      const range = visibleRange(scrolled);
      expect(frame).toBeGreaterThanOrEqual(range.from);
      expect(frame).toBeLessThan(range.to);
    }
  });

  it('leaves the scroll alone while the playhead is comfortably in view', () => {
    // Called on every playhead move: nudging the scroll by a pixel per frame
    // during playback makes the whole strip shimmer.
    const view = { ...zoomed(4), scrollPx: 400 };
    const middle = xToFrame(view, view.scrollPx + WIDTH / 2);
    expect(keepVisible(view, middle)).toBe(view.scrollPx);
  });

  it('follows the playhead out of either edge', () => {
    const view = { ...zoomed(4), scrollPx: 400 };
    const ahead = xToFrame(view, view.scrollPx + WIDTH + 200);
    const behind = xToFrame(view, view.scrollPx - 200);
    expect(keepVisible(view, ahead)).toBeGreaterThan(view.scrollPx);
    expect(keepVisible(view, behind)).toBeLessThan(view.scrollPx);
    for (const frame of [ahead, behind]) {
      const range = visibleRange({
        ...view,
        scrollPx: keepVisible(view, frame),
      });
      expect(frame).toBeGreaterThanOrEqual(range.from);
      expect(frame).toBeLessThan(range.to);
    }
  });
});

describe('a clip dragged past the end of the document stays reachable', () => {
  // This is the tech-debt item zoom exists to fix. The old timeline froze its
  // scale for the gesture and pinned an overshooting clip to a stub against the
  // right edge; with a scale of its own, the content simply gets wider and the
  // strip can scroll to where the clip actually is.
  it('grows the content instead of pinning the clip to the edge', () => {
    const document = zoomed(2);
    const overshoot = MINUTE + 600;
    const during = { ...document, total: overshoot };
    expect(contentWidth(during)).toBeGreaterThan(contentWidth(document));
    expect(frameToX(during, overshoot)).toBeCloseTo(contentWidth(during), 6);
    expect(maxScroll(during)).toBeGreaterThan(maxScroll(document));
  });

  it('does not change the scale, so the clip does not chase the pointer', () => {
    // The frozen-scale rule in one assertion: growing the document must not
    // move a frame that was already drawn.
    const document = zoomed(2);
    const during = { ...document, total: MINUTE + 600 };
    expect(frameToX(during, 300)).toBe(frameToX(document, 300));
  });
});

describe('ruler ticks', () => {
  it('never draws them closer together than they can be read', () => {
    for (const times of [1, 2, 4, 16, 64]) {
      const view = zoomed(times);
      const { major, minor } = tickSteps(view, FPS_30);
      expect(major * view.scale).toBeGreaterThanOrEqual(MIN_MAJOR_TICK_PX);
      if (minor > 0) {
        expect(minor * view.scale).toBeGreaterThanOrEqual(MIN_MINOR_TICK_PX);
      }
    }
  });

  it('subdivides the major step evenly, so the small marks line up', () => {
    for (const times of [1, 2, 4, 16, 64]) {
      const { major, minor } = tickSteps(zoomed(times), FPS_30);
      if (minor > 0) expect(major % minor).toBe(0);
    }
  });

  it('never asks for a step smaller than a frame', () => {
    // At maximum zoom one frame is 40px, which is wider than the minor
    // threshold — the ladder must stop at 1 rather than invent half-frames.
    const view = { ...fitted(), scale: MAX_SCALE };
    const { major, minor } = tickSteps(view, FPS_30);
    expect(minor).toBe(1);
    expect(Number.isInteger(major)).toBe(true);
  });

  it('never labels twice inside one second, because the label cannot tell them apart', () => {
    // The ruler writes "0:03", not "00:03:00" — deliberately, because mm:ss:ff
    // is read as hours:minutes:seconds. The cost is that a sub-second labelled
    // step would print the same text several times in a row, so the labelled
    // ladder starts at one second and the sub-second detail is carried by the
    // unlabelled marks instead.
    const oneSecond = secToFrame(1, FPS_30);
    for (const times of [1, 2, 4, 16, 64]) {
      const { major, minor } = tickSteps(zoomed(times), FPS_30);
      expect(major).toBeGreaterThanOrEqual(oneSecond);
      expect(major % oneSecond).toBe(0);
      if (minor > 0) expect(minor).toBeGreaterThanOrEqual(1);
    }
  });

  it('never steps by zero, however little room there is', () => {
    // When even half the labelled step is thinner than a hairline, `tickSteps`
    // answers `minor: 0` — and `ticks` must then step by the MAJOR one. If it
    // stepped by the minor it would loop forever and hang the tab. The scale
    // here is degenerate on purpose: this is the branch, not a document anyone
    // will have.
    const view: View = {
      total: secToFrame(3600, FPS_30),
      widthPx: 900,
      scale: 1e-6,
      scrollPx: 0,
    };
    expect(tickSteps(view, FPS_30).minor).toBe(0);
    const drawn = ticks(view, FPS_30);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((t) => t.major)).toBe(true);
  });

  it('lands the labelled marks on whole seconds once there is room', () => {
    const view = zoomed(4); // 2 px/frame: a second is 60px, two seconds 120px
    const { major } = tickSteps(view, FPS_30);
    expect(major % secToFrame(1, FPS_30)).toBe(0);
  });

  it('counts a second as 30 frames at 29.97, not 29.97 frames', () => {
    // The one place a rational frame rate leaks into drawing: a tick every
    // 29.97 frames would slide off the timecode it is labelled with.
    const view = zoomed(4);
    const { major, minor } = tickSteps(view, FPS_2997);
    expect(Number.isInteger(major)).toBe(true);
    expect(Number.isInteger(minor)).toBe(true);
    expect(major % secToFrame(1, FPS_2997)).toBe(0);
  });

  it('only produces the ticks that are actually on screen', () => {
    // An hour of footage at full zoom is 108,000 frames. Building a tick for
    // each one and letting the DOM sort it out is how a timeline stops
    // responding to the pointer.
    const hour = secToFrame(3600, FPS_30);
    const view = {
      total: hour,
      widthPx: WIDTH,
      scale: MAX_SCALE,
      scrollPx: 0,
    };
    const drawn = ticks(view, FPS_30);
    expect(drawn.length).toBeLessThan(WIDTH / MIN_MINOR_TICK_PX + 4);
    expect(drawn.every((t) => t.frame >= 0 && t.frame <= hour)).toBe(true);
  });

  it('starts on a whole step, not on wherever the scroll happens to be', () => {
    const view = { ...zoomed(8), scrollPx: 337 };
    const { major, minor } = tickSteps(view, FPS_30);
    const step = minor || major;
    const drawn = ticks(view, FPS_30);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((t) => t.frame % step === 0)).toBe(true);
    expect(
      drawn.filter((t) => t.major).every((t) => t.frame % major === 0),
    ).toBe(true);
  });

  it('covers the visible range from edge to edge', () => {
    const view = { ...zoomed(8), scrollPx: 1200 };
    const range = visibleRange(view);
    const drawn = ticks(view, FPS_30);
    const step = tickSteps(view, FPS_30).minor || tickSteps(view, FPS_30).major;
    expect(drawn[0].frame).toBeLessThanOrEqual(range.from + step);
    expect(drawn[drawn.length - 1].frame).toBeGreaterThanOrEqual(
      range.to - step,
    );
  });

  it('marks the document end when it is on screen', () => {
    // The end of the timeline is a real edge; a ruler that stops one step short
    // of it makes the last clip look like it runs off the page.
    const view = fitted();
    const drawn = ticks(view, FPS_30);
    expect(drawn[drawn.length - 1].frame).toBe(MINUTE);
  });
});
