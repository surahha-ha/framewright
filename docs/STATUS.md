# STATUS — the live handoff

**This file is the handoff.** It is rewritten at the end of every unit of work,
by whoever did the work, before they report anything to the owner.

Write it for a reader with **zero memory of any conversation**. No "as
discussed", no "the fix we talked about", no pronoun pointing at chat history.
If it is not in a file in this repo, it does not exist — chat context dies, the
repo does not.

<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->

**Last verified:** 2026-08-27 01:08 UTC — `npm run verify` **GREEN**

- unit 288 passed · e2e 72 passed

<!-- VERIFY:END -->
## Where we are

**C's second half has started: a clip now shows its own footage.** Thumbnails
are built; the audio waveform is not.

`main` is at `78b656c` and **this unit is committed and pushed.** The commit is
`feat(timeline): let a clip show the footage that is in it` — twelve files, the
three new modules plus the docs and styles around them — and `origin/main` has
it. Nothing described below is still only in a working tree.

The previous unit (C's first half — the timeline's own scale, zoom and ruler
ticks, `docs/adr/0010-the-timeline-has-a-scale.md`) is committed and pushed as
`7e94229`, so `origin/main` has it.

### What is new

Three files, in three layers, deliberately:

- **`src/engine/thumbnails.ts`** (new, pure, 19 unit tests) — `thumbStep` and
  `thumbStrip`: which source frames to ask for, and where each picture goes.
  Node-testable, no DOM, no WebCodecs.
- **`src/ui/thumbnails.ts`** (new, 10 unit tests) — the decode queue and the
  `ImageBitmap` cache. Serial, newest-first, bounded three ways.
- **`src/ui/ClipThumbs.tsx`** (new) — one `<canvas>` per clip, and the effect
  that keeps the other two in step. Nothing else.

Plus: `Timeline.tsx` renders `ClipThumbs` per clip and marks clips whose media
is not bound; `App.tsx` releases an asset's pictures alongside its decode
service and audio; `media.ts` purges them when media is (re-)bound;
`styles.css` gains `.clip-thumbs`, `.sr-only`, `.clip.unlinked` and a ground
for `.clip-name`/`.clip-mark`; `e2e/clip-thumbnails.spec.ts` is new (6 tests).

**No new ADR.** ADR-0010 already named thumbnails as a consequence of giving
the timeline a scale, and nothing here reverses an architectural decision.

### Five decisions a future session would otherwise get wrong

1. **The placement arithmetic is in a NEW sibling module, `engine/thumbnails.ts`,
   not inside `engine/timelineView.ts`.** The previous STATUS said to put it in
   `timelineView.ts`. It reuses `frameToX`/`frameAtX` from there rather than
   re-deriving them, but `thumbStep`/`thumbStrip` are thumbnail-domain concepts
   (a decode-cost-aware grid) and `timelineView.ts` owns the coordinate system
   itself. The waveform is next and wants its own answer to the same question;
   combine the three then, not these two now.

2. **The step is a power of two in FRAMES, and that is the whole cache
   strategy.** A zoom press is x2, so the coarser grid is a subset of the finer
   one and half the pictures survive a zoom step. Any other rounding — "a nice
   round number of frames", "exactly `THUMB_PX` worth" — lands on a different
   set at every zoom and makes each press a full re-decode of the visible strip.

3. **The grid is anchored to the CLIP, not to the viewport.** So scrolling asks
   for the same frames again (cache hits), and a clip always starts with its own
   first frame — which is what identifies it. Anchoring to the viewport would
   re-decode on every pointer event while looking perfectly correct.

4. **The canvas is a window-sized strip positioned inside the clip, never the
   clip's own width.** A zoomed-in ten-minute clip is hundreds of thousands of
   pixels wide; a canvas that size is not allocated, and the browser reports
   nothing — the element stays and the drawing silently disappears.

5. **A picture is keyed by `(assetId, sourceFrame)` and is invalidated by
   SERVICE IDENTITY, not by presence.** A re-link keeps the asset id and swaps
   the decoder, so `getDecodeService(id) === theServiceThisDecodeUsed` is the
   test for "is this picture still of the right file". Both halves matter:
   `media.ts` purges the cache after `setDecodeService` (order matters — see the
   comment there), and `pump()` re-checks identity after every await.

### The bug that only a browser found

The gate was green and four persona reviewers had passed it when the strip was
looked at in Chrome: every thumbnail was the middle of a frame, magnified about
ten times.

**A `<canvas>` is a replaced element.** Absolutely positioned with `height:
auto`, it takes its INTRINSIC height — the `height` attribute — and ignores
`bottom`. `ClipThumbs` sizes that attribute from `clientHeight`, so `top: 0;
bottom: 0` made the two feed each other: the canvas grew a couple of percent per
render and reached **894px tall inside a 42px clip**. Nothing threw. `.clip`'s
`overflow: hidden` hid the overflow, so the only symptom was the magnification.

`.clip-thumbs` uses `height: 100%` now, and
`e2e/clip-thumbnails.spec.ts` asserts the canvas is no taller than the clip
after a zoom round-trip. That test was confirmed red with the fix reverted
(620px in a 44px clip).

This is the second unit running in which looking at the real UI found what the
whole gate could not. It is not optional.

### What the persona round found

Four reviewers (guardrail, QA, a11y, novice), **zero blockers**, and QA and the
guardrail reviewer independently named the same major. Fixed:

1. **The cache survived a media re-link** (QA + guardrail, major). Same asset
   id, different file, stale pictures presented as correct — the failure shape
   this project has shipped before. Fixed by service identity plus a purge on
   bind; two unit tests, both confirmed red with the guard reverted.
2. **A decode landing after its asset was removed** re-inserted an
   `ImageBitmap` into the cache the cleanup had just emptied (QA, major). Same
   identity check; the bitmap is closed instead.
3. **Every visible clip redrew its whole canvas on every playhead tick** — sixty
   times a second during playback, on the thread that is decoding it (QA,
   major). `ClipThumbs` is `memo`ised on the values that change the picture.
   Measured in Chrome afterwards: 20 playhead moves, 0 redraws.
4. **A clip whose file is gone looked exactly like one still decoding** (novice,
   major). It now carries `⚠`, a hatched fill and a dashed border, and an
   `aria-describedby` note.
5. **The selection mark `◉`/`◎` had no ground** and washed out over bright
   footage — about 1.9:1 on white (a11y + novice, major). It carries the same
   pill as the name.
6. **`ui/thumbnails.ts` had no unit tests at all** (QA, minor, but it is the
   riskiest file in the unit). It has 10 now, in Node, with the decoder and
   `createImageBitmap` stubbed.
7. `missing` was the one collection in that file with no bound (QA, minor).

Everything not fixed is in `CLAUDE.md` "Known tech debt" — seven new entries.

### One rule this unit obeyed rather than changed

The unlinked cue was first written into the clip's `aria-label`. That breaks the
DOM contract in `docs/TESTING.md` ("clip `aria-label`: identity + position +
length. **Never state.**"), which exists because four e2e tests once broke over
a label that moved when only state changed. The state moved to
`aria-describedby` and a visually hidden note instead — a description is the
channel state has. `docs/TESTING.md` gained two contract rows (`.clip-thumbs`,
`.clip.unlinked`) but the rule itself was not touched.

## Next single step

**The audio waveform** — C's remaining half.

It is the same shape as this unit and should reuse it: given a visible frame
range and a pixels-per-frame, which columns do I draw. Three things that are
NOT the same, and are the whole difficulty:

- **There is no per-frame decode to cache.** Audio is already fully decoded in
  memory (`engine/audio.ts` holds an `AudioBuffer` per asset — see the tech debt
  entry about `decodeAudioData` on the whole file). So the expensive thing is
  not decoding, it is reducing hundreds of thousands of samples to a few hundred
  peak pairs, and the cache should hold a **peak pyramid** per asset, not
  pictures.
- **`thumbStrip`'s power-of-two step is the right idea for the pyramid too** —
  each level is half the resolution of the one below, and a zoom step moves one
  level. That is the third case; when it lands, consider merging
  `engine/thumbnails.ts` and the waveform module.
- **There is no audio track in the document yet.** The waveform therefore draws
  under the VIDEO clip, from that clip's asset. Decide deliberately whether it
  shares `.clip-thumbs`'s canvas (one draw pass, one memo) or gets its own.

## Blocked / needs the owner

1. **Nothing here is waiting on a commit any more** — the owner said to commit and
   push, and it is done (`78b656c`). The tree still carries the untracked
   `bash.exe.stackdump` — a crash artefact, safe to delete, deliberately never
   staged.

2. **Thumbnail slots can be up to twice the width of the picture in them**, so
   the widest ones crop the frame vertically by up to half. Fixing it properly
   means decoupling the drawing pitch from the cache grid, which changes
   `thumbStrip`'s contract. Left alone deliberately; the owner may disagree.

3. **Unchanged from the previous unit, and still open:** the `m:ss` ruler label
   is a product call the owner can overturn; `MAX_SCALE = 40` px/frame has only
   ever been tried on the three-second fixture; and the two directions the owner
   set — **AWS deployment for real users** and design informed by
   `docs/research/editor-pain-points.md` — have no code yet. The gating question
   is still static hosting (S3 + CloudFront, possible today) versus a real
   backend for projects and media. A consequence worth restating: **a project
   does not follow the user to another machine** — the document is in
   `localStorage`, the video in that browser profile's OPFS.

4. **The remaining backlog, in the order agreed:** the waveform finishes C, then
   B: E7 (subtitles, transitions, audio volume/fades, transform).
