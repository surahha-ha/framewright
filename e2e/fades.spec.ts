// framewright — fades, in a real browser (ADR-0012).
//
// The arithmetic (which frame blends with what, at what weight) is unit-tested
// in `src/engine/fades.test.ts`, the commands in `fadeCommands.test.ts`, the
// draw order in `compose.test.ts`. What only a browser can answer: that the
// picture actually goes dark on the frames the plan says, that the mark and
// the panel appear for the clip the user chose, and that it all works without
// a mouse.
import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supportsH264 } from './helpers';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'sample-h264.mp4',
);

async function withClip(page: Page) {
  await page.addInitScript(() => localStorage.clear());
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

const clips = (page: Page) => page.locator('.timeline .clip');
const fadeInButton = (page: Page) =>
  page.getByRole('button', { name: '서서히 나타나기', exact: true });
const fadeOutButton = (page: Page) =>
  page.getByRole('button', { name: '서서히 사라지기', exact: true });
const status = (page: Page) => page.locator('.statusbar');

/** Park the playhead on an exact frame, by keyboard, and wait until the
 *  stage has DRAWN that frame. The playhead moves on the key press; the
 *  picture follows when the decode lands, and a scrub is "latest wins", so
 *  between the two the canvas shows an earlier frame of the run — whose
 *  brightness, on a fixture that changes colour every frame, is not the
 *  target's. Under load (two workers, an export in the other) that window is
 *  wide enough to measure the wrong frame. */
async function goToFrame(page: Page, frame: number) {
  await page.locator('.ruler').focus();
  await page.keyboard.press('Home');
  for (let f = 0; f < frame; f++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.ruler')).toHaveAttribute(
    'aria-valuenow',
    String(frame),
  );
  await expect(page.locator('.stage-picture')).toHaveAttribute(
    'data-frame',
    String(frame),
    { timeout: 10_000 },
  );
}

/** Mean brightness of the preview picture, 0 (black) to 1 (white). */
const brightness = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector(
      '.stage canvas',
    ) as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !canvas.width) return -1;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4 * 16) {
      sum += data[i] + data[i + 1] + data[i + 2];
      n += 3;
    }
    return sum / n / 255;
  });

/** What the clip tells a screen reader beyond its name. */
async function description(page: Page, index: number) {
  const clip = clips(page).nth(index);
  const ids = (await clip.getAttribute('aria-describedby')) ?? '';
  const parts: string[] = [];
  for (const id of ids.split(' ').filter(Boolean)) {
    parts.push((await page.locator(`#${id}`).textContent()) ?? '');
  }
  return parts.join(' ');
}

test.describe('fades', () => {
  test('the panel comes with the clip, and a fade is a toggle with a mark, a sentence and an undo', async ({
    page,
  }) => {
    await withClip(page);
    await expect(page.getByRole('heading', { name: '클립' })).toHaveCount(0);
    await clips(page).first().click();
    await expect(page.getByRole('heading', { name: '클립' })).toBeVisible();
    await expect(fadeInButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.clip-fade')).toHaveCount(0);

    await fadeInButton(page).click();
    await expect(fadeInButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(status(page)).toContainText(
      '앞부분이 0.5초 동안 서서히 나타나요 · 검은 화면에서 시작해요',
    );
    const mark = page.locator('.clip-fade.in');
    await expect(mark).toHaveCount(1);
    expect((await mark.boundingBox())!.width).toBeGreaterThan(4);
    // Said in words too: the mark is decorative.
    expect(await description(page, 0)).toContain('앞 0.5초 동안 서서히 나타남');
    // The panel says what the edge goes to, without a word to learn.
    await expect(page.locator('.clip-edge').first()).toContainText(
      '검은 화면에서 시작해요',
    );

    await page.keyboard.press('Control+z');
    await expect(page.locator('.clip-fade')).toHaveCount(0);
    await expect(fadeInButton(page)).toHaveAttribute('aria-pressed', 'false');
    expect(await description(page, 0)).not.toContain('서서히');
  });

  test('the picture is black on the first frame, half-way in the middle, and itself after — and the file keeps every frame', async ({
    page,
  }) => {
    await withClip(page);
    await clips(page).first().click();
    await fadeInButton(page).click();

    await goToFrame(page, 20);
    await expect
      .poll(() => brightness(page), { timeout: 10_000 })
      .toBeGreaterThan(0.05);
    const full = await brightness(page);

    await goToFrame(page, 0);
    await expect
      .poll(() => brightness(page), { timeout: 10_000 })
      .toBeLessThan(0.01);

    // Frame 7 of a 15-frame fade shows 8/15 of the picture. Wait for the
    // DARKER side first: the canvas still shows frame 20 (fully bright)
    // until frame 7 is decoded and drawn, and a poll for "brighter than
    // 35%" is satisfied by that stale picture at once.
    await goToFrame(page, 7);
    await expect
      .poll(() => brightness(page), { timeout: 10_000 })
      .toBeLessThan(full * 0.7);
    expect(await brightness(page)).toBeGreaterThan(full * 0.35);

    // Export renders the same plan: same frame count, nothing dropped.
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByRole('button', { name: /내보내기/ }).click();
    await downloadPromise;
    await expect(status(page)).toContainText('내보내기 완료', {
      timeout: 120_000,
    });
    await expect(status(page)).toContainText('90 frames');
  });

  test('a fade-out at a cut goes to the next clip; once that clip is gone, to black', async ({
    page,
  }) => {
    await withClip(page);
    await goToFrame(page, 45);
    await page.keyboard.press('c');
    await expect(clips(page)).toHaveCount(2);

    await clips(page).first().click();
    await fadeOutButton(page).click();
    await expect(status(page)).toContainText('뒤 클립과 겹쳐서 넘어가요');
    await expect(
      page.locator('.clip').first().locator('.clip-fade.out'),
    ).toHaveCount(1);
    await expect(
      page.locator('.clip').nth(1).locator('.clip-fade'),
    ).toHaveCount(0);
    expect(await description(page, 0)).toContain('서서히 사라짐');
    // Two halves of one shot: the overhang IS the next clip's picture, so
    // the last frame before the cut is not dark.
    await goToFrame(page, 44);
    await expect
      .poll(() => brightness(page), { timeout: 10_000 })
      .toBeGreaterThan(0.05);

    // Take the second clip away: the same fade now ends in black.
    await clips(page).nth(1).click();
    await page.keyboard.press('Delete');
    await expect(clips(page)).toHaveCount(1);
    await clips(page).first().click();
    await expect(page.locator('.clip-edge').nth(1)).toContainText(
      '검은 화면으로 끝나요',
    );
    await goToFrame(page, 44);
    await expect
      .poll(() => brightness(page), { timeout: 10_000 })
      .toBeLessThan(0.01);
  });

  test('the length is a choice, and a clip too short for it says so', async ({
    page,
  }) => {
    await withClip(page);
    await clips(page).first().click();
    await fadeOutButton(page).click();
    const length = page.getByRole('combobox', { name: '서서히 사라지기 길이' });
    await expect(length).toHaveValue('15');
    const before = (await page.locator('.clip-fade.out').boundingBox())!.width;
    await length.selectOption('60'); // 2초 of the 3 s clip
    await expect(status(page)).toContainText(
      '뒷부분이 2초 동안 서서히 사라져요',
    );
    const after = (await page.locator('.clip-fade.out').boundingBox())!.width;
    expect(after).toBeGreaterThan(before * 3);

    // The head gets what the tail leaves: 30 of 90 frames.
    await fadeInButton(page).click();
    await page
      .getByRole('combobox', { name: '서서히 나타나기 길이' })
      .selectOption('60');
    await expect(status(page)).toContainText(
      '뒷부분의 서서히 사라지기와 겹치지 않게 1초로 줄였어요',
    );
    // The document holds what fits, so the choice shows 1초 — not 2초.
    await expect(
      page.getByRole('combobox', { name: '서서히 나타나기 길이' }),
    ).toHaveValue('30');
  });

  test('works from the keyboard alone', async ({ page }) => {
    await withClip(page);
    await clips(page).first().focus();
    await page.keyboard.press('Enter'); // select
    await fadeInButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(fadeInButton(page)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Tab');
    const length = page.getByRole('combobox', { name: '서서히 나타나기 길이' });
    await expect(length).toBeFocused();
    // A plain key on the list belongs to the list: Delete here once
    // ripple-deleted the very clip whose fade was being set.
    await page.keyboard.press('Delete');
    await page.keyboard.press('c');
    await expect(clips(page)).toHaveCount(1);
    await expect(length).toBeFocused();
    // What the edge goes to is read after the control's name, not only
    // said once by the status line.
    const note = await fadeInButton(page).getAttribute('aria-describedby');
    await expect(page.locator(`#${note}`)).toContainText(
      '검은 화면에서 시작해요',
    );
    // The palette lists it under its own name, so it can be found by typing.
    await page.keyboard.press('Control+k');
    await page
      .getByRole('combobox', { name: '무엇을 할지 검색하세요' })
      .fill('서서히');
    await expect(
      page.getByRole('option', { name: /서서히 나타나기/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('option', { name: /서서히 사라지기/ }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('a split leaves the head its fade-in and the tail its fade-out, and the new cut hard', async ({
    page,
  }) => {
    await withClip(page);
    await clips(page).first().click();
    await fadeInButton(page).click();
    await fadeOutButton(page).click();
    await goToFrame(page, 45);
    await page.keyboard.press('c');
    await expect(clips(page)).toHaveCount(2);
    await expect(clips(page).nth(0).locator('.clip-fade.in')).toHaveCount(1);
    await expect(clips(page).nth(0).locator('.clip-fade.out')).toHaveCount(0);
    await expect(clips(page).nth(1).locator('.clip-fade.in')).toHaveCount(0);
    await expect(clips(page).nth(1).locator('.clip-fade.out')).toHaveCount(1);
  });
});
