// framewright — the words dragged anywhere on the picture (E8-2c, ADR-0019).
//
// The arithmetic — the normal form, the snap, the sentences, the sliders'
// numbers — is unit-tested in `src/engine/subtitlePosition.test.ts`. What
// only a browser can answer: that a press on the drawn words and a drag
// moves them by the drag and is one undo step; that a drop near a preset
// lands ON it and lights its radio; that off every preset the row shows
// nothing checked and a sentence says where the words are; that a press
// off the words still moves the picture; that the sliders move the words
// by keyboard; that a position survives a reload and an export.
import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supportsH264 } from './helpers';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'sample-h264.mp4',
);

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

const chips = (page: Page) => page.locator('.subtitle-lane .subtitle');
const field = (page: Page) => page.getByRole('textbox', { name: '내용' });
const status = (page: Page) => page.locator('.statusbar');
const group = (page: Page, name: string) =>
  page.getByRole('radiogroup', { name, exact: true });
const radio = (page: Page, groupName: string, name: string) =>
  group(page, groupName).getByRole('radio', { name, exact: true });
const slider = (page: Page, name: string) =>
  page.getByRole('slider', { name, exact: true });
const note = (page: Page) => page.locator('#subtitle-position-note');

/** The overlay's inked box in overlay pixels, or null when blank. */
async function inkBounds(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector(
      '.stage-subtitle',
    ) as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !canvas.width) return null;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let top = -1;
    let bottom = -1;
    let left = canvas.width;
    let right = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (data[(y * canvas.width + x) * 4 + 3] === 0) continue;
        if (top < 0) top = y;
        bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
    return top < 0
      ? null
      : { top, bottom, left, right, w: canvas.width, h: canvas.height };
  });
}

/** The ink's centre as fractions of the box, and in page pixels. */
async function inkCentre(page: Page) {
  const b = (await inkBounds(page))!;
  const box = (await page.locator('.stage-subtitle').boundingBox())!;
  const fx = (b.left + b.right) / 2 / b.w;
  const fy = (b.top + b.bottom) / 2 / b.h;
  return {
    fx,
    fy,
    x: box.x + fx * box.width,
    y: box.y + fy * box.height,
    box,
  };
}

/** Press on the words and drag by fractions of the box. */
async function dragWords(page: Page, dxFrac: number, dyFrac: number) {
  const c = await inkCentre(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  const tx = c.x + dxFrac * c.box.width;
  const ty = c.y + dyFrac * c.box.height;
  await page.mouse.move((c.x + tx) / 2, (c.y + ty) / 2, { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 4 });
  await page.mouse.up();
  return c;
}

async function withWords(page: Page, clear = true) {
  await withClip(page, clear);
  await page.locator('.track').click({ position: { x: 200, y: 20 } });
  await page.getByRole('button', { name: '자막 넣기', exact: true }).click();
  await expect(chips(page)).toHaveCount(1);
  await field(page).fill('끌어 놓기');
  await page.keyboard.press('Enter');
  await expect(chips(page).first()).toContainText('끌어 놓기');
  await expect.poll(() => inkBounds(page)).not.toBeNull();
}

test.describe('자막 끌기', () => {
  test('a drag on the words moves them by the drag, says where they are, and is one undo step', async ({
    page,
  }) => {
    await withWords(page);
    const before = await inkCentre(page);
    expect(before.fy).toBeGreaterThan(0.8); // the bottom stack

    await dragWords(page, -0.25, -0.4);
    await expect(status(page)).toContainText(
      /자막을 옮겼어요 · 왼쪽에서 2\d% · 위에서 [45]\d%\./,
    );
    const after = await inkCentre(page);
    expect(after.fx).toBeCloseTo(before.fx - 0.25, 1);
    expect(after.fy).toBeCloseTo(before.fy - 0.4, 1);
    // Off every preset: nothing checked, and the sentence says where.
    for (const name of ['아래', '가운데', '위']) {
      await expect(radio(page, '자리', name)).toHaveAttribute(
        'aria-checked',
        'false',
      );
    }
    await expect(note(page)).toHaveText(/왼쪽에서 2\d% · 위에서 [45]\d%/);
    await expect(slider(page, '가로 자리')).toHaveValue(/^2\d$/);

    await page.locator('.ruler').focus(); // leave the panel; Ctrl+Z is the editor's
    await page.keyboard.press('ControlOrMeta+z');
    await expect
      .poll(async () => (await inkCentre(page)).fy)
      .toBeCloseTo(before.fy, 2);
    await expect(radio(page, '자리', '아래')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(slider(page, '세로 자리')).toHaveValue('100');
  });

  test("a drop near 가운데 lands on it: the radio lights and the preset's sentence is said", async ({
    page,
  }) => {
    await withWords(page);
    const before = await inkCentre(page);
    // Straight up to just beside the centre — within the snap.
    await dragWords(page, 0.01, 0.49 - before.fy);
    await expect(status(page)).toContainText('자막 자리를 가운데로 옮겼어요.');
    await expect(radio(page, '자리', '가운데')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(note(page)).toContainText('가운데 자리에 있어요');
    const after = await inkCentre(page);
    expect(after.fy).toBeCloseTo(0.5, 1);
    expect(after.fx).toBeCloseTo(0.5, 1);
  });

  test("on an effect's first frame the press counts where the ink IS", async ({
    page,
  }) => {
    // 올라오기 draws the words a good way below their rest bounds on the
    // first frame; the hit test must follow the ink, not the rest layout
    // (QA). Enter on the chip parks the playhead on that first frame.
    await withWords(page);
    await radio(page, '효과', '올라오기').click();
    await expect(status(page)).toContainText('자막 효과를 올라오기로 바꿨어요');
    await chips(page).first().focus();
    await page.keyboard.press('Enter');
    const first = await inkCentre(page);
    await dragWords(page, -0.2, -0.3);
    await expect(status(page)).toContainText('자막을 옮겼어요 · 왼쪽에서');
    const after = await inkCentre(page);
    expect(after.fx).toBeCloseTo(first.fx - 0.2, 1);
    expect(after.fy).toBeCloseTo(first.fy - 0.3, 1);
  });

  test('a press off the words still moves the picture, not the words', async ({
    page,
  }) => {
    await withWords(page);
    const words = await inkCentre(page);
    const box = words.box;
    // The top-left quarter of the picture: no words there.
    const x = box.x + box.width * 0.2;
    const y = box.y + box.height * 0.2;
    await page.mouse.click(x, y);
    await expect(status(page)).toContainText('지금 보이는 클립을 골랐어요');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + box.width * 0.25, y, { steps: 5 });
    await page.mouse.up();
    await expect(status(page)).toContainText('화면을 옮겼어요');
    // A press on the words that does not move them picks the subtitle
    // back (the clip had it) and says so — the panel changed under the
    // pointer.
    await page.mouse.click(words.x, words.y);
    await expect(status(page)).toContainText(
      '화면의 자막을 골랐어요 · 끌면 자리가 옮겨져요.',
    );
    // The words did not move with the picture.
    const after = await inkCentre(page);
    expect(after.fx).toBeCloseTo(words.fx, 2);
    expect(after.fy).toBeCloseTo(words.fy, 2);
  });

  test('the sliders move the words by keyboard, one sentence per gesture', async ({
    page,
  }) => {
    await withWords(page);
    const before = await inkCentre(page);
    await expect(slider(page, '가로 자리')).toHaveValue('50');
    await expect(slider(page, '세로 자리')).toHaveValue('100');

    await slider(page, '가로 자리').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(slider(page, '가로 자리')).toHaveValue('53');
    await expect(status(page)).toContainText(
      '자막을 옮겼어요 · 왼쪽에서 53% · 맨 아래.',
    );
    await expect(slider(page, '가로 자리')).toHaveAttribute(
      'aria-valuetext',
      '왼쪽에서 53%',
    );
    await expect
      .poll(async () => (await inkCentre(page)).fx)
      .toBeGreaterThan(before.fx + 0.02);

    await slider(page, '세로 자리').focus();
    await page.keyboard.press('Home');
    await expect(slider(page, '세로 자리')).toHaveValue('0');
    await expect(status(page)).toContainText(
      '자막을 옮겼어요 · 왼쪽에서 53% · 위에서 0%.',
    );
    await expect.poll(async () => (await inkCentre(page)).fy).toBeLessThan(0.2);
    // Home on 세로 was one gesture; each separate arrow press on 가로 was
    // its own (the key came up between them — a HELD arrow would be one,
    // as on the picture's sliders).
    await page.locator('.ruler').focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(slider(page, '세로 자리')).toHaveValue('100');
    await expect(slider(page, '가로 자리')).toHaveValue('53');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(slider(page, '가로 자리')).toHaveValue('52');
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(slider(page, '가로 자리')).toHaveValue('50');
    await expect(radio(page, '자리', '아래')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('a position survives a reload', async ({ page }) => {
    // `clear: false` — the init script that clears storage runs on EVERY
    // navigation, the reload included.
    await withWords(page, false);
    await dragWords(page, -0.25, -0.4);
    await expect(status(page)).toContainText('자막을 옮겼어요');
    const said = (await note(page).textContent())!;
    await page.waitForTimeout(800); // past the save debounce
    await page.reload();
    await expect(chips(page)).toHaveCount(1);
    await chips(page).first().focus();
    await page.keyboard.press('Enter');
    await expect(note(page)).toHaveText(said);
  });

  test('an export with dragged words has every frame', async ({ page }) => {
    await withWords(page);
    await dragWords(page, -0.25, -0.4);
    await expect(status(page)).toContainText('자막을 옮겼어요');
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByRole('button', { name: /내보내기/ }).click();
    await downloadPromise;
    await expect(status(page)).toContainText('내보내기 완료', {
      timeout: 120_000,
    });
    await expect(status(page)).toContainText('90 frames');
  });
});
