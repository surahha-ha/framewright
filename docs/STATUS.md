# STATUS — the live handoff

**This file is the handoff.** It is rewritten at the end of every unit of work,
by whoever did the work, before they report anything to the owner.

Write it for a reader with **zero memory of any conversation**. No "as
discussed", no "the fix we talked about", no pronoun pointing at chat history.
If it is not in a file in this repo, it does not exist — chat context dies, the
repo does not.

<!-- VERIFY:BEGIN — written by `npm run handoff`, do not edit by hand -->

**Last verified:** 2026-08-14 06:26 UTC — `npm run verify` **GREEN**

- unit 222 passed · e2e 51 passed

<!-- VERIFY:END -->

## Where we are

Two units landed here, in this order:

- **Media persistence** — `4b60b13`. `docs/adr/0009-keep-the-media.md` is the
  argument; nothing about it is outstanding.
- **D, the naming cleanup** — `dd4d451`, committed with the owner's go-ahead.
  Described below.
- **The eviction hint** — in the working tree, **not committed**, and it is the
  only thing uncommitted (see "Blocked", item 1). It is small and separate on
  purpose: the owner approved it as its own step before C.

**Neither commit is pushed.** `origin/main` is still at `4b60b13`, so a clone
elsewhere does not have any of this yet.

### The eviction hint (uncommitted)

OPFS keeps the imported file, but `navigator.storage.persist()` returns **false**
on this origin and Chrome never asks — persistence is granted on engagement
heuristics (bookmarked, installed, high engagement) that a freshly-visited dev
origin has not earned. So "the browser lost your file" is the ordinary case, not
a hypothetical one, and the UI never said so.

It says so now, in one sentence on the end of the import's own status line:

> · 저장 공간이 부족해지면 이 브라우저가 영상을 지울 수 있어요. 원본 파일은
> 지우지 말고 그대로 두세요.

- **Only when the browser actually refused.** Granted, no API, and "could not be
  stored at all" are all silent — the last already has its own sentence, and two
  warnings about one file read as two problems.
- **At most once per page load** (`takeEvictionNote`). A refusal is the DEFAULT
  for a first-time visitor, so appending it to every import would put a warning
  on the end of every success message a beginner ever sees. Page-lifetime state,
  not a React ref: StrictMode mounts twice and a ref would say it again.
- **The in-flight promise is cached, not the settled value**
  (`requestPersistentStorage`). Caching the value only guards a caller arriving
  after the first finished; two arriving together would both ask the browser and
  race to write the answer, so a refusal could be overwritten by a later
  `unknown`. The media queue serialises the one call site today, but that safety
  lives in the caller.
- It lives in `src/engine/mediaStore.ts`, not `src/ui/media.ts`, **so it can be
  unit-tested**: `ui/` has no Vitest specs at all (it pulls in WebCodecs), and
  `navigator.storage` mocks in Node in three lines.

### D — the naming cleanup (`dd4d451`)

Five controls said 자르기 / 잘라내기 and meant three different edits, and `✂`
(split) sat three buttons from `✁` (clipboard cut) — the same shape at toolbar
size. Someone wanting to drop the first 30 seconds was picking by coin flip.
The words are now partitioned, and `docs/UX.md` ("One word, one meaning — and
one shape") is the normative record:

| edit                                  | label now                                 | glyph   |
| ------------------------------------- | ----------------------------------------- | ------- |
| clipboard cut (`Ctrl+X`), `clip.cut`  | 잘라내기                                  | `✂`     |
| split (`C`), `clip.split`             | 나누기                                    | `◫`     |
| trim to playhead (`Q`/`W`)            | 재생 위치까지 앞부분 / 뒷부분 줄이기      | `◧` `◨` |
| one-frame nudges (`Alt`+arrows)       | 앞부분 / 뒷부분 한 프레임 줄이기 · 늘리기 | —       |
| drag an edge (`clip.trimStart`/`End`) | 앞부분 / 뒷부분 조절 (끌기)               | —       |

### The decision that was taken, and how it differs from the one on file

The proposal recorded in the previous handoff was: `clip.cut` → **오려두기**, the
`Q`/`W` pair → **앞부분/뒷부분 버리기**. **That is not what shipped**, and the
reasoning is the part worth keeping:

1. **잘라내기 is the standard Korean word for `Ctrl+X`** — Windows, Office,
   한글 all use it. Renaming the clipboard would have made framewright the odd
   one out at the one place a user's muscle memory is strongest. The collision
   was caused by the _trim_ commands borrowing the word, so the trims moved
   instead.
2. **줄이기 rather than 버리기**, because the six one-frame nudges already said
   `앞부분 한 프레임 줄이기 / 늘리기`. `Q`/`W` are the same edit at a different
   size, so they now read as one family. 버리기 would have invented a third word
   for an edit that already had one.
3. A drag says **조절**, not 줄이기, because pulling a handle outwards puts
   trimmed media **back**. That label never renders (the drag commands are
   `requiresArgs`, so the toolbar, palette and shortcut list all skip them).
4. `Q`/`W` carry **재생 위치까지** in the label itself. Without it the button
   reads as "make the front smaller" by an unsaid amount, and a tooltip is not
   where the deciding fact can live.

**This is a product call and the owner can overturn any of it** — see "Blocked",
item 2. Nothing else depends on the wording.

### What else changed, and why

- **`describeEdit` no longer hedges when it does not have to.** It takes an
  optional `lengthBefore`; a nudge and a drag both pass it, so the sentence says
  줄였어요 / 늘렸어요 instead of 조절했어요 whenever the direction is known.
- **A trim of the tail now reports the hole it opens.** `Q` announced a gap and
  `W` said nothing, though both can leave one. The gap note also only ever names
  the side the edit could have opened — calling a hole that was already there
  "생겼어요" is a claim the user cannot check.
- `ExportButton`'s `⬇` is wrapped in `aria-hidden` like every other toolbar
  glyph.
- The ADR-0008 re-link warning says 편집해 둔 자리, not 잘라 둔 자리.

### The guards, and why there are three

No single layer sees the whole surface, so the vocabulary rule is asserted in
three places and **none of them is sufficient alone**:

- `src/engine/vocabulary.test.ts` — the command registry: no label carries
  자르/잘라, no name is or contains another, glyphs are unique, and the scissors
  belong to the clipboard. Also covers `describeEdit`'s wording, which had **no
  test at all** before this unit.
- `e2e/personas.spec.ts` "no two toolbar buttons share a shape or a word" —
  adds the app actions (`clip.cut`, `clip.copy`, undo/redo), which cannot be
  imported in Node.
- `e2e/personas.spec.ts` "the shortcut list names every action distinctly, too"
  — adds the keyboard-only commands, which never reach the toolbar.

Both e2e checks compare **by position, not by value**: filtering with
`l !== label` would let two buttons carrying the identical string cancel each
other out and pass.

### What the persona round changed

Gate was green before the review; all four reviewers (novice, a11y, QA,
guardrail) returned **zero blockers**. Five findings were fixed anyway, each
with an assertion:

1. `Q`/`W` did not say "to the playhead" anywhere a user would look (novice,
   major) → it is in the label now.
2. `W` never announced the gap it can open (a11y, major) → fixed in
   `describeEdit`, with a test for the side it must _not_ claim.
3. The e2e label check could not catch two buttons with the **identical** label
   (QA, major) → compared by position now.
4. The unit spec's own comment implied a coverage it did not have (QA, major) →
   the comment now says which half it guards and where the other half lives.
5. The hint line listed the nudges as bare nouns ("앞부분", "뒷부분") while
   their buttons had verbs (novice, minor) → "앞부분 늘리기·줄이기".

### One trap this unit walked into, now written down

`getByRole('button', { name: '재생' })` had passed for months and suddenly
resolved to **three** elements, failing two unrelated specs, because Playwright
matches an accessible name by **substring** and two commands are now named
`재생 위치까지 … 줄이기`. It looks like a broken feature and is a broken
selector. `docs/TESTING.md` has the rule now; the two call sites pass
`exact: true`.

### What the persona round changed in the eviction hint

Three reviewers, zero blockers, two findings fixed:

1. **It fired on every import** (novice, major). Since a refusal is the default
   for a new visitor, a beginner assembling one edit from five clips would have
   read the same warning five times and learned to stop reading the status line.
   Now once per page load, pinned by a test whose sequence IS the assertion.
2. **`requestPersistentStorage` cached the settled value, not the in-flight
   promise** (QA, major, latent). Unreachable today — the media queue serialises
   the only call site — but the safety lived in the caller, and a "try again"
   button would have taken it away silently. Moving the function into the engine
   made it unit-testable, which is how the concurrent case is now pinned at all.

Not fixed, deliberately: the sentence carries no `⚠`, unlike the incomplete-read
warning three lines above it in the same status builder. It matches its actual
sibling — `NOT_KEPT`, the other media-storage sentence, which has no icon
either — and the owner asked for a quiet line. Recorded as debt, not dropped.

### Visual QA ran, and passed

In the owner's Chrome at 1568px: the toolbar is one row, nothing clips, `◫` and
`✂` are plainly different shapes, and the palette, the shortcut list and the
timeline hint all read in full. The 1280px case is covered by
`e2e/narrow-layout.spec.ts`, which is green.

**Two connected browsers, and only one of them can see the app.** "Browser 2"
returns `ERR_CONNECTION_REFUSED` on `http://127.0.0.1:9990` while the dev server
answers 200 on this machine — it is a Chrome on a different device, even though
`list_connected_browsers` reports `isLocal: true` for both. "Browser 1" is the
one that works. Check this first; it has cost two sessions an hour each.

## Next single step

**Commit the eviction hint and push both commits** (item 1 below), then start
**C — timeline zoom + ruler ticks + thumbnails + waveform**.

## Blocked / needs the owner

1. **The eviction hint is uncommitted, and nothing is pushed.** Announcing
   before any git operation is the one hard stop in `CLAUDE.md`.
   Uncommitted files: `src/engine/mediaStore.ts`,
   `src/engine/mediaStore.test.ts`, `src/ui/media.ts`, `src/ui/MediaBin.tsx`,
   `e2e/editor.spec.ts`, `docs/adr/0009-keep-the-media.md`, `docs/STATUS.md`.
   `origin/main` is at `4b60b13`, two commits behind local `main`.
   Also untracked and deliberately NOT staged: `bash.exe.stackdump`, a crash
   artefact from a shell that died mid-session. It is safe to delete.

2. **The naming scheme is the owner's to overturn.** It differs from the
   proposal recorded before this session; the four reasons are above. If any of
   it is wrong, the change is cheap — labels and icons only, no behaviour, and
   the three guards will hold whatever words replace them.

3. **Whether to warn about eviction — ANSWERED, and built** (see "Where we
   are"). The owner chose the quiet hint: one line on the import status line,
   only when the browser actually refused. Nothing here is still open.
   What was **not** done, and was not required: the two measurements that would
   pin down when Chrome grants persistence — bookmark `127.0.0.1:9990` in the
   test Chrome and re-run `await navigator.storage.persist()`, and re-measure on
   the deployed HTTPS origin, where the engagement heuristics actually apply.
   Neither changes the code; both would tell us how often real users see the
   hint. Worth doing when there IS a deployed origin (item 4).

4. **Two directions the owner set, neither started as code.** Deployment on
   **AWS for real users**, and design informed by `docs/research/editor-pain-points.md`.
   The gating question is unchanged: static hosting (S3 + CloudFront, possible
   today) or a real backend for projects and media? Media persistence
   deliberately did not depend on the answer — it is per-browser-profile only,
   the local half of ADR-0004; the `srcUrl` half is where that question lands.
   A consequence worth stating: **a project does not follow the user to another
   machine.** The document is in `localStorage` and the video is in that
   profile's OPFS, so a second PC opens neither.

5. **The remaining backlog, in the order agreed:** C — timeline zoom + ruler
   ticks + thumbnails + waveform, then B — E7 (subtitles, transitions, audio
   volume/fades, transform).
