// framewright — preview player.
// Everything resolves through the TIMELINE (resolveAt), so cuts and deletes are
// reflected in what you see.
//   - SCRUB: single-flight, latest-wins decode (stale frames dropped).
//   - PLAYBACK: streaming sessions from the feed pool — one per source in
//     play, two through a dissolve; crossing a cut re-cues only what the pool
//     cannot carry on (ADR-0012).
// The playback loop reads live state through refs — a captured closure would
// keep playing the pre-edit document and would fight the user's seeking.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/projectStore';
import { getDecodeService } from '../engine/registry';
import { frameToSec, secToFrame, formatTimecode } from '../engine/time';
import { resolveAt, timelineDuration } from '../engine/timeline';
import { buildAudioSchedule } from '../engine/audioSchedule';
import { AudioPlayer } from '../engine/audioPlayer';
import { audioContext, getAudioBuffer, resumeAudio } from '../engine/audio';
import { subtitleAt } from '../engine/subtitles';
import { subtitleFrameOf } from '../engine/subtitleStyle';
import { drawSubtitle, type SubtitleFrame } from '../engine/subtitleRender';
import { useWordsDrag } from './useWordsDrag';
import { useImageDrag } from './useImageDrag';
import { useSubtitleFonts } from './useSubtitleFonts';
import { imageAt, imageFrameOf } from '../engine/images';
import { drawImageFrame } from '../engine/imageRender';
import { browserImages, subscribeImages } from './images';
import { evenDimensions } from '../engine/exportPlan';
import { blendAt } from '../engine/fades';
import { FeedPool } from '../engine/feeds';
import { composeFrame, type BlendLayer } from '../engine/compose';
import {
  AS_SHOT,
  clipPanLimits,
  pictureTransform,
  type PictureTransform,
} from '../engine/picture';
import { useStageDrag, type StageEvent } from './useStageDrag';
import { TOGGLE_PLAY_EVENT } from './actions';
import { clipCeiling } from './waveform';
import { isMediaReady } from './media';
import { FramePicker } from './FramePicker';

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** The words, on their own canvas over the picture. Separate on purpose: the
   *  picture only redraws when a frame arrives, the words must change on the
   *  exact frame a subtitle starts or ends — and a subtitle drawn INTO the
   *  picture would stay there on every held frame after it had ended. */
  const overlayRef = useRef<HTMLCanvasElement>(null);
  /** The pictures laid over the footage, on their own canvas between the two
   *  (ADR-0020). Its own layer for the words' reason and one more: a bitmap
   *  arrives long after the frame it belongs to was painted, so drawing it
   *  into the picture would need that frame decoded again. */
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  /** The decoders behind playback. Made when playback starts, emptied when
   *  it stops; a fade needs two of them at once. */
  const poolRef = useRef<FeedPool | null>(null);
  const rafRef = useRef(0);
  const baseFrameRef = useRef(0);
  const baseWallRef = useRef(0);
  const lastSetRef = useRef(-1);
  const audioRef = useRef<AudioPlayer | null>(null);

  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const seekTo = useStore((s) => s.seekTo);
  const seekVersion = useStore((s) => s.seekVersion);
  const isPlaying = useStore((s) => s.isPlaying);
  const setPlaying = useStore((s) => s.setPlaying);
  const setStatus = useStore((s) => s.setStatus);
  const stopSignal = useStore((s) => s.stopSignal);
  const mediaVersion = useStore((s) => s.mediaVersion);
  // Media kept from a previous session is still being read. Without this the
  // stage tells the user to go and find the file the app is already opening.
  const restoring = useStore((s) => s.mediaRestoring);
  const run = useStore((s) => s.run);
  const select = useStore((s) => s.select);
  const fps = project.timeline.fps;
  const total = timelineDuration(project);

  // ---- MOVE THE PICTURE (ADR-0014) ----
  // Dragging on the stage moves the picture of the clip under the playhead:
  // pixels over the picture canvas's CSS size are fractions of the BOX,
  // which is what `clip.pan` takes, one undo step under a coalesce key
  // (ADR-0006), stopped at the clip's own limit with the pointer attached
  // (`useStageDrag`). The gesture is the hook's; this is the hit test, the
  // limits and the command.
  const underPlayhead = resolveAt(project, playhead)?.clip ?? null;
  const selectedClipId = useStore((s) => s.selectedClipId);
  const panDrag = useStageDrag<string>({
    press(e) {
      if (!underPlayhead) return null;
      // Only the SELECTED clip's picture moves, and only while it is the one
      // on screen. A drag that edited the clip under the playhead while the
      // panel showed another was the novice reviewer's blocker: the first
      // press on a different clip chooses it and says so; the next drag
      // moves it.
      if (underPlayhead.id !== selectedClipId) {
        select(underPlayhead.id);
        setStatus('지금 보이는 클립을 골랐어요 · 다시 끌면 화면이 옮겨져요.');
        return null;
      }
      const picture = canvasRef.current;
      if (!picture) return null;
      const rect = picture.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const t = pictureTransform(underPlayhead);
      const limits = clipPanLimits(project, underPlayhead);
      // The pan scales with the zoom (ADR-0014): a pixel of drag is a pixel
      // of the ZOOMED picture, so the picture follows the pointer — and
      // stops with it at the limit the command would clamp to anyway.
      return {
        target: underPlayhead.id,
        base: { x: t.panX, y: t.panY },
        size: { x: rect.width * t.zoom, y: rect.height * t.zoom },
        min: { x: -limits.x, y: -limits.y },
        max: { x: limits.x, y: limits.y },
      };
    },
    move(clipId, v) {
      run('clip.pan', { clipId, x: v.x, y: v.y }, `pan:${clipId}`);
    },
    release() {}, // nothing to snap, nothing to say: the last move is the drop
  });

  // The stage's one handler set, asked in hit order: the words first
  // (E8-2c), then the pictures laid over the footage (E10 step 4), then the
  // clip's pan. A press on the words or on an image is unambiguous, so it
  // selects the thing AND starts its drag; the pan needs a press-to-choose
  // step because a press on the footage is not.
  function onStagePointerDown(e: StageEvent) {
    // ONE GESTURE AT A TIME ON THE STAGE — a decision, not an accident.
    // `useStageDrag` refuses a second pointer for the drag that is already
    // on, but that refusal falls THROUGH to the next handler here, and the
    // second pointer would then start a DIFFERENT drag: the words still
    // being moved under one finger while the pan begins under another, two
    // undo steps interleaved and neither release seen by the other. While
    // any of the three is on, the stage is closed.
    //
    // Each hook answers for its own drag, live off `useStageDrag`'s ref, so
    // there is nothing here to set, clear or get out of step with the drags
    // it describes: a drag is on from the press that took it (the only
    // place the ref is written) until the release that ends it (the only
    // place it is cleared), and a cancel comes through that same release.
    if (wordsDrag.active || imageDrag.active || panDrag.active) return;
    if (wordsDrag.onPointerDown(e)) return;
    if (imageDrag.onPointerDown(e)) return;
    panDrag.onPointerDown(e);
  }

  function onStagePointerMove(e: StageEvent) {
    if (wordsDrag.onPointerMove(e)) return;
    if (imageDrag.onPointerMove(e)) return;
    panDrag.onPointerMove(e);
  }

  function onStagePointerUp(e: StageEvent) {
    // Only the pointer whose drag this is answers true, so a stray release
    // (the second pointer refused above) leaves the gesture running.
    if (wordsDrag.onPointerUp(e)) return;
    if (imageDrag.onPointerUp(e)) return;
    panDrag.onPointerUp(e);
  }
  // The document remembers clips whose media is not loaded (e.g. after reload).
  // Per kind: a picture has no decoder to find, so asking the registry about
  // one called every restored image lost (`isMediaReady`).
  const missingMedia = project.assets.some((a) => !isMediaReady(a));

  // Live mirrors for the rAF loop.
  const projectRef = useRef(project);
  const totalRef = useRef(total);
  const playheadRef = useRef(playhead);
  const seekVersionRef = useRef(seekVersion);
  projectRef.current = project;
  totalRef.current = total;
  playheadRef.current = playhead;
  seekVersionRef.current = seekVersion;
  const seenSeekRef = useRef(seekVersion);

  /**
   * Paint one timeline frame: black, the footage, the other side of a fade.
   * The canvas is the TIMELINE's size and the footage is letterboxed into it
   * — exactly what the export does — so the screen and the file agree even
   * when a source's aspect differs from the sequence's. The words are not
   * here; they have their own layer (above).
   */
  /** Draw one timeline frame. `frame` is WHICH one, stamped on the canvas as
   *  `data-frame`: a scrub is "latest wins", so between a key press and the
   *  decode the canvas shows an earlier frame, and nothing else says which.
   *  The e2e specs read it before they read pixels (docs/TESTING.md). */
  function paint(
    primary: VideoFrame | null,
    blend: BlendLayer | null,
    frame: number,
    transform: PictureTransform = AS_SHOT,
  ) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width, height } = evenDimensions(
      projectRef.current.timeline.width,
      projectRef.current.timeline.height,
    );
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    composeFrame(ctx, width, height, primary, blend, null, transform);
    canvas.dataset.frame = String(frame);
  }

  /** A gap has no picture. Holding the previous frame is what makes a hole in
   *  the timeline look like footage — and export writes black there, so the
   *  preview would be lying about the file it is going to produce. */
  function drawBlank(frame: number) {
    paint(null, null, frame);
  }

  // ---- SCRUB (single-flight, latest wins) ----
  async function pump() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      while (pendingRef.current !== null) {
        const timelineFrame = pendingRef.current;
        pendingRef.current = null;
        const doc = projectRef.current;
        const hit = resolveAt(doc, timelineFrame);
        if (!hit) {
          drawBlank(timelineFrame);
          continue;
        }
        const svc = getDecodeService(hit.clip.assetId);
        if (!svc) continue;
        let frame: VideoFrame | null = null;
        try {
          frame = await svc.decodeAtSec(frameToSec(hit.sourceFrame, fps));
        } catch {
          frame = null; // decoder released internally; keep the last good frame
        }
        if (!frame) continue;
        // The other side of a fade, when this frame has one: the neighbour's
        // overhang or pre-roll, or black.
        const mix = blendAt(doc, timelineFrame);
        let other: VideoFrame | null = null;
        if (mix?.assetId) {
          try {
            other =
              (await getDecodeService(mix.assetId)?.decodeAtSec(
                frameToSec(mix.sourceFrame, fps),
              )) ?? null;
          } catch {
            other = null;
          }
        }
        try {
          paint(
            frame,
            mix
              ? { frame: other, weight: mix.weight, transform: mix.transform }
              : null,
            timelineFrame,
            pictureTransform(hit.clip),
          );
        } finally {
          frame.close();
          other?.close();
        }
      }
    } finally {
      busyRef.current = false;
    }
  }

  useEffect(() => {
    if (isPlaying) return;
    if (total === 0) {
      // Deleting the last clip must clear the picture. The empty-state note is
      // absolutely positioned, so a stale frame would sit behind it.
      drawBlank(playhead);
      return;
    }
    pendingRef.current = playhead;
    void pump();
    // `mediaVersion` is here because re-linking a file changes NOTHING in the
    // document — same project object, same playhead — so without it the stage
    // stays black until the user happens to move the playhead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, project, isPlaying, mediaVersion]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      poolRef.current?.stopAll();
      audioRef.current?.stop();
    };
  }, []);

  // ---- SUBTITLE OVERLAY ----
  // Drawn at the TIMELINE's size — the size the export renders at — and
  // stretched by CSS over the picture, so the words are laid out by the same
  // function on the same pixel grid as the file will have (`drawSubtitle`).
  // While the user is typing, the draft is what they want to see on the
  // picture — the document only gets it on Enter/blur.
  const draft = useStore((s) => s.subtitleDraft);
  const current = total > 0 ? subtitleAt(project, playhead) : null;
  // The same object the export plan records for this frame (ADR-0017), with
  // the draft's words swapped in while typing. Keyed by its JSON so the
  // effect below runs when the frame CHANGES, not on every render.
  const frameKey = current
    ? JSON.stringify(
        subtitleFrameOf(
          current,
          playhead,
          project.timeline.fps,
          draft && draft.id === current.id ? draft.text : current.text,
        ),
      )
    : '';
  const frame = useMemo(
    () => (frameKey ? (JSON.parse(frameKey) as SubtitleFrame) : null),
    [frameKey],
  );
  const words = frame?.text ?? '';

  // The faces the document names are fetched as soon as it is on screen,
  // and the overlay redraws when one lands (ADR-0018, `useSubtitleFonts`).
  const fontsVersion = useSubtitleFonts(project, frame, setStatus);
  // ---- MOVE THE WORDS (E8-2c, ADR-0019) ---- the stage's other drag,
  // asked first by each handler above (`useWordsDrag`).
  const wordsDrag = useWordsDrag({
    overlayRef,
    frame,
    current,
    fontsVersion,
  });
  // A LAYOUT effect: the picture is painted inside the rAF tick and the
  // playhead update that changes the frame is committed right after, so
  // drawing the words before that commit reaches the screen keeps both on
  // the same paint. A passive effect put the words one paint behind the
  // picture.
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const ctx = overlay?.getContext('2d');
    if (!overlay || !ctx) return;
    const { width, height } = evenDimensions(
      project.timeline.width,
      project.timeline.height,
    );
    if (overlay.width !== width || overlay.height !== height) {
      overlay.width = width;
      overlay.height = height;
    }
    ctx.clearRect(0, 0, width, height);
    if (frame && frame.text) drawSubtitle(ctx, frame, width, height);
  }, [frame, fontsVersion, project.timeline.width, project.timeline.height]);

  // ---- THE IMAGE LAYER (E10 step 4, ADR-0020) ----
  // Drawn at the TIMELINE's size, like the words and for the same reason:
  // the export draws the same rectangle with the same function on the same
  // grid, so the screen cannot disagree with the file about where a sticker
  // sits. Between the footage and the words, because the words are the last
  // thing that must stay readable.
  const [imagesVersion, imageArrived] = useState(0);
  useEffect(() => subscribeImages(() => imageArrived((n) => n + 1)), []);
  const currentImage = total > 0 ? imageAt(project, playhead) : null;
  const imageAsset = currentImage
    ? (project.assets.find((a) => a.id === currentImage.assetId) ?? null)
    : null;
  // `imageFrameAt`'s two halves, kept apart: the drag needs the image ITSELF
  // (its id, for the command) and the layer needs the frame. Memoised on the
  // two document objects, which only change when the image or the asset
  // does, so the draw below runs on a real change and not on every tick of
  // the playhead.
  const imageFrame = useMemo(
    () =>
      currentImage && imageAsset
        ? imageFrameOf(currentImage, imageAsset)
        : null,
    [currentImage, imageAsset],
  );
  // The bitmap, if it has arrived. One owner, `ui/images.ts`: this asks and
  // never opens or closes one (golden rule 6).
  const bitmap = imageFrame ? browserImages.get(imageFrame.assetId) : null;
  // What the layer is announced as — the file's name, and only while a
  // picture is actually on it.
  const imageName = bitmap && imageAsset ? imageAsset.name : '';

  useLayoutEffect(() => {
    const canvas = imageCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width, height } = evenDimensions(
      project.timeline.width,
      project.timeline.height,
    );
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.clearRect(0, 0, width, height);
    if (!imageFrame) return;
    if (!bitmap) {
      // Nothing has read this file yet (a reopened document, a restore).
      // Asking is idempotent and a file that cannot be read is remembered,
      // so this cannot become a loop; the redraw comes back through
      // `subscribeImages` → `imagesVersion`.
      void browserImages.load(imageFrame.assetId);
      return;
    }
    drawImageFrame(ctx, { ...imageFrame, picture: bitmap }, width, height);
  }, [
    imageFrame,
    bitmap,
    imagesVersion,
    project.timeline.width,
    project.timeline.height,
  ]);

  // ---- MOVE THE PICTURE ON THE STAGE (E10 step 4) ---- the stage's third
  // drag, asked between the words and the pan by each handler above.
  const imageDrag = useImageDrag({
    imageRef: imageCanvasRef,
    frame: imageFrame,
    image: currentImage,
  });

  // The picture is centred and letterboxed by CSS, so the overlays find out
  // where it landed and sit exactly on top of it. Re-measured whenever the
  // stage or the picture changes size.
  useEffect(() => {
    const stage = stageRef.current;
    const picture = canvasRef.current;
    const overlay = overlayRef.current;
    const images = imageCanvasRef.current;
    if (!stage || !picture || !overlay || !images) return;
    const place = () => {
      const s = stage.getBoundingClientRect();
      const p = picture.getBoundingClientRect();
      for (const layer of [images, overlay]) {
        layer.style.left = `${p.left - s.left}px`;
        layer.style.top = `${p.top - s.top}px`;
        layer.style.width = `${p.width}px`;
        layer.style.height = `${p.height}px`;
      }
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(stage);
    observer.observe(picture);
    return () => observer.disconnect();
  }, [total]);

  function stopPlayback() {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    poolRef.current?.stopAll();
    poolRef.current = null;
    audioRef.current?.stop();
    setPlaying(false);
  }

  /** Start (or re-cue) the timeline's audio for a run beginning at `fromFrame`.
   *  The context starts suspended under the autoplay policy, so we must WAIT for
   *  the resume before scheduling — otherwise everything is queued against a
   *  frozen clock. */
  async function startAudio(fromFrame: number) {
    const ctx = audioContext();
    if (!ctx) return;
    await resumeAudio();
    if (!audioRef.current) audioRef.current = new AudioPlayer(ctx);
    // Each clip is held under its own peak's ceiling (ADR-0013) — the same
    // bound the export applies, from the same peaks.
    const schedule = buildAudioSchedule(projectRef.current, fromFrame, (clip) =>
      clipCeiling(projectRef.current, clip),
    );
    audioRef.current.start(schedule, getAudioBuffer);
    // Say something useful instead of playing silently for no visible reason.
    if (schedule.length > 0 && audioRef.current.scheduledCount === 0) {
      setStatus('이 영상에는 재생할 수 있는 오디오가 없어요.');
    } else if (ctx.state !== 'running') {
      setStatus(
        '브라우저가 소리를 막고 있어요. 화면을 한 번 클릭한 뒤 다시 재생해 주세요.',
      );
    }
  }

  function startPlayback() {
    if (totalRef.current === 0 || rafRef.current) return;
    const from =
      playheadRef.current >= totalRef.current - 1 ? 0 : playheadRef.current;
    baseFrameRef.current = from;
    baseWallRef.current = performance.now();
    lastSetRef.current = from;
    seenSeekRef.current = seekVersionRef.current;
    void startAudio(from);
    setPlaying(true);

    const onDecodeError = (e: DOMException) => {
      console.error('playback decode error:', e);
      setStatus('영상을 재생하는 중 문제가 생겨 멈췄어요. 다시 재생해 보세요.');
      stopPlayback();
    };
    const pool = new FeedPool(
      (assetId) =>
        getDecodeService(assetId)?.createPlaybackSession(onDecodeError) ?? null,
      fps,
    );
    poolRef.current = pool;

    const loop = () => {
      // Rebase only on a REAL user seek. (Comparing playhead values instead made
      // every slow render look like a seek, which re-cued audio ~60×/second and
      // meant it never actually sounded.)
      if (seenSeekRef.current !== seekVersionRef.current) {
        seenSeekRef.current = seekVersionRef.current;
        baseFrameRef.current = playheadRef.current;
        baseWallRef.current = performance.now();
        lastSetRef.current = playheadRef.current;
        pool.stopAll();
        void startAudio(baseFrameRef.current); // re-cue audio at the new position
      }

      // Audio is the MASTER clock while it plays — the picture follows it, which
      // is what keeps sound and image together. Wall time is the fallback.
      const player = audioRef.current;
      const elapsed =
        player && player.isActive
          ? player.elapsedSec()
          : (performance.now() - baseWallRef.current) / 1000;
      const frame = baseFrameRef.current + secToFrame(elapsed, fps, 'floor');

      if (frame >= totalRef.current) {
        setPlayhead(Math.max(0, totalRef.current - 1));
        stopPlayback();
        return;
      }

      const doc = projectRef.current;
      const hit = resolveAt(doc, frame);
      // A frame: ask the pool for each picture it needs, then drop the rest.
      // In a gap that is nothing — so the clip on the far side re-cues
      // instead of being judged "continuous" across it.
      pool.begin();
      if (hit) {
        const feed = pool.feed({
          assetId: hit.clip.assetId,
          sourceFrame: hit.sourceFrame,
        });
        if (feed) {
          pool.pull(feed, frameToSec(hit.sourceFrame, fps));
          const mix = blendAt(doc, frame);
          let blend: BlendLayer | null = null;
          if (mix) {
            const other = mix.assetId
              ? pool.feed({
                  assetId: mix.assetId,
                  sourceFrame: mix.sourceFrame,
                })
              : null;
            if (other) pool.pull(other, frameToSec(mix.sourceFrame, fps));
            // A neighbour's decoder opened THIS tick has nothing yet (decoder
            // output is always asynchronous). Drawing black in its place at
            // the fade's weight flashed dark at the start of every dissolve;
            // leave the blend out until its first picture lands. Black as
            // the partner is what the plan asked for, so that one stays.
            blend =
              other && !other.current
                ? null
                : {
                    frame: other?.current ?? null,
                    weight: mix.weight,
                    transform: mix.transform,
                  };
          }
          // Nothing decoded yet (a cold start at a cut): keep the last
          // picture on the canvas rather than flashing black for a frame.
          if (feed.current) {
            paint(feed.current, blend, frame, pictureTransform(hit.clip));
          }
        }
      } else {
        drawBlank(frame);
      }
      pool.end();

      lastSetRef.current = frame;
      setPlayhead(frame);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  // Space bar (from useShortcuts) toggles playback.
  useEffect(() => {
    const onToggle = () => (isPlaying ? stopPlayback() : startPlayback());
    window.addEventListener(TOGGLE_PLAY_EVENT, onToggle);
    return () => window.removeEventListener(TOGGLE_PLAY_EVENT, onToggle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // The document was replaced underneath us (a version restore) — the running
  // loop's timing base and scheduled audio belong to the old timeline.
  useEffect(() => {
    if (stopSignal > 0 && isPlaying) stopPlayback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopSignal]);

  // Pause when the tab is hidden (rAF throttling would desync the clock).
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && isPlaying) stopPlayback();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  return (
    <div className="preview">
      <div className="panel-title preview-title">
        <span>프리뷰</span>
        <FramePicker />
      </div>
      <div
        className={
          'stage' +
          (underPlayhead && underPlayhead.id === selectedClipId
            ? ' movable'
            : '') +
          // One of the two at a time, in the hit order the handlers use: the
          // words win the press where they overlap a picture, so they win
          // the cursor too.
          (wordsDrag.overWords ? ' words' : imageDrag.overImage ? ' image' : '')
        }
        ref={stageRef}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerUp}
      >
        <canvas ref={canvasRef} className="stage-picture" />
        {/* The pictures laid over the footage, under the words. Hidden from
            assistive tech until one is actually drawn: an image whose file is
            still being read has nothing on screen to name. */}
        <canvas
          ref={imageCanvasRef}
          className="stage-image"
          role={imageName ? 'img' : undefined}
          aria-label={imageName ? `이미지: ${imageName}` : undefined}
          aria-hidden={imageName ? undefined : true}
        />
        {/* Hidden from assistive tech when blank; named by its words when not,
            so a screen reader user can ask what is on screen without being
            read every subtitle as it flies past during playback. */}
        <canvas
          ref={overlayRef}
          className="stage-subtitle"
          role={words ? 'img' : undefined}
          aria-label={words ? `자막: ${words}` : undefined}
          aria-hidden={words ? undefined : true}
        />
        {total > 0 && missingMedia && restoring && (
          <p className="stage-note">
            저장해 둔 파일을 여는 중이에요. 잠시만 기다려 주세요.
          </p>
        )}
        {total > 0 && missingMedia && !restoring && (
          <p className="stage-note" role="status">
            영상 파일이 아직 연결되지 않아 화면이 비어 있어요.
            <br />
            왼쪽에서 같은 영상을 다시 선택하면 이어서 편집할 수 있어요.
          </p>
        )}
        {total === 0 && (
          <p className="stage-note">왼쪽에 영상을 넣으면 여기에 표시돼요.</p>
        )}
      </div>
      <div className="transport">
        <button
          onClick={() => {
            // Playing with no media advances the playhead over a black canvas
            // and looks exactly like a freeze. Say what it is waiting for
            // instead — `aria-disabled`, so the control stays discoverable and
            // the reason is reachable by keyboard.
            if (missingMedia) {
              setStatus(
                restoring
                  ? '저장해 둔 파일을 여는 중이에요. 잠시 뒤에 재생할 수 있어요.'
                  : '영상 파일이 아직 연결되지 않았어요. 왼쪽에서 같은 영상을 다시 선택해 주세요.',
              );
              return;
            }
            isPlaying ? stopPlayback() : startPlayback();
          }}
          disabled={total === 0}
          aria-disabled={missingMedia || undefined}
          aria-label={isPlaying ? '일시정지' : '재생'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <span className="tc">{formatTimecode(playhead, fps)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={Math.min(playhead, Math.max(0, total - 1))}
          aria-label="재생 위치"
          onChange={(e) => seekTo(Number(e.target.value))}
        />
        <span className="dim">
          {playhead} / {Math.max(0, total - 1)}
        </span>
      </div>
    </div>
  );
}
