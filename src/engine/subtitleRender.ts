// framewright — drawing a subtitle onto a picture.
//
// One function draws the words for BOTH the preview and the export, at
// whatever size the picture is, so the two can never disagree about where the
// words go or how big they are. Everything is relative to the picture's
// height: the font, the padding, the margin from the bottom edge. That is what
// makes the preview (drawn at the timeline's size, scaled by CSS) and the
// export (drawn at the timeline's size, encoded) the same image.
//
// The arithmetic — font size, line breaks, pill positions — is separated from
// the canvas calls so it can be unit-tested in Node with a fake measurer.

/** How tall the words are, as a share of the picture's height. About 5% is
 *  where broadcast captions sit: readable on a phone, not a banner on a TV. */
const FONT_SHARE = 0.052;
/** Below this the words are dots. Only a very small picture reaches it. */
const MIN_FONT_PX = 12;
const LINE_HEIGHT = 1.35;
/** A pill may span at most this much of the width before the line wraps. */
const MAX_WIDTH_SHARE = 0.9;
/** Distance from the bottom edge to the bottom of the last pill. */
const BOTTOM_SHARE = 0.06;

/** Set once for every draw. A system Korean face first, so 한글 and Latin
 *  come from the same family on Windows, macOS and Linux desktops. */
export const SUBTITLE_FONT_FAMILY =
  '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif';

export const SUBTITLE_GROUND = 'rgba(0, 0, 0, 0.62)';
export const SUBTITLE_INK = '#ffffff';

export interface SubtitleBox {
  width: number;
  height: number;
}

export interface SubtitleLine {
  text: string;
  /** Pill width, padding included. */
  widthPx: number;
  /** Pill's left edge. */
  x: number;
  /** Pill's top edge. */
  y: number;
}

export interface SubtitleLayout {
  fontPx: number;
  lineHeightPx: number;
  padX: number;
  bottomPx: number;
  lines: SubtitleLine[];
}

export function subtitleFontPx(pictureHeight: number): number {
  return Math.max(MIN_FONT_PX, Math.round(pictureHeight * FONT_SHARE));
}

/**
 * Break the text into drawable lines. The user's own line breaks are kept;
 * a line wider than `maxWidthPx` is wrapped at spaces, and a run with no
 * spaces at all (ordinary for 한글) is broken between characters rather than
 * being allowed to run off the picture.
 */
export function wrapSubtitle(
  text: string,
  maxWidthPx: number,
  measure: (s: string) => number,
): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (measure(line) <= maxWidthPx) {
      out.push(line);
      continue;
    }
    let current = '';
    const push = () => {
      if (current) out.push(current);
      current = '';
    };
    for (const word of line.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate) <= maxWidthPx) {
        current = candidate;
        continue;
      }
      push();
      if (measure(word) <= maxWidthPx) {
        current = word;
        continue;
      }
      // One word wider than the whole line: break it wherever it fits.
      for (const ch of Array.from(word)) {
        const next = current + ch;
        if (current && measure(next) > maxWidthPx) push();
        current += ch;
      }
    }
    push();
  }
  return out;
}

/** Where every pill goes. Null when there is nothing to draw. */
export function layoutSubtitle(
  text: string,
  box: SubtitleBox,
  measure: (s: string) => number,
): SubtitleLayout | null {
  const fontPx = subtitleFontPx(box.height);
  const lineHeightPx = Math.round(fontPx * LINE_HEIGHT);
  const padX = Math.round(fontPx * 0.4);
  const bottomPx = Math.round(box.height * BOTTOM_SHARE);
  const maxTextPx = box.width * MAX_WIDTH_SHARE - 2 * padX;
  const lines = wrapSubtitle(text, maxTextPx, measure);
  if (lines.length === 0) return null;
  const placed: SubtitleLine[] = [];
  let bottom = box.height - bottomPx;
  for (let i = lines.length - 1; i >= 0; i--) {
    const widthPx = Math.round(measure(lines[i]) + 2 * padX);
    const y = bottom - lineHeightPx;
    placed.unshift({
      text: lines[i],
      widthPx,
      x: Math.round((box.width - widthPx) / 2),
      y,
    });
    bottom = y;
  }
  return { fontPx, lineHeightPx, padX, bottomPx, lines: placed };
}

/** The 2D context both a `<canvas>` and an `OffscreenCanvas` hand out. */
export type SubtitleContext =
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function subtitleFont(fontPx: number): string {
  return `600 ${fontPx}px ${SUBTITLE_FONT_FAMILY}`;
}

/**
 * Draw the words onto a picture of the given size. Draws nothing for blank
 * text. The caller owns the canvas: this neither clears it nor saves state.
 */
export function drawSubtitle(
  ctx: SubtitleContext,
  text: string,
  width: number,
  height: number,
): void {
  const fontPx = subtitleFontPx(height);
  ctx.font = subtitleFont(fontPx);
  const layout = layoutSubtitle(
    text,
    { width, height },
    (s) => ctx.measureText(s).width,
  );
  if (!layout) return;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const line of layout.lines) {
    ctx.fillStyle = SUBTITLE_GROUND;
    ctx.fillRect(line.x, line.y, line.widthPx, layout.lineHeightPx);
    ctx.fillStyle = SUBTITLE_INK;
    ctx.fillText(
      line.text,
      line.x + layout.padX,
      line.y + layout.lineHeightPx / 2,
    );
  }
}
