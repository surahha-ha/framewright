// framewright — app shell / layout.
import { useEffect } from 'react';
import { useStore } from './store/projectStore';
import { retainOnly } from './engine/registry';
import { retainOnlyAudio } from './engine/audio';
import { MediaBin } from './ui/MediaBin';
import { Preview } from './ui/Preview';
import { Timeline } from './ui/Timeline';
import { Toolbar } from './ui/Toolbar';
import { useShortcuts } from './ui/useShortcuts';

/** Bump when shipping a change you need to confirm is actually loaded.
 *  Shown in the top bar — if it does not match, the dev server is serving a
 *  stale module graph (restart it and hard-reload). */
const BUILD = 'audio-fallback-3';

export default function App() {
  const status = useStore((s) => s.status);
  const assets = useStore((s) => s.project.assets);
  useShortcuts();

  // Free decode services (they pin the whole source in memory) for assets that
  // are no longer in the document — e.g. after undoing an import.
  useEffect(() => {
    const ids = assets.map((a) => a.id);
    retainOnly(ids);
    retainOnlyAudio(ids);
  }, [assets]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">framewright</span>
        <span className="tagline">web video editor</span>
        <span className="build" title="빌드 표식 — 예상과 다르면 개발서버가 옛 코드를 서빙 중입니다">
          {BUILD}
        </span>
      </header>
      <Toolbar />
      <main className="workspace">
        <MediaBin />
        <Preview />
      </main>
      <Timeline />
      <footer className="statusbar" role="status">
        {status}
      </footer>
    </div>
  );
}
