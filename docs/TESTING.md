# Testing strategy

## Pyramid

1. **Unit (Vitest, Node — fast, no browser).** Pure engine only: time-model,
   document reducers, commands + undo, ID generation, VFR detection, export plan,
   codec-level/letterbox math, and the frame-selection rules (`drainPlan`,
   `isContinuous`). **This is where we do TDD.**
2. **Browser e2e (Playwright).** Everything that needs real WebCodecs: decode
   sessions, playback, import, split/delete in the real UI, and export.
3. **Visual QA (Claude in Chrome).** A real Chrome, driven and _looked at_.
   See below — this is a distinct layer, not a slower e2e.
4. **Manual harness.** `webcodecs_verify.html` for exploratory codec /
   seek-latency / memory checks on real footage.

## Why the split

WebCodecs, Canvas, and OPFS do not exist in Node/jsdom, so they cannot be unit
tested. Keep them behind interfaces, unit-test the pure logic, and cover the
browser paths in Playwright.

The engine must stay **loadable by Node** — no browser globals at module scope and
no TypeScript constructor parameter properties (Node's type-stripping runner
rejects them). `npm run check:guardrails` enforces the first part.

## Commands

- `npm run verify` — **the gate**: refs → guardrails → typecheck → unit → e2e
- `npm test` — unit tests once
- `npm run test:watch` — watch mode
- `npm run typecheck` — types only
- `npm run e2e` — Playwright against bundled Chromium
- `npm run e2e:lowmem` — the same run on one worker, for a machine under memory
  pressure (see below)
- `npm run e2e:chrome` — Playwright against your installed Google Chrome
- `npm run e2e:ui` — interactive Playwright runner

## How much memory an e2e run costs

Every Playwright worker runs its own `chrome-headless-shell`, and one instance
peaks around **425MB** — renderer ~148MB, the network and storage utilities
~122MB together, gpu-process ~81MB, browser process ~82MB. Only the renderer is
ours; the rest is Chromium's fixed floor, so the total is set almost entirely by
**how many browsers run at once**.

Measured on this suite (peak resident across all `chrome-headless-shell`
processes, sampled at 1s; wall clock from two runs each):

| workers        | peak     | processes | wall clock |
| -------------- | -------- | --------- | ---------- |
| 4 (PW default) | ~1,110MB | 16        | 26–28s     |
| **2 (ours)**   | ~770MB   | 10        | 27s        |
| 1 (`:lowmem`)  | ~425MB   | 5         | 43s        |

Playwright's default is half the cores, which on a 12-core machine means one
worker per spec file. That buys nothing: with four spec files the run is
bottlenecked by the longest one, so **two workers are exactly as fast as four**
and cost a third less memory. Going to one worker is the first setting that
actually serialises the critical path, which is why it costs 16s.

Two things that look like levers and are not, both measured:

- **`--disable-gpu` saves nothing** (426MB vs 428MB). `chrome-headless-shell`
  still starts a gpu-process for SwiftShader.
- **`--trace off` saves ~10%** (384MB vs 428MB) and costs every failure trace.
  Not worth it; `retain-on-failure` stays.

There is no leak to chase here. On a single worker, memory sawtooths between
~310MB and ~430MB for the whole run and does not trend upward — the renderer is
torn down and rebuilt at each test. A run that ends normally leaves zero
processes behind; leftover `chrome-headless-shell` processes mean a previous run
was killed rather than finished, and they are safe to kill by name.

## Dev server address

`dev-server.ts` is the single source of truth (host + port) for both Vite and
Playwright. If they disagree, Playwright fails with
`Timed out waiting ... from config.webServer` — that is a port mismatch, not a
broken test. Override per-run with `FRAMEWRIGHT_PORT`.

**Leaving `npm run dev` running is fine and expected.** `webServer.reuseExisting‑
Server` is pinned to `true` (not Playwright's `!process.env.CI` default), because
`npm run handoff` sets `CI=1` and the default turned an already-open dev server
into `http://127.0.0.1:9990 is already used` — a hard failure that looks like a
test failure and isn't one. Vite serves from disk, so reusing a live server never
runs stale code; restart it by hand only after changing `vite.config.ts` or
dependencies.

`npm run handoff` recognises this class of problem and labels it **"not a code
failure"** in `docs/STATUS.md`, so a session picking the work up does not go
hunting for a bug that isn't there.

## ⚠ Codec availability in test browsers

Playwright's bundled Chromium is the **open-source build: it has no H.264**
(VP8/VP9/AV1 only). So:

- `e2e/playback-session.spec.ts` picks whatever codec the browser supports — it
  runs everywhere.
- `e2e/source-offset.spec.ts` needs **no** codec at all: demux only parses the
  container. It therefore runs everywhere too, which is the point — the defect it
  guards was found in the real H.264 fixture, and a spec that self-skipped on the
  machine running the gate would have guarded nothing.
- Import/export tests need H.264 (our fixture and our export target) and
  **self-skip** on bundled Chromium. Run them with `npm run e2e:chrome`.

## Regression tests worth knowing about

Three shipped bugs live on as tests, because all three were invisible to unit
tests:

- **"the picture is two frames behind the playhead"** — a source whose
  presentation does not start at zero (B-frames, no edit list) was matched
  against raw container `cts`, so every frame rendered early and the last two
  frames of the media were unreachable. Found by visual QA, not by the gate.
  Rule extracted as `rebaseToPresentationStart` (ADR-0008); covered by
  `e2e/source-offset.spec.ts` against the **real fixture** and by
  `e2e/playback-session.spec.ts` through a real decode session.
- **"the picture stays black after re-linking a file"** — re-linking changes
  nothing in the document (same project object, same playhead), so the preview's
  scrub effect never re-ran and the stage stayed black until the playhead
  happened to move. Fixed with `mediaVersion` in the store; covered by
  `e2e/editor.spec.ts` → "the picture comes back without touching the playhead",
  which reads the canvas pixels rather than trusting the DOM. Also found by
  visual QA, in the same pass.

- **"plays fast after a cut"** — a clip starting mid-source answered with the
  newest _buffered_ frame instead of the requested one while the decoder was
  still catching up. Rule extracted as `drainPlan`; behaviour covered in
  `e2e/playback-session.spec.ts`.
- **"freezes when you split during playback"** — the fix above stopped consuming
  frames while undecided, jamming the buffer. Covered by the same spec, plus
  `isContinuous` (a split must not restart the decoder at all).

## Visual QA — what Playwright structurally cannot do

Playwright checks what someone **thought to assert**. It will happily report all
green while the drag readout overflows its container, the gap hatching is
invisible against the track, a label is clipped to "빈 곳 없애…", or the timeline
collapses at 1280px. Nobody wrote an assertion for those, because you do not
know to write it until you have seen it.

A driver attached to the owner's real Chrome closes that gap: it drives the
real UI and takes screenshots that get _read_. **Which driver depends on the
session, the rules do not:**

| Session     | Driver                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | Claude in Chrome (the extension, `list_connected_browsers`)                                                                                  |
| Codex       | dev-browser (`sawyerhood/dev-browser`) — launch mode in practice; attach mode hung against the owner's real Chrome on 2026-09-14 (see below) |

The gate (`npm run verify`, Playwright) is the same in both and is never
replaced by either driver. Two things follow from "real Chrome":

- **H.264 works**, so import, playback and export run on actual footage — no
  self-skipping, unlike bundled Chromium.
- It is the browser the owner actually uses, with their zoom, fonts and window
  size.

### It is a layer, not a gate

Visual QA is **not** part of `npm run verify` and never will be. It is
non-deterministic, needs a live extension connection, and its output is a
judgement rather than a boolean. Treat it as the step between "the gate is
green" and "the owner looks at it".

### The rule that keeps it from becoming a treadmill

**Every visual finding must leave behind an assertion.** If the readout
overflows, the fix ships with an e2e check on its width or on
`scrollWidth <= clientWidth`. If a control is unreachable at a narrow width, the
fix ships with a viewport-sized spec. Otherwise the same defect returns and is
only caught by someone happening to look again — which is exactly the failure
mode this project already has a history of.

### What to actually look at

Assertions cover behaviour; look for what they cannot say:

- **Text**: anything clipped, wrapped mid-word, or overflowing — the status bar,
  the drag readout, toolbar labels, clip names in a narrow clip.
- **The timeline at rest and mid-drag**: does a gap read as a gap? Is the pinned
  stub of an off-screen clip visible? Are the trim handles findable on hover,
  and on keyboard focus?
- **Disabled state**: `aria-disabled` buttons must _look_ unavailable — the
  hover style must not fire on them.
- **Contrast and focus rings** on the real background, not in a mockup.
- **A real drag with a real mouse**: does the clip land where you aimed? Does
  snapping feel like help or like fighting?
- **Console**: any error or warning during import → play → edit → export.
- **Narrow window** (~1280px) and a **long timeline** (a dozen clips).

### Running it

Three rules hold for both drivers:

- **Confirm which browser before touching it.** The driver may be attached to
  a Chrome the owner did not mean, or to one on another machine (see the
  operational facts below). Name the browser you are about to drive and get
  the owner's yes.
- **Leave the document as you found it.** A visual pass edits a real project;
  undo what you did (Ctrl+Z, or the frame radio back to 가로) and say which
  "자동 저장" snapshots the pass left in 이전 상태, because the driver keeps
  the profile and nothing cleans it for you.
- **Every visual finding ships with an assertion** (the rule above).

**Claude Code.** The owner must have the Claude in Chrome extension connected,
with site permission granted for the dev server host (`127.0.0.1:9990`). Check
with `list_connected_browsers` first; an empty list means it is not available
and the visual pass is simply skipped — say so rather than guessing.

**Codex.** dev-browser (`npm install -g dev-browser`, Playwright underneath;
0.2.9 is on this PC) runs as a daemon that keeps named pages open between
scripts, so a pass is a series of short scripts against one page rather than
one long one; scripts run in a QuickJS sandbox with a `browser` global whose
pages are Playwright `Page`s, and `saveScreenshot` writes to
`~/.dev-browser/tmp/`. **Attach mode** — connecting to a Chrome the owner
already has open — is what the rules above want, and on 2026-09-14 it did
not work against the owner's real Chrome: with Chrome's own toggle
(chrome://inspect/#remote-debugging, Chrome ≥ 144; writes
`DevToolsActivePort`, no `/json` HTTP endpoints) raw CDP attaches instantly,
but dev-browser's `connectOverCDP` never returns against that profile (16
tabs, extensions) — three attempts, daemon restarted between them, 60–120 s
each. The classic `--remote-debugging-port` route needs a NON-default
`--user-data-dir` on current Chrome, which is not the owner's profile either.
So in practice the Codex pass runs in dev-browser's **launch mode** (its
own Chrome, 145 here, H.264 confirmed, no extensions, a fresh profile): it
shows layout, wording and the strip, and it does NOT show the owner's zoom,
fonts or saved project. Say which mode the pass ran in. Read the page through
its accessibility snapshot first and take a screenshot only where the
question is visual (a clipped label, a gap, contrast); screenshots are what
makes a pass expensive. If no daemon is available, say so and skip the pass.
Two operational facts: the daemon needs the user profile folder
(`~/.dev-browser`) — inside the Codex sandbox it failed with "Could not
determine the home directory for the embedded daemon runtime", which does
not reproduce outside the sandbox even with HOME/USERPROFILE unset; and a
script that hangs holds the daemon's browser lock, so the next script waits
too — `dev-browser stop` clears it.

Save the screenshots and send them. The owner's own pass should start from
evidence, not from a blank page.

### Operational facts the setup above does not tell you

Learned running the pass. Each of these otherwise produces a confident wrong
conclusion.

- **The dev server is usually already up.** `npm run dev` failing with
  `Port 9990 is already in use` is the normal case, not a problem.
- **The connected browser may not be on this machine at all.** The extension
  connects per Claude account, so a Chrome on another computer signed into the
  same account shows up in `list_connected_browsers` — with `isLocal: true`, and
  looking entirely normal. Driving it produces a failure that mimics a broken
  dev server: `http://127.0.0.1:9990` is _that_ machine's loopback, so it lands
  on an error page, screenshots fail with `Frame with ID 0 is showing error
page`, and this machine's `netstat` shows no connection attempt at all — while
  `curl` here returns 200 the whole time. **The tell:** close every Chrome on
  this machine and call `list_connected_browsers` again. If a browser is still
  listed (and `connectedAt` has not changed), it is not yours. The fix is
  `switch_browser`, which prompts every connected Chrome and lets the owner
  click Connect in the right one — `select_browser` cannot help, because the
  entry looks correct.
  The decisive proof is on the shell side: `netstat -an | grep 9990` showing
  an ESTABLISHED loopback pair means a browser on this machine really
  connected. `window.outerWidth`/`outerHeight` reading `0 × 0` is NOT a tell —
  this machine's own Chrome read `0 × 0` too (measured 2026-08-27).
- **Pick a browser by deviceId, never by display name.** More than one Chrome
  can be connected and the names are unreliable — selecting the one listed as
  "Browser 1" reported back "Connected to browser 'Browser 2'". The ids are
  per-machine, so re-read them from `list_connected_browsers` every time.
- **The extension cannot see pre-existing tabs**, only the tab group it creates
  for the session. If the browser is identified as "the one with X open", that
  cannot be verified — say so.
- **The cold Vite start is blank white for a second or two.** That is
  compilation, not the duplicate-import blank page. Screenshot again before
  concluding anything.
- `e2e/fixtures/sample-h264.mp4` uploads through the hidden `<input type="file">`;
  find it with `find`, it is not in the accessibility tree.
- `e2e/fixtures/sample-silence.mp4` is the same pictures with a soundtrack of
  tone · 1.4 s of silence (0.9–2.3 s) · tone, for 조용한 부분 없애기
  (ADR-0016). It was made through the app's own export after swapping the
  decoded audio in place (no ffmpeg on the machine that made it); the other
  fixture never goes quiet, so it is the one that proves the button waits.

**How to check frame accuracy by eye.** That fixture burns its own frame number
into the top-left of the picture. Find the playhead slider (`find` → "재생 위치"),
click it, drive it with `Home` / `End` / `ArrowRight`, and zoom on the picture's
corner and on the transport readout. **The playhead number must equal the
burnt-in number.** That comparison, and nothing in the gate, is what found the
two-frame offset defect (ADR-0008). The element `ref` goes stale after a reload —
re-`find` it.

**A LAN IP is not a workaround.** `http://<lan-ip>:9990` is not a secure
context, so `VideoDecoder` and `navigator.storage.getDirectory` are both
`undefined` there — WebCodecs and OPFS need `127.0.0.1` or HTTPS. Confirm the
page is usable at all with
`isSecureContext` / `typeof VideoDecoder` before drawing any conclusion from it.

**Trap: clearing framewright's `localStorage` does not stick.** The app flushes
the in-memory document on `pagehide`, so removing `framewright:project` and then
reloading or closing the tab writes it straight back. Nor does
`localStorage.setItem = fn` shadow the method — Storage's named-property setter
turns it into a **stored key called `setItem`**. What works:

```js
Object.defineProperty(Storage.prototype, 'setItem', {
  value() {},
  writable: true,
  configurable: true,
});
Object.keys(localStorage).forEach((k) => localStorage.removeItem(k));
```

then close the tab, so the closing flush is a no-op.

## The e2e DOM contract

Playwright tests reach into the DOM, so the DOM is an API. These selectors and
attributes are a **contract**: change one and you must change the specs in the
same commit. Anything not on this list is free to change.

| Contract                                               | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.ruler`                                               | the playhead, `role="slider"`, `aria-valuenow` = current frame                                                                                                                                                                                                                                                                                                                                                                |
| `.track`                                               | the clip strip, `role="group"`; clicking it scrubs                                                                                                                                                                                                                                                                                                                                                                            |
| `.timeline .clip`                                      | one clip button, in timeline order                                                                                                                                                                                                                                                                                                                                                                                            |
| `.gap`                                                 | a hole in the strip (decorative, `aria-hidden`)                                                                                                                                                                                                                                                                                                                                                                               |
| `.clip-canvas`                                         | a clip's pictures AND its waveform: one canvas, `aria-hidden`                                                                                                                                                                                                                                                                                                                                                                 |
| `.clip.unlinked`                                       | a clip whose media is not bound; carries `aria-describedby`                                                                                                                                                                                                                                                                                                                                                                   |
| `clip-silent-note`                                     | described by a clip whose FILE is known to have no audio track                                                                                                                                                                                                                                                                                                                                                                |
| `.subtitle-lane`                                       | the subtitle strip under the track, `role="group"`; scrubs                                                                                                                                                                                                                                                                                                                                                                    |
| `.subtitle`                                            | one subtitle chip button, in timeline order; `.empty` = no words                                                                                                                                                                                                                                                                                                                                                              |
| `.stage-subtitle`                                      | the words over the preview: a canvas, `role="img"` named by its words when showing, `aria-hidden` when blank                                                                                                                                                                                                                                                                                                                  |
| `.stage canvas`                                        | the picture, at the TIMELINE's size (letterboxed like the export); a fade's black shows in its pixels. The `.stage` around it is NOT black (`var(--bg)`) and `.stage-picture` carries a hairline `box-shadow`, so black inside the edge is in the file and the room outside is not                                                                                                                                            |
| `.stage-picture[data-frame]`                           | the same canvas, and the timeline frame its picture IS. Wait for it before reading pixels: the playhead moves on the key, the picture when the decode lands                                                                                                                                                                                                                                                                   |
| `.clip-fade.in/.out`                                   | a softened edge's ramp inside its clip, as wide as the frames it takes (decorative, `aria-hidden`)                                                                                                                                                                                                                                                                                                                            |
| `clip-fade-<id>`                                       | described by a clip with a fade: "앞 0.5초 동안 서서히 나타남 · 뒤 …" — words for the mark                                                                                                                                                                                                                                                                                                                                    |
| heading "클립"                                         | the selected clip's panel; absent when no clip is selected                                                                                                                                                                                                                                                                                                                                                                    |
| button "서서히 나타나기"                               | the fade-in toggle, `aria-pressed`; "서서히 사라지기" likewise. Both in the palette, neither on the toolbar                                                                                                                                                                                                                                                                                                                   |
| combobox "… 길이"                                      | the fade's length in seconds, shown only while that edge is on; its value is the frame count                                                                                                                                                                                                                                                                                                                                  |
| button "소리 끄기"                                     | the mute toggle in the clip panel, `aria-pressed`; in the palette and on `M`, not on the toolbar                                                                                                                                                                                                                                                                                                                              |
| button "조용한 부분 없애기"                            | silence auto-cut (ADR-0016): on the toolbar after 빈 곳 없애기 and in the palette, no key. `aria-disabled` with the reason in `title` until a source's peaks are built AND a cut exists (먼저 영상을 불러오세요 · 소리를 아직 읽는 중이에요 · 0.5초 넘게 조용한 부분이 없어요 · 소리를 끈 클립은 건너뛰어요 …); its sentence counts the places and the seconds (조용한 부분 1곳을 없앴어요 · 0.93초 짧아졌어요)               |
| slider "소리 크기"                                     | the clip's level in steps of 5; `max` is the clip's ceiling (200, or lower from its own peak); `aria-valuetext` is the percent. The ruler is the OTHER slider                                                                                                                                                                                                                                                                 |
| `clip-sound-note`                                      | the one sentence under both sound controls (what the sound does now); both point at it                                                                                                                                                                                                                                                                                                                                        |
| `clip-sound-limit`                                     | present only under a ceiling: why the slider stops short of 200%; the slider alone is described by it                                                                                                                                                                                                                                                                                                                         |
| slider "확대" / "가로 위치" / "세로 위치"              | the clip's zoom (100–400) and pan, percent values; a pan's `min`/`max` is THAT picture's limit (±50 when it fills the axis, less when narrower: ±15 for a 16:9 stood up); `aria-valuetext` says a pan with its direction (오른쪽으로 50%)                                                                                                                                                                                     |
| `clip-picture-limit`                                   | present only when a pan slider ends short of half a box: why (가로로는 15%까지만 옮길 수 있어요 · 더 가면 화면이 보이는 범위를 벗어나요); only the slider(s) whose axis is limited are described by it, after `clip-picture-note`                                                                                                                                                                                             |
| button "화면 돌리기" / "화면 채우기" / "화면 원래대로" | a quarter turn (`R`, in the palette), the zoom that covers the box (in the palette; `aria-disabled` with 화면이 이미 꽉 차 있어요 or 확대는 충분해요 · 위치를 가운데로 옮기면 꽉 차요), and everything back (in the palette); `aria-disabled` when there is nothing to put back                                                                                                                                               |
| `clip-picture-note`                                    | the one sentence under the picture sliders (as shot or what changed, then the sides of the box the picture does not reach — 화면 위아래가 비어요 / 화면 양옆이 비어요 / 화면 왼쪽이 비어요 — whether a pan, a turn or the box's own shape left them; geometric, from `pictureRect`)                                                                                                                                           |
| `.clip-picture-mark`                                   | a pill after the name when the picture is not as shot: 🔍 zoomed, ↻ turned, ✥ moved, in that order (decorative, `aria-hidden`)                                                                                                                                                                                                                                                                                                |
| `clip-picture-<id>`                                    | described by such a clip: "화면 200% · 90° 회전 · 위치 옮김" — words for the pill                                                                                                                                                                                                                                                                                                                                             |
| `.stage.movable`                                       | the stage while the SELECTED clip is under the playhead: dragging on it moves that clip's picture; a press on another clip selects it first                                                                                                                                                                                                                                                                                   |
| `.frame-picker`                                        | `role="radiogroup"` named 영상 모양 on the preview's title row: three `role="radio"` buttons named 가로 / 세로 / 정사각 영상으로 바꾸기 (drawn as the one word), `aria-checked` on the box's current shape (never `aria-disabled`; choosing it again says 지금 가로 영상이에요), the others `aria-disabled` before the first import; one Tab stop, the arrows move and choose; and `.frame-size`, the box in pixels (320×180) |
| `.stage-picture` size                                  | the canvas's `width`/`height` ARE the box (`timeline.width × height`): 180×320 after 세로 on a 320×180 project; the subtitle overlay canvas takes the same size and is re-placed over it                                                                                                                                                                                                                                      |
| `.clip-sound-mark`                                     | a pill after the clip's name when its sound is not as recorded: 🔇 or the percent (decorative, `aria-hidden`)                                                                                                                                                                                                                                                                                                                 |
| `clip-sound-<id>`                                      | described by such a clip: "소리 끔" or "소리 95%" — words for the pill                                                                                                                                                                                                                                                                                                                                                        |
| textbox "내용"                                         | the selected subtitle's words; Enter or blur commits, Escape reverts                                                                                                                                                                                                                                                                                                                                                          |
| subtitle `aria-label`                                  | `자막 N, words (or 내용 없음), tc부터 길이 tc` — identity, never state                                                                                                                                                                                                                                                                                                                                                        |
| subtitle `aria-pressed`                                | selected or not. Never set together with a clip's.                                                                                                                                                                                                                                                                                                                                                                            |
| `.statusbar`                                           | `role="status"`; the last thing that happened, in words                                                                                                                                                                                                                                                                                                                                                                       |
| `.transport .dim`                                      | `playhead / total`, in frames                                                                                                                                                                                                                                                                                                                                                                                                 |
| clip `aria-label`                                      | identity + position + length. **Never state.**                                                                                                                                                                                                                                                                                                                                                                                |
| clip `aria-pressed`                                    | selected or not. The ONLY place selection lives.                                                                                                                                                                                                                                                                                                                                                                              |
| `.track-hint`                                          | the key hints under the track, rendered FROM the keymap                                                                                                                                                                                                                                                                                                                                                                       |
| `.toolbar button`                                      | `"<글리프> <라벨>"`; glyphs unique, no label inside another                                                                                                                                                                                                                                                                                                                                                                   |
| `.overlay`                                             | the modal backdrop; clicking it closes the dialog                                                                                                                                                                                                                                                                                                                                                                             |
| dialog "명령 찾기"                                     | the palette: a `combobox` over a `listbox` of `option`s                                                                                                                                                                                                                                                                                                                                                                       |
| palette `option`                                       | one entry; `aria-disabled` carries "cannot run now"                                                                                                                                                                                                                                                                                                                                                                           |
| dialog "단축키"                                        | the keymap settings; one row per bindable action                                                                                                                                                                                                                                                                                                                                                                              |
| row button `aria-label`                                | `"<라벨> 단축키 바꾸기"` — how a spec picks a row                                                                                                                                                                                                                                                                                                                                                                             |

The keymap lives in `localStorage` under `framewright.keymap.v1` and **outlives a
reload**. A spec that rebinds anything must clear that key first, or the previous
test decides what this one's keys do.

### Rule: never assert on a value that mixes identity and state

Four e2e tests failed at once because the clip's `aria-label` carried
`, 선택됨`. Every "did undo restore this?" check compared the label before and
after — but clicking the clip to drag it also _selected_ it, so the label moved
for a reason that had nothing to do with the edit.

The lesson is not "write the test differently". It is that **an accessible name
that changes with state is a bug on its own**: a screen reader re-announces the
whole control every time you click it. State belongs in a state attribute
(`aria-pressed`, `aria-disabled`, `aria-valuenow`), never in the name.

So, when writing an e2e assertion:

- compare **one fact at a time** — a frame count, a start timecode, a count of
  elements — not a composite string, unless that string is contractually stable;
- if you find yourself wanting to strip a suffix off a label before comparing,
  the label is wrong, not the test;
- `toBeDisabled()` matches `aria-disabled="true"` as well as the native
  attribute, so the toolbar's `aria-disabled` buttons still assert normally.

### Rule: `getByRole(name)` matches a SUBSTRING — pass `exact` for short names

`getByRole('button', { name: '재생' })` passed for months, then resolved to three
elements and failed two unrelated specs the moment two commands were renamed to
`재생 위치까지 … 줄이기`. Playwright matches an accessible name by substring, so
any short name is one rename away from becoming ambiguous, and the failure looks
like a broken feature rather than a broken selector.

If the whole accessible name is what you mean — a transport button, an icon
button — say `{ name: '재생', exact: true }`. Reserve the loose form for names
you deliberately want to match by fragment, and prefer a regex there so the
intent is visible.

### Rule: the undo stack starts at 1, not 0

Importing a file is an edit. After `importFixture`, `되돌리기` is **enabled**, so
"nothing was edited" cannot be asserted with `toBeDisabled()`. Assert it the
honest way: press `Ctrl+Z` once and require the timeline to be empty — if the
gesture had recorded a patch, a clip would survive.

## Invariants (assert in tests)

- rendered frame count == sum of clip frame counts
- export duration == sum of clip durations (frame-exact)
- every `VideoFrame` allocated is closed (no leaks)
- preview and export produce identical frames (determinism)

## Still missing

- A golden-file byte/frame comparison for export output.
- Audio (no pipeline yet).
