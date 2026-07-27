// framewright — tiny singleton holder for the active decode service.
// Keeps the walking-skeleton wiring simple; will become part of an engine
// context/store as the app grows.

import type { VideoDecodeService } from './decoder';

let service: VideoDecodeService | null = null;

export function setDecodeService(s: VideoDecodeService | null): void {
  service = s;
}

export function getDecodeService(): VideoDecodeService | null {
  return service;
}
