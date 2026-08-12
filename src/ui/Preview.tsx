// framewright — preview player.
// Everything resolves through the TIMELINE (resolveAt), so cuts and deletes are
// reflected in what you see.
//   - SCRUB: single-flight, latest-wins decode (stale frames dropped).
//   - PLAYBACK: one streaming session per clip; crossing a cut restarts the
//     session at the next clip's source position.
// The playback loop reads live state through refs — a captured closure would
// keep playing the pre-edit document and would fight the user's seeking.
import { useEffect, useRef } from 'react';
import { useStore } from '../store/projectStore';
import { getDecodeService } from '../engine/registry';
import { frameToSec, secToFrame, formatTimecode } from '../engine/time';
import { resolveAt, timelineDuration } from '../engine/timeline';
import { isContinuous } from '../engine/exportPlan';
import { buildAudioSchedule } from '../engine/audioSchedule';
import { AudioPlayer } from '../engine/audioPlayer';
import { audioContext, getAudioBuffer, resumeAudio } from '../engine/audio';
import type { PlaybackSession } from '../engine/playbackSession';
import { TOGGLE_PLAY_EVENT } from './actions';

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pendingRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const sessionRef = useRef<PlaybackSession | null>(null);
  const sessionAssetRef = useRef<string | null>(null);
  const lastSourceRef = useRef(-1);
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
  const fps = project.timeline.fps;
  const total = timelineDuration(project);
  // The document remembers clips whose media is not loaded (e.g. after reload).
  const missingMedia = project.assets.some((a) => !getDecodeService(a.id));

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

  function drawFrame(frame: VideoFrame) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (
      canvas.width !== frame.displayWidth ||
      canvas.height !== frame.displayHeight
    ) {
      canvas.width = frame.displayWidth;
      canvas.height = frame.displayHeight;
    }
    ctx.drawImage(frame, 0, 0);
  }

  /** A gap has no picture. Holding the previous frame is what makes a hole in
   *  the timeline look like footage — and export writes black there, so the
   *  preview would be lying about the file it is going to produce. */
  function drawBlank() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /** Draw and always release the frame, even if drawing throws. */
  function drawAndRelease(frame: VideoFrame) {
    try {
      drawFrame(frame);
    } finally {
      frame.close();
    }
  }

  // ---- SCRUB (single-flight, latest wins) ----
  async function pump() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      while (pendingRef.current !== null) {
        const timelineFrame = pendingRef.current;
        pendingRef.current = null;
        const hit = resolveAt(projectRef.current, timelineFrame);
        if (!hit) {
          drawBlank();
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
        if (frame) drawAndRelease(frame);
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
      drawBlank();
      return;
    }
    pendingRef.current = playhead;
    void pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, project, isPlaying]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      sessionRef.current?.stop();
      audioRef.current?.stop();
    };
  }, []);

  function stopPlayback() {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    sessionRef.current?.stop();
    sessionRef.current = null;
    sessionAssetRef.current = null;
    lastSourceRef.current = -1;
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
    const schedule = buildAudioSchedule(projectRef.current, fromFrame);
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

    const loop = () => {
      // Rebase only on a REAL user seek. (Comparing playhead values instead made
      // every slow render look like a seek, which re-cued audio ~60×/second and
      // meant it never actually sounded.)
      if (seenSeekRef.current !== seekVersionRef.current) {
        seenSeekRef.current = seekVersionRef.current;
        baseFrameRef.current = playheadRef.current;
        baseWallRef.current = performance.now();
        lastSetRef.current = playheadRef.current;
        sessionRef.current?.stop();
        sessionRef.current = null;
        sessionAssetRef.current = null;
        lastSourceRef.current = -1;
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

      const hit = resolveAt(projectRef.current, frame);
      if (hit) {
        const svc = getDecodeService(hit.clip.assetId);
        if (svc) {
          const sourceSec = frameToSec(hit.sourceFrame, fps);
          // Keep the decoder running whenever the SOURCE is still continuous.
          // Splitting a clip changes its id but not the material, so restarting
          // on id alone would stall playback at every cut.
          if (
            !sessionRef.current ||
            !isContinuous(
              sessionAssetRef.current,
              lastSourceRef.current,
              hit.clip.assetId,
              hit.sourceFrame,
            )
          ) {
            sessionRef.current?.stop();
            sessionRef.current = svc.createPlaybackSession((e) => {
              console.error('playback decode error:', e);
              setStatus(
                '영상을 재생하는 중 문제가 생겨 멈췄어요. 다시 재생해 보세요.',
              );
              stopPlayback();
            });
            sessionRef.current.start(sourceSec);
            sessionAssetRef.current = hit.clip.assetId;
          }
          lastSourceRef.current = hit.sourceFrame;
          const vf = sessionRef.current?.frameFor(sourceSec) ?? null;
          if (vf) drawAndRelease(vf);
        }
      } else {
        // In a gap: show black, and forget the decoder's position so the clip on
        // the far side re-cues instead of being judged "continuous" across it.
        drawBlank();
        sessionRef.current?.stop();
        sessionRef.current = null;
        sessionAssetRef.current = null;
        lastSourceRef.current = -1;
      }

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
      <div className="panel-title">프리뷰</div>
      <div className="stage">
        <canvas ref={canvasRef} />
        {total > 0 && missingMedia && (
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
          onClick={() => (isPlaying ? stopPlayback() : startPlayback())}
          disabled={total === 0}
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
