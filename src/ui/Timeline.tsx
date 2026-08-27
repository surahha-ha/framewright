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
//
// Zoom (ADR-0010): the strip has a scale of its own — pixels per frame — and
// scrolls. Every frame↔pixel conversion below goes through
// `src/engine/timelineView.ts`; this file owns only the gesture and the DOM.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useStore } from '../store/projectStore';
import { getDecodeService } from '../engine/registry';
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
import {
  centerOn,
  clampScale,
  contentWidth,
  deltaFrames,
  fitScale,
  frameToX,
  keepVisible,
  ticks,
  visibleSpan,
  xToFrame,
  type View,
} from '../engine/timelineView';
import { describeEdit, LIMIT_TEXT } from '../engine/commands';
import { formatChord } from '../engine/keymap';
import { formatClock, formatTimecode, frameToSec } from '../engine/time';
import { canRun, perform, whyNot } from './actions';
import { ClipCanvas } from './ClipCanvas';
import { hasNoAudioTrack } from '../engine/audio';
import { useResolvedKeymap } from './useShortcuts';
import type { Clip } from '../engine/types';

/** How close to an edge counts as "grab the edge" rather than "grab the clip". */
const EDGE_PX = 10;
/** Below this, a press is a click (select), not a drag. Stops accidental edits. */
const DRAG_THRESHOLD_PX = 3;
/** Snapping radius, in pixels — so it feels the same at any zoom. (Expressing it
 *  in pixels is what makes that true: 8px is 16 frames in a fitted minute and 1
 *  frame when zoomed all the way in, which is what the hand expects.) */
const SNAP_PX = 8;

/**
 * The in-point the DRAWN geometry corresponds to.
 *
 * A head trim moves a clip's start and its in-point together, so while that
 * edge is being dragged the stored in-point belongs to a start the clip no
 * longer has. Using it would leave the thumbnails showing footage from before
 * the trim — the one moment they are being looked at closely.
 */
function drawnInFrame(
  clip: Clip,
  drawnStart: number,
  mode: DragMode | null,
): number {
  return mode === 'trimStart'
    ? clip.inFrame + (drawnStart - clip.startFrame)
    : clip.inFrame;
}

interface DragState {
  clipId: string;
  mode: DragMode;
  pointerId: number;
  startX: number;
  /** Pixels per frame. Frozen for the gesture: an edit from a shortcut or a
   *  window resize mid-drag would otherwise move the scale under the pointer
   *  and the clip would chase it instead of following it. */
  scale: number;
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
  /** The scroll container. Both the ruler and the track live inside it, so they
   *  cannot drift out of sync: there is one scroll position, not two. */
  const stripRef = useRef<HTMLDivElement>(null);
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
  const timelineScale = useStore((s) => s.timelineScale);
  const widthPx = useStore((s) => s.timelineWidthPx);
  const setTimelineWidth = useStore((s) => s.setTimelineWidth);
  const setTimelineScale = useStore((s) => s.setTimelineScale);
  const keymap = useResolvedKeymap();
  // Re-linking a file changes NOTHING in the document, so the clips below would
  // keep saying "다시 선택 필요" after the media came back without this. Same
  // subscription, and the same reason, as the media panel's.
  useStore((s) => s.mediaVersion);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [scrollPx, setScrollPx] = useState(0);
  /** The handlers live on `window` (see below) and must see the newest drag. */
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const total = timelineDuration(project);
  const clips = videoTrack(project).clips;
  const fps = project.timeline.fps;
  const assetName = (id: string) =>
    project.assets.find((a) => a.id === id)?.name ?? '클립';
  /** A clip whose file is not linked draws no pictures and never will until it
   *  comes back — which, now that every other clip has pictures, looks exactly
   *  like one that is still decoding. It has to say which it is. */
  const unlinked = (assetId: string) => !getDecodeService(assetId);
  /** Known to have no sound — not merely "no sound yet". The strip draws the
   *  difference; this is the same fact for someone who cannot see it. */
  const silent = (assetId: string) =>
    !unlinked(assetId) && hasNoAudioTrack(assetId);

  // The strip measures itself; everything else is derived from that width.
  // `useLayoutEffect`, not `useEffect`: until the first measurement the scale
  // is zero and every clip draws at width zero, and a post-paint effect lets
  // that pile-up reach the screen for a frame.
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => setTimelineWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [setTimelineWidth]);

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

  // ---------------------------------------------------------------- geometry

  /**
   * The scale in force. `null` means fitted — the whole document across the
   * strip, which is what the timeline always did before it could zoom.
   *
   * A live drag uses the scale it started with. The document cannot change
   * under a gesture, but the WINDOW can, and a fitted scale follows the window.
   */
  const liveScale = clampScale(
    timelineScale ?? fitScale(total, widthPx),
    total,
    widthPx,
  );
  const scale = drag ? drag.scale : liveScale;
  const view: View = { total, widthPx, scale, scrollPx };

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

  const drawn = clips.map(geometry);
  /**
   * How wide the scrolled content is. A drag can preview a clip past the end of
   * the document, and the content grows to hold it rather than the clip being
   * pinned to the right edge as a stub — that pin was the whole reason the old
   * timeline froze its scale for a gesture.
   *
   * The SCALE is computed from the document, not from this: letting a preview
   * that lengthens the strip also change the scale is exactly the feedback loop
   * that made a clip chase the pointer.
   */
  const contentPx = drawn.reduce(
    // `reduce`, not `Math.max(...spread)`: a project with tens of thousands of
    // cuts would pass that many arguments in one call and throw.
    (widest, g) => Math.max(widest, (g.start + g.length) * scale),
    contentWidth(view),
  );

  const viewRef = useRef(view);
  viewRef.current = view;

  // An emptied timeline goes back to fitted. A scale chosen for the document
  // that was just deleted is not a preference to carry forward: applied to the
  // next import it opens a fresh video showing a sliver of itself, scrolled,
  // which reads as the file having failed to load.
  useEffect(() => {
    if (total === 0 && timelineScale !== null) setTimelineScale(null);
  }, [total, timelineScale, setTimelineScale]);

  /**
   * The frame a zoom step should keep in view: the playhead, unless the
   * keyboard is on a clip somewhere else. Centring on the playhead regardless
   * would scroll a focused clip off screen while it keeps focus — a focus ring
   * the user cannot see is a keyboard user losing their place.
   */
  function anchorFrame(): number {
    const bar = barRef.current;
    const active = document.activeElement;
    if (bar && active instanceof HTMLElement && bar.contains(active)) {
      const id = active.closest('.clip')?.getAttribute('data-clip-id');
      const clip = id ? clips.find((c) => c.id === id) : undefined;
      if (clip) return clip.startFrame;
    }
    return useStore.getState().playhead;
  }

  // Two promises, so two effects. A zoom step re-CENTRES on the playhead: the
  // magnification just changed under the user and "where was I?" has to be
  // answered. An ordinary playhead move only scrolls when the playhead would
  // otherwise leave the strip — following it by a pixel a frame during playback
  // makes the whole timeline shimmer.
  useEffect(() => {
    const el = stripRef.current;
    if (!el || widthPx <= 0) return;
    el.scrollLeft = centerOn(viewRef.current, anchorFrame());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  useEffect(() => {
    const el = stripRef.current;
    if (!el || widthPx <= 0 || dragRef.current) return;
    const want = keepVisible(
      { ...viewRef.current, scrollPx: el.scrollLeft },
      playhead,
    );
    if (Math.abs(want - el.scrollLeft) >= 1) el.scrollLeft = want;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead]);

  /** One scale for everything, and one place the two units meet. `clientLeft`
   *  is the element's own border: content x is measured from the PADDING box,
   *  which is where the clips and the playhead are laid out from. */
  function seekFromX(clientX: number) {
    const el = barRef.current;
    if (!el || total === 0) return;
    const originX = el.getBoundingClientRect().left + el.clientLeft;
    seekTo(xToFrame(view, clientX - originX));
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
      scale,
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

    // Pixels are what the hand controls; frames are what the document stores.
    // Both conversions go through the engine, at the frozen scale.
    const frozen = { total, widthPx, scale: d.scale };
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

  /**
   * The three view controls. They sit next to the thing they change rather than
   * in the edit toolbar, which is for edits.
   *
   * `short` is drawn, `label` is the accessible name and always contains it —
   * icon-only buttons put the deciding word behind a hover, which is where a
   * first-time user who cannot click a narrow clip will never look for it.
   */
  function ZoomButton({
    id,
    icon,
    label,
    short,
  }: Record<'id' | 'icon' | 'label' | 'short', string>) {
    const enabled = canRun(id);
    const why = enabled ? '' : whyNot(id);
    const chord = keymap.byAction.get(id) ?? null;
    return (
      <button
        type="button"
        className="zoom-btn"
        aria-disabled={!enabled}
        aria-label={label}
        title={
          enabled ? (chord ? `${label} (${formatChord(chord)})` : label) : why
        }
        onClick={() => {
          // Saying why beats a click that does nothing at all.
          if (!enabled) return setStatus(why);
          perform(id);
        }}
      >
        <span aria-hidden="true">{icon}</span> {short}
      </button>
    );
  }

  /**
   * How much footage is on screen, in plain words.
   *
   * The zoom level is otherwise a fact only the eye can read: the ruler covers
   * the whole document at every zoom (on purpose), the tick marks are hidden
   * from assistive tech, and the status line says what CHANGED, once. This says
   * what IS, and it stays there to be asked.
   */
  function spanText(): string {
    if (total === 0 || widthPx <= 0) return '';
    const frames = Math.min(total, Math.round(visibleSpan(view)));
    const sec = Math.max(1, Math.round(frameToSec(frames, fps)));
    if (sec < 60) return `한 화면에 ${sec}초`;
    const rest = sec % 60;
    return rest
      ? `한 화면에 ${Math.floor(sec / 60)}분 ${rest}초`
      : `한 화면에 ${Math.floor(sec / 60)}분`;
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

  const marks = widthPx > 0 ? ticks(view, fps) : [];

  return (
    <section className="timeline" aria-labelledby="timeline-title">
      <h2 className="panel-title" id="timeline-title">
        타임라인
      </h2>
      <div className="track-head">
        <span className="track-label">영상</span>
        <span className="zoom-controls" role="group" aria-label="타임라인 보기">
          <ZoomButton
            id="view.zoomOut"
            icon="⊖"
            label="작게 보기"
            short="작게"
          />
          <ZoomButton id="view.zoomIn" icon="⊕" label="크게 보기" short="크게" />
          {/* ⛶, not ⤢: a four-corner frame is the fit-to-view mark people know
              from image viewers and maps, where a diagonal arrow reads as
              "resize this corner". */}
          <ZoomButton
            id="view.zoomFit"
            icon="⛶"
            label="전체 보기"
            short="전체"
          />
        </span>
        <span className="zoom-span">{spanText()}</span>
        <span className="drag-readout" aria-hidden="true">
          {readout ?? ''}
        </span>
      </div>
      <div
        className="strip"
        ref={stripRef}
        onScroll={(e) => setScrollPx(e.currentTarget.scrollLeft)}
      >
        {/* The slider covers the DOCUMENT, not the visible window: zoom changes
            what you can see, never where the playhead is allowed to go. A
            keyboard user therefore reaches every frame at any zoom, and the
            strip scrolls to follow them. */}
        <div
          className="ruler"
          role="slider"
          tabIndex={0}
          aria-label="재생 위치 (좌우 화살표로 이동)"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, total - 1)}
          aria-valuenow={playhead}
          aria-valuetext={formatTimecode(playhead, fps)}
          style={{ width: contentPx + 'px' }}
          onKeyDown={onRulerKey}
          onMouseDown={(e) => seekFromX(e.clientX)}
        >
          {marks.map((t) => (
            <span
              key={t.frame}
              className={'tick' + (t.major ? ' major' : '')}
              aria-hidden="true"
              style={{ left: frameToX(view, t.frame) + 'px' }}
            >
              {/* `formatClock`, not `formatTimecode`: a ruler is a whole row
                  of times at once, and mm:ss:ff reads as hours:minutes:seconds
                  to anyone who has not been told otherwise — a three-second
                  clip was labelled up to "00:02:25". */}
              {t.major ? (
                <span className="tick-label">{formatClock(t.frame, fps)}</span>
              ) : null}
            </span>
          ))}
          <span
            className="ruler-thumb"
            aria-hidden="true"
            style={{ left: frameToX(view, playhead) + 'px' }}
          />
        </div>
        <div
          className={'track' + (drag?.active ? ' dragging' : '')}
          ref={barRef}
          role="group"
          aria-label={`클립 ${clips.length}개${gaps.length ? `, 빈 곳 ${gaps.length}개` : ''}`}
          style={{ width: contentPx + 'px' }}
          onMouseDown={(e) => seekFromX(e.clientX)}
        >
          {gaps.map((g) => (
            <div
              key={`gap_${g.start}`}
              className="gap"
              aria-hidden="true"
              style={{
                left: frameToX(view, g.start) + 'px',
                width: frameToX(view, g.length) + 'px',
              }}
            />
          ))}
          {clips.map((c, i) => {
            const selected = c.id === selectedClipId;
            const isDragging = drag?.active && drag.clipId === c.id;
            const g = drawn[i];
            return (
              <button
                key={c.id}
                type="button"
                data-clip-id={c.id}
                className={
                  'clip' +
                  (selected ? ' selected' : '') +
                  (isDragging ? ' dragging' : '') +
                  (unlinked(c.assetId) ? ' unlinked' : '')
                }
                // A one-frame clip is thinner than a pixel when fitted; `.clip`
                // carries a min-width so it stays grabbable whatever the numbers
                // say, without this file having to know the number.
                style={{
                  left: frameToX(view, g.start) + 'px',
                  width: frameToX(view, g.length) + 'px',
                }}
                aria-pressed={selected}
                // Selection lives in `aria-pressed` and NOWHERE else. Putting it in
                // the name too made the accessible name change when only the state
                // changed — a screen reader announces the whole clip again, and any
                // "did this edit survive undo?" check compares a moving target.
                aria-label={`클립 ${i + 1}, ${assetName(c.assetId)}, ${formatTimecode(
                  c.startFrame,
                  fps,
                )}부터 길이 ${formatTimecode(clipLength(c), fps)}, ${clipLength(c)}프레임`}
                // A DESCRIPTION, not part of the name. The name carries
                // identity, position and length and never state — that rule is
                // the e2e DOM contract, and it was written after four specs
                // broke over a label that moved when only state changed. A
                // description is the channel state has: it is announced after
                // the name and it is the only way "this clip's file is gone"
                // reaches someone who cannot see the missing pictures.
                aria-describedby={
                  [
                    unlinked(c.assetId) ? 'clip-unlinked-note' : '',
                    silent(c.assetId) ? 'clip-silent-note' : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
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
                <ClipCanvas
                  view={view}
                  clip={{
                    start: g.start,
                    length: g.length,
                    inFrame: drawnInFrame(
                      c,
                      g.start,
                      isDragging ? drag.mode : null,
                    ),
                  }}
                  assetId={c.assetId}
                  fps={fps}
                />
                <span className="clip-handle start" aria-hidden="true" />
                {unlinked(c.assetId) && (
                  <span
                    className="clip-warn"
                    aria-hidden="true"
                    title="영상 파일이 연결되어 있지 않아요 — 미디어 목록에서 같은 영상을 다시 선택해 주세요."
                  >
                    ⚠
                  </span>
                )}
                <span className="clip-mark" aria-hidden="true">
                  {selected ? '◉' : '◎'}
                </span>
                <span className="clip-name">{assetName(c.assetId)}</span>
                <span className="clip-handle end" aria-hidden="true" />
              </button>
            );
          })}
          <div
            className="playhead"
            style={{ left: frameToX(view, playhead) + 'px' }}
          />
          {/* One node, referenced by every clip that needs it. Visually hidden
              because the ⚠ and the hatched fill already say it on screen. */}
          <span id="clip-unlinked-note" className="sr-only">
            영상 파일이 연결되어 있지 않아 미리보기 그림이 없어요. 미디어
            목록에서 같은 영상을 다시 선택해 주세요.
          </span>
          {/* The other half of what the strip draws in the clip's bottom band.
              A description, not part of the name — the name is identity,
              position and length, and never state. */}
          <span id="clip-silent-note" className="sr-only">
            이 영상에는 소리가 없어요.
          </span>
        </div>
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
        <kbd>{key('clip.trimEndToPlayhead')}</kbd>(뒤)를 눌러요. 좁아서 고르기
        어려우면 <kbd>{key('view.zoomIn')}</kbd> 로 크게 보고,{' '}
        <kbd>{key('view.zoomFit')}</kbd> 로 전체를 다시 봐요.
      </p>
    </section>
  );
}
