# STATUS — the live handoff

**This file is the handoff.** It is rewritten at the end of every unit of work,
by whoever did the work, before they report anything to the owner.

Write it for a reader with **zero memory of any conversation**. No "as
discussed", no "the fix we talked about", no pronoun pointing at chat history.
If it is not in a file in this repo, it does not exist — chat context dies, the
repo does not.

<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->

**Last verified:** 2026-08-27 01:55 UTC — `npm run verify` **GREEN**

- unit 340 passed · e2e 76 passed

<!-- VERIFY:END -->

## Where we are

**Epic C is finished. A clip now shows both what it looks like and what it
sounds like.** The thumbnails landed in the previous unit; this one is the
audio waveform, and with it C has nothing left in it.

This unit is committed and pushed as `95a6d38`. The clip-thumbnail unit before
it is `78b656c` (plus `8c61aeb`, its handoff). `origin/main` has both, and
nothing described below is still only in a working tree.

### What is new

- **`src/engine/waveform.ts`** (new, pure, 29 unit tests) — `buildPyramid`,
  `peakLevelFor`, `waveAmplitude`, `wavePlan`. Which samples become which
  buckets, which rung a zoom reads, and where those buckets go.
- **`src/ui/waveform.ts`** (new, 17 unit tests) — one peak pyramid per asset:
  when it is built, when it is thrown away, and when it must not be built at
  all.
- **`src/engine/audio.ts`** gained a small registry — `markNoAudioTrack` /
  `hasNoAudioTrack` (new `src/engine/audio.test.ts`, 6 tests) — because "no
  audio buffer" was two different situations wearing the same face.
- **`src/ui/ClipThumbs.tsx` is now `src/ui/ClipCanvas.tsx`** and `.clip-thumbs`
  is now `.clip-canvas`. The wave is drawn on the SAME canvas as the pictures.
- Plus: `Timeline.tsx` (the renamed component, and a describedby note for a
  clip whose file has no sound), `media.ts` (release the peaks on a re-link,
  and announce a file that turns out to be silent), `App.tsx`
  (`retainOnlyPeaks`), `styles.css` (`--wave-ink`, `--wave-ground`,
  `--wave-quiet`), `docs/TESTING.md` (two contract rows),
  `e2e/clip-waveform.spec.ts` (new, 4 tests).

**No new ADR.** Nothing here reverses an architectural decision; ADR-0010's
scale is what made both halves of C possible, and it already says so.

### Six decisions a future session would otherwise get wrong

1. **The peaks are a pyramid, and each level is half the one below.** `ZOOM_STEP`
   is 2, so one zoom press moves exactly one rung. This is the same reason
   `thumbStep` is a power of two, arrived at from the other end — there, so a
   zoom step keeps half the cached pictures; here, so a zoom step does not have
   to resample anything at all.

2. **The buckets are anchored to the SOURCE FILE.** Not to the clip, not to the
   viewport — a pyramid level IS a partition of the file, so this is forced
   rather than chosen. It falls out nicely: trimming a clip cannot move its
   buckets, and two clips cut from the same source read the same arrays.

3. **ONE canvas for the pictures and the wave, hence the rename.** They want the
   same geometry, the same memo and the same "something arrived, draw again"
   signal, and the wave is drawn OVER the footage — a second absolutely
   positioned canvas would re-derive all of that and would layer by z-index
   instead of by draw order. Measured in Chrome afterwards: 21 playhead moves,
   0 canvas redraws, so the memo the previous unit added still holds.

4. **`waveAmplitude` is a square root, and it is not decoration.** See the next
   section.

5. **The peaks are invalidated by BUFFER IDENTITY** (`getAudioBuffer(id) ===
theBufferIReduced`), the exact analogue of the thumbnail cache's service
   identity, and for the same reason: a re-link keeps the asset id. Here the
   object the peaks were built from IS the receipt, so there is nothing to
   remember by hand.

6. **`refuse` in `ui/waveform.ts` is not belt and braces.** `bindMedia` swaps
   the decoder and releases the peaks BEFORE it decodes the new audio, so at
   that moment `getAudioBuffer` still answers with the OUTGOING file's buffer.
   Releasing alone therefore undid itself: the release notifies, every clip
   re-renders, the re-render asks again, and the file being replaced was
   reduced and cached as current — which by identity it still was.

### The defect that only a browser found

The gate was green and four persona reviewers had passed it. In Chrome, every
clip's waveform was a **flat line**: ink on exactly two rows of an eighteen-pixel
band.

Nothing was wrong with the arithmetic. `e2e/fixtures/sample-h264.mp4` peaks at
**0.189** — about -14 dBFS, an unremarkable level — and 0.189 of an eight-pixel
half-band is one and a half pixels. The feature was correct and useless.

`waveAmplitude` (a square root: monotonic, sign-preserving, the same family of
curve a dB meter uses) now carries the value to the screen, and the same fixture
fills six rows instead of two. Normalising each asset to its own peak was the
other obvious fix and was rejected: it would make two clips from different
sources look equally loud.

**The e2e spec had passed the whole time** — it asserted that ink existed and
that it was in the bottom band, and a flat line satisfies both. It now also
asserts that the ink spans more than a tenth of the canvas's height, and that
assertion was confirmed red with the curve reverted (0.024 against a floor of
0.1). This is the third unit running in which looking at the real UI found what
the whole gate could not.

### What the persona round found

Four reviewers (guardrail, QA, a11y, novice), **zero blockers**. Fixed:

1. **Peaks of the file being replaced could be rebuilt and cached as current**
   during a re-link (QA, major). Decision 6 above; two unit tests, confirmed
   red without the guard.
2. **`pump()` had no error containment and no failure memory** (QA, major).
   It is started as `void pump()`, so anything escaping it was an unhandled
   rejection that stopped the queue, told nobody, and was asked for again on
   the very next render. It now catches and remembers, exactly like
   `thumbnails.ts` remembers a frame that came back empty — three unit tests.
3. **"Still working it out" and "this file has no sound" were the same picture,
   one of them for ever** (novice + a11y, major, named independently).
   `engine/audio.ts` now records the verdict once it is known; a clip whose file
   has no audio track draws the band with a dim line through it and carries
   `aria-describedby="clip-silent-note"`. Six unit tests.

Everything not fixed is in `CLAUDE.md` "Known tech debt" — eight new entries,
the two largest being the synchronous `buildPyramid` pass versus live playback,
and the fact that nothing anywhere tells a first-time user what the wave IS.

### One rule this unit obeyed rather than changed

The silent-clip cue went into `aria-describedby`, never into the clip's
`aria-label`. `docs/TESTING.md`'s DOM contract says a clip's name is identity +
position + length and **never state**, because four e2e tests once broke over a
label that moved when only state changed. That is the same channel the
unlinked-media cue uses; it is now a list rather than a single id, since a clip
could in principle need both.

## Next single step

**Epic B — E7.** In the order agreed: subtitles, transitions, audio volume and
fades, transform.

Two things this unit leaves for whoever starts it:

- **The audio half of E7 will want to draw itself ON the waveform** — a fade is
  a shape over the peaks — so read `src/ui/ClipCanvas.tsx` before designing it.
  That canvas already draws two things; a third is the rule-of-three trigger for
  splitting the draw passes apart.
- **`engine/thumbnails.ts` and `engine/waveform.ts` are the same question asked
  twice**, and each has its own three-field clip span. `engine/thumbnails.ts`'s
  own header says to combine them when a THIRD case appears. E7's transform or
  its fades may be it — decide deliberately; do not merge them because they look
  similar.

## Blocked / needs the owner

1. **Nothing here is waiting on a commit** — the owner said to commit and push,
   and it is done (`95a6d38`). The tree still carries the untracked
   `bash.exe.stackdump` — a crash artefact, safe to delete, deliberately never
   staged.

2. **A quiet source still reads as a thickened line rather than a shape.** The
   square-root curve fixed "invisible"; it did not make an 18px band generous.
   The next levers are a true dB curve (costs honesty about relative level) or
   a taller band (costs picture). Left as it is deliberately; the owner may
   disagree. See also the two product calls now in "Known tech debt": nothing
   explains what the wave is, and "no sound" versus "not yet" differ only by a
   hairline's colour.

3. **Thumbnail slots can be up to twice the width of the picture in them**, so
   the widest ones crop the frame vertically by up to half. Fixing it properly
   changes `thumbStrip`'s contract. Unchanged from the previous unit.

4. **Unchanged and still open:** the `m:ss` ruler label is a product call the
   owner can overturn; `MAX_SCALE = 40` px/frame has only ever been tried on the
   three-second fixture; and the two directions the owner set — **AWS deployment
   for real users** and design informed by `docs/research/editor-pain-points.md`
   — have no code yet. The gating question is still static hosting (S3 +
   CloudFront, possible today) versus a real backend for projects and media. A
   consequence worth restating: **a project does not follow the user to another
   machine** — the document is in `localStorage`, the video in that browser
   profile's OPFS.
