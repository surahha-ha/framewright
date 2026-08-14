// The editor at a small laptop width.
//
// Playwright checks what someone thought to assert, and nobody thinks to assert
// "the page does not scroll sideways" until they have seen it happen. This is
// the cheap, durable half of that: the states that carry the most text at once,
// at a fixed 1280×800, with the one thing that is never a taste question —
// horizontal overflow — asserted rather than eyeballed.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supportsH264 } from './helpers';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'sample-h264.mp4',
);

test.use({ viewport: { width: 1280, height: 800 } });

/** Nothing may push the page wider than the window. */
async function assertNoSidewaysScroll(page: import('@playwright/test').Page) {
  const { scrollW, clientW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(scrollW).toBeLessThanOrEqual(clientW);
}

test.describe('1280px — the media states fit', () => {
  test('empty, imported, restored and lost-media all fit the window', async ({
    page,
  }) => {
    await page.goto('/');
    test.skip(
      !(await supportsH264(page)),
      'this browser has no H.264 (use `npm run e2e:chrome`)',
    );
    await assertNoSidewaysScroll(page);

    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.locator('.timeline .clip')).toHaveCount(1, {
      timeout: 15_000,
    });
    await assertNoSidewaysScroll(page);

    // Reopened from the media store: the state this whole feature exists for.
    await page.reload();
    await expect(page.locator('.statusbar')).toContainText(
      '영상도 준비됐어요',
      {
        timeout: 15_000,
      },
    );
    await assertNoSidewaysScroll(page);

    // The store lost the file — the most new text on screen at once: the panel
    // notice, the ⚠ row, the stage note and the status line together.
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('media', { recursive: true });
    });
    await page.reload();
    await expect(page.locator('.stage-note')).toContainText('연결되지 않아');
    await assertNoSidewaysScroll(page);

    // And the notice must still be readable, not clipped to a single line with
    // its tail cut off.
    const notice = page.locator('.relink');
    await expect(notice).toBeVisible();
    const clipped = await notice.evaluate(
      (el) => el.scrollHeight > el.clientHeight + 1,
    );
    expect(clipped).toBe(false);
  });
});
