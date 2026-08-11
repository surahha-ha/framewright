// framewright — edit toolbar.
// Buttons are DERIVED from the command registry: every command shows up here
// automatically, enabled/disabled by its own `canRun` (ADR-0003).
import { editor, useStore } from '../store/projectStore';
import { ExportButton } from './ExportButton';

export function Toolbar() {
  const run = useStore((s) => s.run);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  // subscribe so buttons re-evaluate canRun as the playhead/selection moves
  useStore((s) => s.playhead);
  useStore((s) => s.selectedClipId);
  useStore((s) => s.project);

  return (
    <div className="toolbar">
      {editor.commands().map((cmd) => (
        <button
          key={cmd.id}
          onClick={() => run(cmd.id)}
          disabled={!editor.canRun(cmd.id)}
          title={
            cmd.defaultKey ? `${cmd.label} (${cmd.defaultKey})` : cmd.label
          }
        >
          {cmd.icon} {cmd.label}
        </button>
      ))}
      <span className="sep" />
      <button onClick={undo} disabled={!canUndo} title="되돌리기 (Ctrl+Z)">
        ↩ 되돌리기
      </button>
      <button onClick={redo} disabled={!canRedo} title="다시 실행 (Ctrl+Shift+Z)">
        ↪ 다시
      </button>
      <span className="sep" />
      <ExportButton />
    </div>
  );
}
