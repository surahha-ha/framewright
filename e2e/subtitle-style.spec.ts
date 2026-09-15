// framewright — 예능 자막 in a real browser (ADR-0017).
//
// The arithmetic — what each choice writes into the document, where a placed
// block lands, how far in an effect is on a frame — is unit-tested in
// `src/engine/subtitleStyle.test.ts` and `subtitleRender.test.ts`. What only a
// browser can answer: that a look, a place and an effect actually reach the
// pixels of the overlay, on the right frames; that the three rows work by
// keyboard; that a choice survives a reload; and that an export of a styled
// subtitle still has every frame.
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
const playheadFrame = async (page: Page) =>
  Number(await page.locator('.ruler').getAttribute('aria-valuenow'));
const group = (page: Page, name: string) =>
  page.getByRole('radiogroup', { name, exact: true });
const radio = (page: Page, groupName: string, name: string) =>
  group(page, groupName).getByRole('radio', { name, exact: true });

/**
 * The overlay's ink: where it is (fractions of the height), the strongest
 * alpha anywhere, and whether any of it is yellow. Null when blank.
 */
async function overlayInk(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector(
      '.stage-subtitle',
    ) as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !canvas.width) return null;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let top = -1;
    let bottom = -1;
    let maxAlpha = 0;
    let yellow = false;
    for (let y = 0; y < canvas.height; y++) {
      let inked = false;
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        const a = data[i + 3];
        if (a === 0) continue;
        inked = true;
        if (a > maxAlpha) maxAlpha = a;
        if (data[i] > 200 && data[i + 1] > 180 && data[i + 2] < 140)
          yellow = true;
      }
      if (inked) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    if (top < 0) return null;
    return {
      top: top / canvas.height,
      bottom: bottom / canvas.height,
      maxAlpha,
      yellow,
    };
  });
}

async function goToFrame(page: Page, frame: number) {
  await page.locator('.ruler').focus();
  await page.keyboard.press('Home');
  for (let f = 0; f < frame; f++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.ruler')).toHaveAttribute(
    'aria-valuenow',
    String(frame),
  );
}

/** A subtitle with words, well inside the clip; returns its first frame. */
async function withWords(page: Page, clear = true) {
  await withClip(page, clear);
  await page.locator('.track').click({ position: { x: 200, y: 20 } });
  const at = await playheadFrame(page);
  expect(at).toBeGreaterThan(0);
  await page.getByRole('button', { name: '자막 넣기', exact: true }).click();
  await expect(chips(page)).toHaveCount(1);
  await field(page).fill('예능 자막');
  await page.keyboard.press('Enter');
  await expect(chips(page).first()).toContainText('예능 자막');
  await expect.poll(() => overlayInk(page)).not.toBeNull();
  return at;
}

test.describe('예능 자막', () => {
  test('the panel offers three rows, each with the first choice chosen', async ({
    page,
  }) => {
    await withWords(page);
    await expect(group(page, '모양')).toBeVisible();
    await expect(radio(page, '모양', '기본')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(radio(page, '자리', '아래')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(radio(page, '효과', '바로')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // The four effect choices wrap INSIDE their group, so the word 효과
    // keeps the same column as 모양 and 자리 and the group starts where
    // theirs do. As one rigid item the group dropped whole under the word
    // (seen in the owner's Chrome, 2026-09-15).
    const left = async (name: string) =>
      (await group(page, name).boundingBox())!.x;
    expect(await left('효과')).toBeCloseTo(await left('모양'), 0);
    expect(await left('자리')).toBeCloseTo(await left('모양'), 0);
  });

  test('위 puts the words in the top band, says so, and one undo puts them back', async ({
    page,
  }) => {
    await withWords(page);
    const before = (await overlayInk(page))!;
    expect(before.bottom).toBeGreaterThan(0.8);

    await radio(page, '자리', '위').click();
    await expect(status(page)).toContainText('자막 자리를 위로 옮겼어요');
    await expect(radio(page, '자리', '위')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect
      .poll(async () => (await overlayInk(page))?.bottom ?? 1)
      .toBeLessThan(0.4);
    expect((await overlayInk(page))!.top).toBeGreaterThan(0.02);

    await page.locator('.ruler').focus(); // leave the panel; Ctrl+Z is the editor's
    await page.keyboard.press('ControlOrMeta+z');
    await expect(radio(page, '자리', '아래')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect
      .poll(async () => (await overlayInk(page))?.bottom ?? 0)
      .toBeGreaterThan(0.8);
  });

  test('강조 changes the ink to yellow, and 기본 takes it back', async ({
    page,
  }) => {
    await withWords(page);
    expect((await overlayInk(page))!.yellow).toBe(false);
    await radio(page, '모양', '강조').click();
    await expect(status(page)).toContainText('자막 모양을 강조로 바꿨어요');
    await expect.poll(async () => (await overlayInk(page))?.yellow).toBe(true);
    await radio(page, '모양', '기본').click();
    await expect(status(page)).toContainText('자막 모양을 기본으로 되돌렸어요');
    await expect.poll(async () => (await overlayInk(page))?.yellow).toBe(false);
  });

  test('서서히 is faint on the first frame and full in the middle', async ({
    page,
  }) => {
    const start = await withWords(page);
    await radio(page, '효과', '서서히').click();
    await expect(status(page)).toContainText('자막 효과를 서서히로 바꿨어요');
    await goToFrame(page, start);
    const first = (await overlayInk(page))!;
    await goToFrame(page, start + 15);
    const middle = (await overlayInk(page))!;
    // 1/8 of the way in on the first frame: well under half the middle's ink.
    expect(first.maxAlpha).toBeLessThan(middle.maxAlpha / 2);
    expect(middle.maxAlpha).toBeGreaterThan(200);
  });

  test('the choice already made is refused with a sentence, not an undo step', async ({
    page,
  }) => {
    await withWords(page);
    await radio(page, '모양', '기본').click();
    await expect(status(page)).toContainText('이미 기본 모양이에요');
    await radio(page, '효과', '바로').click();
    await expect(status(page)).toContainText('이미 효과가 없어요');
  });

  test('the arrows choose within a row, and never reach the playhead', async ({
    page,
  }) => {
    await withWords(page);
    const before = await playheadFrame(page);
    await radio(page, '모양', '기본').focus();
    await page.keyboard.press('ArrowRight');
    await expect(radio(page, '모양', '강조')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(radio(page, '모양', '강조')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(radio(page, '모양', '외침')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(await playheadFrame(page)).toBe(before);
  });

  test('a look and a place survive a reload', async ({ page }) => {
    // `clear: false` — the init script that clears storage runs on EVERY
    // navigation, the reload included, and would wipe what this test checks.
    await withWords(page, false);
    await radio(page, '모양', '외침').click();
    await radio(page, '자리', '가운데').click();
    await expect(status(page)).toContainText('자막 자리를 가운데로 옮겼어요');
    await page.waitForTimeout(800); // past the save debounce
    await page.reload();
    await expect(chips(page)).toHaveCount(1);
    await chips(page).first().click();
    await expect(radio(page, '모양', '외침')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(radio(page, '자리', '가운데')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('an export of a styled subtitle has every frame', async ({ page }) => {
    await withWords(page);
    await radio(page, '모양', '강조').click();
    await radio(page, '자리', '가운데').click();
    await radio(page, '효과', '톡').click();
    await expect(status(page)).toContainText('자막 효과를 톡으로 바꿨어요');
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByRole('button', { name: /내보내기/ }).click();
    await downloadPromise;
    await expect(status(page)).toContainText('내보내기 완료', {
      timeout: 120_000,
    });
    await expect(status(page)).toContainText('90 frames');
  });
});
