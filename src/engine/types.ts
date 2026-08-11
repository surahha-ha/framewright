// framewright — core project data model.
// Design decisions embodied here:
//  - The TIMELINE is a fixed CFR clock. All timeline positions are integer frames.
//  - Frame rate is stored as a RATIONAL (num/den) so 29.97 = 30000/1001 is exact.
//  - Sources (which may be VFR) are conformed onto this grid via the time-model.
//  - The document is plain serializable JSON with stable string IDs (CRDT-friendly).
//  - `nextId` is a document-scoped counter: ids are DETERMINISTIC (never Date.now()).

export interface Rational {
  num: number;
  den: number;
}

export interface TimelineConfig {
  fps: Rational;
  width: number;
  height: number;
}

export interface AssetMeta {
  width?: number;
  height?: number;
  durationSec?: number;
  codec?: string;
}

export interface Asset {
  id: string;
  kind: 'video' | 'audio' | 'image';
  name: string;
  srcUrl?: string; // remote / object URL (future: server sync)
  opfsKey?: string; // local cache key (future)
  meta: AssetMeta;
}

export interface Clip {
  id: string;
  assetId: string;
  startFrame: number; // position on the timeline (frames)
  inFrame: number; // in-point within the (conformed) source, frames
  outFrame: number; // out-point, EXCLUSIVE — ranges are half-open [in, out)
}

export interface Track {
  id: string;
  type: 'video' | 'audio' | 'text';
  clips: Clip[];
}

export interface Project {
  id: string;
  name: string;
  schemaVersion: number;
  nextId: number; // deterministic id counter
  timeline: TimelineConfig;
  tracks: Track[];
  assets: Asset[];
}
