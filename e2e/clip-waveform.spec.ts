// framewright — the waveform drawn inside a clip.
//
// The arithmetic is unit-tested twice over: `src/engine/waveform.test.ts` for
// the peak pyramid and the bucket plan, `src/ui/waveform.test.ts` for the cache
// and its invalidation. What neither of them can see is whether any of it ever
// reaches the screen — that needs a real `AudioContext` decoding a real file,
// and a canvas that a browser has agreed to allocate.
//
// The specific failure this file exists to catch: a wave that is computed
// correctly and drawn outside the band, off the canvas, or in a colour that
// vanishes into the footage. All three look like "the clip has no sound", and
// none of them throws.
import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supportsH264 } from './helpers';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'sample-h264.mp4',
);

/**
 * `clear: false` for the reload test and nothing else. `addInitScript` runs on
 * EVERY navigation, so a test that clears storage that way and then reloads
 * wipes the document it is about to look for — the app comes back empty and the
 * failure reads as "the media was not restored".
 */
async function withClip(page: Page, clear = true) {
  if (clear) await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  test.skip(
    !(await supportsH264(page)),
    'this browser has no H.264 (use `npm run e2e:chrome`)',
  );
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.locator('.timeline .clip')).toHaveCount(1, {
    timeout: 15_000,
  });
}

const zoomIn = (page: Page) => page.getByRole('button', { name: '크게 보기' });

/**
 * Where the wave ink actually landed on a clip's canvas.
 *
 * The ink colour is read from the stylesheet rather than written here, so this
 * measures what the app decided to draw with instead of a copy of it that can
 * drift. `topFraction` is where the topmost ink pixel sits as a fraction of the
 * canvas height, so a wave confined to the bottom 42% starts at about 0.58.
 */
async function inkRows(page: Page, nth = 0) {
  return page.evaluate((index) => {
    const canvas = document.querySelectorAll('.clip-canvas')[
      index
    ] as HTMLCanvasElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || canvas.width === 0) return null;
    const hex = getComputedStyle(document.documentElement)
      .getPropertyValue('--wave-ink')
      .trim();
    const ink = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    let top = Infinity;
    let bottom = -1;
    // Every column that carries ink, so "the wave spans the clip" can be
    // checked without knowing how many buckets there are.
    const columns = new Set<number>();
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (
          Math.abs(data[i] - ink[0]) < 48 &&
          Math.abs(data[i + 1] - ink[1]) < 48 &&
          Math.abs(data[i + 2] - ink[2]) < 48 &&
          data[i + 3] > 200
        ) {
          count++;
          columns.add(x);
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    return {
      count,
      columns: columns.size,
      topFraction: count > 0 ? top / canvas.height : -1,
      bottomFraction: count > 0 ? bottom / canvas.height : -1,
      width: canvas.width,
      height: canvas.height,
    };
  }, nth);
}

test.describe('clip waveform', () => {
  test('a clip draws its sound, along the bottom and nowhere else', async ({
    page,
  }) => {
    await withClip(page);
    // Reducing the samples is deliberately deferred by a macrotask so the
    // import paints first, so this is a wait, not an immediate read.
    await expect
      .poll(async () => (await inkRows(page))?.count ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(0);

    const ink = (await inkRows(page))!;
    // The band is the bottom 42%. Ink above it means the wave is being drawn
    // over the pictures that identify the shot — which is the one thing the
    // band exists to prevent.
    expect(ink.topFraction).toBeGreaterThan(0.5);
    expect(ink.bottomFraction).toBeLessThanOrEqual(1);
    // And it spans the clip rather than sitting in one corner of it.
    expect(ink.columns).toBeGreaterThan(ink.width / 4);
    // A SHAPE, not a line. Drawn at its literal amplitude this fixture — which
    // peaks at 0.19, an ordinary level — filled two rows of an eighteen-pixel
    // band, and every assertion above still passed. That is what the curve in
    // `waveAmplitude` is for, and this is the assertion that noticed.
    expect(ink.bottomFraction - ink.topFraction).toBeGreaterThan(0.1);
  });

  test('the wave stays inside the clip when you zoom in', async ({ page }) => {
    // A clip zoomed in is wider than the window, and the canvas is not: the
    // wave has to be positioned in the canvas's coordinates, not the clip's.
    // Getting that wrong draws it off the left edge, where nothing reports it.
    await withClip(page);
    await expect
      .poll(async () => (await inkRows(page))?.count ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(0);

    for (let step = 0; step < 5; step++) {
      if (await zoomIn(page).isEnabled()) await zoomIn(page).click();
    }
    await expect
      .poll(async () => (await inkRows(page))?.count ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(0);

    const ink = (await inkRows(page))!;
    expect(ink.topFraction).toBeGreaterThan(0.5);
    // Zoomed in, the visible part of the clip fills the window, so the wave
    // should cover most of the canvas rather than a sliver of it.
    expect(ink.columns).toBeGreaterThan(ink.width / 2);
  });

  test('each half of a split clip draws its own part of the sound', async ({
    page,
  }) => {
    await withClip(page);
    await expect
      .poll(async () => (await inkRows(page))?.count ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(0);

    // Park the playhead in the middle and cut. Two clips, two canvases, and
    // each one has to read its own in-point — a wave anchored to the file's
    // head would draw the same shape twice.
    await page.locator('.track').click({ position: { x: 200, y: 20 } });
    await page.keyboard.press('c');
    await expect(page.locator('.timeline .clip')).toHaveCount(2);

    for (const nth of [0, 1]) {
      await expect
        .poll(async () => (await inkRows(page, nth))?.count ?? 0, {
          timeout: 15_000,
        })
        .toBeGreaterThan(0);
      expect((await inkRows(page, nth))!.topFraction).toBeGreaterThan(0.5);
    }
  });

  test('the wave survives a reload, with no file picker', async ({ page }) => {
    // The peaks live in memory only; after a reload they have to be rebuilt
    // from the restored media without anyone asking for the file again.
    await withClip(page, false);
    await expect
      .poll(async () => (await inkRows(page))?.count ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(0);

    await page.reload();
    await expect(page.locator('.timeline .clip')).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect
      .poll(async () => (await inkRows(page))?.count ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(0);
  });
});
