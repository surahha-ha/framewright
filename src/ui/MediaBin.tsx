// framewright — media import (drag & drop / picker), and getting the media back
// after a reload.
// Import goes through the editor so it is undoable and gets deterministic ids.
import { useEffect, useRef, useState } from 'react';
import { editor, useStore } from '../store/projectStore';
import {
  framesForDuration,
  nearestStandardFps,
  secToFrame,
} from '../engine/time';
import { getDecodeService } from '../engine/registry';
import {
  liveMediaKeys,
  persistenceOutcome,
  queueMediaWork,
  takeEvictionNote,
} from '../engine/mediaStore';
import {
  bindMedia,
  mediaRepo,
  openSource,
  persistMedia,
  restoreSavedMedia,
  sweepStoredMedia,
  UnsupportedCodecError,
} from './media';

/** One sentence for one condition: the file could not be kept, so the next
 *  visit has to ask for it. Said the same way wherever it happens. */
const NOT_KEPT =
  ' 이 브라우저에는 영상을 보관할 수 없어서, 다음에 열 때 다시 선택해야 해요.';

export function MediaBin() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hot, setHot] = useState(false);
  const [audioReport, setAudioReport] = useState('');
  // In the store, not local state: the preview panel has to know too, or it
  // tells the user to go and find the file while the restore is doing it.
  const restoring = useStore((s) => s.mediaRestoring);
  const setRestoring = useStore((s) => s.setMediaRestoring);
  const project = useStore((s) => s.project);
  // Subscribing to this is the point: attaching media changes NOTHING in the
  // document, so without it the list below would keep saying "다시 선택 필요"
  // about a file that is already open.
  useStore((s) => s.mediaVersion);
  // Assets the document remembers but whose media is not loaded (after reload).
  const missingMedia = project.assets.filter((a) => !getDecodeService(a.id));
  const sync = useStore((s) => s.sync);
  const setStatus = useStore((s) => s.setStatus);
  const noteMediaAttached = useStore((s) => s.noteMediaAttached);

  // Bring back the media we kept last time. Before this existed, reopening the
  // editor showed a full timeline over a black picture and a list of files to
  // go and find again — the first thing anyone saw on their second visit.
  useEffect(() => {
    if (!restoring) {
      void sweep();
      return;
    }
    let live = true;
    void restoreSavedMedia(editor.project.assets, (name, index, count) => {
      // The status bar is the one place that announces. Several files reopen
      // one after another, so "still working" has to be distinguishable from
      // "stuck".
      if (live) {
        setStatus(
          count > 1
            ? `저장해 둔 영상을 여는 중이에요 (${index}/${count}): ${name}`
            : `저장해 둔 영상을 여는 중이에요: ${name}`,
        );
      }
    }).then((report) => {
      setRestoring(false);
      if (!live) return;
      if (report.audioReport) setAudioReport(report.audioReport);
      noteMediaAttached();
      if (report.restored.length > 0 && report.lost.length === 0) {
        setStatus('이전 작업을 그대로 불러왔어요. 영상도 준비됐어요.');
      } else if (report.restored.length > 0) {
        setStatus(
          `영상 ${report.restored.length}개를 불러왔어요 · ${report.lost.join(', ')} 은(는) 다시 선택해 주세요.`,
        );
      } else if (report.lost.length > 0) {
        setStatus(
          `저장해 둔 영상을 열지 못했어요 — ${report.lost.join(', ')} 을(를) 다시 선택해 주세요.`,
        );
      }
      void sweep();
    });
    return () => {
      live = false;
    };
    // Runs once: `restoring` starts true only when there is something to reopen,
    // and `restoreSavedMedia` is itself once-per-page-load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Reclaim space from files no clip and no saved version points at any more.
   *
   * Only at startup, deliberately. Undo history is not part of the saved state,
   * so mid-session it can still reach an asset the document has dropped —
   * sweeping then would delete the file out from under a redo. At startup there
   * is no history to contradict.
   */
  async function sweep() {
    if (!mediaRepo.available) return;
    const { versions } = useStore.getState();
    await sweepStoredMedia(liveMediaKeys(editor.project, versions));
  }

  function onFile(file: File): Promise<void> {
    // Import is an edit like any other, so it must respect the export guard —
    // otherwise the document changes under a render that already started.
    if (useStore.getState().isExporting) {
      setStatus('내보내는 중에는 불러올 수 없어요. 먼저 취소해 주세요.');
      return Promise.resolve();
    }
    setStatus(`읽는 중: ${file.name}`);
    // Queued behind any restore, sweep or earlier import. Inside the queue the
    // render closure's `project` may be a document ago, so every decision below
    // reads `editor.project` — the live one.
    return queueMediaWork(async () => {
      const doc = editor.project;
      try {
        // decodeAudioData detaches the buffer it is given, and the demuxer keeps
        // views into the file bytes — so audio gets its own copy.
        const audioBytes = await file.slice(0).arrayBuffer();

        // Opening comes first: an unsupported codec must change nothing and store
        // nothing, or the media store fills up with files that can never play.
        const source = await openSource(file);
        const { demux } = source;

        // Keep the file — before anything detaches those bytes, and before the
        // document changes, so a full disk costs nothing but the message.
        const opfsKey = await persistMedia(audioBytes);
        // Kept, but the browser would not promise to keep it. Read at the point
        // of use, not here: `takeEvictionNote` spends a once-per-page-load
        // chance, and an import that throws between here and the status line
        // would spend it on a message nobody saw.
        const evictable = () =>
          takeEvictionNote(!!opfsKey, persistenceOutcome());

        // If the file could not be kept (no OPFS, private window, no space), a
        // reload comes back without it. Picking the same file again re-links it
        // instead of adding a duplicate clip — otherwise reopening your work
        // would double it.
        const missing = doc.assets.find(
          (a) => a.name === file.name && !getDecodeService(a.id),
        );

        if (missing) {
          const media = await bindMedia(missing.id, source, file, audioBytes);
          setAudioReport(media.audioReport);
          // A project saved before ADR-0008 chose its cut points against a mapping
          // that was off by this source's offset. Re-linking silently moves the
          // picture under those cuts, so say it rather than let them find it.
          const shifted =
            demux.startOffsetSec > 0 &&
            missing.meta.startOffsetSec === undefined;
          const frames = secToFrame(demux.startOffsetSec, doc.timeline.fps);
          // Write down where the file went and what was corrected, so neither the
          // re-link nor this warning has to happen a third time.
          useStore.getState().run('asset.attachMedia', {
            assetId: missing.id,
            opfsKey: opfsKey ?? undefined,
            startOffsetSec: demux.startOffsetSec,
          });
          sync();
          // Nothing else in the document changed, so this is the only signal the
          // preview gets that it can stop drawing black.
          noteMediaAttached();
          setStatus(
            `${file.name} 을(를) 다시 연결했어요.` +
              (shifted
                ? ` ⚠ 이 영상은 시작 지점이 어긋나 있어 바로잡았어요 — 예전에 편집해 둔 자리가 ${frames}프레임만큼 달라 보일 수 있습니다.`
                : '') +
              (opfsKey ? evictable() : NOT_KEPT),
          );
          return;
        }

        // The first import defines the sequence: its resolution and (rational)
        // frame rate become the timeline's, so nothing is stretched or re-timed.
        const isFirst = doc.assets.length === 0;
        const sequence = {
          width: demux.track.width,
          height: demux.track.height,
          fps: nearestStandardFps(demux.nominalFps),
        };
        const fps = isFirst ? sequence.fps : doc.timeline.fps;
        const durationFrames = framesForDuration(demux.track.durationSec, fps);
        const { assetId } = editor.importAsset(
          {
            kind: 'video',
            name: file.name,
            ...(opfsKey ? { opfsKey } : {}),
            meta: {
              width: demux.track.width,
              height: demux.track.height,
              durationSec: demux.track.durationSec,
              codec: demux.track.codec,
              // Recorded so a later re-link can tell "imported with the offset
              // corrected" from "imported before that existed" (ADR-0008).
              startOffsetSec: demux.startOffsetSec,
            },
          },
          durationFrames,
          sequence,
        );
        const media = await bindMedia(assetId, source, file, audioBytes);
        setAudioReport(media.audioReport);

        sync();
        noteMediaAttached();
        const audioNote =
          media.audioChannels !== null
            ? ` · 오디오 ${media.audioChannels}ch`
            : ' · 오디오 없음';
        const warn = demux.complete
          ? ''
          : ' ⚠ 파일을 끝까지 읽지 못했어요 — 길이가 실제보다 짧을 수 있습니다.';
        const kept = opfsKey ? evictable() : ` ·${NOT_KEPT}`;
        setStatus(
          `${file.name} · ${demux.track.width}×${demux.track.height} · ` +
            `${demux.nominalFps.toFixed(2)}fps ${demux.isVFR ? '(가변 프레임 → 정규화 대상)' : ''} · ${durationFrames} frames` +
            audioNote +
            warn +
            kept,
        );
      } catch (err) {
        if (err instanceof UnsupportedCodecError) {
          setStatus(
            `이 영상 형식은 아직 열 수 없어요 (${err.codec}). 다른 파일로 시도해 주세요.`,
          );
          return;
        }
        setStatus(
          '영상을 여는 중 문제가 생겼어요: ' +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    });
  }

  return (
    <div className="bin">
      <div className="panel-title">미디어</div>
      <div
        className={'drop' + (hot ? ' hot' : '')}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setHot(true);
        }}
        onDragLeave={() => setHot(false)}
        onDrop={(e) => {
          e.preventDefault();
          setHot(false);
          const f = e.dataTransfer.files[0];
          if (f) void onFile(f);
        }}
      >
        영상 드래그
        <br />
        또는 클릭
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />
      {/* Not live regions. `.statusbar` is the one place that announces (the
          e2e DOM contract says so); a second and third voice describing the
          same event in different words is noise, and during a restore two of
          them used to say opposite things. */}
      {restoring && (
        <div className="relink">저장해 둔 영상을 다시 여는 중이에요…</div>
      )}
      {!restoring && missingMedia.length > 0 && (
        // No list of names here: the asset list directly below already shows
        // every one of them, with ⚠ and "다시 선택 필요". The same filename
        // printed twice, 20px apart, reads as two separate problems.
        <div className="relink">
          아래 ⚠ 표시된 영상을 다시 선택하면 그대로 이어서 편집할 수 있어요.
        </div>
      )}
      <ul className="asset-list">
        {project.assets.map((a) => (
          <li key={a.id} className={getDecodeService(a.id) ? '' : 'missing'}>
            {getDecodeService(a.id) ? '🎬' : '⚠'} {a.name}
            <span className="dim">
              {getDecodeService(a.id)
                ? `${a.meta.width}×${a.meta.height}`
                : restoring
                  ? '여는 중…'
                  : '다시 선택 필요'}
            </span>
          </li>
        ))}
      </ul>
      {audioReport && <div className="audio-report">{audioReport}</div>}
    </div>
  );
}
