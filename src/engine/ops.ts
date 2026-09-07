// framewright — document operations.
// Every edit is expressed as a list of small, invertible ops. A command returns a
// Patch { forward, inverse }; undo applies the inverse, redo re-applies the SAME
// recorded forward ops (so redo is deterministic — it never re-runs the command).

import type { Asset, Clip, Project, Subtitle, TimelineConfig } from './types';

export type Op =
  | { kind: 'insertClip'; trackId: string; index: number; clip: Clip }
  | { kind: 'removeClip'; trackId: string; index: number }
  | {
      kind: 'updateClip';
      trackId: string;
      clipId: string;
      changes: Partial<Omit<Clip, 'id'>>;
    }
  /** Subtitles are their own list (see `types.ts`), so they get their own
   *  three ops — the same shape as a clip's, keyed by index and by id. */
  | { kind: 'insertSubtitle'; index: number; subtitle: Subtitle }
  | { kind: 'removeSubtitle'; index: number }
  | {
      kind: 'updateSubtitle';
      subtitleId: string;
      changes: Partial<Omit<Subtitle, 'id'>>;
    }
  | { kind: 'addAsset'; asset: Asset }
  | { kind: 'removeAsset'; assetId: string }
  /** Where the asset's file is stored, and what was corrected on the way in.
   *  Never touches the cut — see `asset.attachMedia`. */
  | {
      kind: 'updateAsset';
      assetId: string;
      changes: Partial<Omit<Asset, 'id'>>;
    }
  | { kind: 'setTimeline'; config: TimelineConfig }
  | { kind: 'setNextId'; value: number }
  /** Whole-document replace — used by "restore a version", which must itself be
   *  undoable so restoring can never be the thing that loses your work. */
  | { kind: 'replaceProject'; project: Project };

export interface Patch {
  forward: Op[];
  inverse: Op[];
}

function mapTrack(
  project: Project,
  trackId: string,
  fn: (clips: Clip[]) => Clip[],
): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.id === trackId ? { ...t, clips: fn(t.clips) } : t,
    ),
  };
}

/**
 * Setting a field to `undefined` MEANS removing it.
 *
 * Absence carries meaning here — an asset with no `meta.startOffsetSec` is one
 * imported before that correction existed (ADR-0008) — and `JSON.stringify`
 * drops undefined anyway, so a merged-in `undefined` would survive in memory
 * and vanish on reload. Same rule in both places, or undo produces a document
 * that differs from the one you get by reopening it.
 */
function dropUndefined<T extends object>(value: T): T {
  const out = { ...value } as Record<string, unknown>;
  for (const key of Object.keys(out))
    if (out[key] === undefined) delete out[key];
  return out as T;
}

export function applyOp(project: Project, op: Op): Project {
  switch (op.kind) {
    case 'insertClip':
      return mapTrack(project, op.trackId, (clips) => {
        const next = clips.slice();
        next.splice(op.index, 0, op.clip);
        return next;
      });
    case 'removeClip':
      return mapTrack(project, op.trackId, (clips) => {
        const next = clips.slice();
        next.splice(op.index, 1);
        return next;
      });
    case 'updateClip':
      return mapTrack(project, op.trackId, (clips) =>
        clips.map((c) => (c.id === op.clipId ? { ...c, ...op.changes } : c)),
      );
    case 'insertSubtitle': {
      const next = project.subtitles.slice();
      next.splice(op.index, 0, op.subtitle);
      return { ...project, subtitles: next };
    }
    case 'removeSubtitle': {
      const next = project.subtitles.slice();
      next.splice(op.index, 1);
      return { ...project, subtitles: next };
    }
    case 'updateSubtitle':
      return {
        ...project,
        subtitles: project.subtitles.map((s) =>
          s.id === op.subtitleId ? { ...s, ...op.changes } : s,
        ),
      };
    case 'addAsset':
      return { ...project, assets: [...project.assets, op.asset] };
    case 'removeAsset':
      return {
        ...project,
        assets: project.assets.filter((a) => a.id !== op.assetId),
      };
    case 'updateAsset':
      return {
        ...project,
        assets: project.assets.map((a) =>
          a.id === op.assetId
            ? dropUndefined({
                ...a,
                ...op.changes,
                meta: dropUndefined({ ...a.meta, ...op.changes.meta }),
              })
            : a,
        ),
      };
    case 'setTimeline':
      return { ...project, timeline: op.config };
    case 'setNextId':
      return { ...project, nextId: op.value };
    case 'replaceProject':
      return op.project;
  }
}

export function applyOps(project: Project, ops: Op[]): Project {
  return ops.reduce(applyOp, project);
}
