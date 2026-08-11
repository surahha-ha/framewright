// framewright — media decode services, keyed by asset id.
// (A timeline can reference several assets, so one global service is not enough.)
// Services hold every encoded sample of their source, so they must be released
// when the asset leaves the document — see `retainOnly`.

import type { VideoDecodeService } from './decoder';

const services = new Map<string, VideoDecodeService>();

export function setDecodeService(
  assetId: string,
  service: VideoDecodeService,
): void {
  services.set(assetId, service);
}

export function getDecodeService(
  assetId: string | undefined,
): VideoDecodeService | null {
  if (!assetId) return null;
  return services.get(assetId) ?? null;
}

export function releaseDecodeService(assetId: string): void {
  services.delete(assetId);
}

/** Drop services for assets no longer in the document (e.g. after undoing an import). */
export function retainOnly(assetIds: Iterable<string>): void {
  const keep = new Set(assetIds);
  for (const id of [...services.keys()]) {
    if (!keep.has(id)) services.delete(id);
  }
}
