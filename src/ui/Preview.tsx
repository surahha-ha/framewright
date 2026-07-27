// framewright — preview player (canvas render + transport).
import { useEffect, useRef } from 'react';
import { useStore } from '../store/projectStore';
import { getDecodeService } from '../engine/registry';
import { frameToSec, formatTimecode } from '../engine/time';
import { Player } from '../engine/player';

function useTotalFrames(): number {
  const project = useStore((s) => s.project);
  const vtrack = project?.tracks.find((t) => t.type === 'video');
  return vtrack?.clips[0]?.outFrame ?? 0;
}

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | null>(null);
  const project = useStore((s) => s.project);
  const currentFrame = useStore((s) => s.currentFrame);
  const setCurrentFrame = useStore((s) => s.setCurrentFrame);
  const isPlaying = useStore((s) => s.isPlaying);
  const setPlaying = useStore((s) => s.setPlaying);
  const totalFrames = useTotalFrames();

  // Draw the frame at currentFrame whenever it changes.
  useEffect(() => {
    let cancelled = false;
    const svc = getDecodeService();
    const canvas = canvasRef.current;
    if (!svc || !canvas || !project) return;
    const sec = frameToSec(currentFrame, project.timeline.fps);
    svc
      .decodeAtSec(sec)
      .then((frame) => {
        if (!frame) return;
        if (cancelled) {
          frame.close();
          return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          frame.close();
          return;
        }
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
        ctx.drawImage(frame, 0, 0);
        frame.close();
      })
      .catch(() => {
        /* ignore transient decode errors during scrub */
      });
    return () => {
      cancelled = true;
    };
  }, [currentFrame, project]);

  function togglePlay() {
    if (!project || totalFrames === 0) return;
    if (isPlaying) {
      playerRef.current?.pause();
      setPlaying(false);
      return;
    }
    const p = new Player(
      project.timeline.fps,
      totalFrames,
      (f) => setCurrentFrame(f),
      () => setPlaying(false),
    );
    playerRef.current = p;
    setPlaying(true);
    p.play(currentFrame >= totalFrames - 1 ? 0 : currentFrame);
  }

  const fps = project?.timeline.fps ?? { num: 30, den: 1 };

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
