# 0016 — A pause is cut by an absolute rule, from the peaks already built, in one step

- Status: Accepted
- Date: 2026-09-14

## Context

E9 is silence auto-cut: one press finds the pauses in the footage and takes
them out. It is the first command that reads the SOUND of a file to decide an
edit, so four questions had to be settled before any code — and the owner
settled the rule itself on 2026-09-14 (docs/STATUS.md, E9 execution plan).

**What counts as silent?** Every tool has a threshold, and they disagree by
30 dB. Jump-cut tools sit at -28 to -30 dBFS and clip breaths and the ends
of words; a quiet room's floor is -50 to -60; phone footage's floor is
around -45. A threshold RELATIVE to the clip ("quieter than the rest") reads
a whispered take as silence and a noisy one as speech.

**Measured how?** The waveform already reduces every source to a pyramid of
min/max peaks over 128-sample buckets (`engine/waveform.ts`), built once per
file and cached by the strip. An RMS measure would be a second pass over
every sample for a number the first pass nearly has.

**Where does the cut go?** A pause has edges, and a consonant lives on
them. Cutting a run of quiet exactly where the level crosses the threshold
is the most common complaint about every auto-cut: the clipped "t".

**What does a mute mean?** A clip with its sound switched off (ADR-0013)
has pauses in its file like any other. Cutting them removes pictures the
user kept knowing they would be silent.

**Is it one edit?** The cut is several splits and several ripple deletes.
Expressed as the existing commands in sequence, it is that many undo
steps, and Ctrl+Z after "remove the pauses" puts back one sliver of one
pause.

## Decision

**The rule, absolute, in four named constants in `engine/silence.ts`, and
nowhere in the UI in this unit:**

| Rule           | Value                                                                 |
| -------------- | --------------------------------------------------------------------- |
| Level          | peak below **-40 dBFS** (`SILENCE_PEAK` = 0.01 linear), absolute      |
| Measure        | the **128-sample peak buckets** the waveform builds — no RMS          |
| Minimum length | a run of quiet buckets **≥ 0.5 s** (`SILENCE_MIN_SEC`)                |
| Padding        | keep **0.2 s** on each side (`SILENCE_PAD_SEC`), rounded UP to frames |
| Nothing to cut | under **0.1 s** left after the padding (`SILENCE_FLOOR_SEC`): no cut  |

-40 dBFS sits below a quiet room's floor and below most phone footage's,
and above what jump-cut tools use; 0.5 s is the minimum nearly every tool
uses; 0.2 s of padding is what stops the clipped consonant; peak instead of
RMS because the data is already there and the 0.5 s minimum absorbs a
click. The padding rounds up (`sampleToFrame`, integer arithmetic all the
way — 1.2 × 30 is not reliably 36 in floating point) so that a boundary
that lands between frames keeps a frame rather than losing one. The
padding applies at the file's edges too: a pause at the very start keeps
0.2 s of it, which is a beat before the first word, not a defect.

**A run is measured on the SOURCE and cut where a clip shows it.** The
runs are memoised per pyramid (`silentRuns`), so the toolbar may ask on
every render whether the button can run. A clip trimmed into the middle of
a pause loses only the part it has; a run that spans a split is cut once
per piece and the sentence counts it twice, which is what happened. A
sliver a clip's edge leaves of a run is held to the same 0.1 s floor.

**A muted clip is skipped.** Not judged silent, not judged at all: the
user took its sound out of the question. The level (`volume`) and the
fades are ignored — the rule is about the file as recorded, and a clip at
5% is not "silent" in the sense the rule means. Both are stated in the
panel's words only through the button's reason when every clip is muted.

**The peaks reach the command through the editor context (`ctx.peaks`),
not through arguments.** A toolbar button, a palette row and a key all
call `perform(id)` with nothing else, and `canRun` has to say "not yet"
for all three. The app wires the waveform cache in once (`App.tsx` →
`editor.setPeaksSource(peaksFor)`); a test hands over a fixture. A file
the decoder found no audio track in is reported as a pyramid with no
levels — measured, nothing there — so the button does not wait for ever
on it. A clip whose peaks have not arrived is skipped and the sentence says
so; the button is disabled with "still reading" only when NO clip is
measured yet.

**One patch, one undo step.** `silencePatch` folds every split and ripple
delete into one forward list with one exact inverse (`silence.test.ts`
applies both and requires the original document back). Ids are the
document counter's, in timeline order; the head of each clip keeps the
clip's id and its fade-in if the head was not cut away; the last piece
keeps the fade-out on the same condition; each fade is written at what its
piece can hold, as `clip.split` does. A clip wholly inside a pause is
removed. Subtitles ripple with the pictures, as `timeline.closeGaps`
ripples them.

**The command is `timeline.cutSilence`, "조용한 부분 없애기"**, a toolbar
button next to 빈 곳 없애기 and a palette row, with no default key. It runs
only when there is a cut to make; otherwise the reason is one of three —
먼저 영상을 불러오세요 · 소리를 아직 읽는 중이에요 · 0.5초 넘게 조용한
부분이 없어요 — plus one for the all-muted case. Its sentence counts the
places and the seconds: "조용한 부분 3곳을 없앴어요 · 2.4초 짧아졌어요."

## Consequences

- Nothing here decodes: `silence.ts` reads a `Pyramid` and a `Project` and
  is tested in Node with synthetic samples. The browser-only half — that a
  real file's decoded sound reaches the button — is `e2e/silence.spec.ts`
  on `e2e/fixtures/sample-silence.mp4` (the H.264 fixture's pictures with
  tone · 1.4 s of silence · tone, made through the app's own export).
- The constants are not in the UI. A project that needs -30 dBFS or no
  padding cannot say so yet; exposing them is a later unit, and `silentRuns`
  would take them as arguments then.
- `EditorCtx` carries one more thing that is not document state (`peaks`,
  after `clipboard`). Both are "the environment the edit is made in"; a
  third such field is the moment to give them a name of their own.
- A run that spans a split counts as two places in the sentence. The
  number is honest about the cuts made, not about the pauses heard.
- The waveform's own per-clip "이 부분은 조용해요" (a debt entry) now has a
  rule to use; it is still not drawn.
