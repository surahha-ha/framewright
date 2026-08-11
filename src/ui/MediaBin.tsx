// framewright — media import (drag & drop / picker).
// Import goes through the editor so it is undoable and gets deterministic ids.
import { useRef, useState } from 'react';
import { editor, useStore } from '../store/projectStore';
import { demuxAudio, demuxVideo } from '../engine/demux';
import { framesForDuration, nearestStandardFps } from '../engine/time';
import { VideoDecodeService } from '../engine/decoder';
import { setDecodeService } from '../engine/registry';
import { decodeAudio, decodeAudioTrack, setAudioBuffer } from '../engine/audio';

export function MediaBin() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hot, setHot] = useState(false);
  const [audioReport, setAudioReport] = useState('');
  const project = useStore((s) => s.project);
  const sync = useStore((s) => s.sync);
  const setStatus = useStore((s) => s.setStatus);

  async function onFile(file: File) {
    setStatus(`읽는 중: ${file.name}`);
    try {
      // decodeAudioData detaches the buffer it is given, and the demuxer keeps
      // views into the file bytes — so audio gets its own copy.
      const audioBytes = await file.slice(0).arrayBuffer();
      const demux = await demuxVideo(file);
      const svc = new VideoDecodeService(demux);
      if (!(await svc.isSupported())) {
        setStatus(
          `이 영상 형식은 아직 열 수 없어요 (${demux.track.codec}). 다른 파일로 시도해 주세요.`,
        );
        return;
      }
      // The first import defines the sequence: its resolution and (rational)
      // frame rate become the timeline's, so nothing is stretched or re-timed.
      const isFirst = project.assets.length === 0;
      const sequence = {
        width: demux.track.width,
        height: demux.track.height,
        fps: nearestStandardFps(demux.nominalFps),
      };
      const fps = isFirst ? sequence.fps : project.timeline.fps;
      const durationFrames = framesForDuration(demux.track.durationSec, fps);
      const { assetId } = editor.importAsset(
        {
          kind: 'video',
          name: file.name,
          meta: {
            width: demux.track.width,
            height: demux.track.height,
            durationSec: demux.track.durationSec,
            codec: demux.track.codec,
          },
        },
        durationFrames,
        sequence,
      );
      setDecodeService(assetId, svc);

      // Try the quick path first; fall back to demux + WebCodecs, which handles
      // files decodeAudioData refuses. A silent video is fine — a silently
      // FAILED decode is not, so the reason is reported either way.
      let audio = await decodeAudio(audioBytes);
      const quickError = audio.error;
      let demuxNote = '';
      if (!audio.buffer) {
        const demuxedAudio = await demuxAudio(file);
        if (!demuxedAudio) {
          demuxNote = '컨테이너에 오디오 트랙 없음';
        } else {
          demuxNote = `트랙 ${demuxedAudio.track.codec} ${demuxedAudio.track.sampleRate}Hz ${demuxedAudio.track.channelCount}ch, 샘플 ${demuxedAudio.samples.length}, desc=${demuxedAudio.description ? demuxedAudio.description.length + 'B' : '없음'}`;
          audio = await decodeAudioTrack(demuxedAudio);
        }
      }
      if (audio.buffer) setAudioBuffer(assetId, audio.buffer);

      // Persist the diagnosis: the status line gets overwritten as soon as you
      // press play, which hid the real reason last time.
      const audioReport = audio.buffer
        ? `오디오 OK · ${audio.via} · ${audio.buffer.numberOfChannels}ch ${audio.buffer.sampleRate}Hz`
        : `오디오 실패 · decodeAudioData: ${quickError ?? '-'} · demux: ${demuxNote || '-'} · webcodecs: ${audio.error ?? '-'}`;
      setAudioReport(audioReport);
      // eslint-disable-next-line no-console
      console.log('[framewright] audio:', audioReport);

      sync();
      const audioNote = audio.buffer
        ? ` · 오디오 ${audio.buffer.numberOfChannels}ch`
        : ' · 오디오 없음';
      const warn = demux.complete
        ? ''
        : ' ⚠ 파일을 끝까지 읽지 못했어요 — 길이가 실제보다 짧을 수 있습니다.';
      setStatus(
        `${file.name} · ${demux.track.width}×${demux.track.height} · ` +
          `${demux.nominalFps.toFixed(2)}fps ${demux.isVFR ? '(가변 프레임 → 정규화 대상)' : ''} · ${durationFrames} frames` +
          audioNote +
          warn,
      );
    } catch (err) {
      setStatus(
        '영상을 여는 중 문제가 생겼어요: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
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
      <ul className="asset-list">
        {project.assets.map((a) => (
          <li key={a.id}>
            🎬 {a.name}
            <span className="dim">
              {a.meta.width}×{a.meta.height}
            </span>
          </li>
        ))}
      </ul>
      {audioReport && <div className="audio-report">{audioReport}</div>}
    </div>
  );
}
