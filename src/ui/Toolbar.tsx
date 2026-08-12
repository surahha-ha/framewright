// framewright — edit toolbar.
// Buttons are DERIVED from the command registry: every command shows up here
// automatically, enabled/disabled by its own `canRun` (ADR-0003).
//
// Unavailable commands are `aria-disabled`, not `disabled`. A natively disabled
// button leaves the tab order entirely, so a keyboard user never discovers the
// control exists — and never hears why it is waiting.
import { editor, useStore } from '../store/projectStore';
import { ExportButton } from './ExportButton';

export function Toolbar() {
  const run = useStore((s) => s.run);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const setStatus = useStore((s) => s.setStatus);
  // subscribe so buttons re-evaluate canRun as the playhead/selection moves
  useStore((s) => s.playhead);
  useStore((s) => s.selectedClipId);
  useStore((s) => s.project);

  const ctx = {
    project: editor.project,
    playhead: editor.playhead,
    selectedClipId: editor.selectedClipId,
  };

  return (
    <div className="toolbar">
      {/* `hidden` commands (trim/move) need a clip and a target frame, which only
          a drag can supply — a button for them could never do anything. */}
      {editor
        .commands()
        .filter((cmd) => !cmd.hidden)
        .map((cmd) => {
          const enabled = editor.canRun(cmd.id);
          const why = enabled ? '' : (cmd.disabledReason?.(ctx) ?? '');
          return (
            <button
              key={cmd.id}
              aria-disabled={!enabled}
              onClick={() => {
                // Saying why beats a click that does nothing at all.
                if (!enabled) return setStatus(why || `지금은 쓸 수 없어요.`);
                run(cmd.id);
              }}
              title={
                enabled
                  ? cmd.defaultKey
                    ? `${cmd.label} (${cmd.defaultKey})`
                    : cmd.label
                  : why || cmd.label
              }
            >
              <span aria-hidden="true">{cmd.icon}</span> {cmd.label}
            </button>
          );
        })}
      <span className="sep" />
      <button
        onClick={() =>
          canUndo ? undo() : setStatus('아직 되돌릴 편집이 없어요.')
        }
        aria-disabled={!canUndo}
        title={canUndo ? '되돌리기 (Ctrl+Z)' : '아직 되돌릴 편집이 없어요.'}
      >
        <span aria-hidden="true">↩</span> 되돌리기
      </button>
      <button
        onClick={() =>
          canRedo ? redo() : setStatus('다시 실행할 편집이 없어요.')
        }
        aria-disabled={!canRedo}
        title={canRedo ? '다시 실행 (Ctrl+Shift+Z)' : '다시 실행할 편집이 없어요.'}
      >
        <span aria-hidden="true">↪</span> 다시
      </button>
      <span className="sep" />
      <ExportButton />
    </div>
  );
}
