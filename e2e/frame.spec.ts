// framewright — the box's shape, in a real browser (ADR-0015).
//
// The sizes and the sentences are unit-tested in `src/engine/frame.test.ts`
// and the commands in `frameCommands.test.ts`. What only a browser can
// answer: that the buttons over the preview drive those commands, that the
// stage's canvas takes the new size and shows the footage as a strip with
// black above and below, that 화면 채우기 then fills it, that the words
// follow the picture into the new box, and that an export of a portrait
// project writes a portrait file.
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
  const frame = await page.locator('.ruler').getAttribute('aria-valuenow');
  await expect(page.locator('.stage-picture')).toHaveAttribute(
    'data-frame',
    frame ?? '0',
    { timeout: 10_000 },
  );
}

const status = (page: Page) => page.locator('.statusbar');
const picker = (page: Page) =>
  page.getByRole('radiogroup', { name: '영상 모양' });
const shapeButton = (page: Page, name: string) =>
  picker(page).getByRole('radio', { name: `${name} 영상으로 바꾸기` });
const canvasSize = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('.stage-picture') as HTMLCanvasElement;
    return { width: c.width, height: c.height };
  });

/** Mean brightness of a horizontal band of the picture — `from`..`to` as
 *  fractions of its HEIGHT — 0 (black) to 1 (white). The picture spec
 *  reads columns; a portrait box empties rows. */
const rowsBrightness = (page: Page, from: number, to: number) =>
  page.evaluate(
    ([from, to]) => {
      const canvas = document.querySelector(
        '.stage-picture',
      ) as HTMLCanvasElement | null;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx || !canvas.height) return -1;
      const y0 = Math.floor(canvas.height * from);
      const h = Math.max(1, Math.floor(canvas.height * (to - from)));
      const { data } = ctx.getImageData(0, y0, canvas.width, h);
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

test.describe('the box’s shape', () => {
  test('세로 stands the box up: a strip with black above and below, then 화면 채우기 fills it, and undo puts both back', async ({
    page,
  }) => {
    await withClip(page);
    // The first import made a 16:9 box the fixture's size.
    expect(await canvasSize(page)).toEqual({ width: 320, height: 180 });
    // The current shape is chosen, not unavailable: checked, never
    // aria-disabled (the a11y reviewer's objection to "pressed, dimmed").
    await expect(shapeButton(page, '가로')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(shapeButton(page, '가로')).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(shapeButton(page, '세로')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(picker(page)).toContainText('320×180');
    // The size is the radios' description, so a Tab stop hears it.
    await expect(shapeButton(page, '가로')).toHaveAttribute(
      'aria-describedby',
      'frame-size',
    );

    await shapeButton(page, '세로').click();
    await expect(status(page)).toContainText(
      '세로 영상(9:16 · 180×320)으로 바꿨어요 · 비는 클립을 고르고 화면 채우기를 누르면 꽉 차요.',
    );
    expect(await canvasSize(page)).toEqual({ width: 180, height: 320 });
    // The room around a portrait box in a landscape stage is NOT the box's
    // black: a stage of pure black made the box's own bars and the stage's
    // margins one frame, and the fill looked as if it did nothing (novice
    // reviewer). The stage is the app's ground and the box has an edge.
    const stageGround = await page
      .locator('.stage')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(stageGround).not.toBe('rgb(0, 0, 0)');
    const edge = await page
      .locator('.stage-picture')
      .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(edge).not.toBe('none');
    await expect(shapeButton(page, '세로')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(picker(page)).toContainText('180×320');
    // The footage as shot: a strip across the middle, black at the top.
    await expect
      .poll(() => rowsBrightness(page, 0, 0.3), { timeout: 10_000 })
      .toBeLessThan(0.01);
    expect(await rowsBrightness(page, 0.4, 0.6)).toBeGreaterThan(0.05);
    await expect(page.locator('#clip-picture-note')).toHaveText(
      '찍은 그대로 보여요 · 화면 위아래가 비어요',
    );
    // Stood-up box, 16:9 picture: the up/down pan stops at 15%.
    await expect(
      page.getByRole('slider', { name: '세로 위치', exact: true }),
    ).toHaveAttribute('max', '15');

    // Fill: one press, the top row has picture, the note has no empty side.
    const fill = page.getByRole('button', { name: '화면 채우기', exact: true });
    await expect(fill).toHaveAttribute('aria-disabled', 'false');
    await fill.click();
    await expect(status(page)).toContainText(
      '화면을 320%로 확대해 꽉 채웠어요.',
    );
    await expect(
      page.getByRole('slider', { name: '확대', exact: true }),
    ).toHaveValue('320');
    await expect
      .poll(() => rowsBrightness(page, 0, 0.1), { timeout: 10_000 })
      .toBeGreaterThan(0.05);
    await expect(page.locator('#clip-picture-note')).toHaveText('화면 320%');
    await expect(fill).toHaveAttribute('aria-disabled', 'true');

    // Two edits, two undos: the zoom, then the box.
    await page.keyboard.press('Control+z');
    await expect(
      page.getByRole('slider', { name: '확대', exact: true }),
    ).toHaveValue('100');
    expect(await canvasSize(page)).toEqual({ width: 180, height: 320 });
    await page.keyboard.press('Control+z');
    await expect(shapeButton(page, '가로')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(await canvasSize(page)).toEqual({ width: 320, height: 180 });
    await expect(page.locator('#clip-picture-note')).toHaveText(
      '찍은 그대로 보여요',
    );

    // Filled for 세로, then back to 가로 by the button: the 320% is a crop
    // now, with no black to show it, so the sentence says so.
    await page.keyboard.press('Control+Shift+z');
    await page.keyboard.press('Control+Shift+z');
    await expect(
      page.getByRole('slider', { name: '확대', exact: true }),
    ).toHaveValue('320');
    await shapeButton(page, '가로').click();
    await expect(status(page)).toContainText(
      '가로 영상(16:9 · 320×180)으로 바꿨어요 · 크게 확대된 클립은 화면 원래대로로 되돌릴 수 있어요.',
    );
    await expect(page.locator('#clip-picture-note')).toHaveText('화면 320%');
  });

  test('the shape buttons say why when they cannot run, and the palette lists them', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    // Before any import the box would be overwritten by the first file.
    await expect(shapeButton(page, '세로')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // `aria-disabled` keeps the button in the tab order so the reason is
    // reachable; Playwright's own actionability check would wait for it to
    // become enabled, so the click is forced — the way a key press is not.
    await shapeButton(page, '세로').click({ force: true });
    await expect(status(page)).toContainText('영상을 먼저 넣어 주세요.');

    test.skip(
      !(await supportsH264(page)),
      'this browser has no H.264 (use `npm run e2e:chrome`)',
    );
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.locator('.timeline .clip')).toHaveCount(1, {
      timeout: 15_000,
    });
    // Choosing the shape the box already has changes nothing and says so.
    await shapeButton(page, '가로').click();
    await expect(status(page)).toContainText('지금 가로 영상이에요.');

    // A radiogroup is one Tab stop and the arrows choose: from 가로,
    // ArrowRight chooses 세로 (and moves focus there); ArrowLeft goes back.
    await shapeButton(page, '가로').focus();
    await page.keyboard.press('ArrowRight');
    await expect(shapeButton(page, '세로')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(shapeButton(page, '세로')).toBeFocused();
    await expect(status(page)).toContainText('세로 영상(9:16 · 180×320)');
    await page.keyboard.press('ArrowLeft');
    await expect(shapeButton(page, '가로')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(status(page)).toContainText('가로 영상(16:9 · 320×180)');
    // The arrows did not move the playhead: they belong to the radios.
    await expect(page.locator('.ruler')).toHaveAttribute('aria-valuenow', '0');

    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: '명령 찾기' });
    await dialog.getByRole('combobox').fill('영상으로');
    const rows = dialog.getByRole('option');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('세로 영상으로 바꾸기');
    await expect(rows.nth(1)).toContainText('정사각 영상으로 바꾸기');
    // The one that cannot run sorts last.
    await expect(rows.nth(2)).toContainText('가로 영상으로 바꾸기');
    await rows.nth(1).click();
    await expect(status(page)).toContainText('정사각 영상(1:1 · 180×180)');
    expect(await canvasSize(page)).toEqual({ width: 180, height: 180 });
  });

  test('the words follow the picture into a portrait box', async ({ page }) => {
    await withClip(page);
    await page.getByRole('button', { name: '자막 넣기', exact: true }).click();
    await page.getByRole('textbox', { name: '내용' }).fill('세로');
    await page.keyboard.press('Enter');
    await shapeButton(page, '세로').click();
    await expect(page.locator('.stage-subtitle')).toHaveAttribute(
      'aria-label',
      '자막: 세로',
    );
    // The overlay is laid out at the box's size and placed over the picture
    // by script; after the box changed shape both must agree again.
    await expect
      .poll(async () => {
        const picture = await page.locator('.stage-picture').boundingBox();
        const words = await page.locator('.stage-subtitle').boundingBox();
        if (!picture || !words) return 'missing';
        const close = (a: number, b: number) => Math.abs(a - b) < 2;
        return close(picture.x, words.x) &&
          close(picture.y, words.y) &&
          close(picture.width, words.width) &&
          close(picture.height, words.height)
          ? 'aligned'
          : `${JSON.stringify(picture)} vs ${JSON.stringify(words)}`;
      })
      .toBe('aligned');
    const overlay = await page.evaluate(() => {
      const c = document.querySelector('.stage-subtitle') as HTMLCanvasElement;
      return { width: c.width, height: c.height };
    });
    expect(overlay).toEqual({ width: 180, height: 320 });
  });

  test('an export of a portrait project writes a portrait file', async ({
    page,
  }) => {
    await withClip(page);
    await shapeButton(page, '세로').click();
    await expect(status(page)).toContainText('세로 영상(9:16 · 180×320)');
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByRole('button', { name: '내보내기' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    await expect(status(page)).toContainText('내보내기 완료', {
      timeout: 120_000,
    });
    await expect(status(page)).toContainText('90 frames');
    // The video's sample description: the `stsd` box holds a version, flags
    // and an entry count, then the first entry, whose type is `avc1` (the
    // string also appears earlier as an `ftyp` brand, which is why the
    // search starts from `stsd`). After that entry's 8-byte header come 6
    // reserved bytes, a 2-byte data reference index and 16 more reserved
    // bytes, then width and height as 16-bit big-endian integers.
    const stsd = bytes.indexOf(Buffer.from('stsd'));
    expect(stsd).toBeGreaterThan(0);
    const entry = stsd - 4 + 8 + 4 + 4;
    expect(bytes.subarray(entry + 4, entry + 8).toString('ascii')).toBe('avc1');
    expect(bytes.readUInt16BE(entry + 8 + 6 + 2 + 16)).toBe(180);
    expect(bytes.readUInt16BE(entry + 8 + 6 + 2 + 16 + 2)).toBe(320);
  });
});
