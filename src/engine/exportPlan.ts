// framewright — export plan (pure).
// Walks the timeline frame by frame and records what should be shown at each
// one. Export is DETERMINISTIC: it renders this list, never a wall clock, so the
// output matches the preview exactly (ADR-0002, ADR-0005).

import type { Project } from './types';
import { resolveAt, videoDuration } from './timeline';
import { subtitleFrameAt } from './subtitleStyle';
import type { SubtitleFrame } from './subtitleRender';
import { imageFrameAt } from './images';
import type { ImageFrame } from './imageRender';
import { blendAt, type Blend } from './fades';
import { isAsShot, pictureTransform, type PictureTransform } from './picture';

export interface ExportFrame {
  timelineFrame: number;
  /** null for a gap — render a blank frame rather than dropping time. */
  assetId: string | null;
  clipId: string | null;
  sourceFrame: number;
  /** The words burnt into this frame — how they look, where they sit and
   *  how far in their effect is (ADR-0017) — or null. Part of the plan, not
   *  looked up at render time, so "what does frame N show" is answered in
   *  one place and the preview and the export cannot answer it differently. */
  subtitle: SubtitleFrame | null;
  /** The picture laid over this frame — which asset, how big it is in its own
   *  pixels, where it sits and how wide it is drawn (ADR-0020) — or null. In
   *  the plan for the same reason as the words, and for one more: the export
   *  opens every bitmap the plan names before frame 0, so the plan has to say
   *  which ones those are before anything is rendered (`imagesInPlan`). */
  image: ImageFrame | null;
  /** A second picture mixed over this one — the other side of a fade — and
   *  how much of it shows (ADR-0012). `assetId: null` is black. In the plan
   *  for the same reason as the words: one answer per frame, for both
   *  surfaces. */
  blend: Blend | null;
  /** How this frame's clip puts its picture in the box (ADR-0014). Absent
   *  when as shot, and for a gap. In the plan for the same reason as the
   *  words and the blend: one answer per frame, for both surfaces. */
  transform?: PictureTransform;
}

export function buildExportPlan(project: Project): ExportFrame[] {
  const total = videoDuration(project);
  const plan: ExportFrame[] = new Array(total);
  for (let f = 0; f < total; f++) {
    const hit = resolveAt(project, f);
    const subtitle = subtitleFrameAt(project, f);
    const image = imageFrameAt(project, f);
    plan[f] = hit
      ? {
          timelineFrame: f,
          assetId: hit.clip.assetId,
          clipId: hit.clip.id,
          sourceFrame: hit.sourceFrame,
          subtitle,
          image,
          blend: blendAt(project, f),
          ...(isAsShot(pictureTransform(hit.clip))
            ? {}
            : { transform: pictureTransform(hit.clip) }),
        }
      : {
          timelineFrame: f,
          assetId: null,
          clipId: null,
          sourceFrame: 0,
          subtitle,
          image,
          blend: null,
        };
  }
  return plan;
}

export function planDuration(plan: ExportFrame[]): number {
  return plan.length;
}

/**
 * Can a running decode session serve this frame, or must it re-seek?
 * A forward decoder can roll on through small forward gaps, but not backwards
 * and not across a long jump (where seeking to a nearer keyframe is cheaper).
 * Splitting a clip changes its id while the SOURCE stays continuous — keying on
 * the clip id would restart the decoder at every cut and stall playback.
 */
export function isContinuous(
  sessionAssetId: string | null,
  lastSourceFrame: number,
  assetId: string,
  sourceFrame: number,
  maxForwardJump = 90,
): boolean {
  if (sessionAssetId !== assetId) return false;
  if (lastSourceFrame < 0) return false;
  const delta = sourceFrame - lastSourceFrame;
  return delta >= 0 && delta <= maxForwardJump;
}

/** Encoders reject odd dimensions with 4:2:0 chroma. */
export function evenDimensions(
  width: number,
  height: number,
): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(2, width - (width % 2)),
    height: Math.max(2, height - (height % 2)),
  };
}
