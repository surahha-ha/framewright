// framewright — how a clip's picture sits in the box (pure). ADR-0014.
//
// Four optional fields on the clip say where its picture goes: how big
// (`zoom`, 1 = fitted into the box as before), how far off centre (`panX` /
// `panY`, fractions of the BOX), and which way up (`rotation`, quarter
// turns). Everything else is derived here, once, so the preview, the export
// and the strip all draw and describe the same picture:
//
//   - `pictureTransform`: the four numbers as used — clamped, defaulted.
//   - `pictureRect`: where the picture is drawn in a box of a given size,
//     and by how much it is turned. `composeFrame` draws exactly this.
//   - the sentences.
//
// Pan is a fraction of the box, not of the picture, so "move it half a
// screen right" means the same thing at every zoom, and a drag on the
// preview converts pixels to it with one division.

import { containRect } from './exportConfig';
import type { Clip, Project } from './types';

/** Four times the fit is as far as the panel goes. Past that a 1080p frame
 *  is showing 270 real pixels across the whole box. */
export const ZOOM_MAX = 4;

/** One notch of the zoom slider: ten percent. */
export const ZOOM_STEP_PERCENT = 10;

export type Rotation = 0 | 90 | 180 | 270;

export interface PictureTransform {
  /** 1 = fitted into the box; 2 = twice that. */
  zoom: number;
  /** Fraction of the box's width the picture is moved right (-1..1). */
  panX: number;
  /** Fraction of the box's height the picture is moved down (-1..1). */
  panY: number;
  rotation: Rotation;
}

export const AS_SHOT: PictureTransform = {
  zoom: 1,
  panX: 0,
  panY: 0,
  rotation: 0,
};

const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

function clampZoom(zoom: number | undefined): number {
  if (zoom === undefined || !Number.isFinite(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(1, zoom));
}

/**
 * The most the picture may be moved on either axis, as a fraction of the
 * box at the fit — and the pan SCALES with the zoom (see `pictureRect`),
 * so for a picture that fills the box's width, half a box is always
 * exactly enough to bring the picture's own edge to the box's centre:
 * every part of it reachable, at least half the box always showing
 * picture, never black with no explanation (the novice reviewer's
 * blocker). A picture NARROWER than the box on an axis (stood up, or
 * 4:3 in 16:9) reaches that same point sooner; `panLimits` says where.
 */
export const PAN_LIMIT = 0.5;

/** One notch of a pan slider: five percent of the box. */
export const PAN_STEP_PERCENT = 5;

function clampPan(pan: number | undefined, limit = PAN_LIMIT): number {
  if (pan === undefined || !Number.isFinite(pan)) return 0;
  return Math.min(limit, Math.max(-limit, pan));
}

export interface PanLimits {
  /** How far sideways, as a fraction of the box's width (0..PAN_LIMIT). */
  x: number;
  /** How far up or down, as a fraction of the box's height. */
  y: number;
}

/** The fitted footprint of the picture in the box, turned as the clip
 *  says: a quarter turn swaps the sides before the fit. */
function fitted(
  srcWidth: number,
  srcHeight: number,
  boxWidth: number,
  boxHeight: number,
  rotation: Rotation,
) {
  const turned = rotation === 90 || rotation === 270;
  return turned
    ? containRect(srcHeight, srcWidth, boxWidth, boxHeight)
    : containRect(srcWidth, srcHeight, boxWidth, boxHeight);
}

/** Down to a slider notch, in integer percent so 0.35 is 0.35. */
function notchDown(limit: number): number {
  const notches = Math.floor((limit * 100) / PAN_STEP_PERCENT + 1e-9);
  return (notches * PAN_STEP_PERCENT) / 100;
}

/**
 * How far the picture may be moved on each axis: half of its fitted
 * footprint's share of the box, at most `PAN_LIMIT`, rounded down to a
 * slider notch. That is exactly the pan that brings the picture's own
 * edge to the box's centre (the pan is pan × zoom boxes, the half
 * footprint is fit × zoom / 2, and the zoom cancels), so the rule
 * `PAN_LIMIT` was written for holds for every shape of picture: a
 * 16:9 stood up in a 16:9 box goes 15% sideways, not 50% — at 50% it
 * had left the box entirely. Unknown sizes get the full half box.
 */
export function panLimits(
  srcWidth: number,
  srcHeight: number,
  boxWidth: number,
  boxHeight: number,
  rotation: Rotation,
): PanLimits {
  if (srcWidth <= 0 || srcHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return { x: PAN_LIMIT, y: PAN_LIMIT };
  }
  const fit = fitted(srcWidth, srcHeight, boxWidth, boxHeight, rotation);
  return {
    x: Math.min(PAN_LIMIT, notchDown(fit.width / (2 * boxWidth))),
    y: Math.min(PAN_LIMIT, notchDown(fit.height / (2 * boxHeight))),
  };
}

/** The limits for a clip in its project: the asset's recorded size in the
 *  timeline's box, turned as the clip is — or as `rotation` says it is
 *  about to be. */
export function clipPanLimits(
  project: Project,
  clip: Pick<Clip, 'assetId' | 'zoom' | 'panX' | 'panY' | 'rotation'>,
  rotation: Rotation = pictureTransform(clip).rotation,
): PanLimits {
  const asset = project.assets.find((a) => a.id === clip.assetId);
  return panLimits(
    asset?.meta.width ?? 0,
    asset?.meta.height ?? 0,
    project.timeline.width,
    project.timeline.height,
    rotation,
  );
}

/** Why a pan slider stops short of half a box; empty when neither does. */
export function panLimitText(limits: PanLimits): string {
  const parts: string[] = [];
  if (limits.x < PAN_LIMIT)
    parts.push(`가로로는 ${Math.round(limits.x * 100)}%`);
  if (limits.y < PAN_LIMIT)
    parts.push(`세로로는 ${Math.round(limits.y * 100)}%`);
  if (parts.length === 0) return '';
  // "보이는 범위" is the turn's word for the same thing (`describeRotation`);
  // a first-time user meets one phrase, not two (novice). No "box": nothing
  // on screen is called that.
  return `${parts.join(', ')}까지만 옮길 수 있어요 · 더 가면 화면이 보이는 범위를 벗어나요`;
}

/** Round to a percent, so a value survives a save and a comparison. */
export function roundZoom(zoom: number): number {
  return Math.round(clampZoom(zoom) * 100) / 100;
}

export function roundPan(pan: number): number {
  const r = Math.round(clampPan(pan) * 100) / 100;
  return r === 0 ? 0 : r; // no -0
}

/** Whether the picture still covers the whole box after the pan — when it
 *  does not, a side of the box shows black, and the panel says so. */
export function coversBox(t: PictureTransform): boolean {
  // The picture overhangs the box by (zoom - 1) / 2 of a box on each side,
  // and a pan moves it by pan * zoom boxes.
  const room = (t.zoom - 1) / (2 * t.zoom) + 1e-9;
  return Math.abs(t.panX) <= room && Math.abs(t.panY) <= room;
}

export function isRotation(value: unknown): value is Rotation {
  return ROTATIONS.includes(value as Rotation);
}

/** A quarter turn on from this one, back round to none after three. */
export function nextRotation(rotation: Rotation): Rotation {
  return ROTATIONS[(ROTATIONS.indexOf(rotation) + 1) % ROTATIONS.length];
}

/** The transform as used: clamped to what the panel offers, as shot when
 *  nothing is said. A document outside the range is read at the edge,
 *  never rewritten. */
export function pictureTransform(
  clip: Pick<Clip, 'zoom' | 'panX' | 'panY' | 'rotation'>,
): PictureTransform {
  const zoom = clampZoom(clip.zoom);
  return {
    zoom,
    panX: clampPan(clip.panX),
    panY: clampPan(clip.panY),
    rotation: isRotation(clip.rotation) ? clip.rotation : 0,
  };
}

export function isAsShot(t: PictureTransform): boolean {
  return t.zoom === 1 && t.panX === 0 && t.panY === 0 && t.rotation === 0;
}

export interface PictureRect {
  x: number;
  y: number;
  /** The drawn size BEFORE the turn: for a quarter turn, `width` is the
   *  picture's long side even though it ends up standing. */
  width: number;
  height: number;
  rotation: Rotation;
}

/**
 * Where a `srcWidth`×`srcHeight` picture is drawn in a `boxWidth`×`boxHeight`
 * box: its turned footprint fitted into the box (a quarter turn swaps the
 * sides), grown `zoom` times about the box's centre, then moved by the pan.
 * The draw turns it about its own centre, so `x`/`y`/`width`/`height` are
 * the unturned rectangle around that centre.
 */
export function pictureRect(
  srcWidth: number,
  srcHeight: number,
  boxWidth: number,
  boxHeight: number,
  t: PictureTransform,
): PictureRect {
  if (srcWidth <= 0 || srcHeight <= 0) {
    // Nothing to turn: a box-sized image inside a turned context would
    // crop its own corners.
    return { x: 0, y: 0, width: boxWidth, height: boxHeight, rotation: 0 };
  }
  const turned = t.rotation === 90 || t.rotation === 270;
  const fit = fitted(srcWidth, srcHeight, boxWidth, boxHeight, t.rotation);
  const footW = fit.width * t.zoom;
  const footH = fit.height * t.zoom;
  const width = turned ? footH : footW;
  const height = turned ? footW : footH;
  // A pan past this picture's own limit (a document from before the limit
  // existed, or a re-linked file of another shape) is read at the limit,
  // never rewritten — the same rule as a level above its ceiling.
  const limit = panLimits(srcWidth, srcHeight, boxWidth, boxHeight, t.rotation);
  const panX = clampPan(t.panX, limit.x);
  const panY = clampPan(t.panY, limit.y);
  // The pan scales with the zoom, so the point of the picture at the box's
  // centre stays put when the zoom changes: frame a subject, then grow it.
  const cx = boxWidth / 2 + panX * boxWidth * t.zoom;
  const cy = boxHeight / 2 + panY * boxHeight * t.zoom;
  return {
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
    rotation: t.rotation,
  };
}

export function zoomText(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

export function describeZoom(from: number, to: number): string {
  if (to === 1) return '화면 확대를 풀었어요.';
  return to > from
    ? `화면을 ${zoomText(to)}로 확대했어요.`
    : `화면 확대를 ${zoomText(to)}로 줄였어요.`;
}

/** One axis of a pan, with its direction in words — a signed percent says
 *  nothing about which way is up. */
export function panText(axis: 'x' | 'y', pan: number): string {
  const pct = Math.round(Math.abs(pan) * 100);
  if (pct === 0) return '가운데';
  const dir =
    axis === 'x'
      ? pan > 0
        ? '오른쪽으로'
        : '왼쪽으로'
      : pan > 0
        ? '아래로'
        : '위로';
  return `${dir} ${pct}%`;
}

export function describePan(x: number, y: number): string {
  if (x === 0 && y === 0) return '화면을 가운데로 되돌렸어요.';
  const parts = [x !== 0 ? panText('x', x) : '', y !== 0 ? panText('y', y) : '']
    .filter(Boolean)
    .join(', ');
  return `화면을 옮겼어요 (${parts}).`;
}

/** The turn — and, when the turn's new limit pulled the pan in, that too:
 *  a slider that moved on its own reads as broken unless something says
 *  why (the sound unit's ceiling taught this). */
export function describeRotation(
  rotation: Rotation,
  panPulledIn = false,
): string {
  const turn =
    rotation === 0
      ? '화면을 원래 방향으로 되돌렸어요'
      : `화면을 ${rotation}° 돌렸어요`;
  return panPulledIn
    ? `${turn} · 위치는 보이는 범위 안으로 맞췄어요.`
    : `${turn}.`;
}

/** The strip's words for a picture that is not as shot; empty when it is. */
export function pictureNoteText(
  clip: Pick<Clip, 'zoom' | 'panX' | 'panY' | 'rotation'>,
): string {
  const t = pictureTransform(clip);
  const parts: string[] = [];
  if (t.zoom !== 1) parts.push(`화면 ${zoomText(t.zoom)}`);
  if (t.rotation !== 0) parts.push(`${t.rotation}° 회전`);
  if (t.panX !== 0 || t.panY !== 0) parts.push('위치 옮김');
  return parts.join(' · ');
}
