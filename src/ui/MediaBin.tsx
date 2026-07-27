// framewright — media import (drag & drop / picker).
import { useRef, useState } from 'react';
import { useStore } from '../store/projectStore';
import { demuxVideo } from '../engine/demux';
import { framesForDuration } from '../engine/time';
import { VideoDecodeService } from '../engine/decoder';
import { setDecodeService } from '../engine/registry';
import type { Asset } from '../engine/types';

export function MediaBin() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hot, setHot] = useState(false);
  const project = useStore((s) => s.project);
  const addVideoAsset = useStore((s) => s.addVideoAsset);
  const setCurrentFrame = useStore((s) => s.setCurrentFrame);
  const setStatus = useStore((s) => s.setStatus);

  async function onFile(file: File) {
    if (!project) return;
    setStatus(`디먹스 중: ${file.name}`);
    try {
      const demux = await demuxVideo(file);
      const svc = new VideoDecodeService(demux);
      const supported = await svc.isSupported();
      if (!supported) {
        setStatus(
          `⚠️ ${demux.track.codec} 는 native 디코드 미지원 (ffmpeg 폴백 필요). 파일: ${file.name}`,
        );
        return;
      }
      setDecodeService(svc);
      const fps = project.timeline.fps;
      const durationFrames = framesForDuration(demux.track.durationSec, fps);
      const asset: Asset = {
        id: 'asset_' + Math.round(performance.now()),
        kind: 'video',
        name: file.name,
        meta: {
          width: demux.track.width,
          height: demux.track.height,
          durationSec: demux.track.durationSec,
          codec: demux.track.codec,
        },
      };
      addVideoAsset(asset, durationFrames);
      setCurrentFrame(0);
      setStatus(
        `로드됨: ${file.name} · ${demux.track.width}×${demux.track.height} · ` +
          `${demux.nominalFps.toFixed(2)}fps ${demux.isVFR ? '(VFR → conform 대상)' : '(CFR)'} · ${durationFrames} frames`,
      );
    } catch (err) {
      setStatus('오류: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  return (
    <div className="bin">
      <div className="panel-title">미디어</div>
      <div
        className={'drop' + (hot ? ' hot' : '')}
        onClick={() => inputRef.current?.click()}
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
        영상 드래그<br />또는 클릭
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
        {project?.assets.map((a) => (
          <li key={a.id}>
            🎬 {a.name}
            <span className="dim">
              {a.meta.width}×{a.meta.height}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
