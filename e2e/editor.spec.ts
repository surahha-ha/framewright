import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supportsH264 } from './helpers';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'sample-h264.mp4',
);

test.describe('editor shell', () => {
  test('loads with an empty, safe initial state', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('framewright')).toBeVisible();
    // Nothing imported yet: every editing action must be unavailable.
    await expect(page.getByRole('button', { name: /나누기/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: /지우기/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: /되돌리기/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: /내보내기/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: '재생' })).toBeDisabled();
  });

  test('keyboard shortcuts on an empty timeline do not crash', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.keyboard.press('c');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    expect(errors).toEqual([]);
  });
});

test.describe('import → split → undo', () => {
  test('a real MP4 imports, splits into two clips, and undoes', async ({
    page,
  }) => {
    await page.goto('/');
    test.skip(
      !(await supportsH264(page)),
      'this browser has no H.264 (use `npm run e2e:chrome`)',
    );

    await page.setInputFiles('input[type="file"]', FIXTURE);

    // Status line reports the decoded source.
    await expect(page.locator('.statusbar')).toContainText('sample-h264.mp4', {
      timeout: 15_000,
    });
    await expect(page.locator('.statusbar')).toContainText('320×180');
    // The fixture has an AAC track — audio must be picked up, not ignored.
    await expect(page.locator('.statusbar')).toContainText('오디오 1ch');

    // One clip on the timeline, and editing is now possible.
    await expect(page.locator('.timeline .clip')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /내보내기/ })).toBeEnabled();

    // Move the playhead into the middle and split.
    await page.locator('.track').click({ position: { x: 200, y: 20 } });
    await expect(page.getByRole('button', { name: /나누기/ })).toBeEnabled();
    await page.keyboard.press('c');
    await expect(page.locator('.timeline .clip')).toHaveCount(2);

    // Splitting removes nothing: the timeline length is unchanged.
    const totalAfterSplit = await page
      .locator('.transport .dim')
      .innerText();

    await page.keyboard.press('Control+z');
    await expect(page.locator('.timeline .clip')).toHaveCount(1);
    await expect(page.locator('.transport .dim')).toHaveText(totalAfterSplit);
  });

  test('split then delete shortens the timeline by the deleted part', async ({
    page,
  }) => {
    await page.goto('/');
    test.skip(
      !(await supportsH264(page)),
      'this browser has no H.264 (use `npm run e2e:chrome`)',
    );

    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.locator('.timeline .clip')).toHaveCount(1, {
      timeout: 15_000,
    });

    const lengthOf = async () => {
      const text = await page.locator('.transport .dim').innerText();
      return Number(text.split('/')[1].trim());
    };
    const before = await lengthOf();

    await page.locator('.track').click({ position: { x: 200, y: 20 } });
    await page.keyboard.press('c');
    await expect(page.locator('.timeline .clip')).toHaveCount(2);

    // Select the first piece and ripple-delete it.
    await page.locator('.timeline .clip').first().click();
    await page.keyboard.press('Delete');
    await expect(page.locator('.timeline .clip')).toHaveCount(1);

    const after = await lengthOf();
    expect(after).toBeLessThan(before);

    // ...and undo puts it back exactly.
    await page.keyboard.press('Control+z');
    await expect(page.locator('.timeline .clip')).toHaveCount(2);
    expect(await lengthOf()).toBe(before);
  });
});

test.describe('export', () => {
  test('exports an MP4 whose duration matches the timeline', async ({
    page,
  }) => {
    await page.goto('/');
    test.skip(
      !(await supportsH264(page)),
      'this browser cannot encode H.264 (use `npm run e2e:chrome`)',
    );

    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.locator('.timeline .clip')).toHaveCount(1, {
      timeout: 15_000,
    });

    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByRole('button', { name: /내보내기/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.mp4$/);

    await expect(page.locator('.statusbar')).toContainText('내보내기 완료', {
      timeout: 120_000,
    });
    // The fixture is 90 frames at 30fps; export must be frame-exact.
    await expect(page.locator('.statusbar')).toContainText('90 frames');
    // ...and it must not come out silent.
    await expect(page.locator('.statusbar')).toContainText('오디오 포함');
  });

  test('the exported file is a real, non-trivial MP4', async ({ page }) => {
    await page.goto('/');
    test.skip(
      !(await supportsH264(page)),
      'this browser cannot encode H.264 (use `npm run e2e:chrome`)',
    );

    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.locator('.timeline .clip')).toHaveCount(1, {
      timeout: 15_000,
    });

    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByRole('button', { name: /내보내기/ }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);

    expect(bytes.byteLength).toBeGreaterThan(10_000);
    // ISO-BMFF: bytes 4..8 of the first box are 'ftyp'
    expect(bytes.subarray(4, 8).toString('ascii')).toBe('ftyp');
    // fastStart puts 'moov' near the front, and both tracks must be present
    const head = bytes.subarray(0, Math.min(bytes.byteLength, 200_000));
    expect(head.includes(Buffer.from('moov'))).toBe(true);
    expect(head.includes(Buffer.from('avc1'))).toBe(true);
    expect(head.includes(Buffer.from('mp4a'))).toBe(true);
  });
});

test.describe('trim and move (direct manipulation)', () => {
  /** Real pointer drag: press, move in steps, release. */
  async function drag(
    page: import('@playwright/test').Page,
    clip: import('@playwright/test').Locator,
    dx: number,
    grab: 'start' | 'end' | 'body',
  ) {
    const box = (await clip.boundingBox())!;
    const y = box.y + box.height / 2;
    const x =
      grab === 'start'
        ? box.x + 3
        : grab === 'end'
          ? box.x + box.width - 3
          : box.x + box.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y, { steps: 5 });
    await page.mouse.move(x + dx, y, { steps: 5 });
    await page.mouse.up();
  }

  /** The clip's own accessible name carries its start and length. */
  async function label(clip: import('@playwright/test').Locator) {
    return (await clip.getAttribute('aria-label')) ?? '';
  }

  async function importFixture(page: import('@playwright/test').Page) {
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

  test('dragging the body moves the clip, and undo puts it back', async ({
    page,
  }) => {
    await importFixture(page);
    const clip = page.locator('.timeline .clip').first();
    const before = await label(clip);

    await drag(page, clip, 60, 'body');
    await expect(clip).not.toHaveAttribute('aria-label', before);
    // Moving does not change the clip's length, only where it sits.
    const frames = (t: string) => t.match(/(\d+)프레임/)?.[1];
    expect(frames(await label(clip))).toBe(frames(before));

    await page.keyboard.press('Control+z');
    await expect(clip).toHaveAttribute('aria-label', before);
  });

  test('dragging the right edge trims the clip shorter', async ({ page }) => {
    await importFixture(page);
    const clip = page.locator('.timeline .clip').first();
    const lengthOf = async () =>
      Number((await label(clip)).match(/(\d+)프레임/)?.[1] ?? '0');
    const before = await lengthOf();

    await drag(page, clip, -80, 'end');
    expect(await lengthOf()).toBeLessThan(before);

    await page.keyboard.press('Control+z');
    expect(await lengthOf()).toBe(before);
  });

  test('a click without movement selects but never edits', async ({ page }) => {
    await importFixture(page);
    const clip = page.locator('.timeline .clip').first();
    const before = await label(clip);

    await clip.click();
    await expect(clip).toHaveAttribute('aria-pressed', 'true');
    expect(await label(clip)).toBe(before);
    // The import is the only entry on the undo stack: one undo must empty the
    // timeline. If the click had recorded a patch, a clip would survive.
    await page.keyboard.press('Control+z');
    await expect(page.locator('.timeline .clip')).toHaveCount(0);
  });

  test('Alt+arrow moves the focused clip without a mouse', async ({ page }) => {
    await importFixture(page);
    const clip = page.locator('.timeline .clip').first();
    const before = await label(clip);

    await clip.focus();
    await page.keyboard.press('Alt+ArrowRight');
    await expect(clip).not.toHaveAttribute('aria-label', before);
    // Focus must survive the edit, or holding the key would go nowhere.
    await expect(clip).toBeFocused();

    await page.keyboard.press('Alt+ArrowLeft');
    await expect(clip).toHaveAttribute('aria-label', before);
  });
});
