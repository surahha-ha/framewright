// framewright — the selected subtitle: its words, and where it starts and ends.
//
// Shown only while a subtitle is selected (UX.md: the properties panel shows
// what is selected and nothing else). The words are typed here rather than on
// the timeline strip, where a chip is a few dozen pixels wide.
//
// The text is committed on Enter or when the field loses focus — one edit,
// one undo step — not on every keystroke. The global shortcut handler already
// stands aside for a textarea (`isTypingTarget`), so typing `c` here writes a
// c and does not split the clip. Shift+Enter breaks a line; Escape puts the
// draft back to what the document says.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store/projectStore';
import { formatTimecode } from '../engine/time';
import { locateSubtitle, subtitleLength } from '../engine/subtitles';
import {
  EFFECT_HINT,
  EFFECT_IDS,
  EFFECT_LABEL,
  LOOK_HINT,
  LOOK_IDS,
  LOOK_LABEL,
  PLACE_IDS,
  PLACE_LABEL,
  SAME_EFFECT,
  SAME_LOOK,
  SAME_PLACE,
  effectOf,
  lookOf,
  placeOf,
} from '../engine/subtitleStyle';
import {
  FONT_ARRIVED,
  FONT_FAILED,
  FONT_HINT,
  FONT_IDS,
  FONT_LABEL,
  FONT_RETRYING,
  SAME_FONT,
  describeFont,
  fontField,
  fontOf,
  type FontId,
} from '../engine/fonts';
import type { SubtitleFont } from '../engine/types';
import { browserFonts, fontState } from './fonts';
import { RangeRow } from './RangeRow';
import {
  positionOfSlider,
  positionText,
  positionXText,
  positionYText,
  sliderOfPosition,
} from '../engine/subtitlePosition';
import { CommandButton } from './CommandButton';

const NEXT: Record<string, 1 | -1> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * One row of choices for the selected subtitle: 모양, 자리 or 효과
 * (ADR-0017). A radiogroup, for the reasons `FramePicker` gives: exactly
 * one choice is current, the current one is chosen rather than unavailable,
 * and the arrows move choice and focus together, one Tab stop. `current` is
 * null when the subtitle is somewhere no preset names (E8-2c's drag will
 * do that); then nothing is checked and the first choice is the Tab stop.
 */
function Choices<T extends string>({
  id,
  title,
  ids,
  label,
  hint,
  current,
  choose,
  same,
  children,
}: {
  id: string;
  title: string;
  ids: readonly T[];
  label: Record<T, string>;
  hint?: Record<T, string>;
  current: T | null;
  choose: (choice: T) => void;
  same: (choice: T) => string;
  /** More controls for the same word, under the radios (the 자리 row's
   *  two sliders): the row is then one GROUP named by the word, so a
   *  screen reader hears that the radios and the sliders are one thing —
   *  off every preset the radios read as nothing checked and the value
   *  lives only in the sliders (a11y review, E8-2c). */
  children?: ReactNode;
}) {
  const setStatus = useStore((s) => s.setStatus);
  const stop = current ?? ids[0];

  function pick(choice: T) {
    // Pressing what is already chosen changes nothing; say so rather than
    // let a press do nothing in silence (CommandButton's rule).
    if (choice === current) return setStatus(same(choice));
    choose(choice);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, i: number) {
    const step = NEXT[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const next = ids[(i + step + ids.length) % ids.length];
    const buttons =
      e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="radio"]',
      );
    buttons?.[ids.indexOf(next)]?.focus();
    pick(next);
  }

  return (
    <div
      className={'subtitle-choice' + (children ? ' with-more' : '')}
      role={children ? 'group' : undefined}
      aria-labelledby={children ? `${id}-label` : undefined}
    >
      <span className="subtitle-choice-label" id={`${id}-label`}>
        {title}
      </span>
      <div role="radiogroup" aria-labelledby={`${id}-label`}>
        {ids.map((choice, i) => (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={choice === current}
            tabIndex={choice === stop ? 0 : -1}
            title={hint?.[choice]}
            // The hint is the radio's description too, so a keyboard user
            // hears what 톡 IS; `title` alone shows only under a mouse.
            aria-describedby={hint ? `${id}-${choice}-hint` : undefined}
            onClick={() => pick(choice)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {label[choice]}
          </button>
        ))}
      </div>
      {hint &&
        ids.map((choice) => (
          <span key={choice} className="sr-only" id={`${id}-${choice}-hint`}>
            {hint[choice]}
          </span>
        ))}
      {children}
    </div>
  );
}

export function SubtitlePanel() {
  const project = useStore((s) => s.project);
  const selectedSubtitleId = useStore((s) => s.selectedSubtitleId);
  const wordsWanted = useStore((s) => s.subtitleWordsWanted);
  const setSubtitleDraft = useStore((s) => s.setSubtitleDraft);
  const run = useStore((s) => s.run);
  const setStatus = useStore((s) => s.setStatus);
  // The two edge buttons ask `canRun` against the playhead.
  useStore((s) => s.playhead);
  const found = locateSubtitle(project, selectedSubtitleId);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');
  /** Which subtitle the draft belongs to, so a selection change resets it
   *  and an undo of the text shows the restored words rather than the draft. */
  const [draftFor, setDraftFor] = useState<{ id: string; text: string } | null>(
    null,
  );

  const id = found?.subtitle.id ?? null;
  const text = found?.subtitle.text ?? '';
  if (id && (draftFor?.id !== id || draftFor.text !== text)) {
    setDraft(text);
    setDraftFor({ id, text });
  }

  // A subtitle that has just been made has no words yet, and the words are
  // the whole point: put the cursor in the field so typing starts at once.
  // Only on that signal. "The words are empty" was the trigger once, and an
  // undo of the words then yanked focus into the field — where the next
  // Ctrl+Z was the browser's text undo, and the subtitle could not be undone.
  useEffect(() => {
    if (wordsWanted > 0) fieldRef.current?.focus();
  }, [wordsWanted]);

  // The draft is drawn on the preview while it is being typed. It is cleared
  // whenever the field stops being the source of truth: commit, revert, a
  // different selection, or the panel going away.
  useEffect(() => () => setSubtitleDraft(null), [id, setSubtitleDraft]);

  if (!found) return null;
  const { subtitle } = found;
  const fps = project.timeline.fps;

  function commit() {
    if (!id) return;
    setSubtitleDraft(null);
    // Refused when nothing changed (or the subtitle is gone) — not an edit.
    run('subtitle.setText', { subtitleId: id, text: draft });
  }

  // Where the words are, for the two sliders (E8-2c): the absent fields
  // read as 50 (centre) and 100 (bottom), and writing those back is the
  // preset again — the normal form, `subtitlePosition.ts`.
  const slider = sliderOfPosition(subtitle);
  const positionNoteId = 'subtitle-position-note';
  const slide = (x: number, y: number) =>
    run(
      'subtitle.setPosition',
      { subtitleId: id, ...positionOfSlider(x, y) },
      `pos:${id}`,
    );

  /** A face is fetched the first time it is chosen (ADR-0018): the command
   *  writes the field, then the loader is asked, and the sentence says the
   *  words will change when the file lands — the preview draws the
   *  fallback until then and redraws on arrival. */
  function chooseFont(font: FontId) {
    if (!id || !run('subtitle.setFont', { subtitleId: id, font })) return;
    const face = fontField(font);
    if (!face || browserFonts.ready(face)) return;
    const said = describeFont(font, lookOf(subtitle), true);
    setStatus(said);
    void fetchFace(id, face, said);
  }

  /** Says how the fetch ended — unless the subtitle no longer wants that
   *  face by then (a second choice, an undo, a delete), or the status line
   *  has moved on to something else the user did meanwhile: either way the
   *  sentence would be about nothing on screen and would bury a newer one.
   *  `said` is the wait this press put on the status line. */
  function fetchFace(subtitleId: string, face: SubtitleFont, said: string) {
    return browserFonts.load(face).then((ok) => {
      const s = useStore.getState();
      const now = locateSubtitle(s.project, subtitleId);
      if (!now || now.subtitle.font !== face || s.status !== said) return;
      setStatus(ok ? FONT_ARRIVED(face) : FONT_FAILED(face));
    });
  }

  /** Pressing the face already chosen changes nothing — unless its file
   *  never came, when the press is the retry (the document already says
   *  that face; only the fetch is owed). */
  function sameFont(font: FontId): string {
    const face = fontField(font);
    if (id && face && fontState(face) === 'failed') {
      // `Choices` puts this sentence on the status line; the settle
      // compares against it.
      void fetchFace(id, face, FONT_RETRYING(face));
      return FONT_RETRYING(face);
    }
    return SAME_FONT(font);
  }

  function revert() {
    setSubtitleDraft(null);
    if (draft === text) return;
    setDraft(text);
    // Throwing typed words away in silence is the one thing this panel must
    // not do; the sentence is the only sign anything happened.
    setStatus(
      text
        ? '입력하던 내용을 지우고 저장된 자막 내용으로 되돌렸어요.'
        : '입력하던 내용을 지웠어요. 자막은 비어 있어요.',
    );
  }

  return (
    <section className="subtitle-panel" aria-labelledby="subtitle-panel-title">
      <h2 className="panel-title" id="subtitle-panel-title">
        자막
      </h2>
      <label className="subtitle-field">
        <span className="subtitle-field-label">내용</span>
        <textarea
          ref={fieldRef}
          // Three, not two: a two-line subtitle whose second line wraps in
          // the sidebar scrolled its first line out of sight while typing.
          rows={3}
          value={draft}
          placeholder="여기에 자막 내용을 적어요"
          aria-describedby="subtitle-field-help"
          onChange={(e) => {
            setDraft(e.target.value);
            if (id) setSubtitleDraft({ id, text: e.target.value });
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              revert();
            }
            // Everything else — including Delete — is typing. Never let a key
            // pressed while writing reach the editing shortcuts.
            e.stopPropagation();
          }}
        />
        {/* Enter saving rather than breaking a line is the opposite of what
            a plain text box does, so it is said next to the box. */}
        <span className="subtitle-field-help" id="subtitle-field-help">
          <kbd>Enter</kbd> 저장 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 줄 바꿈 ·{' '}
          <kbd>Esc</kbd> 입력 취소
        </span>
      </label>
      {/* 예능 자막 (ADR-0017): how the words look, where they sit, how they
          come and go. Three choices each; the document keeps a field per
          row, absent for the first choice. */}
      <h3 className="panel-subtitle">꾸미기</h3>
      <div className="subtitle-choices">
        <Choices
          id="subtitle-look"
          title="모양"
          ids={LOOK_IDS}
          label={LOOK_LABEL}
          hint={LOOK_HINT}
          current={lookOf(subtitle)}
          choose={(look) => run('subtitle.setLook', { subtitleId: id, look })}
          same={SAME_LOOK}
        />
        <Choices
          id="subtitle-font"
          title="글꼴"
          ids={FONT_IDS}
          label={FONT_LABEL}
          hint={FONT_HINT}
          current={fontOf(subtitle)}
          choose={chooseFont}
          same={sameFont}
        />
        <Choices
          id="subtitle-place"
          title="자리"
          ids={PLACE_IDS}
          label={PLACE_LABEL}
          current={placeOf(subtitle)}
          choose={(place) =>
            run('subtitle.setPlace', { subtitleId: id, place })
          }
          same={SAME_PLACE}
        >
          {/* The keyboard's route to what a drag on the preview does
              (E8-2c): two sliders in the words' own language (fractions of
              the box, as percents), and one sentence that says where the
              words are — the sliders' description, and what the radios
              cannot say when nothing in them is checked. Inside the 자리
              row, so the radios and the sliders are one group. */}
          <div className="subtitle-position">
            <RangeRow
              label="가로 자리"
              min={0}
              max={100}
              step={1}
              value={slider.x}
              valueText={positionXText(subtitle.posX)}
              describedBy={positionNoteId}
              onChange={(v) => slide(v, slider.y)}
            />
            <RangeRow
              label="세로 자리"
              min={0}
              max={100}
              step={1}
              value={slider.y}
              valueText={positionYText(subtitle.posY)}
              describedBy={positionNoteId}
              onChange={(v) => slide(slider.x, v)}
            />
            <span className="clip-edge-note dim" id={positionNoteId}>
              {placeOf(subtitle)
                ? `${PLACE_LABEL[placeOf(subtitle)!]} 자리에 있어요 · 화면의 자막을 끌거나 슬라이더로 옮길 수 있어요`
                : positionText(subtitle)}
            </span>
          </div>
        </Choices>
        <Choices
          id="subtitle-effect"
          title="효과"
          ids={EFFECT_IDS}
          label={EFFECT_LABEL}
          hint={EFFECT_HINT}
          current={effectOf(subtitle)}
          choose={(effect) =>
            run('subtitle.setEffect', { subtitleId: id, effect })
          }
          same={SAME_EFFECT}
        />
      </div>
      <p className="subtitle-when">
        <span>
          {formatTimecode(subtitle.startFrame, fps)}부터{' '}
          {formatTimecode(subtitle.endFrame, fps)}까지
        </span>
        <span className="dim">
          길이 {formatTimecode(subtitleLength(subtitle), fps)}
        </span>
      </p>
      <div className="subtitle-actions">
        <CommandButton
          id="subtitle.moveToPlayhead"
          label="자막 전체를 재생 위치로"
          short="전체를 재생 위치로"
        />
        <CommandButton
          id="subtitle.startToPlayhead"
          label="자막 시작을 재생 위치로"
          short="시작을 재생 위치로"
        />
        <CommandButton
          id="subtitle.endToPlayhead"
          label="자막 끝을 재생 위치로"
          short="끝을 재생 위치로"
        />
        <CommandButton
          id="subtitle.remove"
          label="자막 지우기"
          icon="⌫"
          className="danger"
        />
      </div>
      <p className="empty-hint">
        재생 위치를 옮긴 뒤 위 단추를 누르면 자막 전체가 그 자리로 가거나, 그
        자리에서 시작하거나 끝나요. 타임라인의 자막을 끌어서 옮기거나 양 끝을
        끌어 길이를 조절할 수도 있어요. 꾸미기의 효과는 자막이 나타날 때와
        사라질 때 잠깐 보여요 · 재생해서 확인해 보세요.
      </p>
    </section>
  );
}
