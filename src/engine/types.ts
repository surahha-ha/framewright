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
  /** Presentation offset removed from the source when it was imported (ADR-0008).
   *  Absent means the asset was imported BEFORE that correction existed, so its
   *  frame numbers were chosen against a mapping that was off by this much. */
  startOffsetSec?: number;
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

/**
 * A subtitle: words shown over the picture for a range of TIMELINE frames.
 *
 * Not a clip. A clip is a window onto a source file (`inFrame`/`outFrame`
 * name frames of media); a subtitle has no source, only a position and the
 * text itself, so it lives in its own list rather than pretending to be a
 * clip on a `text` track with nothing to point at. Same half-open rule as
 * everything else: shown on frames `[startFrame, endFrame)`.
 *
 * Subtitles are kept sorted by `startFrame` and never overlap — one line of
 * words on screen at a time is the whole of what a first-time user expects.
 */
export interface Subtitle {
  id: string;
  text: string;
  startFrame: number;
  endFrame: number; // EXCLUSIVE
}

export interface Project {
  id: string;
  name: string;
  schemaVersion: number;
  nextId: number; // deterministic id counter
  timeline: TimelineConfig;
  tracks: Track[];
  assets: Asset[];
  subtitles: Subtitle[];
}
