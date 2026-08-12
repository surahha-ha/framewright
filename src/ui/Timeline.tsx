// framewright — single-track timeline: clips positioned by frame, playhead, selection.
// Clips are real buttons and the ruler is a real slider, so everything here can
// be reached and operated without a mouse (docs/UX.md).
import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useStore } from '../store/projectStore';
import { clipLength, timelineDuration, videoTrack } from '../engine/timeline';
import { formatTimecode } from '../engine/time';

export function Timeline() {
  const barRef = useRef<HTMLDivElement>(null);
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const seekTo = useStore((s) => s.seekTo);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const select = useStore((s) => s.select);

  const total = timelineDuration(project);
  const clips = videoTrack(project).clips;
  const fps = project.timeline.fps;
  const assetName = (id: string) =>
    project.assets.find((a) => a.id === id)?.name ?? '클립';

  // One scale for everything: x = frame / total. (Mixing /total and /(total-1)
  // makes the playhead drift away from the clip it is actually over.)
  function seekFromX(clientX: number) {
    const el = barRef.current;
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

  const pct = (frames: number) => (total > 0 ? (frames / total) * 100 : 0);

  return (
    <section className="timeline" aria-labelledby="timeline-title">
      <h2 className="panel-title" id="timeline-title">
        타임라인
      </h2>
      <div className="track-label">영상</div>
      <div
        className="track"
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label="재생 위치 (좌우 화살표로 이동)"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, total - 1)}
        aria-valuenow={playhead}
        aria-valuetext={`${formatTimecode(playhead, fps)}, 클립 ${clips.length}개`}
        onKeyDown={onRulerKey}
        onMouseDown={(e) => seekFromX(e.clientX)}
      >
        {clips.map((c, i) => {
          const selected = c.id === selectedClipId;
          return (
            <button
              key={c.id}
              type="button"
              className={'clip' + (selected ? ' selected' : '')}
              style={{
                left: pct(c.startFrame) + '%',
                width: pct(clipLength(c)) + '%',
              }}
              aria-pressed={selected}
              aria-label={`클립 ${i + 1}, ${assetName(c.assetId)}, ${formatTimecode(
                c.startFrame,
                fps,
              )}부터 ${clipLength(c)}프레임${selected ? ', 선택됨' : ''}`}
              onMouseDown={(e) => {
                e.stopPropagation();
                select(c.id);
                seekFromX(e.clientX);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  select(c.id);
                  seekTo(c.startFrame);
                }
              }}
            >
              <span className="clip-mark" aria-hidden="true">
                {selected ? '◉' : '◎'}
              </span>
              <span className="clip-name">{assetName(c.assetId)}</span>
            </button>
          );
        })}
        <div className="playhead" style={{ left: pct(playhead) + '%' }} />
      </div>
      <p className="track-hint">
        클립을 클릭하거나 <kbd>Tab</kbd>으로 선택한 뒤 <kbd>Delete</kbd>로 지울 수
        있어요.
      </p>
    </section>
  );
}
