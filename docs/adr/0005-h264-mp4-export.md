# 0005 — H.264 / MP4 export target

- Status: Accepted

## Context

Encoder support varies by browser/OS; HEVC carries licensing and spotty support; output
must play everywhere (QuickTime, Windows, mobile, YouTube/Instagram).

## Decision

Export **H.264 (avc1, High/Main) + AAC (mp4a) in MP4** via a lightweight WebCodecs
muxer (e.g. `mp4-muxer`); `ffmpeg.wasm` is fallback only. Always probe
`VideoEncoder.isConfigSupported()` / `AudioEncoder.isConfigSupported()` first and warn
if unavailable. Disable B-frames initially (simpler DTS/muxing). Insert keyframes at a
fixed interval. **First export is video-only** (audio pipeline not built yet); AAC +
priming/sync handling follows.

## Update — audio landed

Audio is decoded with `AudioContext.decodeAudioData` (not a second WebCodecs
path), played back through WebAudio with the **audio clock as the master clock**,
and exported by rendering the timeline offline (`OfflineAudioContext`) and
encoding that to AAC. Rendering offline keeps export deterministic and makes the
soundtrack follow cuts exactly like playback does.

## Consequences

- Broad playback compatibility.
- Must handle AAC encoder-delay (priming) and A/V length matching when audio lands.
- VP9/AV1 (royalty-free) considered later for web delivery.
- Export must be frame-deterministic and match preview (see time-model, ADR-0002).
