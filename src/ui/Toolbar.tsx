// framewright — edit toolbar.
// Buttons are DERIVED from the command registry and the app actions: adding
// either one puts it here automatically, enabled/disabled by its own `canRun`
// (ADR-0003). Nothing in this file knows what any particular button does.
//
// Unavailable buttons are `aria-disabled`, not `disabled`. A natively disabled
// button leaves the tab order entirely, so a keyboard user never discovers the
// control exists — and never hears why it is waiting.
import { useStore } from '../store/projectStore';
import { formatChord } from '../engine/keymap';
import { APP_ACTIONS, entries, type Entry } from './actions';
import { useResolvedKeymap } from './useShortcuts';
import { ExportButton } from './ExportButton';
import { CommandButton } from './CommandButton';

/** Commands in registry order, with each action slotted in after its anchor. */
function toolbarEntries(): Entry[] {
  const all = entries();
  const out: Entry[] = [];
  for (const entry of all) {
    if (!entry.isCommand || entry.hiddenInToolbar) continue;
    out.push(entry);
    for (const action of APP_ACTIONS) {
      if (action.anchorAfter !== entry.id) continue;
      const slot = all.find((e) => e.id === action.id);
      if (slot) out.push(slot);
    }
  }
  return out;
}

export function Toolbar() {
  const setOverlay = useStore((s) => s.setOverlay);
  const keymap = useResolvedKeymap();
  // subscribe so buttons re-evaluate canRun as the document/selection moves
  useStore((s) => s.playhead);
  useStore((s) => s.selectedClipId);
  useStore((s) => s.selectedSubtitleId);
  useStore((s) => s.project);
  useStore((s) => s.hasClipboard);
  useStore((s) => s.canUndo);
  useStore((s) => s.canRedo);

  return (
    <div className="toolbar">
      {toolbarEntries().map((e) => (
        <CommandButton key={e.id} id={e.id} label={e.label} icon={e.icon} />
      ))}
      <span className="sep" />
      <CommandButton id="app.undo" label="되돌리기" icon="↩" />
      <CommandButton id="app.redo" label="다시 실행" icon="↪" />
      <span className="sep" />
      <button
        onClick={() => setOverlay('palette')}
        title={`명령 찾기 (${formatChord(keymap.byAction.get('app.palette') ?? null)})`}
      >
        <span aria-hidden="true">⌘</span> 명령 찾기
      </button>
      <button onClick={() => setOverlay('shortcuts')} title="단축키 설정">
        <span aria-hidden="true">⌨</span> 단축키
      </button>
      <span className="sep" />
      <ExportButton />
    </div>
  );
}
