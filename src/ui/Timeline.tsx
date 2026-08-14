// framewright — single-track timeline: clips positioned by frame, playhead, selection.
//
// Two separate controls, deliberately:
//   `.ruler` is the playhead — a real `role="slider"` with NO interactive children.
//   `.track` is the clip strip — a `role="group"` of real buttons.
// They used to be one element, which meant the clips were descendants of a
// slider. ARIA calls a slider's children presentational, so every clip's name,
// role and selected state was stripped from the accessibility tree: a screen
// reader user could not tell which clip they were on.
//
// Direct manipulation (E5): drag a clip's body to move it, drag either edge to
// trim it. The drag only PREVIEWS while the pointer is down — the command is
// dispatched once on release, so one gesture is exactly one undo step. Holding
// a nudge key coalesces the same way.
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useStore } from '../store/projectStore';
import { clipLength, timelineDuration, videoTrack } from '../engine/timeline';
import {
  dragBounds,
  dragCommand,
  dragTargets,
  limitHit,
  planDrag,
  previewGeometry,
  type DragLimit,
  type DragMode,
} from '../engine/drag';
import { describeEdit, LIMIT_TEXT } from '../engine/commands';
import { formatChord } from '../engine/keymap';
import { formatTimecode } from '../engine/time';
import { useResolvedKeymap } from './useShortcuts';
import type { Clip } from '../engine/types';

/** How close to an edge counts as "grab the edge" rather than "grab the clip". */
const EDGE_PX = 10;
/** Below this, a press is a click (select), not a drag. Stops accidental edits. */
const DRAG_THRESHOLD_PX = 3;
/** Snapping radius, in pixels — so it feels the same at any timeline length. */
const SNAP_PX = 8;
/** A clip narrower than this cannot be grabbed back, so we never draw one. */
const MIN_CLIP_PX = 24;

interface DragState {
  clipId: string;
  mode: DragMode;
  pointerId: number;
  startX: number;
  /** Frames spanned by the whole bar. Frozen for the gesture: if the scale moved
   *  while dragging, the clip would chase the pointer instead of following it. */
  denom: number;
  originStart: number;
  originEnd: number;
  /** Edges worth snapping to: neighbours, the playhead, 0, the end. */
  targets: number[];
  min: number;
  max: number;
  minReason: DragLimit;
  maxReason: DragLimit;
  /** The boundary being dragged, already clamped and snapped. */
  frame: number;
  /** False until the pointer passes the threshold — a plain click stays a click. */
  active: boolean;
}

export function Timeline() {
  const barRef = useRef<HTMLDivElement>(null);
  /** Grabbing a trim handle must not also scrub: "trim to the playhead" only
   *  works if pressing the edge leaves the playhead where the user put it. */
  const suppressSeek = useRef(false);
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const seekTo = useStore((s) => s.seekTo);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const select = useStore((s) => s.select);
  const run = useStore((s) => s.run);
  const setStatus = useStore((s) => s.setStatus);
  const keymap = useResolvedKeymap();
  const [drag, setDrag] = useState<DragState | null>(null);
  /** The handlers live on `window` (see below) and must see the newest drag. */
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const total = timelineDuration(project);
  const clips = videoTrack(project).clips;
  const fps = project.timeline.fps;
  const assetName = (id: string) =>
    project.assets.find((a) => a.id === id)?.name ?? '클립';

  // Holes in the strip. They are legal (trimming a head leaves one) but they must
  // be visible: an invisible gap exports as black and surprises people.
  const gaps: { start: number; length: number }[] = [];
  {
    let cursor = 0;
    for (const c of clips) {
      if (c.startFrame > cursor) {
        gaps.push({ start: cursor, length: c.startFrame - cursor });
      }
      cursor = c.startFrame + clipLength(c);
    }
  }

  // One scale for everything: x = frame / total. (Mixing /total and /(total-1)
  // makes the playhead drift away from the clip it is actually over.)
  function seekFromX(clientX: number, el: Element | null = barRef.current) {
    if (!el || total === 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    seekTo(Math.min(total - 1, Math.floor(ratio * total)));
  }

  function onRulerKey(e: ReactKeyboardEvent) {
    if (total === 0) return;
    const step = e.shiftKey ? Math.round(total / 10) || 1 : 1;
    const map: Record<string, number> = {
      ArrowLeft: -step,
      ArrowRight: step,
      Home: -total,
      End: total,
    };
    const delta = map[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    seekTo(Math.min(total - 1, Math.max(0, playhead + delta)));
  }

  // ---------------------------------------------------------------- dragging

  function beginDrag(clip: Clip, e: ReactPointerEvent) {
    if (e.button !== 0 || total === 0) return;
    if (dragRef.current) return; // a second finger must not hijack the first

    const rect = e.currentTarget.getBoundingClientRect();
    // A very short clip has no room for two handles — dragging it always moves it,
    // which is better than a clip you can grab but never reposition.
    const roomForHandles = rect.width >= EDGE_PX * 3;
    const mode: DragMode = !roomForHandles
      ? 'move'
      : e.clientX - rect.left <= EDGE_PX
        ? 'trimStart'
        : rect.right - e.clientX <= EDGE_PX
          ? 'trimEnd'
          : 'move';

    const bounds = dragBounds(project, clip.id, mode);
    if (!bounds) return;

    const start = clip.startFrame;
    const end = start + clipLength(clip);

    suppressSeek.current = mode !== 'move';
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      clipId: clip.id,
      mode,
      pointerId: e.pointerId,
      startX: e.clientX,
      denom: total,
      originStart: start,
      originEnd: end,
      targets: dragTargets(project, clip.id, mode, playhead),
      min: bounds.min,
      max: bounds.max,
      minReason: bounds.minReason,
      maxReason: bounds.maxReason,
      frame: mode === 'trimEnd' ? end : start,
      active: false,
    });
  }

  function onDragMove(e: ReactPointerEvent) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    if (!d.active && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    const bar = barRef.current;
    if (!bar) return;

    // Pixels are what the hand controls; frames are what the document stores.
    // This is the only place the two meet.
    const framesPerPx = d.denom / bar.getBoundingClientRect().width;
    const frame = planDrag({
      mode: d.mode,
      originStart: d.originStart,
      originEnd: d.originEnd,
      deltaFrames: Math.round(dx * framesPerPx),
      targets: d.targets,
      snapThreshold: Math.max(1, Math.round(SNAP_PX * framesPerPx)),
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

  /** End the gesture. Called from `window`, never from the clip's own props: the
   *  clip can unmount mid-drag (undo), and a handler that lives on it would then
   *  never fire — leaving the timeline stuck at a stale scale forever. */
  function finishDrag(commit: boolean) {
    const d = dragRef.current;
    suppressSeek.current = false;
    if (!d) return;
    setDrag(null);
    if (!commit || !d.active) return;

    // The document can change mid-gesture (a shortcut still reaches the window
    // while the pointer is down), so re-clamp against the CURRENT bounds rather
    // than the ones frozen when the drag began.
    const fresh = dragBounds(project, d.clipId, d.mode);
    const frame = fresh
      ? Math.min(fresh.max, Math.max(fresh.min, d.frame))
      : d.frame;

    const command = dragCommand(
      d.mode,
      d.clipId,
      frame,
      d.originStart,
      d.originEnd,
    );
    if (!command) return; // landed where it started — not an edit, not an undo step
    if (!run(command.id, command.args)) return; // refused: say nothing rather than lie
    announce(d.mode, d.clipId, d.originEnd - d.originStart);
  }

  /** One sentence per edit, in one wording, whatever triggered it — the nudge
   *  commands announce themselves through the same `describeEdit`. The length
   *  the gesture started from is what lets it say 줄였어요 rather than 조절했어요:
   *  a drag handle runs both ways, so only the caller knows which way it went. */
  function announce(mode: DragMode, clipId: string, lengthBefore: number) {
    const text = describeEdit(
      mode,
      useStore.getState().project,
      clipId,
      lengthBefore,
    );
    if (text) setStatus(text);
  }

  // Global end-of-gesture handling. Registered only while a drag is live.
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
        finishDrag(false); // abandon the gesture, keep the document as it was
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

  // The clip being dragged can vanish under us (undo, restore, delete).
  useEffect(() => {
    // finishDrag(false), not setDrag(null): it also clears `suppressSeek`, which
    // would otherwise stay true forever and eat every later click on a clip.
    if (drag && !clips.some((c) => c.id === drag.clipId)) finishDrag(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, drag]);

  // ----------------------------------------------------- keyboard editing

  /** Which clip the keyboard was last on, so focus survives a split or delete. */
  const lastFocused = useRef<{ id: string; index: number } | null>(null);
  useEffect(() => {
    const last = lastFocused.current;
    if (!last || clips.some((c) => c.id === last.id)) return;
    // The focused clip is gone and focus fell to <body>: put it somewhere useful
    // rather than making a keyboard user tab in from the top of the page again.
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const el = barRef.current?.querySelectorAll<HTMLButtonElement>('.clip');
    if (!el || el.length === 0) {
      lastFocused.current = null;
      return;
    }
    const next = el[Math.min(last.index, el.length - 1)];
    next?.focus();
    // Focus is not selection: without this, the next Delete would act on the
    // clip the user last *selected*, not the one they can see they are on.
    const id = clips[Math.min(last.index, clips.length - 1)]?.id;
    if (id) select(id);
  }, [clips]);

  function onClipKey(clip: Clip, index: number, e: ReactKeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      select(clip.id);
      seekTo(clip.startFrame);
      return;
    }
    if (!e.altKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    // The nudge itself is a bound command now (`clip.moveLeft` and friends), run
    // by the global keymap so a user rebinding reaches it. All this control does
    // is make sure the clip under the keyboard is the one that gets nudged —
    // focus is not selection, and acting on the clip you cannot see is worse
    // than doing nothing. Deliberately no preventDefault: the event must reach
    // the window handler.
    select(clip.id);
    lastFocused.current = { id: clip.id, index };
  }

  /** How a binding is written in the hint line, straight from the keymap. */
  function key(actionId: string): string {
    return formatChord(keymap.byAction.get(actionId) ?? null);
  }

  // ---------------------------------------------------------------- geometry

  const denom = drag ? drag.denom : total;
  const pct = (frames: number) => (denom > 0 ? (frames / denom) * 100 : 0);

  function geometry(clip: Clip): { start: number; length: number } {
    if (drag?.active && drag.clipId === clip.id) {
      return previewGeometry(
        drag.mode,
        drag.frame,
        drag.originStart,
        drag.originEnd,
      );
    }
    return { start: clip.startFrame, length: clipLength(clip) };
  }

  /** Keep a clip on screen and grabbable, whatever the numbers say. A clip that
   *  is one frame long, or dragged past the right edge, must not vanish. */
  function clipStyle(g: { start: number; length: number }) {
    const left = pct(g.start);
    if (left >= 100) {
      return {
        left: `calc(100% - ${MIN_CLIP_PX + 2}px)`,
        width: `${MIN_CLIP_PX}px`,
      };
    }
    return { left: left + '%', width: pct(g.length) + '%' };
  }

  const readout = (() => {
    if (!drag?.active) return null;
    const limit =
      LIMIT_TEXT[
        limitHit(drag.frame, {
          min: drag.min,
          max: drag.max,
          minReason: drag.minReason,
          maxReason: drag.maxReason,
        })
      ];
    const body =
      drag.mode === 'move'
        ? `옮기는 중 → ${formatTimecode(drag.frame, fps)}`
        : drag.mode === 'trimStart'
          ? `앞부분 조절 중 · 남은 길이 ${formatTimecode(drag.originEnd - drag.frame, fps)}`
          : `뒷부분 조절 중 · 남은 길이 ${formatTimecode(drag.frame - drag.originStart, fps)}`;
    const previewStart =
      drag.mode === 'trimEnd' ? drag.originStart : drag.frame;
    const opensGap = previewStart > drag.originStart && drag.mode !== 'trimEnd';
    const note = limit || (opensGap ? '앞에 빈 곳이 생겨요.' : '');
    return note ? `${body} — ${note}` : body;
  })();

  return (
    <section className="timeline" aria-labelledby="timeline-title">
      <h2 className="panel-title" id="timeline-title">
        타임라인
      </h2>
      <div className="track-head">
        <span className="track-label">영상</span>
        <span className="drag-readout" aria-hidden="true">
          {readout ?? ''}
        </span>
      </div>
      <div
        className="ruler"
        role="slider"
        tabIndex={0}
        aria-label="재생 위치 (좌우 화살표로 이동)"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, total - 1)}
        aria-valuenow={playhead}
        aria-valuetext={formatTimecode(playhead, fps)}
        onKeyDown={onRulerKey}
        onMouseDown={(e) => seekFromX(e.clientX, e.currentTarget)}
      >
        <span
          className="ruler-thumb"
          aria-hidden="true"
          style={{ left: pct(playhead) + '%' }}
        />
      </div>
      <div
        className={'track' + (drag?.active ? ' dragging' : '')}
        ref={barRef}
        role="group"
        aria-label={`클립 ${clips.length}개${gaps.length ? `, 빈 곳 ${gaps.length}개` : ''}`}
        onMouseDown={(e) => seekFromX(e.clientX)}
      >
        {gaps.map((g) => (
          <div
            key={`gap_${g.start}`}
            className="gap"
            aria-hidden="true"
            style={{ left: pct(g.start) + '%', width: pct(g.length) + '%' }}
          />
        ))}
        {clips.map((c, i) => {
          const selected = c.id === selectedClipId;
          const isDragging = drag?.active && drag.clipId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              className={
                'clip' +
                (selected ? ' selected' : '') +
                (isDragging ? ' dragging' : '')
              }
              style={clipStyle(geometry(c))}
              aria-pressed={selected}
              // Selection lives in `aria-pressed` and NOWHERE else. Putting it in
              // the name too made the accessible name change when only the state
              // changed — a screen reader announces the whole clip again, and any
              // "did this edit survive undo?" check compares a moving target.
              aria-label={`클립 ${i + 1}, ${assetName(c.assetId)}, ${formatTimecode(
                c.startFrame,
                fps,
              )}부터 길이 ${formatTimecode(clipLength(c), fps)}, ${clipLength(c)}프레임`}
              onFocus={() => {
                lastFocused.current = { id: c.id, index: i };
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                select(c.id);
                if (!suppressSeek.current) seekFromX(e.clientX);
              }}
              onPointerDown={(e) => beginDrag(c, e)}
              onPointerMove={onDragMove}
              onKeyDown={(e) => onClipKey(c, i, e)}
            >
              <span className="clip-handle start" aria-hidden="true" />
              <span className="clip-mark" aria-hidden="true">
                {selected ? '◉' : '◎'}
              </span>
              <span className="clip-name">{assetName(c.assetId)}</span>
              <span className="clip-handle end" aria-hidden="true" />
            </button>
          );
        })}
        <div className="playhead" style={{ left: pct(playhead) + '%' }} />
      </div>
      {/* Read from the live keymap, so a rebinding shows up here instead of
          leaving the hint quietly lying about which keys work. */}
      <p className="track-hint">
        클립을 끌어 옮기고, 양 끝을 끌면 앞뒤 길이를 조절할 수 있어요. 클립을
        고른 뒤 <kbd>{key('clip.moveLeft')}</kbd>/
        <kbd>{key('clip.moveRight')}</kbd> 옮기기,{' '}
        <kbd>{key('clip.headExtend')}</kbd>/<kbd>{key('clip.headShrink')}</kbd>{' '}
        앞부분 늘리기·줄이기, <kbd>{key('clip.tailShrink')}</kbd>/
        <kbd>{key('clip.tailExtend')}</kbd> 뒷부분 줄이기·늘리기,{' '}
        <kbd>{key('clip.deleteRipple')}</kbd> 지우기. 재생 위치까지 한 번에
        줄이려면 <kbd>{key('clip.trimStartToPlayhead')}</kbd>(앞),{' '}
        <kbd>{key('clip.trimEndToPlayhead')}</kbd>(뒤)를 눌러요.
      </p>
    </section>
  );
}
