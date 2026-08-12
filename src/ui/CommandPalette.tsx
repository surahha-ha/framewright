// framewright — the ⌘K command palette.
//
// It is close to free: commands and actions are already data with a label, an
// icon, a binding and a reason for being unavailable, so this file is a filter
// and a listbox over `entries()` — it knows nothing about editing.
//
// Unavailable entries are LISTED, greyed, with their reason. Hiding them makes
// the palette lie about what the editor can do, and a first-time user learns
// "선택한 클립이 있어야 해요" exactly when they were looking for it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/projectStore';
import { formatChord } from '../engine/keymap';
import { canRun, entries, perform, whyNot } from './actions';
import { useResolvedKeymap } from './useShortcuts';

interface Row {
  id: string;
  label: string;
  icon?: string;
  enabled: boolean;
  why: string;
  chord: string | null;
}

export function CommandPalette() {
  const setOverlay = useStore((s) => s.setOverlay);
  const keymap = useResolvedKeymap();
  // Availability changes with the document, the playhead and the selection.
  useStore((s) => s.project);
  useStore((s) => s.playhead);
  useStore((s) => s.selectedClipId);
  useStore((s) => s.hasClipboard);
  useStore((s) => s.canUndo);
  useStore((s) => s.canRedo);

  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = entries()
      .filter((e) => !e.hiddenInPalette)
      .filter(
        (e) => !q || e.label.toLowerCase().includes(q) || e.id.includes(q),
      )
      .map<Row>((e) => ({
        id: e.id,
        label: e.label,
        icon: e.icon,
        enabled: canRun(e.id),
        why: canRun(e.id) ? '' : whyNot(e.id),
        chord: keymap.byAction.get(e.id) ?? null,
      }));
    // What you can do now comes first; the rest stay visible underneath.
    return [...all.filter((r) => r.enabled), ...all.filter((r) => !r.enabled)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, keymap]);

  // The query narrowed under the cursor — never leave it pointing past the end.
  useEffect(() => {
    setIndex((i) => (i >= rows.length ? Math.max(0, rows.length - 1) : i));
  }, [rows.length]);

  /** Give the keyboard back to whatever had it before the palette opened. */
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    openerRef.current = document.activeElement;
    inputRef.current?.focus();
    return () => {
      const back = openerRef.current as HTMLElement | null;
      if (back && typeof back.focus === 'function') back.focus();
    };
  }, []);

  // Keep the highlighted row on screen when arrowing through a long list.
  useEffect(() => {
    const el = listRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  function close() {
    setOverlay('none');
  }

  /** A live region only announces a CHANGE, so re-setting the same sentence is
   *  silent — which is exactly what happens when someone presses Enter twice on
   *  the same unavailable row. Clear it first, then say it again. */
  function say(text: string) {
    setNote('');
    window.setTimeout(() => setNote(text), 0);
  }

  function choose(row: Row | undefined) {
    if (!row) return;
    if (!row.enabled) {
      // Staying open is the point: the status bar is behind the dialog, so the
      // reason has to be said here or it is not said at all.
      say(row.why);
      return;
    }
    // A command can still refuse after `canRun` said yes — a nudge that reaches
    // the clip next door, an export in progress. Closing on a no-op would look
    // like the palette swallowed the request.
    if (!perform(row.id)) {
      say(whyNot(row.id));
      return;
    }
    // ...but not if the entry opened something else in our place.
    if (useStore.getState().overlay === 'palette') close();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setIndex((i) => (i + step + rows.length) % rows.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      choose(rows[index]);
    }
  }

  /** Two focusable controls, so the trap is a wrap rather than a machine. */
  function trapTab(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const from = document.activeElement;
    (from === inputRef.current ? closeRef : inputRef).current?.focus();
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="palette-title"
        onKeyDown={trapTab}
      >
        <div className="palette-head">
          <h2 id="palette-title">명령 찾기</h2>
          <button ref={closeRef} className="ghost" onClick={close}>
            닫기 (Esc)
          </button>
        </div>
        <input
          ref={inputRef}
          className="palette-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={
            rows.length ? `palette-row-${index}` : undefined
          }
          aria-label="무엇을 할지 검색하세요"
          placeholder="무엇을 할까요? (예: 나누기, 복사)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
            setNote('');
          }}
          onKeyDown={onKeyDown}
        />
        <ul
          id="palette-list"
          className="palette-list"
          role="listbox"
          aria-label="할 수 있는 것"
          ref={listRef}
        >
          {rows.map((row, i) => (
            <li
              key={row.id}
              id={`palette-row-${i}`}
              role="option"
              aria-selected={i === index}
              aria-disabled={!row.enabled}
              className={
                'palette-row' +
                (i === index ? ' active' : '') +
                (row.enabled ? '' : ' off')
              }
              onMouseMove={() => setIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the input
                choose(row);
              }}
            >
              <span className="pal-icon" aria-hidden="true">
                {row.icon ?? '·'}
              </span>
              <span className="pal-label">{row.label}</span>
              <span className="pal-why">{row.why}</span>
              <kbd className="pal-key">{formatChord(row.chord)}</kbd>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="palette-row off" aria-disabled="true">
              <span className="pal-label">찾는 것이 없어요.</span>
            </li>
          )}
        </ul>
        {/* One live region for the whole dialog. An empty result has to be
            said, not only drawn: with no rows there is no active option for a
            screen reader to land on. */}
        <p className="palette-foot" role="status">
          {note ||
            (rows.length === 0
              ? '찾는 것이 없어요 · 다른 말로 찾아보세요'
              : '↑↓ 고르기 · Enter 실행 · Esc 닫기')}
        </p>
      </div>
    </div>
  );
}
