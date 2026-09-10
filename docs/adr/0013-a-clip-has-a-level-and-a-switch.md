# 0013 — A clip's sound is a level and a switch, and a mute is not "volume 0"

- Status: Accepted
- Date: 2026-09-10

## Context

E7's third item is audio volume. Every editor has it, and every one of them
has to answer the same questions before the slider is drawn.

**What is stored, and in what unit?** Premiere keeps dB; iMovie and CapCut
show a percent. The audio graph multiplies by a linear gain, and the fade
ramps of ADR-0012 are already linear gain points on the same graph. A dB
value would have to be converted at every reader; a percent integer would
have to be converted at the one multiplier. A first-time user reads
"100%" and knows what it means; nobody who has not mixed sound knows what
"−6 dB" is.

**Is a mute a level of zero?** It is the one audio edit almost everyone
makes, it has a key in every player, and it has to go BOTH ways: turn the
sound off, then turn it back on and get the level you had. A mute expressed
as "volume 0" forgets that level the moment the sound comes back — undo
knows, but undo is not the way back after three other edits.

**Where does the level meet the sound?** `buildAudioSchedule` already
computes a gain ramp per segment for the fades, and the player and the
offline render already put that ramp on a `GainNode`. The level is one more
factor on the same points, or it is a second gain node, a second place the
preview and the export could disagree.

**What does a muted clip do to its neighbour's dissolve?** A fade-in at a
cut plays the previous clip's overhang underneath (ADR-0012). If that clip
is muted, playing its overhang would be the one moment its sound is heard.

## Decision

**Two fields on the clip, both optional.** `Clip.volume` is a LINEAR gain:
1 is the file as recorded, absent means 1, and the panel offers 0–2 in
steps of five percent. The document is rounded to a whole percent when
written (`roundVolume`), so a saved 0.35 is a compared 0.35, and a value
outside the range is read at the edge, never rewritten. `Clip.muted` is
`true` or absent — never `false` — so a clip that was never muted and one
that was muted and unmuted are the same document, and undo's inverse leaves
no key behind (the `dropUndefined` rule of `ops.ts`).

**One reader for what the clip is heard at**: `clipLevel` in
`src/engine/volume.ts` — 0 when muted, otherwise the clamped volume. The
schedule, the strip and the panel all ask it; nothing else looks at the
two fields.

**The level multiplies the fade ramp.** Every gain point of a segment is
scaled by the level, so a fade on a quiet clip still starts at silence and
ends at the clip's level, and a neighbour's overhang runs at the
neighbour's level. A segment with no ramp gets one flat point at its start
(in the past when playback joins later, exactly like a fade's), and the
player's `scheduleGain` already starts the parameter where the ramp is.

**A muted clip has no segment.** Not a segment at zero gain: nothing is
scheduled, so its overhang is not played under a neighbour's fade-in and
its pre-roll is not played under a neighbour's fade-out. A document with
every clip muted renders no audio buffer, and the exporter writes a
video-only file, which is what the export sentence already calls 무음.

**The slider stops where the clip's own peak would pass full scale.** The
only way an exported file can clip is one clip's level times its own
loudest sample: through a dissolve the two ramps sum to 1, so the
combined gain never exceeds the louder clip's level (a review claimed
"four times full scale"; the ramp shapes in `audioSchedule.ts` say
otherwise, pre-roll shorter than the fade included). So a bound per clip
is a bound on the whole mix, and no DSP is needed. `clipPeak` reads the
loudest sample off the finest level of the peak pyramid the waveform
already builds — over `audibleSourceRange`, which is the clip's `[in, out)`
PLUS the pre-roll and overhang a neighbour's dissolve pulls in, because a
transient the trim cut away is still played, at the clip's level, under a
dissolve (a QA reviewer's scenario; the schedule and the ceiling now share
that one range). `volumeCeiling` turns the peak into
`max(1, min(2, 1 / peak))` rounded down to a notch; the panel's slider
gets it as `max`, the preview and the export apply the same bound
through `buildAudioSchedule`'s `ceiling` callback, and the strip draws
what is heard. A level stored above the ceiling (set before the peaks
arrived, or before a trim moved the clip into a louder passage) is heard
at the ceiling and never rewritten — the fade-under-a-trim rule. The
alternatives were a limiter (browser-defined, with lookahead latency that
would move sound against picture) and a lower fixed ceiling (which would
not stop a hot file clipping at 150% either). Unknown peaks mean the full
range; a file already past full scale is not turned down.

**Two commands, of two kinds.** `clip.mute` is a toggle: from the `M` key,
the panel's button or the palette it flips the selected clip (or the one
named). `clip.volume` sets a level and needs one, so it is `requiresArgs`:
no palette row, no key, no shortcut-list row; the panel's slider is its
only caller. Each notch of the slider is one dispatch with a coalesce key,
so a drag or a held arrow key is one undo step while the status line and
the document follow each notch (the same rule as a trim drag, ADR-0006).

**The words are 소리 끄기 and 소리 크기, and the level is a percent.** The
panel says under the controls what the sound does now (녹음된 그대로 /
녹음된 것보다 크게·작게 / 들리지 않아요), and a muted note says what
level the sound comes back at. On the strip a pill after the clip's name
says 🔇 or the percent, and the wave is drawn at the level: smaller for a
quieter clip, and for a muted one the full shape in the colour that means
"not sound" — the sound is still there to turn back on, which a flat band
(the silent file's picture) would deny.

## Consequences

- Nothing in the mix can pass full scale, by construction rather than by
  processing. The cost is that the ceiling is known only once the peaks
  are built (about a second after an import) and that it reads whole
  128-sample buckets, so it can sit one notch low at a trim.
- The slider's every notch is a document edit and a status sentence; a
  drag through twenty notches says twenty sentences and leaves one undo
  step. During playback each notch also schedules the debounced re-cue that
  every edit does, so the new level is heard after the debounce.
- `ClipboardEntry` carries both fields, so a pasted clip sounds like its
  source. A split keeps both on both pieces: the sound is a property of the
  whole clip, unlike a fade, which belongs to an edge.
- A mute does not change what a fade partners with. A muted clip that
  fades in at a cut still asks for the previous clip's overhang, so that
  clip's sound fades out under the (silent) muted one — the picture
  dissolves, the sound fades to nothing. That is the honest reading of
  "this clip is silent"; a hard cut to silence would have to come from
  turning the fade off.
- The document schema does not change (optional fields on `Clip`). A
  project saved before this reads as every clip at 100%, heard.
- The waveform now depends on the clip as well as the file: `ClipCanvas`
  takes a `gain` prop and its memo compares it.
