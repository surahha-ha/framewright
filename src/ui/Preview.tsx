// framewright — preview player.
//   - SCRUB: single-flight, latest-wins decodeAtSec (drops stale frames).
//   - PLAYBACK: a streaming PlaybackSession decodes forward once; a rAF loop
//     pulls the frame matching the clock and draws it (smooth, no re-seek storm).
import { useEffect, useRef } from 'react';
import { useStore } from '../store/projectStore';
import { getDecodeService } from '../engine/registry';
import { frameToSec, secToFrame, formatTimecode } from '../engine/time';
import type { PlaybackSession } from '../engine/playbackSession';

function useTotalFrames(): number {
  const project = useStore((s) => s.project);
  const vtrack = project?.tracks.find((t) => t.type === 'video');
  return vtrack?.clips[0]?.outFrame ?? 0;
}

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pendingSecRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const sessionRef = useRef<PlaybackSession | null>(null);
  const rafRef = useRef(0);

  const project = useStore((s) => s.project);
  const currentFrame = useStore((s) => s.currentFrame);
  const setCurrentFrame = useStore((s) => s.setCurrentFrame);
  const isPlaying = useStore((s) => s.isPlaying);
  const setPlaying = useStore((s) => s.setPlaying);
  const totalFrames = useTotalFrames();
  const fps = project?.timeline.fps ?? { num: 30, den: 1 };

  function drawFrame(frame: VideoFrame) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (
      canvas.width !== frame.displayWidth ||
      canvas.height !== frame.displayHeight
    ) {
      canvas.width = frame.displayWidth;
      canvas.height = frame.displayHeight;
    }
    ctx.drawImage(frame, 0, 0);
  }

  // ---- SCRUB path (single-flight) ----
  async function pump() {
    if (busyRef.current) return;
    const svc = getDecodeService();
    const canvas = canvasRef.current;
    if (!svc || !canvas) {
      pendingSecRef.current = null;
      return;
    }
    busyRef.current = true;
    try {
      while (pendingSecRef.current !== null) {
        const sec = pendingSecRef.current;
        pendingSecRef.current = null;
        let frame: VideoFrame | null = null;
        try {
          frame = await svc.decodeAtSec(sec);
        } catch {
          frame = null;
        }
        if (!frame) continue;
        drawFrame(frame);
        frame.close();
      }
    } finally {
      busyRef.current = false;
    }
  }
  function requestDraw(sec: number) {
    pendingSecRef.current = sec;
    void pump();
  }

  // Redraw on scrub / playhead move — but NOT during playback (loop owns drawing).
  useEffect(() => {
    if (!project || isPlaying) return;
    requestDraw(frameToSec(currentFrame, fps));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFrame, project, isPlaying]);

  // Clean up any running session on unmount.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  function stopPlayback() {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    sessionRef.current?.stop();
    sessionRef.current = null;
    setPlaying(false);
  }

  function startPlayback() {
    const svc = getDecodeService();
    if (!svc || totalFrames === 0) return;
    const startFrame = currentFrame >= totalFrames - 1 ? 0 : currentFrame;
    const startSec = frameToSec(startFrame, fps);
    const session = svc.createPlaybackSession((e) => {
      // eslint-disable-next-line no-console
      console.error('playback decode error:', e);
      stopPlayback();
    });
    session.start(startSec);
    sessionRef.current = session;
    setPlaying(true);

    const startWall = performance.now();
    const loop = () => {
      const sess = sessionRef.current;
      if (!sess) return;
      const sec = startSec + (performance.now() - startWall) / 1000;
      const frame = sess.frameFor(sec);
      if (frame) {
        drawFrame(frame);
        frame.close();
      }
      const cf = Math.min(secToFrame(sec, fps), totalFrames - 1);
      setCurrentFrame(cf);
      if (cf >= totalFrames - 1 || sess.finished) {
        stopPlayback();
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  function togglePlay() {
    if (!project || totalFrames === 0) return;
    if (isPlaying) stopPlayback();
    else startPlayback();
  }

  return (
    <div className="preview">
      <div className="panel-title">프리뷰</div>
      <div className="stage">
        <canvas ref={canvasRef} />
      </div>
      <div className="transport">
        <button onClick={togglePlay} disabled={totalFrames === 0}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <span className="tc">{formatTimecode(currentFrame, fps)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, totalFrames - 1)}
          value={currentFrame}
          onChange={(e) => setCurrentFrame(Number(e.target.value))}
        />
        <span className="dim">
          {currentFrame} / {Math.max(0, totalFrames - 1)}
        </span>
      </div>
    </div>
  );
}
