# 0008 — Media time starts at the first picture, not at the container's clock

- Status: Accepted

## Context

`e2e/fixtures/sample-h264.mp4` burns its own frame number into the picture. Visual
QA in real Chrome read the playhead at 22 / 44 / 69 / 89 while the picture read
**20 / 42 / 67 / 87**. Probing the container explained it exactly: the file has
B-frames, its first sample's `cts` is **1024** at timescale **15360** — two frames
at 30fps — and there is **no edit list** to take that offset back out.

Everything downstream computed a time as `frame / fps` seconds (ADR-0002: the
timeline is a CFR integer-frame clock) and matched it against the raw container
`cts`. So the whole source was two frames early, and — worse — the last two
frames of the media sat past the end of the timeline, where nothing could reach
them. `PlaybackSession`, `VideoDecodeService.decodeAtSec` and the exporter all
share that mapping, so preview and export agreed with each other (golden rule 7
held) while both were wrong about the file.

An MP4 can express this properly with an edit list, and a well-formed file does.
Plenty of real files do not, and an editor does not get to demand well-formed
input.

## Decision

**A source's time starts at its own first presented sample.** `demuxVideo` and
`demuxAudio` rebase every sample through `rebaseToPresentationStart` before
anyone sees them: the earliest `cts` across the track becomes 0, and `dts` shifts
by the same amount (which may make it negative — nothing consumes `dts`, and the
relationship `dts <= cts` is what matters). `DemuxSample.cts` therefore means
_presentation time from the start of this track_, never container time.

The correction runs in **both directions**. `ctts` version 1 offsets are signed,
so an encoder may present its first picture _before_ the track's zero rather than
shifting the whole track up. Left alone, that picture is unreachable — every
non-negative timeline position resolves to a later sample — and the tail runs off
the end exactly as it does for a late start. Only an offset of exactly zero is a
no-op.

**And the duration comes from the samples, not the header.** The container's
`mdhd` duration is not reduced by the offset just removed. Where the extraction
is complete and every sample carries a duration, `presentationSpan` measures how
far the media actually reaches, and that wins; the header is the fallback. A
timeline sized from a header that overstates the media does not error — preview
freezes on the last picture and export writes it again, at the right frame count,
silently. That is the worst shape a defect can have here.

Three more things follow, and they are the reasons this is the decision:

- **Demux is the seam that owns container quirks** (golden rule 8). Fixing it
  there fixes playback, scrub and export at once. Fixing it in `PlaybackSession`
  would have left `decodeAtSec` wrong, and would have meant threading an offset
  through every decode call site.
- **The offset is per track, taken from that track's own samples.** This is what
  ffmpeg does by default (each stream is rebased to its earliest timestamp unless
  `-copyts` says otherwise), and it is what the case that produced this defect
  wants: the video's offset is reorder delay and the audio has none, so zeroing
  each track independently puts them back together. **This is an assumption the
  code does not verify.** If a file's audio track carries a real offset of its
  own, both tracks are zeroed anyway and the two drift apart by the difference,
  uniformly and silently — and the audio pipeline cannot even see it, because
  `decodeAudioData` never goes through demux and `decodeAudioTrack` concatenates
  decoded PCM in callback order, ignoring `cts` entirely. Recorded as tech debt
  rather than guessed at: no fixture of that shape exists to fix against.
- **The edit list is not read.** For the case that produced this defect — a
  reorder-delay offset and no edit list — `min(cts)` gives the identical answer a
  correct edit list would. A file whose edit list deliberately starts _later_
  than its first sample (a trim expressed as an edit) would be treated as if that
  material were still available, which for an editor is the forgiving direction.
  Reading `elst` is a real feature, not this fix, and there is no fixture for it.

`startOffsetSec` is reported on `DemuxResult` / `DemuxAudioResult` so what was
removed is visible rather than silent.

## Consequences

- `DemuxSample` is no longer a faithful record of the container. Anything that
  ever needs true container time (remux without re-encode, a passthrough export,
  reading an edit list) must get it from `startOffsetSec`, not by assuming `cts`.
- A project saved before this change stores `inFrame` / `outFrame` against the
  old, offset mapping. Re-linking such a file shifts its content by the offset —
  for the fixture, two frames. There is no migration: the old mapping was wrong,
  the frame numbers still mean "frames into the source", and the correction is
  what the user wanted in the first place. It is not silent, though:
  `AssetMeta.startOffsetSec` records what was removed at import, so a re-link can
  tell "imported with the correction" from "imported before it existed" and says
  so in the status line for the second case.
- Three regression tests, because this is invisible to unit tests alone:
  `e2e/source-offset.spec.ts` runs the **real fixture** through `demuxVideo` and
  asserts timeline frame _n_ is media frame _n_ for every _n_ (it needs no
  decoder, so unlike the import/export specs it cannot self-skip on bundled
  Chromium); `e2e/playback-session.spec.ts` drives synthetic samples offset in
  **both** directions through the same seam into a real decode session; and
  `presentationSpan` / `rebaseToPresentationStart` are unit-tested in Node.
