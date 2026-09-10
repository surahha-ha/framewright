// framewright — a clip's sound, in a real browser (ADR-0013).
//
// The level arithmetic and the commands are unit-tested in
// `src/engine/volume.test.ts` and `volumeCommands.test.ts`, and how they
// reach the audio schedule in `audioSchedule.test.ts`. What only a browser can
// answer: that the panel's switch and slider drive those commands, that a
// drag on the slider is one undo step, that the strip says what it draws,
// that the `M` key does what the button does, and that an export of a muted
// clip is an export with no sound in it.
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
}

const clips = (page: Page) => page.locator('.timeline .clip');
const muteButton = (page: Page) =>
  page.getByRole('button', { name: '소리 끄기', exact: true });
const slider = (page: Page) =>
  page.getByRole('slider', { name: '소리 크기', exact: true });
const status = (page: Page) => page.locator('.statusbar');
const mark = (page: Page) => page.locator('.clip-sound-mark');

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

test.describe('sound', () => {
  test('the mute is a switch with a mark, a sentence, a note and an undo', async ({
    page,
  }) => {
    await withClip(page);
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(mark(page)).toHaveCount(0);
    await expect(page.locator('#clip-sound-note')).toHaveText(
      '녹음된 그대로 들려요',
    );

    await muteButton(page).click();
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(status(page)).toContainText(
      '소리를 껐어요 · 이 클립은 들리지 않아요.',
    );
    await expect(mark(page)).toHaveCount(1);
    expect(await description(page, 0)).toContain('소리 끔');
    await expect(page.locator('#clip-sound-note')).toHaveText('들리지 않아요');
    // The level is untouched by the switch.
    await expect(slider(page)).toHaveValue('100');

    await page.keyboard.press('Control+z');
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(mark(page)).toHaveCount(0);
    expect(await description(page, 0)).not.toContain('소리');
  });

  test('the slider sets the level by keyboard, says which way, and a held key is one undo step', async ({
    page,
  }) => {
    await withClip(page);
    await slider(page).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(slider(page)).toHaveValue('95');
    await expect(slider(page)).toHaveAttribute('aria-valuetext', '95%');
    await expect(status(page)).toContainText('소리를 95%로 줄였어요.');
    await expect(mark(page)).toContainText('95%');
    expect(await description(page, 0)).toContain('소리 95%');
    await expect(page.locator('#clip-sound-note')).toHaveText(
      '녹음된 것보다 작게 들려요',
    );

    // Two notches without letting go: one gesture, one undo.
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.up('ArrowLeft');
    await expect(slider(page)).toHaveValue('85');
    await page.keyboard.press('Control+z');
    await expect(slider(page)).toHaveValue('95');
    await page.keyboard.press('Control+z');
    await expect(slider(page)).toHaveValue('100');
    await expect(mark(page)).toHaveCount(0);

    // Up, and the sentence says so.
    await slider(page).focus();
    await page.keyboard.press('End');
    await expect(slider(page)).toHaveValue('200');
    await expect(status(page)).toContainText('소리를 200%로 키웠어요.');
    await expect(page.locator('#clip-sound-note')).toHaveText(
      '녹음된 것보다 크게 들려요',
    );
  });

  test('the editor’s single keys do nothing while the slider has focus', async ({
    page,
  }) => {
    // The fade-length list once ripple-deleted the clip on Delete; the
    // slider must not repeat it. Delete, split and mute all stay out.
    await withClip(page);
    await slider(page).focus();
    await page.keyboard.press('Delete');
    await page.keyboard.press('c');
    await page.keyboard.press('m');
    await expect(clips(page)).toHaveCount(1);
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(slider(page)).toBeFocused();
    // Modified chords are still the app's: undo reaches through.
    await page.keyboard.press('ArrowLeft');
    await expect(slider(page)).toHaveValue('95');
    await page.keyboard.press('Control+z');
    await expect(slider(page)).toHaveValue('100');
  });

  test('M mutes the selected clip and the palette lists the switch, not the level', async ({
    page,
  }) => {
    await withClip(page);
    // Focus is on the clip after the click; a plain key reaches the app.
    await page.keyboard.press('m');
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('m');
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: '명령 찾기' });
    await dialog.getByRole('combobox').fill('소리');
    const rows = dialog.getByRole('option');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('소리 끄기');
    await expect(rows.first()).toContainText('M');
  });

  test('an export of a muted clip has every frame and no sound', async ({
    page,
  }) => {
    await withClip(page);
    await muteButton(page).click();
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'true');

    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByRole('button', { name: /내보내기/ }).click();
    await downloadPromise;
    await expect(status(page)).toContainText('내보내기 완료', {
      timeout: 120_000,
    });
    await expect(status(page)).toContainText('90 frames');
    await expect(status(page)).toContainText('무음');
  });
});
