# Runbook — failure modes & mitigations

Anticipated bugs / exceptions and how framewright should handle each. Three rules
underpin every entry:

1. **Fail gracefully** — one broken clip or codec must never crash the whole app.
2. **Never lose work** — autosave + versions mean a crash costs seconds, not hours.
3. **Speak plainly** — the user sees "This video uses a format we can't open yet",
   never `avc1.640033` or a stack trace.

## 0. Plan trajectory checkpoint

On track toward the studio goal: the foundations (canonical time-model, command
registry spine, local-first sync-ready storage, tests/hooks/ADRs) let collaboration,
dashboard, AI, and export land as **retrofits, not rewrites**. Two sequencing gaps to
fill right after editing (A): **audio pipeline** and **export** (close the loop).

## 1. Import & demux

| Symptom | Likely cause | Mitigation |
| --- | --- | --- |
| "unsupported / can't decode" | HEVC / VP9 / exotic profile | Probe `isConfigSupported()`; offer transcode-to-H.264 or ffmpeg.wasm fallback; clear message |
| Video cut short / runs long | VFR treated as CFR | Detect VFR (done) and **conform** to timeline grid at import |
| Long spinner on big file | moov atom at end of MP4 | Detect; ask to remux (faststart) or stream; show progress |
| Import hangs | corrupt / truncated file | Timeout + "file looks corrupted" message; don't block UI |
| No picture, only audio | audio-only or unsupported video track | Detect track kinds; handle audio-only gracefully |
| Sideways video | rotation matrix ignored | Read display matrix; apply rotation in render |

## 2. Decode

| Symptom | Likely cause | Mitigation |
| --- | --- | --- |
| Nothing renders | WebCodecs unavailable (old/Safari/FF) | Capability-detect on load; show "use Chrome/Edge" or fallback path |
| Tab crashes / OOM | `VideoFrame` not closed | Close every frame; cap frame cache; enforced by guardrail hook |
| Wrong / glitchy frame on seek | B-frame reorder or keyframe seek | Decode from keyframe forward; order by PTS |
| Decoder throws mid-stream | bad sample / codec edge | Catch, `reset()`, skip; keep app alive |

## 3. Playback & render

| Symptom | Likely cause | Mitigation |
| --- | --- | --- |
| Choppy playback | full-res cold decode | Proxy media (low-res, all-intra) + warm decoder + frame cache |
| Frame doesn't fit preview | canvas sized to source res | `object-fit: contain` letterbox (done) |
| Audio/video drift | separate clocks | Single master clock; audio in samples |
| Playhead runs, picture frozen | decode can't keep up | Latest-wins single-flight + frame drop (done) |
| Jumpy when tab backgrounded | rAF throttled in background | Pause playback on `visibilitychange` |

## 4. Editing & commands

| Symptom | Likely cause | Mitigation |
| --- | --- | --- |
| One frame too many/few at a cut | rounding inconsistency | Half-open `[in,out)` + single time-model; unit tests assert frame-sum |
| Undo leaves stale state | command missing inverse | Every command has an inverse; op-based patches; tests for exact undo |
| Redo differs from original | non-deterministic ids | Deterministic id counter (no `Date.now`/`Math.random`); guardrail hook |
| Clip references a deleted asset | dangling reference | Integrity check on delete; block or cascade |
| Two tabs clobber a project | concurrent autosave | Detect multi-tab; lock or warn |

## 5. Storage & autosave

| Symptom | Likely cause | Mitigation |
| --- | --- | --- |
| "storage full" / save fails | OPFS quota exceeded / eviction | Detect quota; warn early; evict proxies; keep project JSON (tiny) safe |
| Work lost on refresh | no autosave | Autosave + restore; version snapshots |
| Old project won't open | schema changed | `schemaVersion` + migration runner |

## 6. Export

| Symptom | Likely cause | Mitigation |
| --- | --- | --- |
| "can't export" | encoder unsupported | Probe `VideoEncoder.isConfigSupported()`; message + fallback |
| MP4 won't play anywhere | missing/wrong avcC description | Write SPS/PPS from encoder config; avcc format; golden-file QC |
| Audio offset in export | AAC priming / encoder delay | Trim priming / write edit list; match A/V length |
| UI frozen during export | encoding on main thread | Run in Worker + OffscreenCanvas; progress + cancel |
| Export ≠ preview | wall-clock / nondeterminism | Deterministic frame render off the master clock |
| Runs out of memory (long export) | frames held in memory | Stream frames to muxer; close each |

## 7. App-level resilience

| Symptom | Likely cause | Mitigation |
| --- | --- | --- |
| White screen | unhandled render error | React error boundary → recover to last autosave |
| Silent failure | swallowed promise rejection | Central error handler; plain-language toast; telemetry (anonymous) |

## 8. Collaboration (future)

| Symptom | Likely cause | Mitigation |
| --- | --- | --- |
| Edits conflict / overwrite | concurrent editing | CRDT (Yjs) merge; stable ids already in place |
| Peer stuck / desynced | network drop | Reconnect + resync from server doc; presence heartbeat |

## Cross-cutting

- Capability-detect up front; degrade gracefully, never dead-end.
- One central place turns errors into **friendly, non-technical** messages.
- Every long operation has progress + cancel.
- Every destructive path is undoable and autosaved.
