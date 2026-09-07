// framewright — export plan (pure).
// Walks the timeline frame by frame and records what should be shown at each
// one. Export is DETERMINISTIC: it renders this list, never a wall clock, so the
// output matches the preview exactly (ADR-0002, ADR-0005).

import type { Project } from './types';
import { resolveAt, videoDuration } from './timeline';
import { subtitleAt } from './subtitles';

export interface ExportFrame {
  timelineFrame: number;
  /** null for a gap — render a blank frame rather than dropping time. */
  assetId: string | null;
  clipId: string | null;
  sourceFrame: number;
  /** The words burnt into this frame, or null. Part of the plan, not looked
   *  up at render time, so "what does frame N show" is answered in one place
   *  and the preview and the export cannot answer it differently. */
  subtitle: string | null;
}

export function buildExportPlan(project: Project): ExportFrame[] {
  const total = videoDuration(project);
  const plan: ExportFrame[] = new Array(total);
  for (let f = 0; f < total; f++) {
    const hit = resolveAt(project, f);
    const words = subtitleAt(project, f)?.text ?? '';
    const subtitle = words.length ? words : null;
    plan[f] = hit
      ? {
          timelineFrame: f,
          assetId: hit.clip.assetId,
          clipId: hit.clip.id,
          sourceFrame: hit.sourceFrame,
          subtitle,
        }
      : {
          timelineFrame: f,
          assetId: null,
          clipId: null,
          sourceFrame: 0,
          subtitle,
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
