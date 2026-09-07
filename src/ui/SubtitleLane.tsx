// framewright — the subtitle lane under the clip strip.
//
// One chip per subtitle, at the same scale and in the same scroll container as
// the clips, so a subtitle sits exactly under the frames it is shown on. Drag
// the chip to move it, drag either edge to change when it starts or ends —
// the same gesture as a clip, previewed while the pointer is down and
// dispatched once on release (one gesture, one undo step; ADR-0006).
//
// This is the second drag gesture in the app, not a reuse of the clip's:
// the arithmetic is shared (`planDrag`, `previewGeometry`, `limitHit` from
// `engine/drag.ts`; the bounds and targets from `engine/subtitles.ts`), the
// DOM handling is not. A third kind of draggable thing is the trigger to
// extract one.
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useStore } from '../store/projectStore';
import {
  limitHit,
  planDrag,
  previewGeometry,
  type DragLimit,
  type DragMode,
} from '../engine/drag';
import {
  describeSubtitleEdit,
  SUBTITLE_LIMIT_TEXT,
  subtitleDragBounds,
  subtitleDragCommand,
  subtitleDragTargets,
  subtitleLength,
} from '../engine/subtitles';
import { deltaFrames, frameToX, type View } from '../engine/timelineView';
import { formatChord } from '../engine/keymap';
import { formatTimecode } from '../engine/time';
import type { Subtitle } from '../engine/types';
import { useResolvedKeymap } from './useShortcuts';

const EDGE_PX = 10;
const DRAG_THRESHOLD_PX = 3;
const SNAP_PX = 8;
/** An accessible name is read aloud in full; a paragraph of it is not a name. */
const NAME_CHARS = 60;

interface DragState {
  subtitleId: string;
  mode: DragMode;
  pointerId: number;
  startX: number;
  scale: number;
  originStart: number;
  originEnd: number;
  targets: number[];
  min: number;
  max: number;
  minReason: DragLimit;
  maxReason: DragLimit;
  frame: number;
  active: boolean;
}

export function SubtitleLane({
  view,
  contentPx,
  onScrub,
  onReadout,
}: {
  view: View;
  contentPx: number;
  /** A press on the lane's empty part moves the playhead, like the track. */
  onScrub: (clientX: number) => void;
  /** The live drag sentence, shown in the track head next to the clips'. */
  onReadout: (text: string | null) => void;
}) {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const seekTo = useStore((s) => s.seekTo);
  const selectedSubtitleId = useStore((s) => s.selectedSubtitleId);
  const selectSubtitle = useStore((s) => s.selectSubtitle);
  const run = useStore((s) => s.run);
  const setStatus = useStore((s) => s.setStatus);
  const keymap = useResolvedKeymap();
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const suppressSeek = useRef(false);
  const laneRef = useRef<HTMLDivElement>(null);

  const subtitles = project.subtitles;
  const fps = project.timeline.fps;
  const scale = drag ? drag.scale : view.scale;
  const drawView = { ...view, scale };

  function geometry(s: Subtitle): { start: number; length: number } {
    if (drag?.active && drag.subtitleId === s.id) {
      return previewGeometry(
        drag.mode,
        drag.frame,
        drag.originStart,
        drag.originEnd,
      );
    }
    return { start: s.startFrame, length: subtitleLength(s) };
  }

  function beginDrag(s: Subtitle, e: ReactPointerEvent) {
    if (e.button !== 0) return;
    if (dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const roomForHandles = rect.width >= EDGE_PX * 3;
    const mode: DragMode = !roomForHandles
      ? 'move'
      : e.clientX - rect.left <= EDGE_PX
        ? 'trimStart'
        : rect.right - e.clientX <= EDGE_PX
          ? 'trimEnd'
          : 'move';
    const bounds = subtitleDragBounds(project, s.id, mode);
    if (!bounds) return;
    suppressSeek.current = mode !== 'move';
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      subtitleId: s.id,
      mode,
      pointerId: e.pointerId,
      startX: e.clientX,
      scale,
      originStart: s.startFrame,
      originEnd: s.endFrame,
      targets: subtitleDragTargets(project, s.id, mode, playhead),
      min: bounds.min,
      max: bounds.max,
      minReason: bounds.minReason,
      maxReason: bounds.maxReason,
      frame: mode === 'trimEnd' ? s.endFrame : s.startFrame,
      active: false,
    });
  }

  function onDragMove(e: ReactPointerEvent) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    if (!d.active && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    const frozen = { total: view.total, widthPx: view.widthPx, scale: d.scale };
    const frame = planDrag({
      mode: d.mode,
      originStart: d.originStart,
      originEnd: d.originEnd,
      deltaFrames: deltaFrames(frozen, dx),
      targets: d.targets,
      snapThreshold: Math.max(1, deltaFrames(frozen, SNAP_PX)),
      bounds: {
        min: d.min,
        max: d.max,
        minReason: d.minReason,
        maxReason: d.maxReason,
      },
    });
    if (d.active && frame === d.frame) return;
    setDrag({ ...d, frame, active: true });
  }

  function finishDrag(commit: boolean) {
    const d = dragRef.current;
    suppressSeek.current = false;
    if (!d) return;
    setDrag(null);
    if (!commit || !d.active) return;
    const fresh = subtitleDragBounds(project, d.subtitleId, d.mode);
    const frame = fresh
      ? Math.min(fresh.max, Math.max(fresh.min, d.frame))
      : d.frame;
    const command = subtitleDragCommand(
      d.mode,
      d.subtitleId,
      frame,
      d.originStart,
      d.originEnd,
    );
    if (!command) return;
    if (!run(command.id, command.args)) return;
    const text = describeSubtitleEdit(
      d.mode,
      useStore.getState().project,
      d.subtitleId,
      d.originEnd - d.originStart,
    );
    if (text) setStatus(text);
  }

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const up = (e: PointerEvent) => {
      if (e.pointerId === dragRef.current?.pointerId) finishDrag(true);
    };
    const cancel = () => finishDrag(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finishDrag(false);
      }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  // The subtitle being dragged can vanish under us (undo, restore).
  useEffect(() => {
    if (drag && !subtitles.some((s) => s.id === drag.subtitleId)) {
      finishDrag(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitles, drag]);

  // ----------------------------------------------------- keeping focus
  // Which subtitle was selected last, and where it sat. When it is removed
  // — Delete on its chip, or the panel's 자막 지우기 button — the chip and
  // the panel both leave the DOM and focus falls to <body>, which for a
  // keyboard user means tabbing in from the top of the page again. Same
  // remedy as the clips': put focus on the neighbour, or on the playhead
  // when no subtitle is left.
  const lastSelected = useRef<{ id: string; index: number } | null>(null);
  useEffect(() => {
    if (!selectedSubtitleId) return;
    const index = subtitles.findIndex((s) => s.id === selectedSubtitleId);
    if (index >= 0) lastSelected.current = { id: selectedSubtitleId, index };
  }, [selectedSubtitleId, subtitles]);
  useEffect(() => {
    const last = lastSelected.current;
    if (!last || subtitles.some((s) => s.id === last.id)) return;
    lastSelected.current = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const lane = laneRef.current;
    const chipsLeft = lane?.querySelectorAll<HTMLButtonElement>('.subtitle');
    if (chipsLeft && chipsLeft.length > 0) {
      const index = Math.min(last.index, chipsLeft.length - 1);
      chipsLeft[index].focus();
      // Focus is not selection: the next Delete must act on what they see.
      const id = subtitles[index]?.id;
      if (id) selectSubtitle(id);
      return;
    }
    lane?.parentElement?.querySelector<HTMLElement>('.ruler')?.focus();
  }, [subtitles, selectSubtitle]);

  // The sentence for the track head, kept up to date while the pointer moves.
  useEffect(() => {
    if (!drag?.active) {
      onReadout(null);
      return;
    }
    const limit =
      SUBTITLE_LIMIT_TEXT[
        limitHit(drag.frame, {
          min: drag.min,
          max: drag.max,
          minReason: drag.minReason,
          maxReason: drag.maxReason,
        })
      ];
    const body =
      drag.mode === 'move'
        ? `자막 옮기는 중 → ${formatTimecode(drag.frame, fps)}`
        : drag.mode === 'trimStart'
          ? `자막 시작 조절 중 · 길이 ${formatTimecode(drag.originEnd - drag.frame, fps)}`
          : `자막 끝 조절 중 · 길이 ${formatTimecode(drag.frame - drag.originStart, fps)}`;
    onReadout(limit ? `${body} — ${limit}` : body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  function onChipKey(s: Subtitle, e: ReactKeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      selectSubtitle(s.id);
      seekTo(s.startFrame);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // The global Delete belongs to the clip's ripple delete, and two commands
      // cannot share one chord. So the chip answers for itself: the subtitle
      // under the keyboard is the one that goes.
      e.preventDefault();
      e.stopPropagation();
      selectSubtitle(s.id);
      run('subtitle.remove');
    }
  }

  const addKey = formatChord(keymap.byAction.get('subtitle.add') ?? null);
  const shortName = (text: string) =>
    text.length > NAME_CHARS ? `${text.slice(0, NAME_CHARS)}…` : text;

  return (
    <div
      ref={laneRef}
      className={'subtitle-lane' + (drag?.active ? ' dragging' : '')}
      role="group"
      aria-label={`자막 ${subtitles.length}개`}
      style={{ width: contentPx + 'px' }}
      onMouseDown={(e) => onScrub(e.clientX)}
    >
      <span className="lane-label" aria-hidden="true">
        자막
      </span>
      {subtitles.length === 0 && view.total > 0 && (
        <span className="lane-hint">
          재생 위치를 정한 뒤 <kbd>{addKey}</kbd> 또는 ‘자막 넣기’를 누르면
          여기에 생겨요.
        </span>
      )}
      {subtitles.map((s, i) => {
        const selected = s.id === selectedSubtitleId;
        const isDragging = drag?.active && drag.subtitleId === s.id;
        const g = geometry(s);
        return (
          <button
            key={s.id}
            type="button"
            data-subtitle-id={s.id}
            className={
              'subtitle' +
              (selected ? ' selected' : '') +
              (isDragging ? ' dragging' : '') +
              (s.text ? '' : ' empty')
            }
            style={{
              left: frameToX(drawView, g.start) + 'px',
              width: frameToX(drawView, g.length) + 'px',
            }}
            aria-pressed={selected}
            // The chip answers Delete itself (see `onChipKey`); say so where
            // a screen reader will read it with the control.
            aria-keyshortcuts="Delete"
            title="끌어서 옮기고, 양 끝을 끌어 길이를 조절해요. 고른 뒤 Delete 를 누르면 지워져요."
            // Identity, position, length — never state (docs/TESTING.md).
            // The same four fields, in the same order, as a clip's name.
            aria-label={`자막 ${i + 1}, ${s.text ? shortName(s.text) : '내용 없음'}, ${formatTimecode(
              s.startFrame,
              fps,
            )}부터 길이 ${formatTimecode(subtitleLength(s), fps)}, ${subtitleLength(s)}프레임`}
            onMouseDown={(e) => {
              e.stopPropagation();
              selectSubtitle(s.id);
              if (!suppressSeek.current) onScrub(e.clientX);
            }}
            onPointerDown={(e) => beginDrag(s, e)}
            onPointerMove={onDragMove}
            onKeyDown={(e) => onChipKey(s, e)}
          >
            <span className="clip-handle start" aria-hidden="true" />
            <span className="subtitle-text">{s.text || '내용 없음'}</span>
            <span className="clip-handle end" aria-hidden="true" />
          </button>
        );
      })}
      <div
        className="playhead"
        style={{ left: frameToX(view, playhead) + 'px' }}
      />
    </div>
  );
}
