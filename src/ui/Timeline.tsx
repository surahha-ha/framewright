// framewright — minimal single-track timeline with a clickable playhead.
import { useRef } from 'react';
import { useStore } from '../store/projectStore';

export function Timeline() {
  const barRef = useRef<HTMLDivElement>(null);
  const project = useStore((s) => s.project);
  const currentFrame = useStore((s) => s.currentFrame);
  const setCurrentFrame = useStore((s) => s.setCurrentFrame);

  const vtrack = project?.tracks.find((t) => t.type === 'video');
  const clip = vtrack?.clips[0];
  const total = clip?.outFrame ?? 0;

  function seekFromX(clientX: number) {
    const el = barRef.current;
    if (!el || total === 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setCurrentFrame(Math.round(ratio * (total - 1)));
  }

  const playheadPct = total > 1 ? (currentFrame / (total - 1)) * 100 : 0;

  return (
    <div className="timeline">
      <div className="panel-title">타임라인</div>
      <div className="track-label">V1</div>
      <div
        className="track"
        ref={barRef}
        onMouseDown={(e) => seekFromX(e.clientX)}
      >
        {clip && (
          <div className="clip" title={clip.assetId}>
            {project?.assets[0]?.name ?? 'clip'}
          </div>
        )}
        <div className="playhead" style={{ left: playheadPct + '%' }} />
      </div>
    </div>
  );
}
