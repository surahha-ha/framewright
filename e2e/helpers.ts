import type { Page } from '@playwright/test';

/** Codecs to try, best first. Headless Chromium has no H.264. */
export const CODEC_CANDIDATES = [
  'avc1.42001f',
  'vp8',
  'vp09.00.10.08',
  'av01.0.04M.08',
];

export async function pickCodec(page: Page): Promise<string | null> {
  return page.evaluate(async (candidates) => {
    if (typeof VideoEncoder === 'undefined') return null;
    for (const codec of candidates) {
      try {
        const enc = await VideoEncoder.isConfigSupported({
          codec,
          width: 160,
          height: 90,
          bitrate: 300_000,
          framerate: 30,
        });
        const dec = await VideoDecoder.isConfigSupported({
          codec,
          codedWidth: 160,
          codedHeight: 90,
        });
        if (enc.supported && dec.supported) return codec;
      } catch {
        /* try the next one */
      }
    }
    return null;
  }, CODEC_CANDIDATES);
}

export async function supportsH264(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    if (typeof VideoDecoder === 'undefined') return false;
    try {
      const dec = await VideoDecoder.isConfigSupported({
        codec: 'avc1.64001f',
        codedWidth: 320,
        codedHeight: 180,
      });
      const enc = await VideoEncoder.isConfigSupported({
        codec: 'avc1.64001f',
        width: 320,
        height: 180,
        bitrate: 500_000,
        framerate: 30,
      });
      return !!dec.supported && !!enc.supported;
    } catch {
      return false;
    }
  });
}
