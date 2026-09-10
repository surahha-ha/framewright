// framewright — how a clip's picture sits in the box (ADR-0014).
import { describe, expect, it } from 'vitest';
import {
  ZOOM_MAX,
  PAN_LIMIT,
  coversBox,
  panText,
  describePan,
  describeRotation,
  describeZoom,
  isAsShot,
  panLimits,
  panLimitText,
  pictureNoteText,
  pictureRect,
  pictureTransform,
  nextRotation,
} from './picture';
import type { Clip } from './types';

const clip = (extra: Partial<Clip> = {}): Clip => ({
  id: 'a',
  assetId: 'asset_1',
  startFrame: 0,
  inFrame: 0,
  outFrame: 60,
  ...extra,
});

describe('pictureTransform', () => {
  it('is as shot when nothing is said', () => {
    expect(pictureTransform(clip())).toEqual({
      zoom: 1,
      panX: 0,
      panY: 0,
      rotation: 0,
    });
    expect(isAsShot(pictureTransform(clip()))).toBe(true);
  });

  it('reads the fields, clamped to what the panel offers', () => {
    expect(
      pictureTransform(clip({ zoom: 2, panX: 0.25, panY: -0.5, rotation: 90 })),
    ).toEqual({ zoom: 2, panX: 0.25, panY: -0.5, rotation: 90 });
    expect(pictureTransform(clip({ zoom: 9 })).zoom).toBe(ZOOM_MAX);
    expect(pictureTransform(clip({ zoom: 0.5 })).zoom).toBe(1);
    // Half a box either way, at every zoom (the pan scales with the zoom).
    expect(pictureTransform(clip({ panX: 3, panY: -3 }))).toMatchObject({
      panX: 0.5,
      panY: -0.5,
    });
    expect(
      pictureTransform(clip({ zoom: 2, panX: 3, panY: -3 })),
    ).toMatchObject({ panX: PAN_LIMIT, panY: -PAN_LIMIT });
    // A rotation that is not a quarter turn is no rotation.
    expect(pictureTransform(clip({ rotation: 45 as never })).rotation).toBe(0);
    expect(pictureTransform(clip({ zoom: Number.NaN })).zoom).toBe(1);
  });

  it('steps a quarter turn at a time, and comes back round', () => {
    expect(nextRotation(0)).toBe(90);
    expect(nextRotation(90)).toBe(180);
    expect(nextRotation(180)).toBe(270);
    expect(nextRotation(270)).toBe(0);
  });
});

describe('pictureRect — where the picture is drawn', () => {
  const t = (extra: Partial<ReturnType<typeof pictureTransform>> = {}) => ({
    zoom: 1,
    panX: 0,
    panY: 0,
    rotation: 0 as const,
    ...extra,
  });

  it('is the letterboxed fit when as shot', () => {
    expect(pictureRect(160, 90, 320, 320, t())).toEqual({
      x: 0,
      y: 70,
      width: 320,
      height: 180,
      rotation: 0,
    });
  });

  it('grows around the centre of the box when zoomed', () => {
    const r = pictureRect(160, 90, 320, 180, t({ zoom: 2 }));
    expect(r).toEqual({
      x: -160,
      y: -90,
      width: 640,
      height: 360,
      rotation: 0,
    });
  });

  it('moves by a fraction of the BOX, not of the picture', () => {
    const r = pictureRect(160, 90, 320, 180, t({ panX: 0.5, panY: -0.25 }));
    expect(r).toMatchObject({ x: 160, y: -45, width: 320, height: 180 });
  });

  it('keeps the framed point where it is when the zoom changes', () => {
    // Pan so that the picture point a quarter left of its centre sits at
    // the box's centre; then zoom. That point must still be at the centre.
    const at1 = pictureRect(160, 90, 320, 180, t({ panX: 0.25 }));
    const at3 = pictureRect(160, 90, 320, 180, t({ panX: 0.25, zoom: 3 }));
    // Picture x of the box centre = (160 - rect.x) / rect.width, as a fraction.
    const framed = (r: { x: number; width: number }) => (160 - r.x) / r.width;
    expect(framed(at1)).toBeCloseTo(0.25, 9);
    expect(framed(at3)).toBeCloseTo(0.25, 9);
    // And half a box of pan at any zoom brings the picture's edge to the centre.
    const edge = pictureRect(160, 90, 320, 180, t({ panX: 0.5, zoom: 4 }));
    expect(edge.x).toBeCloseTo(160, 9);
  });

  it('fits the turned picture — a quarter turn swaps its sides', () => {
    // A 16:9 picture turned upright inside a 16:9 box stands 180 tall and
    // 101.25 wide, centred: black at both sides.
    const r = pictureRect(160, 90, 320, 180, t({ rotation: 90 }));
    expect(r.rotation).toBe(90);
    // width/height are the DRAWN size before the turn: the long side
    // becomes the box's height.
    expect(r.width).toBeCloseTo(180, 6);
    expect(r.height).toBeCloseTo(101.25, 6);
    // Centred on the box, so the rect is centred too.
    expect(r.x + r.width / 2).toBeCloseTo(160, 6);
    expect(r.y + r.height / 2).toBeCloseTo(90, 6);
    // A half turn keeps the sides.
    expect(pictureRect(160, 90, 320, 180, t({ rotation: 180 }))).toMatchObject({
      width: 320,
      height: 180,
      rotation: 180,
    });
  });

  it('is the whole box for a picture with no size', () => {
    expect(pictureRect(0, 0, 320, 180, t({ zoom: 2 }))).toMatchObject({
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    });
  });

  it('stops a pan where the picture’s own edge reaches the centre, even for a picture narrower than the box', () => {
    // A 16:9 picture stood up in a 16:9 box is 101.25 wide of 320. Half a
    // box of pan (160 at zoom 1) would carry it clear out of the box — the
    // owner's Chrome showed an all-black preview under "화면 한쪽이 비어요".
    // The draw reads such a pan at the picture's own limit instead.
    const r = pictureRect(160, 90, 320, 180, t({ rotation: 90, panX: 0.5 }));
    const cx = r.x + r.width / 2;
    const footprintHalfWidth = r.height / 2; // turned: the short side stands across
    expect(cx - footprintHalfWidth).toBeLessThanOrEqual(160 + 1e-6);
    expect(cx).toBeCloseTo(160 + 0.15 * 320, 6);
    // The same at any zoom: the limit is a fraction of the box, the pan
    // scales with the zoom, so the edge lands at the centre either way.
    const z = pictureRect(
      160,
      90,
      320,
      180,
      t({ rotation: 90, panX: 0.5, zoom: 3 }),
    );
    expect(z.x + z.width / 2 - z.height / 2).toBeLessThanOrEqual(160 + 1e-6);
  });
});

describe('panLimits — how far each axis may go', () => {
  it('is half a box on both axes for a picture that fills the box', () => {
    expect(panLimits(160, 90, 320, 180, 0)).toEqual({ x: 0.5, y: 0.5 });
    expect(panLimits(1920, 1080, 320, 180, 180)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('is half the picture’s share of the box on the axis it does not fill, rounded down to a slider notch', () => {
    // 4:3 in 16:9: 240 of 320 wide → 0.375 → 0.35 (notches of 5%).
    expect(panLimits(160, 120, 320, 180, 0)).toEqual({ x: 0.35, y: 0.5 });
    // 16:9 stood up: 101.25 of 320 wide → 0.158 → 0.15.
    expect(panLimits(160, 90, 320, 180, 90)).toEqual({ x: 0.15, y: 0.5 });
    // A tall source as shot is the same shape; turned, it fills the box.
    expect(panLimits(90, 160, 320, 180, 0)).toEqual({ x: 0.15, y: 0.5 });
    expect(panLimits(90, 160, 320, 180, 270)).toEqual({ x: 0.5, y: 0.5 });
    // A wide source in a square box is short on the OTHER axis.
    expect(panLimits(160, 90, 320, 320, 0)).toEqual({ x: 0.5, y: 0.25 });
  });

  it('is half a box when the size is unknown', () => {
    expect(panLimits(0, 0, 320, 180, 0)).toEqual({ x: 0.5, y: 0.5 });
    expect(panLimits(160, 90, 0, 0, 0)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('says why a pan slider stops short, and nothing when neither does', () => {
    expect(panLimitText({ x: 0.5, y: 0.5 })).toBe('');
    expect(panLimitText({ x: 0.15, y: 0.5 })).toBe(
      '가로로는 15%까지만 옮길 수 있어요 · 더 가면 화면이 보이는 범위를 벗어나요',
    );
    expect(panLimitText({ x: 0.5, y: 0.25 })).toBe(
      '세로로는 25%까지만 옮길 수 있어요 · 더 가면 화면이 보이는 범위를 벗어나요',
    );
    expect(panLimitText({ x: 0.35, y: 0.25 })).toBe(
      '가로로는 35%, 세로로는 25%까지만 옮길 수 있어요 · 더 가면 화면이 보이는 범위를 벗어나요',
    );
  });
});

describe('what an edit says', () => {
  it('names the zoom, and a return to the fit', () => {
    expect(describeZoom(1, 2)).toBe('화면을 200%로 확대했어요.');
    expect(describeZoom(3, 2)).toBe('화면 확대를 200%로 줄였어요.');
    expect(describeZoom(2, 1)).toBe('화면 확대를 풀었어요.');
  });

  it('says where the picture went', () => {
    expect(describePan(0.2, -0.1)).toBe(
      '화면을 옮겼어요 (오른쪽으로 20%, 위로 10%).',
    );
    expect(describePan(-0.5, 0)).toBe('화면을 옮겼어요 (왼쪽으로 50%).');
    expect(describePan(0, 0.1)).toBe('화면을 옮겼어요 (아래로 10%).');
    expect(describePan(0, 0)).toBe('화면을 가운데로 되돌렸어요.');
    expect(panText('x', 0)).toBe('가운데');
    expect(panText('y', -0.25)).toBe('위로 25%');
  });

  it('says the turn', () => {
    expect(describeRotation(90)).toBe('화면을 90° 돌렸어요.');
    expect(describeRotation(0)).toBe('화면을 원래 방향으로 되돌렸어요.');
  });

  it('knows when a side of the box shows black', () => {
    const t = (z: number, x: number, y = 0) => ({
      zoom: z,
      panX: x,
      panY: y,
      rotation: 0 as const,
    });
    expect(coversBox(t(1, 0))).toBe(true);
    expect(coversBox(t(1, 0.1))).toBe(false);
    // At 200% the overhang is half a box each side; a pan of 0.25 moves it
    // by 0.25 × 2 = half a box — exactly to the edge.
    expect(coversBox(t(2, 0.25))).toBe(true);
    expect(coversBox(t(2, 0.3))).toBe(false);
  });

  it('gives the strip words only when the picture is not as shot', () => {
    expect(pictureNoteText(clip())).toBe('');
    expect(pictureNoteText(clip({ zoom: 2 }))).toBe('화면 200%');
    expect(pictureNoteText(clip({ rotation: 90 }))).toBe('90° 회전');
    expect(pictureNoteText(clip({ zoom: 1.5, rotation: 270, panX: 0.1 }))).toBe(
      '화면 150% · 270° 회전 · 위치 옮김',
    );
  });
});
