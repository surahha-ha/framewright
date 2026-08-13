import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'sample-h264.mp4',
);

/**
 * The two-frame defect, against the file that actually had it.
 *
 * `sample-h264.mp4` has B-frames, its first sample's `cts` is 1024 at timescale
 * 15360 — two frames at 30fps — and no edit list takes that back out. Visual QA
 * caught it in real Chrome: the playhead read 22 / 44 / 69 / 89 while the frame
 * number burnt into the picture read 20 / 42 / 67 / 87, and the last two frames
 * of the media could not be reached at all.
 *
 * This spec needs no decoder — demux only parses the container — so unlike the
 * import/export specs it runs on bundled Chromium too, and cannot silently
 * self-skip on the machine where it matters.
 */
test.describe('source presentation offset (the real fixture)', () => {
  test('every timeline frame maps to the same frame of the media', async ({
    page,
  }) => {
    await page.goto('/');
    const base64 = readFileSync(FIXTURE).toString('base64');

    const out = await page.evaluate(async (b64: string) => {
      // URLs the Vite dev server transforms at runtime, kept in variables so
      // TypeScript does not try to resolve them as package specifiers.
      const demuxPath = '/src/engine/demux.ts';
      const timePath = '/src/engine/time.ts';
      const { demuxVideo } = await import(demuxPath);
      const {
        framesForDuration,
        nearestStandardFps,
        frameToSec,
        secToUs,
        timescaleToUs,
      } = await import(timePath);

      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bin], 'sample-h264.mp4', { type: 'video/mp4' });
      const d = await demuxVideo(file);

      const result: Record<string, string> = {};
      const ok = (name: string, cond: boolean, detail = '') => {
        result[name] = cond ? 'ok' : `FAIL ${detail}`;
      };

      // The fixture must still be the file this defect was found in — if a
      // future fixture starts at zero, this spec would pass without testing
      // anything, and that silence is the failure mode to avoid.
      ok(
        'fixtureStillOffset',
        Math.abs(d.startOffsetSec - 2 / 30) < 1e-6,
        `startOffsetSec ${d.startOffsetSec}`,
      );

      // Presentation order: B-frames mean decode order is not it.
      const byCts = [...d.samples].sort(
        (a: any, b: any) =>
          timescaleToUs(a.cts, a.timescale) - timescaleToUs(b.cts, b.timescale),
      );
      ok(
        'startsAtZero',
        timescaleToUs(byCts[0].cts, byCts[0].timescale) === 0,
        `first cts ${byCts[0].cts}`,
      );

      // The mapping the whole app uses: timeline frame n -> n/fps seconds ->
      // the last sample presented at or before it.
      const fps = nearestStandardFps(d.nominalFps);
      const total = framesForDuration(d.track.durationSec, fps);
      const ctsUs = byCts.map((s: any) => timescaleToUs(s.cts, s.timescale));
      const indexFor = (targetUs: number) => {
        let best = -1;
        for (let i = 0; i < ctsUs.length; i++) {
          if (ctsUs[i] <= targetUs + 1) best = i;
          else break;
        }
        return best;
      };

      let mismatch = '';
      for (let n = 0; n < total && !mismatch; n++) {
        const got = indexFor(secToUs(frameToSec(n, fps)));
        if (got !== n) mismatch = `timeline frame ${n} -> media frame ${got}`;
      }
      ok('everyFrame', !mismatch, mismatch);

      // ...and nothing is left over at the end: the last timeline frame is the
      // last picture in the file, not the one two before it.
      ok(
        'tailReachable',
        indexFor(secToUs(frameToSec(total - 1, fps))) === byCts.length - 1,
        `total ${total} frames vs ${byCts.length} samples`,
      );

      return result;
    }, base64);

    for (const [name, value] of Object.entries(out)) {
      expect(value, name).toBe('ok');
    }
  });
});
