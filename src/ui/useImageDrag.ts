// framewright — the picture on the stage dragged by hand (E10 step 4,
// ADR-0020), as a hook.
//
// The third caller of `useStageDrag`, after the clip's pan and the words.
// The gesture itself — the main button, pointer capture, the 3px threshold,
// `dragAxis` on both axes with the origin rebased at a limit, the pointer-id
// check, the teardown — is the hook's; this file is what makes it an IMAGE:
// the hit test, the limits, the command and its coalesce key, the snap at the
// drop, and the one sentence a press that only chose has to say.
//
// Two things here are not the words':
//
//   - THE HIT TEST IS ARITHMETIC, NOT INK. `imageRect` answers where the
//     picture is drawn from the ASSET's recorded pixel size, which the
//     document has the moment the image exists — so the sticker can be
//     pressed and moved while its bitmap is still being read, and a picture
//     that never arrives is still a thing the user can put where they want.
//     The words have to be measured because their ink depends on the face.
//   - BOTH AXES GO IN, ALWAYS. `image.setPosition` reads its two axes out of
//     the ARGS (`normalizeImagePosition`), and an axis left out is the CENTRE
//     of the box, not "leave it alone" — so one-axis args would snap the
//     picture back to the middle on the other axis. `dragAxis` hands both
//     axes over on every move and `snapImagePosition` returns both, so
//     nothing below ever writes one on its own.
import { useState } from 'react';
import type { RefObject } from 'react';
import { useStore } from '../store/projectStore';
import type { StageImage } from '../engine/types';
import { imageRect, type ImageFrame } from '../engine/imageRender';
import { snapImagePosition } from '../engine/images';
import { useStageDrag, type StageEvent } from './useStageDrag';

/** The middle of an axis — what an absent `posX` / `posY` draws at, and so
 *  what the drag starts from (`imageRect`, `normalizeImagePosition`). */
const CENTRE = 0.5;

/** What a press on the picture locks for the rest of the gesture. */
interface Pressed {
  imageId: string;
  /** Whether the press changed the selection — a press that then does not
   *  move has only that to say. */
  chose: boolean;
}

export function useImageDrag({
  imageRef,
  frame,
  image,
}: {
  imageRef: RefObject<HTMLCanvasElement>;
  /** What the image layer draws right now, null when nothing. */
  frame: ImageFrame | null;
  /** The image under the playhead, the one `frame` came from. */
  image: StageImage | null;
}) {
  const run = useStore((s) => s.run);
  const setStatus = useStore((s) => s.setStatus);
  const selectImage = useStore((s) => s.selectImage);
  const selectedImageId = useStore((s) => s.selectedImageId);
  const [overImage, setOverImage] = useState(false);

  /** The drawn rectangle under the pointer, or null. The canvas's CSS rect
   *  IS the box the fractions are of, so the rectangle comes back in the
   *  same CSS pixels the pointer is in — no export-grid conversion, unlike
   *  the words, whose layout is measured on the export's pixel grid. */
  function imageUnder(e: StageEvent) {
    const canvas = imageRef.current;
    if (!canvas || !frame || !image) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const r = imageRect(
      frame,
      frame.srcWidth,
      frame.srcHeight,
      rect.width,
      rect.height,
    );
    if (!(r.width > 0) || !(r.height > 0)) return null;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < r.x || x > r.x + r.width || y < r.y || y > r.y + r.height)
      return null;
    return { rect };
  }

  const drag = useStageDrag<Pressed>({
    // A press on the picture selects the image and starts its drag in the
    // same press: the pointer is inside the drawn rectangle, so there is
    // nothing else it could have meant. (The pan needs a press-to-choose
    // step because a press on the footage is ambiguous; this one is not.)
    press(e) {
      const hit = imageUnder(e);
      if (!hit || !image) return null;
      const pressed: Pressed = {
        imageId: image.id,
        chose: image.id !== selectedImageId,
      };
      selectImage(image.id);
      return {
        target: pressed,
        // The document's own two numbers, with an absent axis read as the
        // centre — the place the picture is actually drawn at, so the first
        // move does not jump.
        base: { x: image.posX ?? CENTRE, y: image.posY ?? CENTRE },
        size: { x: hit.rect.width, y: hit.rect.height },
        // The CENTRE stays inside the box; the rectangle may hang off an
        // edge, which is a normal thing to want of a sticker (`imageRect`).
        min: { x: 0, y: 0 },
        max: { x: 1, y: 1 },
      };
    },
    move(t, v) {
      run(
        'image.setPosition',
        { imageId: t.imageId, posX: v.x, posY: v.y },
        `imgpos:${t.imageId}`,
      );
    },
    release(t, moved, last) {
      if (moved) {
        // The drop: near the middle, on it — under the SAME key, so the
        // whole gesture is one undo step and one Ctrl+Z puts the picture
        // back where it was before the press. `snapImagePosition` returns
        // the normal form and always both axes.
        const snapped = snapImagePosition({ posX: last.x, posY: last.y });
        run(
          'image.setPosition',
          { imageId: t.imageId, ...snapped },
          `imgpos:${t.imageId}`,
        );
      } else if (t.chose) {
        // The press picked the image and the panel changed under the
        // pointer; the words' press says as much, so does this (a11y).
        setStatus('화면의 이미지를 골랐어요 · 끌면 자리가 옮겨져요.');
      }
    },
  });

  /** A press on the picture: selects the image and starts its drag in the
   *  same press. True when it did. */
  function onPointerDown(e: StageEvent): boolean {
    return drag.onPointerDown(e);
  }

  /** A move: the drag when one is on (true), else the cursor (false, so the
   *  caller may go on to its own drag). */
  function onPointerMove(e: StageEvent): boolean {
    if (drag.onPointerMove(e)) return true;
    if (!drag.active) {
      const over = imageUnder(e) !== null;
      if (over !== overImage) setOverImage(over);
    }
    return false;
  }

  /** The release (or a cancel): the snapped drop, or the one sentence a
   *  press that only chose has to say. True when an image drag ended. */
  function onPointerUp(e: StageEvent): boolean {
    return drag.onPointerUp(e);
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    overImage,
    get active() {
      return drag.active;
    },
  };
}
