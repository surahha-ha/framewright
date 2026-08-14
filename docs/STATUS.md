# STATUS — the live handoff

**This file is the handoff.** It is rewritten at the end of every unit of work,
by whoever did the work, before they report anything to the owner.

Write it for a reader with **zero memory of any conversation**. No "as
discussed", no "the fix we talked about", no pronoun pointing at chat history.
If it is not in a file in this repo, it does not exist — chat context dies, the
repo does not.

<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->

**Last verified:** 2026-08-14 01:54 UTC — `npm run verify` **GREEN**

- unit 201 passed · e2e 47 passed

<!-- VERIFY:END -->

## Where we are

**The media is kept now.** Reopening the editor restores the project *and* its
video, with no file picker and no re-linking. That was the fifth of five
candidates offered after E6 and it was taken because it gates the first
impression of every later feature. It is not committed yet — see "Blocked".

Before this, the second visit to framewright looked like a failure: the whole
timeline over a black picture, every asset marked ⚠, and a list of files to go
and find on disk. `ADR-0004` had decided OPFS for exactly this in the MVP, and
`Asset.opfsKey` had been declared for it — but nothing had ever written it, and
there was no OPFS call anywhere in the code.

**Read `docs/adr/0009-keep-the-media.md` before touching any of this.** The
short version:

- `src/engine/mediaStore.ts` — a `MediaRepository` interface (OPFS
  implementation) beside `storage.ts`'s document repository. Nothing in it
  throws; no OPFS, a private window and a full disk all degrade to "not stored".
- **Keys are content addresses** — `media_` + SHA-256 of the bytes. Deterministic
  (rule 4), dedupes a re-import, and knowable *before* the import command runs,
  so the document records it in the same undo entry that creates the asset.
- `asset.attachMedia` — a hidden, args-only command recording `opfsKey` and
  `startOffsetSec`. Recording where the file went is a document edit, so it goes
  through the command spine (rule 2). It refuses when nothing would change.
- `ops.ts` gained `updateAsset`. **Setting a field to `undefined` means removing
  it** — absence is meaningful (`meta.startOffsetSec` missing = imported before
  ADR-0008), and `JSON.stringify` drops undefined anyway, so undo has to produce
  the same document a reload would.
- **One queue for all media work** (`queueMediaWork` in `mediaStore.ts`).
  Restore, sweep and import each race the other two. Everything that touches the
  media store or the decode registry goes through it.
- The GC sweep runs **only at startup**. Undo history is not part of the saved
  state, so mid-session it can still reach an asset the document has dropped;
  sweeping then deletes a file out from under a redo.

Two long-standing tech-debt items died with it: the re-link that changed nothing
in the document (so the next reload asked again), and the ADR-0008 offset warning
that repeated on every re-link forever.

### What the persona round changed

The gate was green before the review and the review still found two blockers.
Both are fixed, and each shipped with a new assertion:

1. **The preview told the user to go and find the file while the restore was
   already opening it** — the largest text on screen, at the exact moment the
   feature was succeeding. `MediaBin` knew it was restoring; `Preview` could not
   see that state. Fixed by moving it into the store (`mediaRestoring`), decided
   synchronously before the first render.
2. **The startup sweep could delete a file that had just been imported** (a
   TOCTOU: the sweep snapshots the live key set, then awaits). Nothing fails that
   session, and the *next* reload reports it as a browser eviction that never
   happened. Fixed by the queue above.

Three more, also fixed: the status bar claimed "이전 작업을 그대로 불러왔어요"
before the media had been read; three `role="status"` regions narrated the same
moment and two of them disagreed (now `.statusbar` is the only announcer); and
the play button, with no media, silently advanced the playhead over a black
canvas — indistinguishable from a freeze.

## Next single step

**Commit this unit** (see "Blocked", item 1), then start **D — the naming
cleanup**, which is item 2 below.

## Blocked / needs the owner

1. **Nothing is committed.** The whole media-persistence unit is in the working
   tree with the gate green (`npm run verify`, and `npx playwright test
   --project=chrome` also 46/46 — the H.264 specs do not self-skip there).
   Committing needs the owner's go-ahead, which is the one hard stop in
   `CLAUDE.md`. Files: `src/engine/mediaStore.ts{,.test.ts}`,
   `src/engine/attachMedia.test.ts`, `src/ui/media.ts` (new);
   `src/engine/ops.ts`, `src/engine/commands.ts`, `src/ui/MediaBin.tsx`,
   `src/ui/Preview.tsx`, `src/store/projectStore.ts`, `e2e/editor.spec.ts`,
   `CLAUDE.md`, `docs/TESTING.md` (modified);
   `docs/adr/0009-keep-the-media.md` (new).

2. **A naming decision, not a defect.** Five controls use "자르기"/"잘라내기"
   and they mean three different things:

   | id | label today |
   | --- | --- |
   | `clip.cut` | 잘라내기 (clipboard cut) |
   | `clip.trimStart` / `clip.trimEnd` | 앞부분 / 뒷부분 **자르기** (drag) |
   | `clip.trimStartToPlayhead` / `clip.trimEndToPlayhead` | 앞부분 / 뒷부분 **잘라내기** (Q / W) |

   The novice persona rated this major: someone trying to "cut 30 seconds out"
   will click the wrong one, and `✂` (split) vs `✁` (cut) are indistinguishable
   at toolbar size. The proposal put to the owner, not yet answered: take the
   word "잘라내기" away from all of them — `clip.cut` → **오려두기** (pairs with
   복사/붙여넣기), the trim-to-playhead pair → **앞부분/뒷부분 버리기**, and give
   split a distinct icon. Renaming shipped commands is a product call.

3. **Visual QA ran, and passed.** Done in the owner's Chrome ("e2e Browser") on
   the real fixture: import → the file is written to OPFS under the content-hash
   key the document records, with `startOffsetSec` 0.0667 → reload → the picture
   is back with no file picker, `.relink` gone, status "영상도 준비됐어요".
   Frame accuracy was checked by eye against the fixture's burnt-in frame number
   at both ends: playhead 89 / burnt-in 89, and 45 / 45 — so ADR-0008's offset
   survives the OPFS round trip. Deleting the stored file and reloading produces
   the re-link path and the play refusal, both correct.
   One finding, fixed with an assertion: the media panel printed the same
   filename twice, 20px apart (once in the "pick it again" box, once in the
   asset list below), which reads as two separate problems. The box no longer
   lists names.
   **The 1280px layout was checked too**, but through Playwright rather than the
   extension: the extension's `resize_window` reported success and did nothing
   (the window was maximised — `innerWidth` stayed 1828), so the check was moved
   to a fixed viewport, screenshotted to disk and read. Nothing clips and the
   page never scrolls sideways in any of the four states; the toolbar wraps to
   two rows, which is fine. That is now `e2e/narrow-layout.spec.ts`, so it
   cannot regress unseen.

   **One thing it could not settle: persistent storage.**
   `navigator.storage.persist()` returns **false** and the `persistent-storage`
   permission sits at `prompt` — Chrome denied it silently, without asking.
   Quota is 10GB, so it is not a space problem; Chrome grants persistence on
   engagement heuristics (bookmarked, installed, notification permission, high
   engagement score) and a freshly-visited dev origin qualifies for none of
   them. **So the media store is evictable in practice, and "the browser lost
   your file" is a real path, not a hypothetical one** — it is covered by the
   re-link tests, but nothing in the UI ever warns the user it can happen.
   To decide it properly: bookmark `127.0.0.1:9990` in the test Chrome and
   re-run `await navigator.storage.persist()`; and re-measure on the deployed
   HTTPS origin, where the heuristics actually apply. Both are cheap; neither
   has been done.

4. **Two directions the owner set, neither started as code.** Deployment on
   **AWS for real users**, and design informed by what real users complain about
   in Premiere / Final Cut / DaVinci / CapCut / browser editors
   (`docs/research/editor-pain-points.md`). The gating question is unchanged: is
   this static hosting (S3 + CloudFront, possible today) or does it need a
   backend for projects and media? Media persistence deliberately did not depend
   on the answer — it is per-browser-profile only, which is the local half of
   ADR-0004; the `srcUrl` half is where that question lands.

5. **The remaining backlog the owner asked for, in the order agreed:** D (naming,
   item 2), then C — timeline zoom + ruler ticks + thumbnails + waveform, then
   B — E7 (subtitles, transitions, audio volume/fades, transform).
