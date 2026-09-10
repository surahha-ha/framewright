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
  /**
   * How many of the clip's first / last TIMELINE frames are softened
   * (ADR-0012). Absent or 0 is a hard cut. What the edge softens INTO is not
   * stored: it is the butted neighbour's overhang when there is one and that
   * neighbour does not soften the same cut itself, and black otherwise — so
   * a fade never moves a clip, and the same field is a dissolve at a cut and
   * a fade from black at the start of the video. A value longer than the clip
   * is clamped when drawn, the head first (`effectiveFades`), never rewritten.
   */
  fadeIn?: number;
  fadeOut?: number;
  /**
   * How loud the clip's sound is, as a LINEAR gain: 1 is the file as
   * recorded, and absent means 1 (ADR-0013). The panel offers 0–2 in steps
   * of a percent; a document outside that is read at the edge, never
   * rewritten. Multiplied into the fade ramps, so a fade on a quiet clip
   * still ends at the clip's level.
   */
  volume?: number;
  /**
   * Whether the clip is heard at all. `true` or absent — never `false` — so
   * a clip that was never muted and one that was muted and unmuted are the
   * same document. Separate from `volume` on purpose: a mute is a switch
   * that goes both ways, and the level has to survive the trip.
   */
  muted?: true;
  /**
   * How the clip's picture sits in the box (ADR-0014). All absent = as
   * shot: fitted into the box, centred, upright. `zoom` is a multiple of
   * that fit (1–4); `panX` / `panY` are fractions of the BOX the picture is
   * moved right / down (-1..1); `rotation` is a quarter turn clockwise.
   * Read through `pictureTransform`, which clamps and defaults; a value
   * outside the range is read at the edge, never rewritten.
   */
  zoom?: number;
  panX?: number;
  panY?: number;
  rotation?: 90 | 180 | 270;
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
