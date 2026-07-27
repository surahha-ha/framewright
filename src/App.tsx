// framewright — app shell / layout.
import { useEffect } from 'react';
import { useStore } from './store/projectStore';
import { createProject } from './engine/project';
import { MediaBin } from './ui/MediaBin';
import { Preview } from './ui/Preview';
import { Timeline } from './ui/Timeline';

export default function App() {
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);
  const status = useStore((s) => s.status);

  useEffect(() => {
    if (!project) setProject(createProject());
  }, [project, setProject]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">framewright</span>
        <span className="tagline">web video editor · First Playable Loop</span>
      </header>
      <main className="workspace">
        <MediaBin />
        <Preview />
      </main>
      <Timeline />
      <footer className="statusbar">{status}</footer>
    </div>
  );
}
