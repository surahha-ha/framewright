// framewright — a button that runs a command or an app action by id.
//
// Four places used to carry the same eight lines: ask `canRun`, show the
// binding in `title`, dispatch through `perform`, and stay in the tab order
// with `aria-disabled` so the reason for being unavailable is reachable by
// keyboard and said out loud on a click. The toolbar, the timeline's zoom
// buttons and the subtitle panel now share this one; the palette's rows are
// `option`s inside a listbox and keep their own markup.
//
// `short` is what is drawn when the accessible name is longer than the room
// for it (the zoom buttons say 크게 on screen and 크게 보기 to a screen
// reader). Without it, the name is the drawn label, straight from the content.
import { useStore } from '../store/projectStore';
import { formatChord } from '../engine/keymap';
import { canRun, perform, whyNot } from './actions';
import { useResolvedKeymap } from './useShortcuts';

export function CommandButton({
  id,
  label,
  icon,
  short,
  className,
}: {
  id: string;
  label: string;
  icon?: string;
  short?: string;
  className?: string;
}) {
  const setStatus = useStore((s) => s.setStatus);
  const keymap = useResolvedKeymap();
  const enabled = canRun(id);
  const why = enabled ? '' : whyNot(id);
  const chord = keymap.byAction.get(id) ?? null;
  return (
    <button
      type="button"
      className={className}
      aria-disabled={!enabled}
      aria-label={short ? label : undefined}
      title={
        enabled ? (chord ? `${label} (${formatChord(chord)})` : label) : why
      }
      onClick={() => {
        // Saying why beats a click that does nothing at all.
        if (!enabled) return setStatus(why);
        perform(id);
      }}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {icon ? ' ' : null}
      {short ?? label}
    </button>
  );
}
