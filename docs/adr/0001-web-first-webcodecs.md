# 0001 — Web-first on WebCodecs

- Status: Accepted

## Context

Video editing has historically been desktop (raw performance, local files, GPU).
But framewright is part of a browser studio, the team is JS/TS, and we need fast
iteration, instant deploy, and future real-time collaboration. Modern browser APIs
(WebCodecs, WebGL/WebGPU, WASM, OPFS, File System Access) close most of the old
performance gap, and the workload is light-to-medium (1080p, short clips).

## Decision

Build web-first: TypeScript + React UI, editing engine in the browser on
**WebCodecs** (hardware-accelerated decode/encode). `mp4box.js` for demux.
`ffmpeg.wasm` reserved for muxing fallback and codec fallback (lazy-loaded), never
the hot path. If a desktop build is later needed, wrap the same code in
Electron/Tauri (reuse ~90%).

## Consequences

- Chromium-first; require capability detection + graceful fallback.
- Not native-desktop performance for 4K — solved with proxies, not a rewrite.
- Huge wins: zero-install deploy, instant updates, natural collaboration.
- Web-first does not foreclose desktop; the reverse (native → web) would be a rewrite.
