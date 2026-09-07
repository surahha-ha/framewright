// framewright — subtitles, in a real browser.
//
// The arithmetic (where a subtitle may go, how it wraps, what each command
// does to the document) is unit-tested in `src/engine/subtitles.test.ts`,
// `subtitleCommands.test.ts` and `subtitleRender.test.ts`. What only a browser
// can answer: that the words actually reach the picture, on the right frames,
// on top of the footage and nowhere else; that typing them does not fire the
// editing shortcuts; and that the whole thing works without a mouse.
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

const addButton = (page: Page) =>
  page.getByRole('button', { name: '자막 넣기', exact: true });
const chips = (page: Page) => page.locator('.subtitle-lane .subtitle');
const field = (page: Page) => page.getByRole('textbox', { name: '내용' });
const playheadFrame = async (page: Page) =>
  Number(await page.locator('.ruler').getAttribute('aria-valuenow'));

/**
 * Where the overlay's ink is, as fractions of its height — or null when the
 * overlay is blank. A subtitle must sit in the bottom band and nowhere else.
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
    for (let y = 0; y < canvas.height; y++) {
      let inked = false;
      for (let x = 0; x < canvas.width && !inked; x++) {
        if (data[(y * canvas.width + x) * 4 + 3] > 0) inked = true;
      }
      if (inked) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    if (top < 0) return null;
    return { top: top / canvas.height, bottom: bottom / canvas.height };
  });
}

/** Put the playhead well inside the clip and add a subtitle there. */
async function addAtMiddle(page: Page) {
  await page.locator('.track').click({ position: { x: 200, y: 20 } });
  const at = await playheadFrame(page);
  expect(at).toBeGreaterThan(0);
  await addButton(page).click();
  await expect(chips(page)).toHaveCount(1);
  return at;
}

test.describe('subtitles', () => {
  test('is unavailable until there is footage, and says so', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await expect(addButton(page)).toBeDisabled();
    // `force`: the button is `aria-disabled`, which Playwright will not click
    // on its own — and clicking it is the point, since that is how it explains.
    await addButton(page).click({ force: true });
    await expect(page.locator('.statusbar')).toContainText('영상을 불러오세요');
    await expect(chips(page)).toHaveCount(0);
  });

  test('adding one puts the cursor in the words, and the words reach the picture', async ({
    page,
  }) => {
    await withClip(page);
    // Nothing on the picture yet.
    expect(await overlayInk(page)).toBeNull();

    const at = await addAtMiddle(page);
    // The new subtitle is selected and its (empty) words are ready to type.
    await expect(chips(page).first()).toHaveAttribute('aria-pressed', 'true');
    await expect(field(page)).toBeFocused();
    await expect(page.locator('.statusbar')).toContainText('자막을 넣었어요');

    await field(page).fill('안녕하세요');
    await page.keyboard.press('Enter');
    await expect(chips(page).first()).toContainText('안녕하세요');
    await expect(page.locator('.statusbar')).toContainText(
      '자막 내용을 바꿨어요',
    );

    // Words on the picture: ink in the bottom band, over the footage, and the
    // overlay lies exactly on the picture rather than somewhere in the stage.
    const ink = await overlayInk(page);
    expect(ink).not.toBeNull();
    expect(ink!.top).toBeGreaterThan(0.5);
    expect(ink!.bottom).toBeLessThan(1);
    const boxes = await page.evaluate(() => {
      const pick = (sel: string) =>
        document.querySelector(sel)!.getBoundingClientRect();
      const p = pick('.stage canvas:not(.stage-subtitle)');
      const o = pick('.stage-subtitle');
      return { p, o };
    });
    expect(Math.abs(boxes.p.left - boxes.o.left)).toBeLessThan(1.5);
    expect(Math.abs(boxes.p.width - boxes.o.width)).toBeLessThan(1.5);
    expect(Math.abs(boxes.p.height - boxes.o.height)).toBeLessThan(1.5);
    // ...and the overlay is named by its words for a screen reader.
    await expect(
      page.getByRole('img', { name: '자막: 안녕하세요' }),
    ).toBeVisible();

    // Before the subtitle starts there is nothing on the picture: the words
    // change on the exact frame, not when the next picture happens to arrive.
    await page.locator('.ruler').focus();
    await page.keyboard.press('Home');
    expect(await playheadFrame(page)).toBe(0);
    expect(at).toBeGreaterThan(0);
    expect(await overlayInk(page)).toBeNull();
    await page.keyboard.press('End');
    expect(await overlayInk(page)).toBeNull(); // two seconds long, three-second clip
  });

  test('the panel says when the subtitle runs without breaking a word in two', async ({
    page,
  }) => {
    // Seen in Chrome: "00:01:00부터 00:03:00까지" wrapped as "…00까 / 지" in
    // the 260px sidebar. Each fact must sit on one line, and nothing may
    // overflow the panel sideways.
    await withClip(page);
    await addAtMiddle(page);
    const lines = page.locator('.subtitle-when span');
    await expect(lines).toHaveCount(2);
    const measured = await lines.evaluateAll((els) =>
      els.map((el) => {
        const box = el.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
        const fontSize = parseFloat(getComputedStyle(el).fontSize);
        return {
          height: box.height,
          oneLine: Number.isNaN(lineHeight) ? fontSize * 1.6 : lineHeight,
          overflows: el.scrollWidth > el.clientWidth + 1,
        };
      }),
    );
    for (const m of measured) {
      expect(m.height).toBeLessThanOrEqual(m.oneLine * 1.2);
      expect(m.overflows).toBe(false);
    }
  });

  test('typing the words never fires an editing shortcut', async ({ page }) => {
    await withClip(page);
    await addAtMiddle(page);
    await expect(field(page)).toBeFocused();
    // `c` is split, Delete is ripple delete, Space is play. In the field they
    // are letters.
    await page.keyboard.type('c c');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Enter');
    await expect(page.locator('.timeline .clip')).toHaveCount(1);
    await expect(chips(page).first()).toContainText('c c');
  });

  test('is fully undoable, one step per edit, and never takes the video with it', async ({
    page,
  }) => {
    await withClip(page);
    await addAtMiddle(page);
    await field(page).fill('첫 자막');
    await page.keyboard.press('Enter');
    await expect(chips(page).first()).toContainText('첫 자막');

    // Leave the field, or Ctrl+Z is the browser's text undo.
    await page.locator('.ruler').focus();
    await page.keyboard.press('Control+z'); // the words
    await expect(chips(page).first()).toContainText('내용 없음');
    // Undoing the words must NOT put the cursor back in the field — the next
    // Ctrl+Z would then be the browser's, and the subtitle could not be undone.
    await expect(field(page)).not.toBeFocused();
    await page.keyboard.press('Control+z'); // the subtitle itself
    await expect(chips(page)).toHaveCount(0);
    await expect(page.locator('.timeline .clip')).toHaveCount(1);
    await page.keyboard.press('Control+Shift+z');
    await expect(chips(page)).toHaveCount(1);
  });

  test('works without a mouse: T to add, the words, then Delete on the chip', async ({
    page,
  }) => {
    await withClip(page);
    await page.locator('.ruler').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('t');
    await expect(chips(page)).toHaveCount(1);
    await expect(field(page)).toBeFocused();
    await page.keyboard.type('키보드로');
    await page.keyboard.press('Enter');
    await expect(chips(page).first()).toContainText('키보드로');

    // Time it with the keyboard: park the playhead, press the panel's button.
    await page.locator('.ruler').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const at = await playheadFrame(page);
    await page.getByRole('button', { name: '자막 시작을 재생 위치로' }).click();
    await expect(chips(page).first()).toHaveAttribute(
      'aria-label',
      new RegExp(`00:00:${String(at).padStart(2, '0')}부터`),
    );

    // Delete on the chip removes THAT subtitle — not the clip.
    await chips(page).first().focus();
    await page.keyboard.press('Delete');
    await expect(chips(page)).toHaveCount(0);
    await expect(page.locator('.timeline .clip')).toHaveCount(1);
    await expect(page.locator('.statusbar')).toContainText('자막을 지웠어요');
  });

  test('words typed and then abandoned by clicking a clip are still saved', async ({
    page,
  }) => {
    await withClip(page);
    await addAtMiddle(page);
    await expect(field(page)).toBeFocused();
    await page.keyboard.type('저장되나요');
    // No Enter, no Tab: straight to a clip. Selecting it happens on mousedown,
    // before the field's blur — the words used to vanish here.
    await page.locator('.timeline .clip').first().click();
    await expect(chips(page).first()).toContainText('저장되나요');
    // ...and while typing, the words were already on the picture.
  });

  test('the words show on the picture while they are typed, before Enter', async ({
    page,
  }) => {
    await withClip(page);
    await addAtMiddle(page);
    expect(await overlayInk(page)).toBeNull();
    await page.keyboard.type('바로 보여요');
    expect(await overlayInk(page)).not.toBeNull();
    // Escape throws the draft away, says so, and the picture clears.
    await page.keyboard.press('Escape');
    await expect(page.locator('.statusbar')).toContainText('입력하던 내용을');
    expect(await overlayInk(page)).toBeNull();
  });

  test('deleting a subtitle by keyboard leaves focus somewhere useful', async ({
    page,
  }) => {
    await withClip(page);
    await addAtMiddle(page);
    await page.keyboard.press('Enter'); // commit the (empty) words, stay put
    await chips(page).first().focus();
    await page.keyboard.press('Delete');
    await expect(chips(page)).toHaveCount(0);
    // Not <body>: the playhead, which is where the next subtitle starts from.
    await expect(page.locator('.ruler')).toBeFocused();
  });

  test('ripple-deleting a clip pulls the subtitles after it along', async ({
    page,
  }) => {
    await withClip(page);
    // Split in the middle, put a subtitle at the start of the second half.
    await page.locator('.track').click({ position: { x: 200, y: 20 } });
    await page.keyboard.press('c');
    await expect(page.locator('.timeline .clip')).toHaveCount(2);
    await addButton(page).click();
    await expect(chips(page)).toHaveCount(1);
    await page.keyboard.press('Enter');
    const before = (await chips(page).first().getAttribute('aria-label'))!;
    expect(before).not.toMatch(/00:00:00부터/);
    // Delete the FIRST half: the second half, and its subtitle, come to 0.
    await page.locator('.timeline .clip').first().click();
    await page.keyboard.press('Delete');
    await expect(page.locator('.timeline .clip')).toHaveCount(1);
    await expect(chips(page).first()).toHaveAttribute(
      'aria-label',
      /00:00:00부터/,
    );
    await page.keyboard.press('Control+z');
    await expect(chips(page).first()).toHaveAttribute('aria-label', before);
  });

  test('pasting into the middle of a subtitle splits it around the new footage', async ({
    page,
  }) => {
    await withClip(page);
    // Split the clip in the middle, then lay a subtitle ACROSS that cut.
    await page.locator('.track').click({ position: { x: 200, y: 20 } });
    await page.keyboard.press('c');
    await expect(page.locator('.timeline .clip')).toHaveCount(2);
    const cut = await playheadFrame(page); // the split is at the playhead
    await page.locator('.ruler').focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('t');
    await expect(chips(page)).toHaveCount(1);
    await page.keyboard.type('걸침');
    await page.keyboard.press('Enter');
    const before = (await chips(page).first().getAttribute('aria-label'))!;

    // Copy the first clip and paste it exactly at the cut (a click on a clip
    // would scrub to where it was clicked, so the ruler sets the frame).
    await page.locator('.timeline .clip').first().click();
    await page.keyboard.press('Control+c');
    await page.locator('.ruler').focus();
    await page.keyboard.press('Home');
    for (let f = 0; f < cut; f++) await page.keyboard.press('ArrowRight');
    expect(await playheadFrame(page)).toBe(cut);
    await page.keyboard.press('Control+v');
    await expect(page.locator('.timeline .clip')).toHaveCount(3);

    // Two subtitles now, both saying 걸침: one ending at the cut, one
    // starting after the pasted clip — and no subtitle over the pasted frames.
    await expect(chips(page)).toHaveCount(2);
    await expect(chips(page).nth(0)).toContainText('걸침');
    await expect(chips(page).nth(1)).toContainText('걸침');
    await page.keyboard.press('Home');
    for (let f = 0; f < cut; f++) await page.keyboard.press('ArrowRight');
    expect(await playheadFrame(page)).toBe(cut);
    expect(await overlayInk(page)).toBeNull();
    await page.keyboard.press('Control+z');
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toHaveAttribute('aria-label', before);
  });

  test('refuses a second subtitle on a frame that already has one', async ({
    page,
  }) => {
    await withClip(page);
    await addAtMiddle(page);
    // The playhead is still on the new subtitle's first frame.
    await expect(addButton(page)).toBeDisabled();
    await addButton(page).click({ force: true });
    await expect(page.locator('.statusbar')).toContainText(
      '이미 자막이 있어요',
    );
    await expect(chips(page)).toHaveCount(1);
  });

  test('can be dragged along the lane, and a mis-drag is one undo away', async ({
    page,
  }) => {
    await withClip(page);
    await addAtMiddle(page);
    const before = await chips(page).first().getAttribute('aria-label');
    const box = (await chips(page).first().boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, y, { steps: 6 });
    await page.mouse.up();
    await expect(chips(page).first()).not.toHaveAttribute(
      'aria-label',
      before!,
    );
    await expect(page.locator('.statusbar')).toContainText('자막을');
    await expect(page.locator('.statusbar')).toContainText('옮겼어요');
    await page.keyboard.press('Control+z');
    await expect(chips(page).first()).toHaveAttribute('aria-label', before!);
  });

  test('survives a reload', async ({ page }) => {
    // `clear: false` — the init script that clears storage runs on EVERY
    // navigation, the reload included, and would wipe what this test checks.
    await withClip(page, false);
    await addAtMiddle(page);
    await field(page).fill('남아 있어요');
    await page.keyboard.press('Enter');
    await expect(chips(page).first()).toContainText('남아 있어요');
    await page.waitForTimeout(800); // past the save debounce
    await page.reload();
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toContainText('남아 있어요');
  });
});
