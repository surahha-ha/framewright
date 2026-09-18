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
// The row's button IS this command, so it wears the command's own label — a
// second spelling of a name is a second name (docs/UX.md).
import { addImageCommand } from '../engine/imageCommands';
import {
  liveMediaKeys,
  persistenceOutcome,
  queueMediaWork,
  takeEvictionNote,
} from '../engine/mediaStore';
import { videoDuration } from '../engine/timeline';
import {
  bindMedia,
  dropInvitation,
  imageToRelink,
  isMediaReady,
  markMediaHeld,
  mediaRepo,
  openSource,
  persistMedia,
  restoreSavedMedia,
  sweepStoredMedia,
  UnsupportedCodecError,
} from './media';
import { importImageFile } from './images';
import { whyNot } from './actions';

/** One sentence for one condition: the file could not be kept, so the next
 *  visit has to ask for it. Said the same way wherever it happens.
 *
 *  파일, not 영상: this is about what the BROWSER will hold, and it holds
 *  pictures and footage the same way. */
const NOT_KEPT =
  ' 이 브라우저에는 파일을 보관할 수 없어서, 다음에 열 때 다시 선택해야 해요.';

/** The file the user picked is not a picture — said only after a decoder has
 *  actually refused the bytes, never from a name or a media type. */
const NOT_A_PICTURE =
  '이 파일은 이미지로 열 수 없어요. 다른 파일로 시도해 주세요.';

/**
 * Which half of the import a file goes down.
 *
 * The media type, because that is what the picker's `accept` filters on and
 * what a drop hands over. It is a claim, not a fact — only a decoder can say
 * whether bytes are a picture, and that is exactly what the picture path does
 * next, with its own sentence for when the claim was wrong. A file with no
 * type at all takes the footage path, which is where the sentences about
 * containers and codecs live.
 */
function isPicture(file: File): boolean {
  return file.type.startsWith('image/');
}

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
  // Through `isMediaReady`, not the decode registry: a picture never gets a
  // decoder, so asking the registry called every restored one lost for ever.
  const missingMedia = project.assets.filter((a) => !isMediaReady(a));
  // Subscribed for the same reason as `mediaVersion` above, and used the same
  // way — not at all, directly. Whether a picture can go where the playhead is
  // is the row button's whole state, so a playhead that moves with the bin on
  // screen has to re-render it.
  useStore((s) => s.playhead);
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
        // 파일, not 영상: what comes back out of storage is footage AND
        // pictures, and the report that drives these sentences carries names
        // only — it cannot tell one kind from the other, and neither can a
        // sentence built from it.
        setStatus(
          count > 1
            ? `저장해 둔 파일을 여는 중이에요 (${index}/${count}): ${name}`
            : `저장해 둔 파일을 여는 중이에요: ${name}`,
        );
      }
    }).then((report) => {
      setRestoring(false);
      if (!live) return;
      if (report.audioReport) setAudioReport(report.audioReport);
      noteMediaAttached();
      if (report.restored.length > 0 && report.lost.length === 0) {
        setStatus('이전 작업을 그대로 불러왔어요. 파일도 준비됐어요.');
      } else if (report.restored.length > 0) {
        setStatus(
          `파일 ${report.restored.length}개를 불러왔어요 · ${report.lost.join(', ')} 은(는) 다시 선택해 주세요.`,
        );
      } else if (report.lost.length > 0) {
        setStatus(
          `저장해 둔 파일을 열지 못했어요 — ${report.lost.join(', ')} 을(를) 다시 선택해 주세요.`,
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

  /**
   * Bring a picture in: open it, keep the file, put it at the playhead.
   *
   * Runs inside the media queue, like the footage path around it, and in the
   * order that path established — **open before store**, so a file that turns
   * out not to be a picture leaves nothing behind in the media store.
   *
   * It says nothing about where the picture went: `image.import` is one
   * command for the asset AND the placement (one Ctrl+Z takes back both), and
   * it has its own sentence. The only thing added here is what the command
   * cannot know — whether the browser kept the file.
   *
   * Two things can happen to the picture that comes out of the file: it is
   * imported, or it is given to a picture already in the document whose own
   * file is gone (a re-link, by name, like footage). The re-link is not an
   * import and has no placement, so that branch does say its own sentence.
   */
  async function onPicture(file: File): Promise<void> {
    const bytes = await file.slice(0).arrayBuffer();
    const { opened } = await importImageFile(
      file,
      async ({ width, height }) => {
        // The same file again, for a picture whose own file is gone: re-link
        // it rather than import a second copy, which is what footage has done
        // since the first reload. Without this an image that lost its file was
        // a dead end — the bin said 다시 선택 필요 and nothing the user could
        // do acted on it.
        //
        // Asked BEFORE the bytes are stored, which is that function's one
        // rule: storing them is exactly what makes `isMediaReady` true for a
        // picture, so a file re-picked for a missing asset would read as ready
        // the moment it was kept, and the import path below would add a second
        // copy of a picture that is already in the document.
        const missing = imageToRelink(editor.project.assets, file.name);
        // Kept BEFORE the document is asked, although a refusal then leaves
        // bytes nothing points at: storing is slow, and asking first would put
        // an await between "there is room at the playhead" and the edit that
        // uses the answer — the playhead can move in that window and the edit
        // would fail with nothing to say. The startup sweep reclaims a file no
        // asset names; a refusal that says nothing is not reclaimed by anything.
        const opfsKey = await persistMedia(bytes);
        if (missing) {
          // A picture needs none of the footage re-link's machinery — no
          // container to demux, no decoder to register, no offset to correct.
          // The bytes are in the store now, which is the whole of what
          // `isMediaReady` asks about, and the command writes down where they
          // went. The picture decoded a moment ago is cached for this asset by
          // `importImageFile`, against the key this command has just written.
          //
          // Nothing stored means the picture in hand is the only copy there
          // is — the import's case, reached the same way by a re-link in a
          // browser that will not keep files.
          if (!opfsKey) markMediaHeld(missing.id);
          // The file matched by name; its shape may differ, and the picture's
          // size on the stage follows the recorded shape (ADR-0014) — as does
          // the size this row prints.
          useStore.getState().run('asset.attachMedia', {
            assetId: missing.id,
            opfsKey: opfsKey ?? undefined,
            width,
            height,
          });
          sync();
          noteMediaAttached();
          // The same sentence footage gets, for the same event. There is no
          // offset warning to add: nothing was re-timed.
          setStatus(
            `${file.name} 을(를) 다시 연결했어요.` +
              (opfsKey
                ? takeEvictionNote(true, persistenceOutcome())
                : NOT_KEPT),
          );
          return missing.id;
        }
        const args = {
          name: file.name,
          ...(opfsKey ? { opfsKey } : {}),
          width,
          height,
        };
        // Asked before it is run, so a refusal can say why. A command dispatched
        // and rejected says nothing at all, and silence reads as broken.
        if (!editor.canRun('image.import', args)) {
          setStatus(whyNot('image.import'));
          return null;
        }
        // The command mints the asset's id from the document counter; asking the
        // document which id is new is how that stays the counter's business.
        const before = new Set(editor.project.assets.map((a) => a.id));
        if (!useStore.getState().run('image.import', args)) return null;
        const assetId =
          editor.project.assets.find((a) => !before.has(a.id))?.id ?? null;
        if (assetId === null) return null;
        // Nothing was stored, so nothing can be read back: the picture the
        // import is about to keep is the only copy there is, and this is what
        // stops the bin and the export calling it a missing file.
        if (!opfsKey) markMediaHeld(assetId);
        sync();
        noteMediaAttached();
        // Appended to the command's own sentence rather than replacing it — the
        // placement is the command's to describe, the storage is not.
        const kept = opfsKey
          ? takeEvictionNote(true, persistenceOutcome())
          : NOT_KEPT;
        if (kept) setStatus(useStore.getState().status + kept);
        return assetId;
      },
    );
    if (!opened) setStatus(NOT_A_PICTURE);
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
        // A picture takes none of what follows. It has no container to demux,
        // no decoder to register and no audio track, and `openSource` on a PNG
        // reports it as a video whose codec cannot be played — the wrong
        // sentence about the wrong thing. So the branch is here, before the
        // first byte is copied for audio.
        if (isPicture(file)) {
          await onPicture(file);
          return;
        }
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
        // Footage only, and asked of the decode registry rather than of
        // `isMediaReady`: what is being re-linked here is a decoder, and a
        // picture of the same name has neither one nor any use for this path
        // — it re-links by name too, in `onPicture`, where the answer is the
        // stored bytes rather than a decoder.
        const missing = doc.assets.find(
          (a) =>
            a.kind !== 'image' &&
            a.name === file.name &&
            !getDecodeService(a.id),
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
            // The file matched by name; its shape may differ, and the
            // picture's pan limits follow the recorded shape (ADR-0014).
            width: demux.track.width,
            height: demux.track.height,
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
        // What went wrong is the same either way; WHAT the user handed over is
        // not, and a picture told "영상을 여는 중" would look for a mistake it
        // did not make.
        const detail = err instanceof Error ? err.message : String(err);
        setStatus(
          isPicture(file)
            ? `이미지를 여는 중 문제가 생겼어요: ${detail}`
            : `영상을 여는 중 문제가 생겼어요: ${detail}`,
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
        {/* What the bin can actually take right now. A picture cannot be the
            first thing in a project, so offering one before there is any
            footage is an invitation the app refuses — and the refused file
            leaves no trace to come back to. */}
        {dropInvitation(videoDuration(project) > 0)}
        <br />
        또는 클릭
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*,image/*"
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
        <div className="relink">저장해 둔 파일을 다시 여는 중이에요…</div>
      )}
      {!restoring && missingMedia.length > 0 && (
        // No list of names here: the asset list directly below already shows
        // every one of them, with ⚠ and "다시 선택 필요". The same filename
        // printed twice, 20px apart, reads as two separate problems.
        <div className="relink">
          아래 ⚠ 표시된 파일을 다시 선택하면 그대로 이어서 편집할 수 있어요.
        </div>
      )}
      <ul className="asset-list">
        {project.assets.map((a) => {
          const ready = isMediaReady(a);
          const picture = a.kind === 'image';
          // The kind in WORDS, in every state. The glyph next to the name is
          // aria-hidden — a screen reader reading 🖼 says "framed picture",
          // which is a description of the emoji and not of the row — so this
          // is the only thing that tells a picture from footage out loud.
          const kind = picture ? '이미지' : '영상';
          // Whether it can go on the timeline where the playhead is. Most of
          // the answer is the command's (`image.add`), asked per row because
          // the refusal that matters — 이 자리에는 이미 이미지가 있어요 — is
          // about the playhead. The command cannot ask the other half: a
          // picture whose file is gone would go on the timeline quite legally
          // and draw nothing, so the bin, which is where the file's state
          // lives, refuses that here and says which file to go and find.
          const canPlace =
            picture && ready && editor.canRun('image.add', { assetId: a.id });
          const whyNotPlace = ready
            ? whyNot('image.add')
            : `${a.name} 파일을 다시 선택한 뒤 넣을 수 있어요.`;
          return (
            <li key={a.id} className={ready ? '' : 'missing'}>
              <span className="asset-name">
                <span aria-hidden="true">
                  {ready ? (picture ? '🖼' : '🎬') : '⚠'}
                </span>{' '}
                {a.name}
              </span>
              <span className="dim">
                {kind} ·{' '}
                {ready
                  ? `${a.meta.width}×${a.meta.height}`
                  : restoring
                    ? '여는 중…'
                    : '다시 선택 필요'}
              </span>
              {picture && (
                // `CommandButton` cannot carry this one: its `canRun` and
                // `perform` take an id and no args, and this command is told
                // WHICH picture. So the four steps it packages are followed by
                // hand — ask `canRun`, put the name in `title`, dispatch, and
                // stay in the tab order with `aria-disabled` so the reason for
                // a refusal is reachable and said out loud on a click. The
                // accessible name is the file's, then the command's own label:
                // every picture in the bin carries this button, and "재생
                // 위치에 넣기" alone cannot say which one it means.
                <button
                  type="button"
                  aria-disabled={!canPlace}
                  aria-label={`${a.name} ${addImageCommand.label}`}
                  title={canPlace ? addImageCommand.label : whyNotPlace}
                  onClick={() => {
                    if (!canPlace) return setStatus(whyNotPlace);
                    useStore.getState().run('image.add', { assetId: a.id });
                  }}
                >
                  {addImageCommand.label}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {audioReport && <div className="audio-report">{audioReport}</div>}
    </div>
  );
}
