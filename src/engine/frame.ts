// framewright — the shape of the box (pure). ADR-0015.
//
// "Frame" here is the picture frame — the box's width and height — not
// the timeline's unit of time (that is `time.ts`, ADR-0002). Nothing in
// this file counts frames or converts seconds.
//
// The box every picture is fitted into is `timeline.width × height`: the
// first import sets it from the footage, and the preview, the export, the
// pan limits and the subtitles all read it. Making a 9:16 video out of a
// 16:9 project is therefore one change — the box takes another shape — and
// everything that draws follows, because `pictureRect` is the one rectangle
// (ADR-0014). What is decided here is only which shapes are offered, what
// pixel size each one gets, and the words.

export type FrameShape = 'landscape' | 'portrait' | 'square';

export const FRAME_SHAPES: readonly FrameShape[] = [
  'landscape',
  'portrait',
  'square',
];

/** The word on the button. 가로 / 세로 are what a phone calls them. */
export const FRAME_LABEL: Record<FrameShape, string> = {
  landscape: '가로',
  portrait: '세로',
  square: '정사각',
};

export const FRAME_RATIO_TEXT: Record<FrameShape, string> = {
  landscape: '16:9',
  portrait: '9:16',
  square: '1:1',
};

const RATIO: Record<FrameShape, number> = {
  landscape: 16 / 9,
  portrait: 9 / 16,
  square: 1,
};

/** Encoders reject odd dimensions (4:2:0 chroma), so a box side is the
 *  NEAREST even number: 480 × 16/9 = 853.3 becomes 854, the size every
 *  480p file has, not 852. Not `evenDimensions` (`exportPlan.ts`): that
 *  one FLOORS an integer pixel size the document already holds; this one
 *  rounds a ratio's fractional result. Same constraint, different input. */
function even(n: number): number {
  return Math.max(2, 2 * Math.round(n / 2));
}

/**
 * Which preset a box is, or null when it is none of them (a 4:3 source
 * project, say). Within one percent: 1280×720 and 854×480 are both 16:9.
 */
export function frameShapeOf(width: number, height: number): FrameShape | null {
  if (width <= 0 || height <= 0) return null;
  const ratio = width / height;
  for (const shape of FRAME_SHAPES) {
    if (Math.abs(ratio / RATIO[shape] - 1) < 0.01) return shape;
  }
  return null;
}

/**
 * The pixel size a box gets in a shape: the SHORT side keeps its count of
 * pixels and the long side follows the ratio. So 1280×720 stood up is
 * 720×1280 — the footage's own resolution, the size a phone expects — and
 * laid back down it is 1280×720 again: the presets are each other's
 * inverse, and no clip's picture is ever asked to be sharper than its file.
 */
export function frameSize(
  shape: FrameShape,
  width: number,
  height: number,
): { width: number; height: number } {
  const short = even(Math.min(width, height));
  const long = even(short * (16 / 9));
  switch (shape) {
    case 'landscape':
      return { width: long, height: short };
    case 'portrait':
      return { width: short, height: long };
    case 'square':
      return { width: short, height: short };
  }
}

export function sizeText(width: number, height: number): string {
  return `${width}×${height}`;
}

/** The box in words: "세로 영상 (9:16 · 720×1280)", or just the size when it
 *  is no preset. */
export function frameText(width: number, height: number): string {
  const shape = frameShapeOf(width, height);
  return shape
    ? `${FRAME_LABEL[shape]} 영상 (${FRAME_RATIO_TEXT[shape]} · ${sizeText(width, height)})`
    : sizeText(width, height);
}

/** What the new box does to the clips' pictures, for the sentence. */
export interface FrameHints {
  /** Some clip's picture no longer covers the box (black at a side). */
  uncovered: boolean;
  /** Some clip is zoomed past what covering THIS box needs — filled for
   *  the last shape, say — and now shows a crop with no black to say so. */
  overzoomed: boolean;
}

/**
 * What the box change did — and, when a clip's picture no longer covers
 * the new box, where the way to fill it is, INCLUDING that the clip has to
 * be chosen first (the fill lives in the clip panel, which is not on screen
 * until then). A first-time user who pressed 세로 and got a thin strip with
 * black above and below has to be told the next step in the same breath, or
 * the change reads as broken. The reverse is said too: a clip filled for
 * 세로 and taken back to 가로 is cropped to a third with no black to show
 * it (novice reviewer).
 */
export function describeFrame(
  shape: FrameShape,
  width: number,
  height: number,
  hints: FrameHints,
): string {
  const parts = [
    `${FRAME_LABEL[shape]} 영상(${FRAME_RATIO_TEXT[shape]} · ${sizeText(width, height)})으로 바꿨어요`,
  ];
  if (hints.uncovered)
    parts.push('비는 클립을 고르고 화면 채우기를 누르면 꽉 차요');
  if (hints.overzoomed)
    parts.push('크게 확대된 클립은 화면 원래대로로 되돌릴 수 있어요');
  return `${parts.join(' · ')}.`;
}
