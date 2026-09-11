// framewright — a clip's picture, in a real browser (ADR-0014).
//
// The arithmetic (where the picture lands, how it turns) is unit-tested in
// `src/engine/picture.test.ts`, the commands in `pictureCommands.test.ts`,
// the draw in `compose.test.ts`. What only a browser can answer: that the
// panel's controls and a drag on the preview drive those commands, that the
// pixels move the way the plan says, and that the `R` key does what the
// button does.
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
  await page.locator('.timeline .clip').first().click();
  await expect(page.getByRole('heading', { name: '클립' })).toBeVisible();
  // The click also parks the playhead where it landed; wait until THAT
  // frame's picture is drawn before reading any pixels.
  const frame = await page.locator('.ruler').getAttribute('aria-valuenow');
  await expect(page.locator('.stage-picture')).toHaveAttribute(
    'data-frame',
    frame ?? '0',
    { timeout: 10_000 },
  );
}

const clips = (page: Page) => page.locator('.timeline .clip');
const status = (page: Page) => page.locator('.statusbar');
const mark = (page: Page) => page.locator('.clip-picture-mark');
const rotateButton = (page: Page) =>
  page.getByRole('button', { name: '화면 돌리기', exact: true });
const resetButton = (page: Page) =>
  page.getByRole('button', { name: '화면 원래대로', exact: true });
const zoomSlider = (page: Page) =>
  page.getByRole('slider', { name: '확대', exact: true });
const panXSlider = (page: Page) =>
  page.getByRole('slider', { name: '가로 위치', exact: true });

/** Mean brightness of a horizontal band of the picture: `from`..`to` as
 *  fractions of its width, 0 (black) to 1 (white). */
const bandBrightness = (page: Page, from: number, to: number) =>
  page.evaluate(
    ([from, to]) => {
      const canvas = document.querySelector(
        '.stage-picture',
      ) as HTMLCanvasElement | null;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx || !canvas.width) return -1;
      const x0 = Math.floor(canvas.width * from);
      const w = Math.max(1, Math.floor(canvas.width * (to - from)));
      const { data } = ctx.getImageData(x0, 0, w, canvas.height);
      let sum = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4 * 8) {
        sum += data[i] + data[i + 1] + data[i + 2];
        n += 3;
      }
      return sum / n / 255;
    },
    [from, to] as const,
  );

async function description(page: Page, index: number) {
  const clip = clips(page).nth(index);
  const ids = (await clip.getAttribute('aria-describedby')) ?? '';
  const parts: string[] = [];
  for (const id of ids.split(' ').filter(Boolean)) {
    parts.push((await page.locator(`#${id}`).textContent()) ?? '');
  }
  return parts.join(' ');
}

test.describe('picture', () => {
  test('a quarter turn stands the picture up: black at both sides, a mark, words, an undo', async ({
    page,
  }) => {
    await withClip(page);
    // As shot, the 16:9 fixture fills the 16:9 box: the left edge has colour.
    expect(await bandBrightness(page, 0, 0.2)).toBeGreaterThan(0.05);
    await expect(page.locator('#clip-picture-note')).toHaveText(
      '찍은 그대로 보여요',
    );
    await expect(resetButton(page)).toHaveAttribute('aria-disabled', 'true');

    await rotateButton(page).click();
    await expect(status(page)).toContainText('화면을 90° 돌렸어요.');
    await expect(mark(page)).toContainText('↻');
    expect(await description(page, 0)).toContain('90° 회전');
    // The turn's own black sides are said now (ADR-0015 made the note
    // geometric); before, the note read just "90° 회전" over two black bands.
    await expect(page.locator('#clip-picture-note')).toHaveText(
      '90° 회전 · 화면 양옆이 비어요',
    );
    // Standing up inside the box: the sides are black, the middle is not.
    await expect
      .poll(() => bandBrightness(page, 0, 0.25), { timeout: 10_000 })
      .toBeLessThan(0.01);
    expect(await bandBrightness(page, 0.4, 0.6)).toBeGreaterThan(0.05);
    await expect(resetButton(page)).toHaveAttribute('aria-disabled', 'false');

    // Stood up, the picture is narrower than the box, so the sideways pan
    // stops where the picture's own edge reaches the centre — 15% of the
    // box, not half of it. Half a box carried it clear out, leaving an
    // all-black preview under "화면 한쪽이 비어요" (the owner's Chrome,
    // 2026-09-10). The slider says its limit, and at that limit the centre
    // still shows picture.
    await expect(panXSlider(page)).toHaveAttribute('max', '15');
    await expect(page.locator('#clip-picture-limit')).toContainText(
      '가로로는 15%까지만',
    );
    // The sentence names the sideways axis, so only that slider is
    // described by it; up and down still go the full half box.
    await expect(panXSlider(page)).toHaveAttribute(
      'aria-describedby',
      'clip-picture-note clip-picture-limit',
    );
    const panYSlider = page.getByRole('slider', {
      name: '세로 위치',
      exact: true,
    });
    await expect(panYSlider).toHaveAttribute('max', '50');
    await expect(panYSlider).toHaveAttribute(
      'aria-describedby',
      'clip-picture-note',
    );
    await panXSlider(page).focus();
    await page.keyboard.press('End');
    await expect(status(page)).toContainText(
      '화면을 옮겼어요 (오른쪽으로 15%).',
    );
    await expect
      .poll(() => bandBrightness(page, 0.5, 0.6), { timeout: 10_000 })
      .toBeGreaterThan(0.05);

    // Two edits, two undos: the pan first (the turn's mark stays), then
    // the turn.
    await page.keyboard.press('Control+z');
    await expect(panXSlider(page)).toHaveValue('0');
    await expect(mark(page)).toContainText('↻');
    await page.keyboard.press('Control+z');
    await expect(mark(page)).toHaveCount(0);
    await expect
      .poll(() => bandBrightness(page, 0, 0.2), { timeout: 10_000 })
      .toBeGreaterThan(0.05);
  });

  test('R turns it, and the palette lists the turn and the reset but not the sliders', async ({
    page,
  }) => {
    await withClip(page);
    await page.keyboard.press('r');
    await expect(status(page)).toContainText('화면을 90° 돌렸어요.');
    await page.keyboard.press('r');
    await page.keyboard.press('r');
    await page.keyboard.press('r');
    await expect(status(page)).toContainText(
      '화면을 원래 방향으로 되돌렸어요.',
    );
    await expect(mark(page)).toHaveCount(0);

    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: '명령 찾기' });
    await dialog.getByRole('combobox').fill('화면');
    const rows = dialog.getByRole('option');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('화면 돌리기');
    await expect(rows.nth(1)).toContainText('화면 채우기');
    await expect(rows.nth(2)).toContainText('화면 원래대로');
  });

  test('the zoom slider grows the picture, the pan slider moves it, and the reset puts all back in one step', async ({
    page,
  }) => {
    await withClip(page);
    await zoomSlider(page).focus();
    await page.keyboard.press('End');
    await expect(zoomSlider(page)).toHaveValue('400');
    await expect(status(page)).toContainText('화면을 400%로 확대했어요.');
    await expect(mark(page)).toContainText('🔍');
    expect(await description(page, 0)).toContain('화면 400%');
    await expect(page.locator('#clip-picture-note')).toContainText('화면 400%');

    // At 400% the picture is four boxes wide, so a move uncovers nothing;
    // back at the fit, half a box to the right empties the left half.
    await page.keyboard.press('Home');
    await expect(zoomSlider(page)).toHaveValue('100');
    await expect(status(page)).toContainText('화면 확대를 풀었어요.');
    await panXSlider(page).focus();
    await page.keyboard.down('ArrowRight');
    for (let i = 0; i < 9; i++) await page.keyboard.down('ArrowRight');
    await page.keyboard.up('ArrowRight');
    await expect(panXSlider(page)).toHaveValue('50');
    await expect(status(page)).toContainText(
      '화면을 옮겼어요 (오른쪽으로 50%).',
    );
    await expect
      .poll(() => bandBrightness(page, 0, 0.45), { timeout: 10_000 })
      .toBeLessThan(0.01);
    expect(await bandBrightness(page, 0.6, 1)).toBeGreaterThan(0.05);
    await expect(mark(page)).toContainText('✥');

    // The turn on top: stood up, the picture is narrower, so the turn
    // pulls the pan inside its new limit (15%) and says so. Then
    // everything back in one step, and one undo restores the turned,
    // pulled-in state — not the 50% from before the turn.
    await rotateButton(page).click();
    await expect(status(page)).toContainText(
      '화면을 90° 돌렸어요 · 위치는 보이는 범위 안으로 맞췄어요.',
    );
    await expect(panXSlider(page)).toHaveValue('15');
    await expect(mark(page)).toContainText('↻✥');
    await resetButton(page).click();
    await expect(status(page)).toContainText('화면을 찍은 그대로 되돌렸어요.');
    await expect(panXSlider(page)).toHaveValue('0');
    await expect(mark(page)).toHaveCount(0);
    await expect(resetButton(page)).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Control+z');
    await expect(panXSlider(page)).toHaveValue('15');
    await expect(mark(page)).toContainText('↻✥');
    // And the undo before that puts the half-box pan back, unturned.
    await page.keyboard.press('Control+z');
    await expect(panXSlider(page)).toHaveValue('50');
    await expect(mark(page)).toContainText('✥');
    await expect(mark(page)).not.toContainText('↻');
  });

  test('dragging on the preview moves the picture, as one undo step', async ({
    page,
  }) => {
    await withClip(page);
    const picture = page.locator('.stage-picture');
    const box = (await picture.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + box.width * 0.25, cy, { steps: 5 });
    await page.mouse.move(cx + box.width * 0.5, cy + box.height * 0.1, {
      steps: 5,
    });
    await page.mouse.up();
    await expect(status(page)).toContainText(
      '화면을 옮겼어요 (오른쪽으로 50%, 아래로 10%).',
    );
    await expect(panXSlider(page)).toHaveValue('50');
    await expect(mark(page)).toContainText('✥');
    await page.keyboard.press('Control+z');
    await expect(panXSlider(page)).toHaveValue('0');
    await expect(mark(page)).toHaveCount(0);
  });
});
