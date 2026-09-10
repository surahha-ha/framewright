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

  test('the slider stops where the clip’s own peak would clip, and a level set before that is heard at the ceiling', async ({
    page,
  }) => {
    await withClip(page);
    // The fixture peaks at 0.19: the whole range is open.
    await expect(slider(page)).toHaveAttribute('max', '200');
    await slider(page).focus();
    await page.keyboard.press('End');
    await expect(slider(page)).toHaveValue('200');
    await expect(mark(page)).toContainText('200%');

    // Swap the file's decoded sound for a loud one (peak 0.9) through the
    // app's own module — the same seam a re-linked file goes through — and
    // give the strip a reason to render, which is what asks for new peaks.
    await expect
      .poll(() =>
        page.evaluate(() => !!localStorage.getItem('framewright:project')),
      )
      .toBe(true);
    // The app's OWN instance of the module: Vite may serve it under an HMR
    // query, and a plain `/src/engine/audio.ts` would be a second, empty one.
    const audioModule = await page.evaluate(
      () =>
        performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .find((n) => n.includes('/src/engine/audio.ts')) ??
        '/src/engine/audio.ts',
    );
    await expect
      .poll(
        () =>
          page.evaluate(async (url) => {
            const A = await import(/* @vite-ignore */ url);
            const saved = JSON.parse(
              localStorage.getItem('framewright:project')!,
            );
            return A.getAudioBuffer(saved.project.assets[0].id) !== null;
          }, audioModule),
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.evaluate(async (url) => {
      const A = await import(/* @vite-ignore */ url);
      const saved = JSON.parse(localStorage.getItem('framewright:project')!);
      const id: string = saved.project.assets[0].id;
      const old = A.getAudioBuffer(id)!;
      const loud = new AudioBuffer({
        numberOfChannels: 1,
        length: old.length,
        sampleRate: old.sampleRate,
      });
      const d = loud.getChannelData(0);
      for (let i = 0; i < d.length; i++)
        d[i] = 0.9 * Math.sin((2 * Math.PI * 220 * i) / old.sampleRate);
      A.setAudioBuffer(id, loud);
    }, audioModule);
    // A zoom changes the strip's scale, which re-renders every clip canvas —
    // and a clip canvas asking for its peaks is what builds the new ones. (A
    // re-linked file gets the same render from its thumbnails arriving.)
    await page.locator('.ruler').focus();
    await page.keyboard.press('=');

    // 1 / 0.9 = 111% → the notch below, 110%. The stored 200% is not
    // rewritten: it is heard, shown and described at the ceiling.
    await expect(slider(page)).toHaveAttribute('max', '110', {
      timeout: 10_000,
    });
    await expect(slider(page)).toHaveValue('110');
    await expect(mark(page)).toContainText('110%');
    expect(await description(page, 0)).toContain('소리 110%');
    await expect(page.locator('#clip-sound-note')).toHaveText(
      '녹음된 것보다 크게 들려요',
    );
    // The limit is the slider's own description, not the mute button's.
    await expect(page.locator('#clip-sound-limit')).toHaveText(
      '이 클립은 소리가 커서 110%까지만 키울 수 있어요',
    );
    expect(await slider(page).getAttribute('aria-describedby')).toContain(
      'clip-sound-limit',
    );
    expect(
      await muteButton(page).getAttribute('aria-describedby'),
    ).not.toContain('clip-sound-limit');
    // Nothing the user did moved the slider's end, so the status line says it.
    await expect(status(page)).toContainText(
      '소리를 200%로 두었지만, 이 클립은 소리가 커서 110%로 들려요.',
    );
    // Undo reaches the stored 200% → 100%, proving the document kept it.
    await page.keyboard.press('Control+z');
    await expect(slider(page)).toHaveValue('100');
    await expect(mark(page)).toHaveCount(0);
    await expect(page.locator('#clip-sound-note')).toHaveText(
      '녹음된 그대로 들려요',
    );
    // And the slider itself cannot pass the ceiling now.
    await slider(page).focus();
    await page.keyboard.press('End');
    await expect(slider(page)).toHaveValue('110');
    await expect(status(page)).toContainText('소리를 110%로 키웠어요.');
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
