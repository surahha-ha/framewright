// framewright — export control: progress, cancel, download.
import { useRef, useState } from 'react';
import { useStore } from '../store/projectStore';
import { getDecodeService } from '../engine/registry';
import { exportProject, ExportUnsupportedError } from '../engine/exporter';
import { videoDuration } from '../engine/timeline';

export function ExportButton() {
  const project = useStore((s) => s.project);
  const setStatus = useStore((s) => s.setStatus);
  const [progress, setProgress] = useState<number | null>(null);
  const [phase, setPhase] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);

  const setExporting = useStore((s) => s.setExporting);
  const total = videoDuration(project);
  const busy = progress !== null;
  // Exporting with unloaded media would hand the user a black video after a
  // convincing progress bar. Refuse up front instead.
  const missingMedia = project.assets.filter((a) => !getDecodeService(a.id));
  const blocked = total === 0 || missingMedia.length > 0;

  async function onExport() {
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress(0);
    setExporting(true);
    setStatus('내보내는 중…');
    try {
      const result = await exportProject(project, getDecodeService, {
        signal: controller.signal,
        onProgress: (done, all, p) => {
          setProgress(Math.round((done / all) * 100));
          if (p)
            setPhase(
              p === 'finalizing'
                ? '마무리 중'
                : p === 'audio'
                  ? '오디오 처리 중'
                  : '',
            );
        },
      });
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name || 'framewright'}.mp4`;
      a.style.display = 'none';
      document.body.appendChild(a); // Firefox needs the anchor in the document
      a.click();
      a.remove();
      // Revoking in the same task can race the download for large blobs.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const warn =
        result.missingFrames > 0
          ? ` ⚠ ${result.missingFrames}프레임은 원본을 읽지 못해 검은 화면으로 채웠어요.`
          : '';
      setStatus(
        `내보내기 완료 · ${result.frames} frames · ${result.durationSec.toFixed(2)}s` +
          (result.hasAudio ? ' · 오디오 포함' : ' · 무음') +
          warn,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus('내보내기를 취소했어요.');
      } else if (err instanceof ExportUnsupportedError) {
        setStatus(err.message);
      } else {
        setStatus(
          '내보내는 중 문제가 생겼어요: ' +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    } finally {
      setProgress(null);
      setPhase('');
      setExporting(false);
      abortRef.current = null;
    }
  }

  // One stable container: swapping the button out entirely dropped focus to
  // <body> mid-export, which made 취소 unreachable by keyboard.
  return (
    <span className="export-slot">
      {busy ? (
        <>
          <progress
            value={progress ?? 0}
            max={100}
            aria-label="내보내기 진행률"
          />
          <span className="dim" role="status" aria-live="polite">
            {progress}% {phase}
          </span>
          <button autoFocus onClick={() => abortRef.current?.abort()}>
            취소
          </button>
        </>
      ) : (
        <button
          onClick={onExport}
          disabled={blocked}
          title={
            missingMedia.length > 0
              ? '영상 파일을 다시 선택한 뒤 내보낼 수 있어요'
              : 'MP4로 내보내기'
          }
        >
          ⬇ 내보내기
        </button>
      )}
    </span>
  );
}
