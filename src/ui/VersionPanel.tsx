// framewright — autosave status + version history.
// The promise of this panel is that work is never lost: everything is saved
// automatically, any earlier state can be brought back, and the restore itself
// is undoable. So nothing here may be a one-click irreversible loss.
import { useRef, useState } from 'react';
import { useStore } from '../store/projectStore';
import { clipLength, videoTrack } from '../engine/timeline';
import type { Version } from '../engine/persistence';

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** A version is only useful if you can tell it apart from the others. */
function describe(v: Version): string {
  const clips = videoTrack(v.project).clips;
  if (clips.length === 0) return '빈 타임라인';
  const frames = clips.reduce((n, c) => n + clipLength(c), 0);
  const seconds = frames / (v.project.timeline.fps.num / v.project.timeline.fps.den);
  return `조각 ${clips.length}개 · ${seconds.toFixed(1)}초`;
}

export function VersionPanel() {
  const versions = useStore((s) => s.versions);
  const savedAt = useStore((s) => s.savedAt);
  const saveDisabledReason = useStore((s) => s.saveDisabledReason);
  const saveVersion = useStore((s) => s.saveVersion);
  const restoreVersion = useStore((s) => s.restoreVersion);
  const deleteVersion = useStore((s) => s.deleteVersion);
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const ordered = [...versions].sort((a, b) => b.ts - a.ts);

  function closeNaming() {
    setNaming(false);
    setLabel('');
    addButtonRef.current?.focus(); // never strand focus on <body>
  }

  function commitName() {
    saveVersion(label);
    closeNaming();
  }

  return (
    <section className="versions" aria-labelledby="versions-title">
      <h2 className="panel-title" id="versions-title">
        이전 상태
      </h2>

      {saveDisabledReason ? (
        <p className="save-warning" role="status">
          ⚠ {saveDisabledReason}
        </p>
      ) : (
        <div className="saved-line" role="status">
          {savedAt
            ? `자동 저장됨 · ${timeLabel(savedAt)}`
            : '편집하면 자동으로 저장돼요'}
        </div>
      )}

      {naming ? (
        <div className="name-row">
          <input
            autoFocus
            value={label}
            placeholder="예: 1차 편집 완료"
            aria-label="이 상태의 이름"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') closeNaming();
            }}
          />
          <button onClick={commitName}>저장</button>
        </div>
      ) : (
        <button
          className="wide"
          ref={addButtonRef}
          onClick={() => setNaming(true)}
        >
          ＋ 지금 상태 저장해두기
        </button>
      )}

      {ordered.length === 0 ? (
        <p className="empty-hint">
          편집을 시작하면 이전 상태가 여기에 쌓여요. 언제든 되돌아올 수 있어요.
        </p>
      ) : (
        <ul className="version-list">
          {ordered.map((v) => {
            const name = v.label ?? '자동 저장';
            const when = timeLabel(v.ts);
            return (
              <li key={v.id}>
                <div className="v-main">
                  <span className="v-label">{name}</span>
                  <span className="dim">{when}</span>
                </div>
                <div className="v-desc">{describe(v)}</div>
                {confirmingId === v.id ? (
                  <div className="v-actions">
                    <span className="dim">지울까요?</span>
                    <button
                      className="danger"
                      onClick={() => {
                        deleteVersion(v.id);
                        setConfirmingId(null);
                      }}
                    >
                      지우기
                    </button>
                    <button onClick={() => setConfirmingId(null)}>취소</button>
                  </div>
                ) : (
                  <div className="v-actions">
                    <button
                      aria-label={`${name} (${when}) 상태로 되돌아가기`}
                      onClick={() => restoreVersion(v.id)}
                    >
                      되돌아가기
                    </button>
                    <button
                      className="ghost"
                      aria-label={`${name} (${when}) 기록 지우기`}
                      onClick={() => setConfirmingId(v.id)}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
