// framewright — pure export helpers (no browser APIs, unit-testable in Node).
// Codec-string/level selection and letterbox geometry live here so they can be
// tested without an encoder.

export type AvcProfile = 'high' | 'main' | 'baseline';

const PROFILE_PREFIX: Record<AvcProfile, string> = {
  high: '6400',
  main: '4d00',
  baseline: '4200',
};

/** (level, maxMacroblocksPerSecond, maxFrameSizeInMacroblocks) */
const LEVELS: Array<[string, number, number]> = [
  ['1e', 40500, 1620], // 3.0
  ['1f', 108000, 3600], // 3.1
  ['20', 216000, 5120], // 3.2
  ['28', 245760, 8192], // 4.0
  ['2a', 522240, 8704], // 4.2
  ['32', 589824, 22080], // 5.0
  ['33', 983040, 36864], // 5.1
  ['34', 2073600, 36864], // 5.2
  ['3c', 4177920, 139264], // 6.0
  ['3d', 8355840, 139264], // 6.1
  ['3e', 16711680, 139264], // 6.2
];

/**
 * Pick the AVC level from the MACROBLOCK RATE, not the pixel count.
 * 1280x720@60 needs Level 3.2 — declaring 3.1 (which area-only logic does)
 * makes strict decoders and some upload pipelines reject the file.
 */
export function avcLevel(width: number, height: number, fps: number): string {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const mbps = mbs * Math.max(1, fps);
  for (const [level, maxMbps, maxFs] of LEVELS) {
    if (mbps <= maxMbps && mbs <= maxFs) return level;
  }
  return LEVELS[LEVELS.length - 1][0];
}

export function avcCodecString(
  profile: AvcProfile,
  width: number,
  height: number,
  fps: number,
): string {
  return `avc1.${PROFILE_PREFIX[profile]}${avcLevel(width, height, fps)}`;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Letterbox rect for drawing a source inside a canvas, preserving aspect ratio.
 * The preview letterboxes via CSS `object-fit: contain`; export must do the same
 * arithmetic or the file is geometrically distorted (preview != export).
 */
export function containRect(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Rect {
  if (srcWidth <= 0 || srcHeight <= 0) {
    return { x: 0, y: 0, width: dstWidth, height: dstHeight };
  }
  const scale = Math.min(dstWidth / srcWidth, dstHeight / srcHeight);
  const width = srcWidth * scale;
  const height = srcHeight * scale;
  return {
    x: (dstWidth - width) / 2,
    y: (dstHeight - height) / 2,
    width,
    height,
  };
}
