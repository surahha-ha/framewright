// framewright — app shell / layout.
import { useEffect } from 'react';
import { useStore } from './store/projectStore';
import { retainOnly } from './engine/registry';
import { retainOnlyAudio } from './engine/audio';
import { retainOnlyThumbnails } from './ui/thumbnails';
import { retainOnlyPeaks } from './ui/waveform';
import { CommandPalette } from './ui/CommandPalette';
import { MediaBin } from './ui/MediaBin';
import { ShortcutsPanel } from './ui/ShortcutsPanel';
import { Preview } from './ui/Preview';
import { SubtitlePanel } from './ui/SubtitlePanel';
import { Timeline } from './ui/Timeline';
import { Toolbar } from './ui/Toolbar';
import { VersionPanel } from './ui/VersionPanel';
import { useShortcuts } from './ui/useShortcuts';

/** Bump when shipping a change you need to confirm is actually loaded.
 *  Shown in the top bar — if it does not match, the dev server is serving a
 *  stale module graph (restart it and hard-reload). */
const BUILD = 'versions-1';

export default function App() {
  const status = useStore((s) => s.status);
  const assets = useStore((s) => s.project.assets);
  const overlay = useStore((s) => s.overlay);
  useShortcuts();

  // Free decode services (they pin the whole source in memory) for assets that
  // are no longer in the document — e.g. after undoing an import.
  useEffect(() => {
    const ids = assets.map((a) => a.id);
    retainOnly(ids);
    retainOnlyAudio(ids);
    // Same reason, different resource: a cached thumbnail is an `ImageBitmap`,
    // which holds memory the collector is in no hurry to release.
    retainOnlyThumbnails(ids);
    // And the waveform's peaks, which are a few megabytes of Float32Array for a
    // long source and are held by asset id like everything else here.
    retainOnlyPeaks(ids);
  }, [assets]);

  const modal = overlay !== 'none';

  return (
    <>
      {/* `aria-modal` alone does not reliably stop a screen reader's browse mode
          from walking the page behind a dialog, so the editor itself is hidden
          from the accessibility tree while one is open. The dialogs are siblings
          of this element, not children, so focus never sits inside the hidden
          subtree. */}
      <div className="app" aria-hidden={modal || undefined}>
        <header className="topbar">
          <span className="brand">framewright</span>
          <span className="tagline">web video editor</span>
          {import.meta.env.DEV && (
            <span
              className="build"
              title="빌드 표식(개발용) — 예상과 다르면 개발서버가 옛 코드를 서빙 중입니다"
            >
              {BUILD}
            </span>
          )}
        </header>
        <Toolbar />
        <main className="workspace">
          <div className="sidebar">
            <MediaBin />
            <SubtitlePanel />
            <VersionPanel />
          </div>
          <Preview />
        </main>
        <Timeline />
        <footer className="statusbar" role="status">
          {status}
        </footer>
      </div>
      {/* Mounted only while open, so each opening starts clean and the closing
          one can hand focus back to whatever the user was on. */}
      {overlay === 'palette' && <CommandPalette />}
      {overlay === 'shortcuts' && <ShortcutsPanel />}
    </>
  );
}
