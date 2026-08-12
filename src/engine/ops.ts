// framewright — document operations.
// Every edit is expressed as a list of small, invertible ops. A command returns a
// Patch { forward, inverse }; undo applies the inverse, redo re-applies the SAME
// recorded forward ops (so redo is deterministic — it never re-runs the command).

import type { Asset, Clip, Project, TimelineConfig } from './types';

export type Op =
  | { kind: 'insertClip'; trackId: string; index: number; clip: Clip }
  | { kind: 'removeClip'; trackId: string; index: number }
  | {
      kind: 'updateClip';
      trackId: string;
      clipId: string;
      changes: Partial<Omit<Clip, 'id'>>;
    }
  | { kind: 'addAsset'; asset: Asset }
  | { kind: 'removeAsset'; assetId: string }
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
    case 'addAsset':
      return { ...project, assets: [...project.assets, op.asset] };
    case 'removeAsset':
      return {
        ...project,
        assets: project.assets.filter((a) => a.id !== op.assetId),
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
