// framewright — a subtitle's face in a real browser (ADR-0018).
//
// What the engine knows about the faces is unit-tested in
// `src/engine/fonts.test.ts`. What only a browser can answer: that choosing
// a face fetches the file from the app's own origin and, once it lands,
// changes the glyphs on the overlay; that 기본 draws the system face again,
// to the pixel; that a face named by a reopened document is fetched when
// the document opens (quietly) and a failed one is said once the words
// reach it; and that an export waits for its faces and says nothing when
// they came.
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

/** The overlay's inked bounds as pixel counts — a different face has a
 *  different width and height for the same words. Null when blank. */
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
    let inked = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (data[(y * canvas.width + x) * 4 + 3] === 0) continue;
        inked++;
        if (top < 0) top = y;
        bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
    return top < 0 ? null : { top, bottom, left, right, inked };
  });
}

/** Whether the face has been fetched and added: a `FontFace` of that
 *  family sits in `document.fonts` with status `loaded`. NOT
 *  `document.fonts.check()` — that answers true for a family the page
 *  never registered (it counts as a system font), so it cannot tell "never
 *  fetched" from "landed". */
const faceReady = (page: Page, family: string) =>
  page.evaluate(
    (f) =>
      [...document.fonts].some(
        (face) =>
          face.family.replace(/^["']|["']$/g, '') === f &&
          face.status === 'loaded',
      ),
    family,
  );

async function withWords(page: Page, clear = true) {
  await withClip(page, clear);
  await page.locator('.track').click({ position: { x: 200, y: 20 } });
  await page.getByRole('button', { name: '자막 넣기', exact: true }).click();
  await expect(chips(page)).toHaveCount(1);
  await field(page).fill('붓으로 쓴 자막');
  await page.keyboard.press('Enter');
  await expect(chips(page).first()).toContainText('붓으로 쓴 자막');
  await expect.poll(() => inkBounds(page)).not.toBeNull();
}

test.describe('자막 글꼴', () => {
  test('the 글꼴 row offers the system face and three bundled ones, 기본 chosen', async ({
    page,
  }) => {
    await withWords(page);
    await expect(group(page, '글꼴')).toBeVisible();
    for (const name of ['기본', '붓글씨', '손글씨', '굵은고딕']) {
      await expect(radio(page, '글꼴', name)).toBeVisible();
    }
    await expect(radio(page, '글꼴', '기본')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // Nothing was fetched just for opening the panel.
    expect(await faceReady(page, 'Nanum Brush Script')).toBe(false);
  });

  test('붓글씨 fetches the face and changes the glyphs; 기본 draws the system face again, to the pixel', async ({
    page,
  }) => {
    await withWords(page);
    const system = (await inkBounds(page))!;

    await radio(page, '글꼴', '붓글씨').click();
    // The whole sentence, one full stop: the choice and the wait glued
    // with ". ·" was seen in the owner's Chrome. (From the cache the file
    // can land before it is read, so the arrival sentence is accepted too.)
    await expect(status(page)).toContainText(
      /^(자막 글꼴을 붓글씨로 바꿨어요 · 글꼴을 받는 중이에요 · 받으면 바로 바뀌어요\.|붓글씨 글꼴을 받았어요\.)$/,
    );
    await expect
      .poll(() => faceReady(page, 'Nanum Brush Script'), { timeout: 30_000 })
      .toBe(true);
    await expect(status(page)).toContainText('붓글씨 글꼴을 받았어요');
    await expect.poll(() => inkBounds(page)).not.toEqual(system);

    await radio(page, '글꼴', '기본').click();
    await expect(status(page)).toContainText('자막 글꼴을 기본으로 되돌렸어요');
    await expect.poll(() => inkBounds(page)).toEqual(system);
  });

  test('a face named by a reopened document is fetched when the document opens, quietly, and the words are drawn in it at once', async ({
    page,
  }) => {
    // `clear: false` — the init script that clears storage runs on EVERY
    // navigation, the reload included, and would wipe what this test checks.
    await withWords(page, false);
    const system = (await inkBounds(page))!;
    await radio(page, '글꼴', '손글씨').click();
    await expect(status(page)).toContainText('자막 글꼴을 손글씨로 바꿨어요');
    await page.waitForTimeout(800); // past the save debounce
    await page.reload();
    await expect(chips(page)).toHaveCount(1);
    // A reload parks the playhead on frame 0, before the words — and the
    // face is fetched anyway, because the DOCUMENT names it (ADR-0018 as
    // amended on 2026-09-16: what the document names, when it opens;
    // still never a face nothing names). Nothing is said: the words are
    // not on screen, so there is nothing to explain.
    await expect
      .poll(() => faceReady(page, 'Nanum Pen Script'), { timeout: 30_000 })
      .toBe(true);
    await expect(status(page)).not.toContainText('글꼴');
    // Enter on the chip selects it AND seeks to its first frame: the words
    // are drawn in the face from the first paint, with no swap and no
    // sentence about a fetch.
    await chips(page).first().focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => inkBounds(page)).not.toBeNull();
    expect(await inkBounds(page)).not.toEqual(system);
    await expect(status(page)).not.toContainText('글꼴을 받');
    await expect(radio(page, '글꼴', '손글씨')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('a face a reopened document could not fetch is said once the words reach it, with the way back', async ({
    page,
  }) => {
    await withWords(page, false);
    const system = (await inkBounds(page))!;
    await radio(page, '글꼴', '손글씨').click();
    await expect(status(page)).toContainText('자막 글꼴을 손글씨로 바꿨어요');
    await page.waitForTimeout(800); // past the save debounce
    // Routing also turns the HTTP cache off, so the reopened document's
    // fetch fails even though the file just came for the choice above.
    await page.route('**/fonts/*.ttf', (route) => route.abort());
    await page.reload();
    await expect(chips(page)).toHaveCount(1);
    // The quiet fetch failed; on frame 0 nothing on screen wants the face,
    // so nothing is said yet.
    await expect(status(page)).not.toContainText('받지 못했어요');
    // The words come under the playhead: NOW the failure is said, once,
    // and the sentence names the retry — the radio is checked (the
    // document says the face) and shows no other way back.
    await chips(page).first().focus();
    await page.keyboard.press('Enter');
    await expect(status(page)).toContainText(
      '손글씨 글꼴을 받지 못했어요 · 기본 글꼴로 보여요 · 자막을 고른 뒤 글꼴에서 손글씨 단추를 다시 누르면 다시 받아요.',
      { timeout: 30_000 },
    );
    // The page has no such face: nothing in `document.fonts` is loaded.
    // (The INK is not compared here: Chrome's renderer keeps the typeface
    // the previous document fetched and finds it by name for the canvas
    // even though this document never registered it, so after a reload
    // the words can still come out in the face the page does not have —
    // docs/TESTING.md, "Operational facts".)
    expect(await faceReady(page, 'Nanum Pen Script')).toBe(false);
    await expect(radio(page, '글꼴', '손글씨')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.unroute('**/fonts/*.ttf');
    await radio(page, '글꼴', '손글씨').click();
    await expect(status(page)).toContainText(
      '손글씨 글꼴을 다시 받는 중이에요',
    );
    await expect
      .poll(() => faceReady(page, 'Nanum Pen Script'), { timeout: 30_000 })
      .toBe(true);
    await expect.poll(() => inkBounds(page)).not.toEqual(system);
  });

  test('a document naming a face this build does not know still draws its words, in the system face', async ({
    page,
  }) => {
    // A later build's fourth face, or a hand edit. The preview has no error
    // boundary: a throw in the draw would blank the whole editor.
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await withWords(page, false);
    const system = (await inkBounds(page))!;
    await radio(page, '글꼴', '손글씨').click();
    await expect(status(page)).toContainText('자막 글꼴을 손글씨로 바꿨어요');
    await page.waitForTimeout(800); // past the save debounce
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('framewright:project')!);
      saved.project.subtitles[0].font = 'calligraphy';
      localStorage.setItem('framewright:project', JSON.stringify(saved));
      // The app flushes its in-memory document on `pagehide`, which the
      // reload fires — and that would put 'pen' straight back. Neuter this
      // realm's `setItem`; the reloaded page gets a fresh one.
      Object.defineProperty(Storage.prototype, 'setItem', {
        value() {},
        writable: true,
        configurable: true,
      });
    });
    await page.reload();
    await expect(chips(page)).toHaveCount(1);
    await chips(page).first().focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => inkBounds(page)).toEqual(system);
    await expect(group(page, '글꼴')).toBeVisible();
    // Nothing is fetched for it, nothing is said about it, nothing threw.
    expect(await faceReady(page, 'Nanum Pen Script')).toBe(false);
    await expect(status(page)).not.toContainText('글꼴');
    expect(errors).toEqual([]);
  });

  test('a face that fails to come is said, and the same radio pressed again is the retry', async ({
    page,
  }) => {
    await withWords(page);
    const system = (await inkBounds(page))!;
    await page.route('**/fonts/*.ttf', (route) => route.abort());
    await radio(page, '글꼴', '붓글씨').click();
    await expect(status(page)).toContainText(
      '붓글씨 글꼴을 받지 못했어요 · 기본 글꼴로 보여요',
      { timeout: 30_000 },
    );
    // The document says 붓글씨; the screen shows the system face.
    await expect(radio(page, '글꼴', '붓글씨')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(await inkBounds(page)).toEqual(system);
    expect(await faceReady(page, 'Nanum Brush Script')).toBe(false);

    await page.unroute('**/fonts/*.ttf');
    await radio(page, '글꼴', '붓글씨').click();
    await expect(status(page)).toContainText(
      '붓글씨 글꼴을 다시 받는 중이에요',
    );
    await expect
      .poll(() => faceReady(page, 'Nanum Brush Script'), { timeout: 30_000 })
      .toBe(true);
    await expect(status(page)).toContainText('붓글씨 글꼴을 받았어요');
    await expect.poll(() => inkBounds(page)).not.toEqual(system);
  });

  test('an export with a face has every frame and no font warning', async ({
    page,
  }) => {
    await withWords(page);
    await radio(page, '글꼴', '굵은고딕').click();
    await expect(status(page)).toContainText(
      '자막 글꼴을 굵은고딕으로 바꿨어요',
    );
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByRole('button', { name: /내보내기/ }).click();
    await downloadPromise;
    await expect(status(page)).toContainText('내보내기 완료', {
      timeout: 120_000,
    });
    await expect(status(page)).toContainText('90 frames');
    await expect(status(page)).not.toContainText('글꼴을 받지 못해');
    expect(await faceReady(page, 'Black Han Sans')).toBe(true);
  });
});
