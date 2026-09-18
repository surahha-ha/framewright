// framewright — the picture on the stage, dragged by hand (E10 step 4,
// ADR-0020).
//
// The arithmetic is unit-tested elsewhere: where the rectangle lands in
// `src/engine/imageRender.test.ts`, the normal form and the snap in
// `src/engine/images.test.ts`, the command in `imageCommands.test.ts`, and
// the hook's own hit test, base and coalesce key in `src/ui/useImageDrag.test.ts`.
//
// What only a browser can answer, and what this file is for:
//
//   - a real press on the drawn rectangle moves the picture, and the pixels
//     end up where the numbers say;
//   - the whole gesture is ONE undo step, even though every move dispatched
//     a command;
//   - and — the reason this file exists at all — that the stage's THREE
//     drags share one handler set correctly. The hit order (words → image →
//     pan) and the one-gesture-at-a-time rule are a contract between three
//     hooks and the DOM. No unit test can see it: each hook is correct on
//     its own and the defect only appears when two of them are asked about
//     the same press.
//
// Conventions are `e2e/subtitle-drag.spec.ts`'s, deliberately: the ink on a
// layer's own canvas is the oracle (both overlays are transparent apart from
// what they draw), fractions of the box are the unit, and the status line is
// the only thing that announces.
import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supportsH264 } from './helpers';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const VIDEO = join(FIXTURES, 'sample-h264.mp4');
const PICTURE = join(FIXTURES, 'sample-picture.png');

const status = (page: Page) => page.locator('.statusbar');
const chips = (page: Page) => page.locator('.subtitle-lane .subtitle');
const field = (page: Page) => page.getByRole('textbox', { name: '내용' });

/** The inked box of one stage layer, in that canvas's own pixels, or null
 *  when it is blank. Both overlays are cleared and then drawn on, so
 *  anything with alpha is what the layer put there. */
async function inkBounds(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
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
  }, selector);
}

/** The ink's centre as fractions of the box AND in page pixels, with its
 *  four edges in page pixels too — the edges are what lets a test prove a
 *  press point really is inside two layers at once. */
async function ink(page: Page, selector: string) {
  const b = (await inkBounds(page, selector))!;
  const box = (await page.locator(selector).boundingBox())!;
  const fx = (b.left + b.right) / 2 / b.w;
  const fy = (b.top + b.bottom) / 2 / b.h;
  return {
    fx,
    fy,
    x: box.x + fx * box.width,
    y: box.y + fy * box.height,
    left: box.x + (b.left / b.w) * box.width,
    right: box.x + (b.right / b.w) * box.width,
    top: box.y + (b.top / b.h) * box.height,
    bottom: box.y + (b.bottom / b.h) * box.height,
    box,
  };
}

const imageInk = (page: Page) => ink(page, '.stage-image');
const wordsInk = (page: Page) => ink(page, '.stage-subtitle');

/** Footage, then a picture on it at the playhead. Two uploads through the
 *  one hidden file input: the bin tells them apart by the file itself. */
async function withPicture(page: Page) {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  test.skip(
    !(await supportsH264(page)),
    'this browser has no H.264 (use `npm run e2e:chrome`)',
  );
  await page.setInputFiles('input[type="file"]', VIDEO);
  await expect(page.locator('.timeline .clip')).toHaveCount(1, {
    timeout: 15_000,
  });
  // Park the playhead inside the clip before the picture goes in: both the
  // picture and (in the overlap test) the subtitle are placed AT the
  // playhead, so this is what puts the two on screen together.
  await page.locator('.track').click({ position: { x: 200, y: 20 } });
  await page.setInputFiles('input[type="file"]', PICTURE);
  await expect(status(page)).toContainText('위치에 이미지를 넣었어요');
  await expect
    .poll(() => inkBounds(page, '.stage-image'), { timeout: 10_000 })
    .not.toBeNull();
}

/** A subtitle at the same playhead, so its words and the picture are on the
 *  stage at the same time. */
async function andWords(page: Page) {
  await page.getByRole('button', { name: '자막 넣기', exact: true }).click();
  await expect(chips(page)).toHaveCount(1);
  await field(page).fill('겹쳐 놓기');
  await page.keyboard.press('Enter');
  await expect(chips(page).first()).toContainText('겹쳐 놓기');
  await expect.poll(() => inkBounds(page, '.stage-subtitle')).not.toBeNull();
}

/** Press on the picture and drag by fractions of the box. */
async function dragImage(page: Page, dxFrac: number, dyFrac: number) {
  const c = await imageInk(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  const tx = c.x + dxFrac * c.box.width;
  const ty = c.y + dyFrac * c.box.height;
  await page.mouse.move((c.x + tx) / 2, (c.y + ty) / 2, { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 4 });
  await page.mouse.up();
  return c;
}

test.describe('이미지 끌기', () => {
  test('a drag on the picture moves it, says where it went, and is one undo step', async ({
    page,
  }) => {
    await withPicture(page);
    const before = await imageInk(page);
    // A fresh picture carries no position at all, so it is drawn in the
    // middle of the box (ADR-0020).
    expect(before.fx).toBeCloseTo(0.5, 1);
    expect(before.fy).toBeCloseTo(0.5, 1);

    await dragImage(page, 0.25, -0.2);
    await expect(status(page)).toContainText(
      /이미지를 옮겼어요 · 왼쪽에서 7\d% · 위에서 [23]\d%\./,
    );
    const after = await imageInk(page);
    expect(after.fx).toBeCloseTo(before.fx + 0.25, 1);
    expect(after.fy).toBeCloseTo(before.fy - 0.2, 1);

    // Eight moves went out under one coalesce key, so ONE Ctrl+Z is the way
    // back — not eight.
    await page.keyboard.press('ControlOrMeta+z');
    await expect
      .poll(async () => (await imageInk(page)).fx)
      .toBeCloseTo(before.fx, 2);
    expect((await imageInk(page)).fy).toBeCloseTo(before.fy, 2);
  });

  test('a drop back near the middle IS the middle, and says so', async ({
    page,
  }) => {
    await withPicture(page);
    // Out and almost back: the drop lands within the snap of the centre, so
    // the document goes back to carrying no position at all and the sentence
    // is the centre's own rather than "왼쪽에서 50% · 위에서 50%".
    const c = await imageInk(page);
    const before = c;
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + c.box.width * 0.3, c.y, { steps: 5 });
    await expect(status(page)).toContainText(
      /이미지를 옮겼어요 · 왼쪽에서 [78]\d%/,
    );
    await page.mouse.move(c.x + c.box.width * 0.01, c.y, { steps: 5 });
    await page.mouse.up();
    await expect(status(page)).toContainText('이미지를 가운데로 옮겼어요.');
    const after = await imageInk(page);
    expect(after.fx).toBeCloseTo(before.fx, 2);
    expect(after.fy).toBeCloseTo(before.fy, 2);
  });

  test('where the words and the picture overlap, the press takes the words', async ({
    page,
  }) => {
    await withPicture(page);
    await andWords(page);
    // The words sit at the bottom of the box and the picture in the middle,
    // so they have to be brought together first.
    await dragImage(page, 0, 0.38);
    await expect(status(page)).toContainText('이미지를 옮겼어요');

    const picture = await imageInk(page);
    const words = await wordsInk(page);
    // The press point is the words' own centre — and this spec is worth
    // nothing unless that point is inside the picture too, so prove it.
    expect(words.x).toBeGreaterThan(picture.left);
    expect(words.x).toBeLessThan(picture.right);
    expect(words.y).toBeGreaterThan(picture.top);
    expect(words.y).toBeLessThan(picture.bottom);

    await page.mouse.move(words.x, words.y);
    await page.mouse.down();
    await page.mouse.move(words.x + words.box.width * 0.12, words.y, {
      steps: 5,
    });
    await page.mouse.move(words.x + words.box.width * 0.24, words.y, {
      steps: 5,
    });
    await page.mouse.up();

    // The words moved, by the drag; the picture under them did not move at
    // all. Hit order: words first (E8-2c), then the picture (E10 step 4).
    await expect(status(page)).toContainText('자막을 옮겼어요');
    const wordsAfter = await wordsInk(page);
    expect(wordsAfter.fx).toBeCloseTo(words.fx + 0.24, 1);
    const pictureAfter = await imageInk(page);
    expect(pictureAfter.fx).toBeCloseTo(picture.fx, 2);
    expect(pictureAfter.fy).toBeCloseTo(picture.fy, 2);
  });

  test('a press on neither the words nor the picture moves the screen', async ({
    page,
  }) => {
    await withPicture(page);
    const picture = await imageInk(page);
    const box = picture.box;
    // The top-left corner of the box: the picture is a quarter of the box
    // wide and centred, so nothing of it reaches here.
    const x = box.x + box.width * 0.15;
    const y = box.y + box.height * 0.2;
    expect(x).toBeLessThan(picture.left);
    expect(y).toBeLessThan(picture.top);

    // Placing the picture selected it, so the first press on the footage is
    // the pan's press-to-choose step.
    await page.mouse.click(x, y);
    await expect(status(page)).toContainText(
      '지금 보이는 클립을 골랐어요 · 다시 끌면 화면이 옮겨져요.',
    );
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + box.width * 0.12, y, { steps: 5 });
    await page.mouse.move(x + box.width * 0.25, y, { steps: 5 });
    await page.mouse.up();
    await expect(status(page)).toContainText(/화면을 옮겼어요 \(오른쪽으로 2/);
    // The footage moved under it; the sticker is not part of the footage and
    // stayed exactly where it was (its own layer, ADR-0020).
    const after = await imageInk(page);
    expect(after.fx).toBeCloseTo(picture.fx, 2);
    expect(after.fy).toBeCloseTo(picture.fy, 2);
  });

  test('a second pointer cannot start another drag while one is running', async ({
    page,
  }) => {
    await withPicture(page);
    await andWords(page);
    const picture = await imageInk(page);
    const words = await wordsInk(page);
    // The words are at the bottom and the picture in the middle, so the two
    // presses below land on different things.
    expect(words.y).toBeGreaterThan(picture.bottom);

    const startX = words.x;
    await page.mouse.move(words.x, words.y);
    await page.mouse.down();
    await page.mouse.move(startX + words.box.width * 0.1, words.y, {
      steps: 5,
    });
    await expect(status(page)).toContainText('자막을 옮겼어요');

    // A SECOND pointer presses on the picture while the words are still
    // under the first. Playwright's mouse is one pointer, so the only way to
    // be two is to dispatch the event; an unknown pointer id is also what
    // makes `setPointerCapture` throw, which is the second half of the same
    // hazard (`src/ui/useStageDrag.test.ts`).
    await page.locator('.stage').dispatchEvent('pointerdown', {
      pointerId: 99,
      isPrimary: false,
      button: 0,
      buttons: 1,
      clientX: Math.round(picture.x),
      clientY: Math.round(picture.y),
    });

    // Finish the words' gesture.
    await page.mouse.move(startX + words.box.width * 0.24, words.y, {
      steps: 5,
    });
    await page.mouse.up();

    // Three things would have gone wrong had the refused press reached the
    // picture's hit test. It selects, so the subtitle would have been
    // dropped and its panel with it:
    await expect(field(page)).toBeVisible();
    // it would have said its own sentence over the drag in progress:
    await expect(status(page)).not.toContainText('화면의 이미지를 골랐어요');
    await expect(status(page)).toContainText('자막을 옮겼어요');
    // and its failed capture ends the coalescing gesture, so the moves after
    // it would have become a SECOND undo step. One Ctrl+Z is the whole way
    // back.
    await page.locator('.ruler').focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect
      .poll(async () => (await wordsInk(page)).fx)
      .toBeCloseTo(words.fx, 2);
    // And the picture never moved through any of it.
    const after = await imageInk(page);
    expect(after.fx).toBeCloseTo(picture.fx, 2);
    expect(after.fy).toBeCloseTo(picture.fy, 2);
  });
});
