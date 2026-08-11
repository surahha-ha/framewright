// framewright — single-track timeline: clips positioned by frame, playhead, selection.
import { useRef } from 'react';
import { useStore } from '../store/projectStore';
import { clipLength, timelineDuration, videoTrack } from '../engine/timeline';

export function Timeline() {
  const barRef = useRef<HTMLDivElement>(null);
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const seekTo = useStore((s) => s.seekTo);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const select = useStore((s) => s.select);

  const total = timelineDuration(project);
  const clips = videoTrack(project).clips;
  const assetName = (id: string) =>
    project.assets.find((a) => a.id === id)?.name ?? 'clip';

  // One scale for everything: x = frame / total. (Mixing /total and /(total-1)
  // makes the playhead drift away from the clip it is actually over.)
  function seekFromX(clientX: number) {
    const el = barRef.current;
    if (!el || total === 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    seekTo(Math.min(total - 1, Math.floor(ratio * total)));
  }

  const pct = (frames: number) => (total > 0 ? (frames / total) * 100 : 0);

  return (
    <div className="timeline">
      <div className="panel-title">타임라인</div>
      <div className="track-label">V1</div>
      <div
        className="track"
        ref={barRef}
        onMouseDown={(e) => seekFromX(e.clientX)}
      >
        {clips.map((c) => (
          <div
            key={c.id}
            className={'clip' + (c.id === selectedClipId ? ' selected' : '')}
            style={{
              left: pct(c.startFrame) + '%',
              width: pct(clipLength(c)) + '%',
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              select(c.id);
              seekFromX(e.clientX);
            }}
            title={`${assetName(c.assetId)} · ${clipLength(c)} frames`}
          >
            {assetName(c.assetId)}
          </div>
        ))}
        <div className="playhead" style={{ left: pct(playhead) + '%' }} />
      </div>
    </div>
  );
}
