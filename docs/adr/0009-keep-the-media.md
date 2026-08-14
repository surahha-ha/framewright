# 0009 — Keep the media, so re-linking stops being a thing

- Status: Accepted
- Supersedes nothing. Implements the local half of ADR-0004.

## Context

Reopening the editor restored the document and nothing else. Every asset came
back as a name with a warning triangle, the preview drew black, and the user had
to find each file on disk again before the timeline they were looking at meant
anything. That was the **second** thing anyone ever saw of framewright.

ADR-0004 decided OPFS for exactly this, in the same breath as `srcUrl` /
`opfsKey` on `Asset`. Neither had been built: `opfsKey` was declared and never
written, and there was no OPFS call anywhere in the codebase.

Re-link also leaked. Attaching a file changed nothing in the document, so:

- the next reload asked again, and the one after that;
- the "이 영상은 시작 지점이 어긋나 있어" warning (ADR-0008) repeated forever,
  because the thing that would have silenced it — recording `startOffsetSec` on
  the asset — is a document edit that the re-link path refused to make.

## Decision

**Keep the imported file in OPFS, keyed by its content hash, and record that key
in the document through a command.**

Three parts:

1. **`src/engine/mediaStore.ts`** — a `MediaRepository` interface (`put` / `get`
   / `has` / `remove` / `keys`) with an OPFS implementation, alongside
   `storage.ts`'s document repository. Nothing in it throws: no OPFS, a private
   window and a full disk all degrade to "not stored", and the caller falls back
   to asking for the file. Losing media is recoverable; a crash on import is not.

2. **Keys are content addresses** — `media_` + SHA-256 hex of the bytes. This is
   deterministic (CLAUDE.md rule 4: no clock, no randomness), it dedupes a
   re-import for free, and — the reason it matters most — the key is known
   **before** the import command runs, so the document records it in the same
   undo entry that creates the asset.

3. **`asset.attachMedia`** — a hidden, args-only command carrying
   `{ assetId, opfsKey, startOffsetSec }`, with an inverse. Recording where the
   file went is a document edit, so it goes through the spine like every other
   edit (rule 2). It refuses when nothing would change, so re-attaching the same
   file cannot pile up empty undo steps.

4. **One queue for all media work** (`queueMediaWork`). Restore, sweep and
   import each race the other two, and all three races end the same way — a
   file that is gone, or a decoder nobody released. Three separate guards were
   the first attempt and two of them were wrong; serialising is one small
   function and removes the class:
   - _restore vs import_: the import finds the asset "missing" (its decoder is
     not registered yet), opens the file again and registers a second
     `VideoDecodeService` over the first, which pins every encoded sample of
     the source and is never released.
   - _sweep vs import_: the sweep decides what is live **before** the import
     commits the asset, and deletes the file that was just written. Nothing
     fails that session — the decoder came from the `File`, not from storage —
     and the next reload reports it as an eviction the browser never did.
   - _import vs import_ (a double-fired picker, a duplicated drop): both see the
     same pre-import document and the project ends up with two clips for one
     file.

   Inside the queue the React render closure is a document behind, so the
   import reads `editor.project`, not the mirrored state.

`ops.ts` gains `updateAsset`. Setting a field in it to `undefined` **means
removing it**: absence carries meaning (`meta.startOffsetSec` missing = imported
before ADR-0008), and `JSON.stringify` drops undefined anyway — so a merged-in
`undefined` would survive in memory and vanish on reload. Undo has to produce
the same document you get by reopening.

## Consequences

- A reload reopens the project **and** its media. `MediaBin` decides on its very
  first render whether a restore is pending, so "다시 선택 필요" never flashes.
- Re-link survives as the recovery path for a store that lost the file — no
  OPFS, private window, eviction — and it now writes the key down. That ends the
  repetition it used to cause on its own (a re-link that changed nothing, so the
  next reload asked again, and the ADR-0008 offset warning that repeated
  forever). It does **not** promise a re-link happens only once: an evictable
  store can lose the file again, and then the user is asked again.
- **Garbage collection runs only at startup.** A file is garbage when neither
  the current document nor any saved version points at it (`liveMediaKeys`
  unions both — a version restore brings its assets back, and sweeping on the
  current document alone would make that restore a dead end). Mid-session,
  undo history can still reach an asset the document has dropped, and sweeping
  then would delete the file out from under a redo. At startup there is no
  history to contradict.
- `navigator.storage.persist()` is requested once, at the first import. A
  refusal is not an error; the store is simply evictable — and **the refusal is
  now told to the user**, once per page load, as one sentence on the end of the
  import's own status line (`takeEvictionNote`). Measured on 2026-08-14: Chrome
  refuses silently on a fresh origin, so this is the ordinary case for a
  first-time visitor, not an edge one. Nothing is said when persistence was
  granted, when the API is absent, or when the file was not stored at all —
  that last case already has its own sentence.
- The import path holds the whole file in memory twice for a moment (the audio
  copy, and the blob OPFS is writing). Acceptable for MVP-sized footage; a
  streamed write is the fix when it stops being.
- Hashing is one extra pass over the bytes at import (~1GB/s). Nothing else in
  the pipeline got slower.
- Media is not versioned or shared between projects yet, but content addressing
  means it could be: two documents referencing the same key already share the
  one copy.
