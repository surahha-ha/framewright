// framewright — the selected clip: where it is, and how its edges come and go.
//
// Shown only while a clip is selected (UX.md: the properties panel shows what
// is selected and nothing else). The edits themselves — split, trim, move —
// live on the toolbar and the strip; what is here is the one thing a clip
// carries that has no gesture of its own: its fades (ADR-0012).
//
// Each edge is a toggle and, once on, a length. The toggle is the command
// with no arguments (on with the default, off again); the length is the same
// command with `frames`, so both routes leave one undo step and say the same
// sentence. What the edge fades INTO is not a choice: it is read off the
// neighbours and said under the control, so the word "dissolve" never has to
// be learned — the previous clip is simply what a fade-in at a cut goes to.
import { useStore } from '../store/projectStore';
import { formatTimecode, secToFrame } from '../engine/time';
import { clipLength, locateClip } from '../engine/timeline';
import {
  FADE_CHOICES_SEC,
  effectiveFades,
  fadeIntoText,
  fadeLimit,
  fadeSecondsText,
  fadeShortenedText,
  type FadeEdge,
} from '../engine/fades';
import { CommandButton } from './CommandButton';

/**
 * One edge of the selected clip. A component of its own, at module level:
 * defined inside the panel it would be a NEW component type on every render,
 * so each click remounted it and the button the user had just pressed lost
 * focus — the keyboard-only spec caught it.
 */
function Edge({ edge }: { edge: FadeEdge }) {
  const project = useStore((s) => s.project);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const run = useStore((s) => s.run);
  const found = locateClip(project, selectedClipId);
  if (!found) return null;
  const { clip } = found;
  const fps = project.timeline.fps;
  const fades = effectiveFades(clip);
  const commandId = edge === 'in' ? 'clip.fadeIn' : 'clip.fadeOut';
  // What the document says, and what fits: they differ only after a trim
  // shortened the clip under its fade (the command itself clamps on the way in).
  const asked = (edge === 'in' ? clip.fadeIn : clip.fadeOut) ?? 0;
  const frames = edge === 'in' ? fades.fadeIn : fades.fadeOut;
  const on = frames > 0;
  const into = fadeIntoText(project, clip.id, edge);
  // Read after the control's name by a screen reader: what the edge goes
  // to, or why it cannot be turned on, or that a trim cut it short. The
  // status line said it once, at the moment of the edit; this is where it
  // can be asked again.
  const noteId = `clip-edge-note-${edge}`;
  // The choices, plus whatever the clip actually has when that is not one
  // of them (a clamped fade, or one set before the choices changed).
  const choices = FADE_CHOICES_SEC.map((sec) => secToFrame(sec, fps));
  const options = choices.includes(asked)
    ? choices
    : [...choices, asked].sort((a, b) => a - b);
  const limit = fadeLimit(clip, edge);
  return (
    <div className="clip-edge">
      <CommandButton
        id={commandId}
        label={edge === 'in' ? '서서히 나타나기' : '서서히 사라지기'}
        icon={edge === 'in' ? '◖' : '◗'}
        pressed={on}
        describedBy={noteId}
      />
      {on && (
        <label className="clip-fade-length">
          <span>길이</span>
          <select
            aria-label={
              edge === 'in' ? '서서히 나타나기 길이' : '서서히 사라지기 길이'
            }
            aria-describedby={noteId}
            value={asked}
            onChange={(e) =>
              run(commandId, {
                clipId: clip.id,
                frames: Number(e.target.value),
              })
            }
          >
            {options.map((f) => (
              <option key={f} value={f}>
                {fadeSecondsText(f, fps)}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="clip-edge-note dim" id={noteId}>
        {on
          ? asked > frames
            ? `${into} · ${fadeShortenedText(clip, edge, frames, asked, fps)}`
            : into
          : limit === 0
            ? '반대쪽이 클립 전체를 쓰고 있어요'
            : edge === 'in'
              ? '바로 시작해요'
              : '바로 끝나요'}
      </span>
    </div>
  );
}

export function ClipPanel() {
  const project = useStore((s) => s.project);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const found = locateClip(project, selectedClipId);
  if (!found) return null;
  const { clip } = found;
  const fps = project.timeline.fps;
  const asset = project.assets.find((a) => a.id === clip.assetId);

  return (
    <section className="clip-panel" aria-labelledby="clip-panel-title">
      <h2 className="panel-title" id="clip-panel-title">
        클립
      </h2>
      <p className="clip-when">
        <span className="clip-panel-name">{asset?.name ?? clip.assetId}</span>
        <span>
          {formatTimecode(clip.startFrame, fps)}부터{' '}
          {formatTimecode(clip.startFrame + clipLength(clip), fps)}까지
        </span>
        <span className="dim">
          길이 {formatTimecode(clipLength(clip), fps)}
        </span>
      </p>
      <div className="clip-edges">
        <Edge edge="in" />
        <Edge edge="out" />
      </div>
      <p className="empty-hint">
        클립의 앞뒤를 서서히 나타나고 사라지게 할 수 있어요. 바로 앞이나 뒤에
        다른 클립이 붙어 있으면 두 장면이 겹치며 넘어가고, 없으면 검은 화면에서
        시작하거나 검은 화면으로 끝나요.
      </p>
    </section>
  );
}
