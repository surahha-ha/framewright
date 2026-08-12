// framewright — the keyboard settings panel.
//
// Rebinding is "press the key you want", not "type the name of the key": the
// capture reads a real key press through the same `chordOf` the shortcut handler
// uses, so what you pressed and what gets stored can never disagree.
//
// Assigning a chord that is already taken TAKES it, and says whose it was. The
// alternative — refusing, or letting two actions share one key — leaves the user
// with a shortcut that silently does the wrong thing.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/projectStore';
import { chordOf, formatChord, reservedReason } from '../engine/keymap';
import { entries } from './actions';
import { useKeymapStore } from './keymapStore';
import { useResolvedKeymap } from './useShortcuts';

export function ShortcutsPanel() {
  const setOverlay = useStore((s) => s.setOverlay);
  const keymap = useResolvedKeymap();
  const setBinding = useKeymapStore((s) => s.setBinding);
  const clearBinding = useKeymapStore((s) => s.clearBinding);
  const resetAll = useKeymapStore((s) => s.resetAll);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  // Bindings only make sense for things a key can actually run: trim/move need
  // a target frame that only a drag can supply.
  const rows = entries().filter((e) => !e.requiresArgs);
  const labelOf = (id: string) => rows.find((r) => r.id === id)?.label ?? id;

  useEffect(() => {
    openerRef.current = document.activeElement;
    dialogRef.current?.querySelector('button')?.focus();
    return () => {
      const back = openerRef.current as HTMLElement | null;
      if (back && typeof back.focus === 'function') back.focus();
    };
  }, []);

  useEffect(() => {
    if (!capturing) return;
    function onKey(e: KeyboardEvent) {
      // Capture phase and preventDefault: while we are listening, the key means
      // "this is the binding", never what it usually means.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(null);
        setNote('바꾸지 않았어요.');
        return;
      }
      // An IME in the middle of composing reports `Process`, which is not a key
      // anyone can press again on purpose.
      if (e.isComposing || e.key === 'Process') return;
      const chord = chordOf(e);
      if (!chord) return; // a modifier on its own — keep waiting for the key
      const reserved = reservedReason(chord);
      if (reserved) {
        setNote(`${formatChord(chord)}: ${reserved} 다른 키를 눌러 주세요.`);
        return;
      }
      const target = capturing as string;
      const owner = keymap.byChord.get(chord);
      if (owner === target) {
        setCapturing(null);
        setNote('원래 쓰던 키예요.');
        return;
      }
      // Explicitly unbind the previous owner: leaving it alone would let its
      // default keep claiming the chord and put the keymap back in conflict.
      if (owner) setBinding(owner, null);
      setBinding(target, chord);
      setCapturing(null);
      setNote(
        owner
          ? `${labelOf(target)} → ${formatChord(chord)} · ${labelOf(owner)}의 단축키는 없어졌어요.`
          : `${labelOf(target)} → ${formatChord(chord)}`,
      );
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, keymap]);

  function onDialogKey(e: React.KeyboardEvent) {
    if (capturing) return; // the capture listener owns the keyboard
    if (e.key === 'Escape') {
      e.preventDefault();
      setOverlay('none');
      return;
    }
    if (e.key !== 'Tab') return;
    // Keep focus inside the dialog: a modal you can tab out of leaves a screen
    // reader reading the page behind it.
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !capturing) setOverlay('none');
      }}
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        ref={dialogRef}
        onKeyDown={onDialogKey}
      >
        <div className="palette-head">
          <h2 id="shortcuts-title">단축키</h2>
          <button className="ghost" onClick={() => setOverlay('none')}>
            닫기 (Esc)
          </button>
        </div>

        {keymap.conflicts.length > 0 && (
          <p className="warn">
            같은 키를 쓰는 항목이 있어요:{' '}
            {keymap.conflicts
              .map(
                (c) =>
                  `${formatChord(c.chord)} — ${c.actionIds.map(labelOf).join(', ')}`,
              )
              .join(' / ')}
            . 뒤쪽 항목은 지금 단축키가 없어요.
          </p>
        )}

        <ul className="keylist">
          {rows.map((row) => {
            const chord = keymap.byAction.get(row.id) ?? null;
            const isCapturing = capturing === row.id;
            return (
              <li key={row.id}>
                <span className="key-label">
                  <span aria-hidden="true">{row.icon ?? '·'}</span> {row.label}
                </span>
                <kbd className={'key-chord' + (chord ? '' : ' none')}>
                  {isCapturing ? '키를 누르세요…' : formatChord(chord)}
                </kbd>
                <span className="key-actions">
                  <button
                    onClick={() => {
                      if (isCapturing) {
                        setCapturing(null);
                        setNote('바꾸지 않았어요.');
                        return;
                      }
                      setCapturing(row.id);
                      // The only other sign of capture is a <kbd> changing, and
                      // nothing announces that. Say it, and say the way out.
                      setNote(
                        `${row.label}: 쓰고 싶은 키를 지금 누르세요. 그만두려면 Esc.`,
                      );
                    }}
                    // The accessible name has to follow the visible one, or a
                    // screen reader reads "바꾸기" off a button that says "취소".
                    aria-label={
                      isCapturing
                        ? `${row.label} 단축키 바꾸기 취소`
                        : `${row.label} 단축키 바꾸기`
                    }
                  >
                    {isCapturing ? '취소' : '바꾸기'}
                  </button>
                  <button
                    onClick={() => {
                      setBinding(row.id, null);
                      setNote(`${row.label}의 단축키를 없앴어요.`);
                    }}
                    aria-label={`${row.label} 단축키 없애기`}
                  >
                    없애기
                  </button>
                  <button
                    onClick={() => {
                      clearBinding(row.id);
                      setNote(`${row.label}을(를) 처음 설정으로 되돌렸어요.`);
                    }}
                    aria-label={`${row.label} 단축키 처음으로`}
                  >
                    처음으로
                  </button>
                </span>
              </li>
            );
          })}
        </ul>

        <div className="sheet-foot">
          <button
            className="ghost"
            onClick={() => {
              resetAll();
              setNote('모든 단축키를 처음 설정으로 되돌렸어요.');
            }}
          >
            전부 처음으로
          </button>
          <p className="palette-foot" role="status">
            {note ||
              '"바꾸기"를 누른 뒤 원하는 키를 누르세요. 이미 쓰는 키를 누르면 그 키를 가져옵니다.'}
          </p>
        </div>
      </div>
    </div>
  );
}
