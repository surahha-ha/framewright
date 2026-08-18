import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supportsH264 } from './helpers';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'sample-h264.mp4',
);

/** The keymap lives in localStorage and outlives a reload — start each test
 *  from the defaults, or the previous test's rebinding decides this one. */
async function fresh(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('framewright.keymap.v1'));
  await page.reload();
}

test.describe('command palette', () => {
  test('opens on the keyboard, filters, and hands focus back on Escape', async ({
    page,
  }) => {
    await fresh(page);
    await page.keyboard.press('Control+k');

    const dialog = page.getByRole('dialog', { name: '명령 찾기' });
    await expect(dialog).toBeVisible();
    // A modal that opens without focus is a modal a keyboard user cannot use.
    await expect(dialog.getByRole('combobox')).toBeFocused();

    await dialog.getByRole('combobox').fill('빈 곳');
    const rows = dialog.getByRole('option');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('빈 곳 없애기');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('lists what it cannot do, with the reason, instead of hiding it', async ({
    page,
  }) => {
    // Nothing is imported: every edit is unavailable. Hiding those rows would
    // make the palette lie about what the editor can do.
    await fresh(page);
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: '명령 찾기' });
    await dialog.getByRole('combobox').fill('나누기');

    const row = dialog.getByRole('option').first();
    await expect(row).toHaveAttribute('aria-disabled', 'true');
    await expect(row).toContainText('재생 위치를');
  });

  test('runs the highlighted entry with Enter', async ({ page }) => {
    await fresh(page);
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: '명령 찾기' });
    await palette.getByRole('combobox').fill('단축키');
    await page.keyboard.press('Enter');

    await expect(palette).toBeHidden();
    await expect(page.getByRole('dialog', { name: '단축키' })).toBeVisible();
  });

  test('hides the editor behind it from assistive tech', async ({ page }) => {
    // `aria-modal` alone does not stop a screen reader's browse mode walking
    // the toolbar and timeline behind the dialog.
    await fresh(page);
    await expect(page.locator('.app')).not.toHaveAttribute('aria-hidden', /.*/);
    await page.keyboard.press('Control+k');
    await expect(page.locator('.app')).toHaveAttribute('aria-hidden', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('.app')).not.toHaveAttribute('aria-hidden', /.*/);
  });

  test('puts the everyday commands above the one-frame nudges', async ({
    page,
  }) => {
    // Opening the palette to browse is a designed path. Six frame-nudge rows
    // between the user and "복사" makes that path useless.
    await fresh(page);
    await page.keyboard.press('Control+k');
    const labels = await page
      .getByRole('dialog', { name: '명령 찾기' })
      .getByRole('option')
      .allInnerTexts();
    const copy = labels.findIndex((t) => t.includes('복사'));
    const nudge = labels.findIndex((t) => t.includes('한 프레임 왼쪽으로'));
    expect(copy).toBeGreaterThanOrEqual(0);
    expect(nudge).toBeGreaterThan(copy);
  });

  test('shows every reason in full at a narrow window, never clipped', async ({
    page,
  }) => {
    // `.pal-why` is nowrap + ellipsis, so a reason one word too long turns into
    // "재생 위치를 클립 안(맨 앞이…" and stops being a reason. Checked by eye at
    // 1280; this keeps it that way when someone writes a longer sentence.
    await page.setViewportSize({ width: 1280, height: 800 });
    await fresh(page);
    await page.keyboard.press('Control+k');
    const clipped = await page
      .locator('.palette-row .pal-why')
      .evaluateAll((els) =>
        els
          .filter((el) => el.scrollWidth > el.clientWidth)
          .map((el) => el.textContent),
      );
    expect(clipped).toEqual([]);
  });

  test('shows the key each entry is bound to', async ({ page }) => {
    await fresh(page);
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: '명령 찾기' });
    await dialog.getByRole('combobox').fill('나누기');
    await expect(dialog.getByRole('option').first()).toContainText('C');
  });
});

test.describe('user keymap', () => {
  async function openShortcuts(page: Page) {
    await page.getByRole('button', { name: '단축키', exact: true }).click();
    return page.getByRole('dialog', { name: '단축키' });
  }

  test('a rebinding takes effect, frees the old key, and survives a reload', async ({
    page,
  }) => {
    await fresh(page);
    const sheet = await openShortcuts(page);
    await sheet
      .getByRole('button', { name: '명령 찾기 단축키 바꾸기' })
      .click();
    await page.keyboard.press('Control+j');
    await expect(sheet).toContainText('명령 찾기 → Ctrl+J');
    await sheet.getByRole('button', { name: /닫기/ }).click();

    const palette = page.getByRole('dialog', { name: '명령 찾기' });
    await page.keyboard.press('Control+j');
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');

    // The old key must be genuinely free, not quietly still bound.
    await page.keyboard.press('Control+k');
    await expect(palette).toBeHidden();

    // A keymap belongs to the person, not to the page load.
    await page.reload();
    await page.keyboard.press('Control+j');
    await expect(page.getByRole('dialog', { name: '명령 찾기' })).toBeVisible();
  });

  test('refuses a key the browser and the page need', async ({ page }) => {
    await fresh(page);
    const sheet = await openShortcuts(page);
    await sheet
      .getByRole('button', { name: '명령 찾기 단축키 바꾸기' })
      .click();
    await page.keyboard.press('Tab');
    await expect(sheet).toContainText('탭 이동에 쓰는 키예요');

    // Still capturing, so the next real key still lands.
    await page.keyboard.press('Control+j');
    await expect(sheet).toContainText('명령 찾기 → Ctrl+J');
  });

  test('says that it is waiting for a key, and how to get out', async ({
    page,
  }) => {
    // The only other sign of capture is a <kbd> changing, which nothing
    // announces — a screen reader user would not know the next key is captured.
    await fresh(page);
    const sheet = await openShortcuts(page);
    const change = sheet.getByRole('button', {
      name: '명령 찾기 단축키 바꾸기',
    });
    await change.click();
    await expect(sheet).toContainText('쓰고 싶은 키를 지금 누르세요');
    await expect(sheet).toContainText('Esc');
    // The accessible name has to follow the visible one ("취소").
    await expect(change).toHaveAttribute('aria-label', /취소$/);
    await page.keyboard.press('Escape');
    await expect(sheet).toContainText('바꾸지 않았어요');
  });

  test('refuses a key that a focused button would swallow', async ({
    page,
  }) => {
    // Bound to Space, an action works on the page and is silently dead whenever
    // a button has focus. That is worse than not being allowed.
    await fresh(page);
    const sheet = await openShortcuts(page);
    await sheet.getByRole('button', { name: '복사 단축키 바꾸기' }).click();
    await page.keyboard.press('Space');
    await expect(sheet).toContainText('버튼에 초점이 있을 때');
    await page.keyboard.press('Escape');
    // ...and the original binding is untouched.
    await expect(
      sheet.locator('.keylist li', { hasText: '복사' }),
    ).toContainText('Ctrl+C');
  });

  test('"전부 처음으로" puts every default back', async ({ page }) => {
    await fresh(page);
    const sheet = await openShortcuts(page);
    await sheet
      .getByRole('button', { name: '명령 찾기 단축키 바꾸기' })
      .click();
    await page.keyboard.press('Control+j');
    await sheet.getByRole('button', { name: '전부 처음으로' }).click();
    await sheet.getByRole('button', { name: /닫기/ }).click();

    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: '명령 찾기' })).toBeVisible();
  });

  test('the timeline hint quotes the keymap, not a hardcoded key', async ({
    page,
  }) => {
    // The hint used to be prose that a rebinding could silently falsify.
    await fresh(page);
    await expect(page.locator('.track-hint')).toContainText('Alt+←/Alt+→');

    const sheet = await openShortcuts(page);
    await sheet
      .getByRole('button', { name: '한 프레임 왼쪽으로 단축키 바꾸기' })
      .click();
    await page.keyboard.press('Control+Shift+j');
    await sheet.getByRole('button', { name: /닫기/ }).click();

    await expect(page.locator('.track-hint')).toContainText('Ctrl+Shift+J');
    // The pair it used to name is gone (Ctrl+Alt+← elsewhere in the line still
    // ends in "Alt+←", so the assertion has to be the pair, not the chord).
    await expect(page.locator('.track-hint')).not.toContainText('Alt+←/Alt+→');
  });
});

test.describe('clipboard', () => {
  async function importFixture(page: Page) {
    await fresh(page);
    test.skip(
      !(await supportsH264(page)),
      'this browser has no H.264 (use `npm run e2e:chrome`)',
    );
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.locator('.timeline .clip')).toHaveCount(1, {
      timeout: 15_000,
    });
  }

  /** The transport shows the LAST frame index, so the length is one more. */
  const totalFrames = async (page: Page) => {
    const text = await page.locator('.transport .dim').innerText();
    return Number(text.split('/')[1].trim()) + 1;
  };

  test('copy then paste adds exactly the copied length, and undo takes it back', async ({
    page,
  }) => {
    await importFixture(page);
    const before = await totalFrames(page);

    await page.locator('.timeline .clip').first().click();
    await page.keyboard.press('Control+c');
    await expect(page.locator('.statusbar')).toContainText('복사했어요');

    await page.keyboard.press('Control+v');
    await expect(page.locator('.timeline .clip')).toHaveCount(2);
    // Frame-exact: a paste adds the clipboard's length and nothing else.
    expect(await totalFrames(page)).toBe(before * 2);

    await page.keyboard.press('Control+z');
    await expect(page.locator('.timeline .clip')).toHaveCount(1);
    expect(await totalFrames(page)).toBe(before);
  });

  test('cut removes the clip but keeps it available to paste back', async ({
    page,
  }) => {
    await importFixture(page);
    const before = await totalFrames(page);

    await page.locator('.timeline .clip').first().click();
    await page.keyboard.press('Control+x');
    await expect(page.locator('.timeline .clip')).toHaveCount(0);

    await page.keyboard.press('Control+v');
    await expect(page.locator('.timeline .clip')).toHaveCount(1);
    expect(await totalFrames(page)).toBe(before);
  });

  test('holding the paste key does not stack a document full of copies', async ({
    page,
  }) => {
    // OS key repeat fires ~25 keydowns a second, each one its own undo entry.
    // Only the actions that mean "again" (nudge, playhead step) may repeat.
    await importFixture(page);
    await page.locator('.timeline .clip').first().click();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(page.locator('.timeline .clip')).toHaveCount(2);

    await page.evaluate(() => {
      for (let i = 0; i < 8; i++) {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'v',
            ctrlKey: true,
            repeat: true,
          }),
        );
      }
    });
    await expect(page.locator('.timeline .clip')).toHaveCount(2);
  });

  test('the pasted clip is the selected one', async ({ page }) => {
    // A paste can shove several clips sideways; without this nothing says which
    // of the clips that moved is the new one.
    await importFixture(page);
    const clip = page.locator('.timeline .clip').first();
    // Deliberately NOT the centre. Clicking the middle of a clip parks the
    // playhead on the exact tie in `pastePlan`, where a one-pixel difference in
    // layout decides whether the paste lands before or after — this test then
    // fails on the position of the new clip while claiming to be about
    // selection. Three quarters in, "after the clip I am looking at" is the
    // only answer.
    const box = (await clip.boundingBox())!;
    await clip.click({ position: { x: box.width * 0.75, y: box.height / 2 } });
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(page.locator('.timeline .clip').nth(1)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.timeline .clip').first()).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('pasting with an empty clipboard says what is missing', async ({
    page,
  }) => {
    await fresh(page);
    await page.keyboard.press('Control+v');
    await expect(page.locator('.statusbar')).toContainText('복사하거나 잘라내');
  });
});
