// framewright — the box's shape: 가로 · 세로 · 정사각 (ADR-0015).
//
// Three radios over the preview, one per frame command, because the shape
// of the output is a fact about the picture the user is looking at, not
// about any one clip — so it does not belong in the clip panel, and a
// toolbar row of three is read as three edits rather than one choice.
//
// A radiogroup, not three toggle buttons: exactly one shape is ever the
// current one, and the current one is CHOSEN, not unavailable — a button
// that read "pressed, dimmed" was the a11y reviewer's objection. So the
// checked radio is never `aria-disabled` (choosing it again says which
// shape the box already is and changes nothing), the others are disabled
// only while nothing is imported, and the arrows move between them the
// way native radios do: focus and choice travel together, one Tab stop.
import { useStore } from '../store/projectStore';
import {
  FRAME_LABEL,
  FRAME_SHAPES,
  frameShapeOf,
  sizeText,
  type FrameShape,
} from '../engine/frame';
import { canRun, perform, whyNot } from './actions';

const NEXT: Record<string, 1 | -1> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

export function FramePicker() {
  const { width, height } = useStore((s) => s.project.timeline);
  const setStatus = useStore((s) => s.setStatus);
  // Subscribe to what `canRun` reads, so the radios follow an import.
  useStore((s) => s.project.assets.length);
  const current = frameShapeOf(width, height);
  // The one Tab stop: the checked radio, or the first when the box is no
  // preset (a 4:3 source project).
  const stop = current ?? FRAME_SHAPES[0];

  function choose(shape: FrameShape) {
    const id = `frame.${shape}`;
    // Saying why beats a press that does nothing (CommandButton's rule).
    if (!canRun(id)) return setStatus(whyNot(id));
    perform(id);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, i: number) {
    const step = NEXT[e.key];
    if (!step) return;
    e.preventDefault();
    const shape =
      FRAME_SHAPES[(i + step + FRAME_SHAPES.length) % FRAME_SHAPES.length];
    const buttons =
      e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="radio"]',
      );
    buttons?.[FRAME_SHAPES.indexOf(shape)]?.focus();
    choose(shape);
  }

  return (
    <div className="frame-picker" role="radiogroup" aria-label="영상 모양">
      {FRAME_SHAPES.map((shape, i) => {
        const id = `frame.${shape}`;
        const checked = current === shape;
        const enabled = checked || canRun(id);
        const label = `${FRAME_LABEL[shape]} 영상으로 바꾸기`;
        return (
          <button
            key={shape}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={enabled ? undefined : true}
            aria-label={label}
            aria-describedby="frame-size"
            tabIndex={shape === stop ? 0 : -1}
            title={enabled ? label : whyNot(id)}
            onClick={() => choose(shape)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {FRAME_LABEL[shape]}
          </button>
        );
      })}
      {/* The pixel size, said once: the status line says it at the change
          and the import, and this is where it can be asked again. */}
      <span className="frame-size dim" id="frame-size">
        {sizeText(width, height)}
      </span>
    </div>
  );
}
