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
import { RangeRow } from './RangeRow';
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
import { useEffect, useRef, useState } from 'react';
import {
  VOLUME_MAX,
  VOLUME_STEP_PERCENT,
  ceilingText,
  describeCeiling,
  percentToVolume,
  volumePercent,
} from '../engine/volume';
import { hasNoAudioTrack } from '../engine/audio';
import {
  ZOOM_MAX,
  ZOOM_STEP_PERCENT,
  PAN_LIMIT,
  PAN_STEP_PERCENT,
  clipEmptySides,
  clipPanLimits,
  emptySidesText,
  panLimitText,
  panText,
  pictureNoteText,
  pictureTransform,
} from '../engine/picture';
import { CommandButton } from './CommandButton';
import { clipCeiling, subscribeWaveforms } from './waveform';

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

/** What the sound does now, under the controls. One sentence, the same
 *  channel as the fade notes: read after a control's name, and there to be
 *  asked again after the status line has moved on. */
function soundNote(
  silentFile: boolean,
  muted: boolean,
  percent: number,
): string {
  if (silentFile) return '이 영상에는 소리가 없어요';
  if (muted)
    return percent === 100
      ? '들리지 않아요'
      : `들리지 않아요 · 다시 켜면 ${percent}%로 돌아와요`;
  if (percent === 0) return '0%라 들리지 않아요';
  if (percent === 100) return '녹음된 그대로 들려요';
  return percent > 100
    ? '녹음된 것보다 크게 들려요'
    : '녹음된 것보다 작게 들려요';
}

/**
 * The selected clip's sound (ADR-0013): a switch and a level. Module-level
 * for the same reason as `Edge`.
 *
 * Every notch of the slider is the `clip.volume` command with a coalesce
 * key, so a drag or a held arrow is ONE undo step (the same rule as a trim
 * drag, ADR-0006) while the status line and the document follow each notch.
 * The gesture ends when the pointer lifts, the key comes up or focus leaves.
 */
function Sound() {
  const project = useStore((s) => s.project);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const run = useStore((s) => s.run);
  // `hasNoAudioTrack` is answered out of band, when the file is decoded.
  useStore((s) => s.mediaVersion);
  // ...and so is the ceiling: the peaks land after the file does.
  const [, arrived] = useState(0);
  useEffect(() => subscribeWaveforms(() => arrived((n) => n + 1)), []);
  const found = locateClip(project, selectedClipId);
  const clip = found?.clip ?? null;
  const stored = volumePercent(clip?.volume ?? 1);
  // The slider stops where this clip's own peak would pass full scale
  // (ADR-0013). A stored level above that — set before the peaks arrived,
  // or before a trim moved the clip into a louder passage — is HEARD at
  // the ceiling and shown there, never rewritten (the fade-clamp rule).
  const ceiling = clip ? clipCeiling(project, clip) : VOLUME_MAX;
  const ceilingPercent = volumePercent(ceiling);
  // The ceiling can change with no gesture from the user (the peaks land,
  // a trim moves the range). Every other change to the slider says a
  // sentence; this one must too, or the end of the slider moving on its
  // own reads as a bug — and a screen reader hears the note only on focus.
  const setStatus = useStore((s) => s.setStatus);
  const lastCeiling = useRef<{ id: string | null; percent: number }>({
    id: null,
    percent: 100 * VOLUME_MAX,
  });
  useEffect(() => {
    const last = lastCeiling.current;
    const id = clip?.id ?? null;
    if (id && last.id === id && ceilingPercent < last.percent) {
      setStatus(describeCeiling(stored / 100, ceilingPercent / 100));
    }
    lastCeiling.current = { id, percent: ceilingPercent };
  }, [clip?.id, ceilingPercent, stored, setStatus]);
  if (!clip) return null;
  const percent = Math.min(stored, ceilingPercent);
  const muted = !!clip.muted;
  const noteId = 'clip-sound-note';
  // The slider's own, so the mute button is not described by a limit that
  // has nothing to do with muting.
  const limitId = 'clip-sound-limit';
  const limit = ceilingText(ceiling);
  const commit = (value: number) =>
    run(
      'clip.volume',
      { clipId: clip.id, volume: percentToVolume(value) },
      `volume:${clip.id}`,
    );
  return (
    <div className="clip-sound">
      {/* The glyph is the STATE (what every player does), the label the
          action: a pressed border alone is a hover's twin at a glance. */}
      <CommandButton
        id="clip.mute"
        label="소리 끄기"
        icon={muted ? '🔇' : '🔊'}
        pressed={muted}
        describedBy={noteId}
      />
      <RangeRow
        label="소리 크기"
        min={0}
        max={ceilingPercent}
        step={VOLUME_STEP_PERCENT}
        value={percent}
        valueText={`${percent}%`}
        describedBy={limit ? `${noteId} ${limitId}` : noteId}
        onChange={commit}
      />
      <span className="clip-edge-note dim" id={noteId}>
        {soundNote(hasNoAudioTrack(clip.assetId), muted, percent)}
      </span>
      {limit && (
        <span className="clip-edge-note dim" id={limitId}>
          {limit}
        </span>
      )}
    </div>
  );
}

/**
 * The selected clip's picture (ADR-0014): how big, where, which way up.
 * Module-level for the same reason as `Edge`. The sliders are the
 * keyboard's route to what a drag on the preview does; the two buttons
 * are the commands a key or the palette can run whole. The pans stop at
 * half a box (`PAN_LIMIT`), so the picture never leaves the box.
 */
function PictureBlock() {
  const project = useStore((s) => s.project);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const run = useStore((s) => s.run);
  const found = locateClip(project, selectedClipId);
  if (!found) return null;
  const { clip } = found;
  const t = pictureTransform(clip);
  const zoomPercent = Math.round(t.zoom * 100);
  // Each pan slider ends where THIS picture's edge reaches the box's
  // centre: half a box when the picture fills that axis, less when it is
  // narrower (stood up, 4:3 in 16:9). Half a box for every picture pushed
  // a stood-up one clear out of the box (seen in the owner's Chrome).
  const limits = clipPanLimits(project, clip);
  const limitX = Math.round(limits.x * 100);
  const limitY = Math.round(limits.y * 100);
  const noteId = 'clip-picture-note';
  const limitId = 'clip-picture-limit';
  const limitNote = panLimitText(limits);
  // Only the slider whose axis is limited is described by the limit: the
  // sentence names that axis, and a slider that still goes the full half
  // box must not be told it stops at 15% (a11y).
  const describedBy = (limited: boolean) =>
    limited && limitNote ? `${noteId} ${limitId}` : noteId;
  const panXDescribedBy = describedBy(limits.x < PAN_LIMIT);
  const panYDescribedBy = describedBy(limits.y < PAN_LIMIT);
  // A stored pan past the limit (a document from before the limit, a
  // re-linked file of another shape) is SHOWN where it is drawn — the
  // sound slider's rule for a level above its ceiling.
  const shownX = Math.min(limits.x, Math.max(-limits.x, t.panX));
  const shownY = Math.min(limits.y, Math.max(-limits.y, t.panY));
  const summary = pictureNoteText(clip);
  // What the picture does now, and — the one thing the preview shows but
  // does not say — which sides of the box are black: under a pan, after a
  // turn, or because the box is another shape than the footage (ADR-0015),
  // in which case the picture is as shot AND the sides are empty.
  const empty = emptySidesText(clipEmptySides(project, clip));
  const note = `${summary || '찍은 그대로 보여요'}${empty ? ` · ${empty}` : ''}`;
  const pan = (x: number, y: number) =>
    run('clip.pan', { clipId: clip.id, x, y }, `pan:${clip.id}`);
  return (
    <div className="clip-picture">
      <RangeRow
        label="확대"
        min={100}
        max={ZOOM_MAX * 100}
        step={ZOOM_STEP_PERCENT}
        value={zoomPercent}
        valueText={`${zoomPercent}%`}
        describedBy={noteId}
        onChange={(v) =>
          run(
            'clip.zoom',
            { clipId: clip.id, zoom: v / 100 },
            `zoom:${clip.id}`,
          )
        }
      />
      <RangeRow
        label="가로 위치"
        min={-limitX}
        max={limitX}
        step={PAN_STEP_PERCENT}
        value={Math.round(shownX * 100)}
        valueText={panText('x', shownX)}
        describedBy={panXDescribedBy}
        onChange={(v) => pan(v / 100, shownY)}
      />
      <RangeRow
        label="세로 위치"
        min={-limitY}
        max={limitY}
        step={PAN_STEP_PERCENT}
        value={Math.round(shownY * 100)}
        valueText={panText('y', shownY)}
        describedBy={panYDescribedBy}
        onChange={(v) => pan(shownX, v / 100)}
      />
      <div className="clip-picture-buttons">
        <CommandButton id="clip.rotate" label="화면 돌리기" icon="↻" />
        <CommandButton id="clip.pictureFill" label="화면 채우기" icon="⛶" />
        <CommandButton id="clip.pictureReset" label="화면 원래대로" icon="⟲" />
      </div>
      <span className="clip-edge-note dim" id={noteId}>
        {note}
      </span>
      {limitNote && (
        <span className="clip-edge-note dim" id={limitId}>
          {limitNote}
        </span>
      )}
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
      <h3 className="panel-subtitle">소리</h3>
      <Sound />
      <p className="empty-hint">
        이 클립의 소리만 끄거나, 녹음된 것보다 크게·작게 할 수 있어요. 다른
        클립의 소리는 그대로예요.
      </p>
      <h3 className="panel-subtitle">화면</h3>
      <PictureBlock />
      <p className="empty-hint">
        화면을 키우면 가운데가 크게 보이고, 프리뷰에서 그림을 끌어 보이는 자리를
        옮길 수 있어요. 돌리기는 한 번에 90°씩 돌아가요. 채우기는 비는 곳이
        없어질 만큼만 키워요. 이 클립의 화면만 바뀌어요.
      </p>
    </section>
  );
}
