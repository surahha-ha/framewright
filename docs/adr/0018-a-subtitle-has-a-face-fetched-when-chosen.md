# 0018 — A subtitle has a face: three bundled OFL files, fetched when chosen

- Status: Accepted
- Date: 2026-09-15

## Context

E8-2b is the second layer of 예능 자막 (ADR-0017): the words in a brush
face, a pen face, a heavy display face. Four questions had to be settled,
and the owner settled the first three on 2026-09-15.

**Which faces, under what licence?** Every font has a licence. Our use is
three acts at once — the file is served with the app, the glyphs are burnt
into a video, and the user may sell that video — and a paid family often
prices the first two separately. The OFL faces on Google Fonts allow all
three, on two conditions: the licence text travels with the file, and the
file is not modified. Subsetting a Korean face (keeping the common 2,350
syllables to cut a 3 MB file to a few hundred KB) is a modification under
the OFL's Reserved Font Name clause and would force a rename; it also
drops the rare syllables a variety caption reaches for on purpose.

**When does a face load?** Three faces are 7.6 MB as published. On first
load that is several seconds for every user, most of whom will never pick
a face. Fetched on the choice, it is one file for the one person who
asked, cached by the browser after.

**Is the face part of the look?** 강조 and 외침 (ADR-0017) are a colour,
an outline and a size. A yellow outlined brush face is the variety look,
so the face and the look are chosen apart.

**How does the export get the face?** The export draws onto an
`OffscreenCanvas` from a plan built before frame 0; the preview draws from
the same frame objects (ADR-0011, ADR-0017). If the face arrives after
frame 0 is drawn, the file opens in the fallback and switches faces
mid-way.

## Decision

**Three faces, the original files, each with its licence beside it.**
Nanum Brush Script (붓글씨), Nanum Pen Script (손글씨), Black Han Sans
(굵은고딕), the TTFs from the google/fonts repository under
`public/fonts/` with `OFL-<Face>.txt` next to each. No subsetting, no
conversion. `docs/FONTS.md` records the licence terms, how to add a face,
and the faces that need a licence of their own (배민, paid calligraphy
families) for a later unit.

**A field of its own: `font?: 'brush' | 'pen' | 'black'` on the subtitle**,
absent = the system stack; a fourth row 글꼴 in the panel beside 모양. The
engine's whole knowledge of the faces is `engine/fonts.ts`: ids, labels,
the CSS family name and file per face, `fontFamilyStack`, `fontsInPlan`,
the sentences, and the `FontLoader` seam.

**The face goes before the system stack, at weight 400.** `subtitleFont`
builds `"Nanum Brush Script", "Malgun Gothic", …`, so a glyph the face
lacks falls back per character instead of the line changing face; and a
face is always drawn at 400 — the look's 600 / 800 is for the system
stack, and a brush face thickened by a synthetic bold is not the face.

**Loading is behind a seam (rule 8).** `FontLoader { ready, load }` in the
engine; `ui/fonts.ts` is the one place `FontFace` and `document.fonts`
are touched. `load` memoises per face, never throws (false on failure),
and notifies subscribers. It is called on the choice (the panel), by the
preview when a frame under the playhead names a face not on the page (a
reopened document), and by the export — never at app start.

**The export waits.** `exportProject` takes `options.fonts`, collects
`fontsInPlan(plan)` (each face once, first-use order), reports the phase
`'fonts'`, and awaits `load` on each before rendering; a face that does
not come is drawn with the fallback and listed in `ExportResult.
missingFonts`, which the button's sentence names with ⚠.

**While it loads the words are the fallback and the status line says so:**
"자막 글꼴을 붓글씨로 바꿨어요 · 글꼴을 받는 중이에요 · 받으면 바로
바뀌어요.", then "붓글씨 글꼴을 받았어요." and the overlay redraws (a
`fontsVersion` in `Preview`), or "붓글씨 글꼴을 받지 못했어요 · 기본 글꼴로
보여요." The preview's own path (the reopened document) says the same
three, with the face named, so the swap from the system face mid-subtitle
is never a silent change of shape. On a bold look the choice's sentence
adds the one thing the two choices do to each other: "· 외침의 굵은
글씨는 붓글씨 본래 굵기로 보여요." A sentence about a fetch is said only
while the subtitle still wants that face — a second choice, an undo or a
delete in the meantime makes the settle silent, so it never buries a
newer sentence about something else.

**The same radio, pressed again after a failure, is the retry.** The
document already says the face; only the fetch is owed. The press says
"붓글씨 글꼴을 다시 받는 중이에요 · 받으면 바로 바뀌어요." instead of
"이미 붓글씨 글꼴이에요."

**A face this build does not know is the system face, at the look's
weight; a look it does not know is the plain look.** A document from a
later build (a fourth face), or a hand edit, must still draw: the preview
has no error boundary, and a throw in the draw blanks the whole editor.
`knownFont` / `lookSpec` are the two guards; the export neither waits for
nor reports such a face.

**The export's wait answers Cancel.** A `load` cannot be broken into, so
it is raced against `options.signal` (`engine/abort.ts`); otherwise 취소
would wait for a fetch that may never end.

## Consequences

- 7.6 MB of font files are in the repository and in every deploy. They are
  served as static files from the app's own origin, so an export never
  calls a third party; the cost is the first pick of each face, once per
  browser.
- The three faces are OFL only, one licence family. A face with its own
  licence (배민) or a paid one needs its terms checked against the three
  acts above and recorded in `docs/FONTS.md` before it goes in.
- A face is not part of a look, so a fourth radiogroup joined the panel:
  four rows of choices under 꾸미기. A preset that sets all four at once
  ("예능 자막 한 번에") is the obvious next lever and is not built.
- `Preview` draws with whatever `document.fonts` has: a face still in
  flight draws the fallback, and the export in that window waits. The
  preview and the file can therefore differ for the seconds a face takes
  to arrive — the status line is the only sign, and the file is the one
  that waited.
- `ExportResult` grew a field (`missingFonts`). `exportProject` without a
  loader (a test) reports every face missing and draws the fallback.
- The word 글꼴 hints name the face ("나눔붓 · 붓으로 쓴 글씨"); the radio
  itself does not draw a sample in the face. That is a draw-time change
  to `Choices` and is out of scope.
