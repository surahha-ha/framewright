// framewright — 조용한 부분 없애기, in a real browser (ADR-0016).
//
// The rule and the patch are unit-tested in `src/engine/silence.test.ts`, the
// command's contract in `silenceCommand.test.ts`. What only a browser can
// answer: that a real file's decoded sound reaches the command through the
// waveform cache, that the button waits for it and then runs, that the cut
// keeps the frame sum honest, that the sentence counts, and that one Ctrl+Z
// puts everything back.
//
// `sample-silence.mp4` is `sample-h264.mp4`'s pictures with a soundtrack of
// tone 0–0.9 s · silence 0.9–2.3 s · tone 2.3–3.0 s, made through the app's
// own export (there is no ffmpeg on the machine that made it). Decoded, the
// pause measures 0.901–2.299 s; padded and rounded to frames that is a cut of
// [34, 62), 28 frames — give or take one at each edge for another decoder.
import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supportsH264 } from './helpers';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const SILENT = join(FIXTURES, 'sample-silence.mp4');
const STEADY = join(FIXTURES, 'sample-h264.mp4');

const button = (page: Page) =>
  page.getByRole('button', { name: '조용한 부분 없애기', exact: true });
const clips = (page: Page) => page.locator('.timeline .clip');
const status = (page: Page) => page.locator('.statusbar');

/** The timeline's length in frames. The readout is `playhead / LAST frame`
 *  (`0 / 89` for 90 frames), so the total is one more than it shows. */
async function totalFrames(page: Page): Promise<number> {
  const text = await page.locator('.transport .dim').innerText();
  const m = text.match(/\/\s*(\d+)/);
  if (!m) throw new Error(`transport readout has no total: "${text}"`);
  return Number(m[1]) + 1;
}

async function open(page: Page, fixture: string) {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  test.skip(
    !(await supportsH264(page)),
    'this browser has no H.264 (use `npm run e2e:chrome`)',
  );
  await page.setInputFiles('input[type="file"]', fixture);
  await expect(clips(page)).toHaveCount(1, { timeout: 15_000 });
}

test.describe('silence auto-cut', () => {
  test('before a file is in, the button waits and says to import', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await expect(button(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(button(page)).toHaveAttribute(
      'title',
      '먼저 영상을 불러오세요.',
    );
    // The reason is reachable by keyboard: the button stays in the tab
    // order and a press says why.
    await button(page).click({ force: true });
    await expect(status(page)).toHaveText('먼저 영상을 불러오세요.');
  });

  test('a file with no pause leaves the button waiting, with the reason', async ({
    page,
  }) => {
    await open(page, STEADY);
    // The peaks land after the file; whichever sentence is up, the button
    // does not offer a cut it cannot make.
    await expect(button(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(button(page)).toHaveAttribute(
      'title',
      '0.5초 넘게 조용한 부분이 없어요.',
      { timeout: 15_000 },
    );
  });

  test('cuts the pause, keeps the frame sum, says so, and undoes in one step', async ({
    page,
  }) => {
    await open(page, SILENT);
    const before = await totalFrames(page);
    expect(before).toBe(90);

    // Enabled once the sound is read — not before.
    await expect(button(page)).toHaveAttribute('aria-disabled', 'false', {
      timeout: 15_000,
    });
    await button(page).click();

    // One pause → two clips, and the timeline is shorter by exactly the cut.
    await expect(clips(page)).toHaveCount(2);
    const after = await totalFrames(page);
    const removed = before - after;
    expect(removed).toBeGreaterThanOrEqual(26);
    expect(removed).toBeLessThanOrEqual(30);
    await expect(status(page)).toContainText('조용한 부분 1곳을 없앴어요');
    await expect(status(page)).toContainText('초 짧아졌어요');
    // The cut is the middle of the pause: the head keeps its 0.9 s of tone
    // plus the padding, so the first clip is 34 frames, give or take one.
    const first = await clips(page).first().getAttribute('aria-label');
    expect(first).toMatch(/, (33|34|35)프레임$/);
    // Nothing else to cut now: the button says so instead of going dark.
    await expect(button(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(button(page)).toHaveAttribute(
      'title',
      '0.5초 넘게 조용한 부분이 없어요.',
    );

    // One undo step for the whole cut.
    await page.keyboard.press('Control+z');
    await expect(clips(page)).toHaveCount(1);
    expect(await totalFrames(page)).toBe(before);
    await expect(button(page)).toHaveAttribute('aria-disabled', 'false');
  });

  test('a muted clip is left alone, and the reason says so', async ({
    page,
  }) => {
    await open(page, SILENT);
    await expect(button(page)).toHaveAttribute('aria-disabled', 'false', {
      timeout: 15_000,
    });
    await clips(page).first().click();
    await page.getByRole('button', { name: '소리 끄기', exact: true }).click();
    await expect(button(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(button(page)).toHaveAttribute(
      'title',
      '소리를 끈 클립은 건너뛰어요 · 소리를 다시 켜면 그 클립의 조용한 부분도 찾아요.',
    );
  });

  test('is in the palette, with no key of its own', async ({ page }) => {
    await open(page, SILENT);
    await expect(button(page)).toHaveAttribute('aria-disabled', 'false', {
      timeout: 15_000,
    });
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: '명령 찾기' });
    await dialog.getByRole('combobox').fill('조용한');
    const rows = dialog.getByRole('option');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('조용한 부분 없애기');
    await expect(rows.first()).toHaveAttribute('aria-disabled', 'false');
    await page.keyboard.press('Enter');
    await expect(clips(page)).toHaveCount(2);
    await expect(status(page)).toContainText('조용한 부분 1곳을 없앴어요');
  });

  test('a palette row opened while the sound is still being read wakes up when it lands', async ({
    page,
  }) => {
    // The peaks land out of band, after the file. A palette opened before
    // that showed the row as a dead end until the query was retyped (found by
    // the QA persona in the E9 round). Reproduced here through the app's own
    // seam: the steady file's sound is swapped for one with a pause AFTER the
    // palette is open, and its peaks are released and asked for again.
    await open(page, STEADY);
    await expect(button(page)).toHaveAttribute(
      'title',
      '0.5초 넘게 조용한 부분이 없어요.',
      { timeout: 15_000 },
    );
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: '명령 찾기' });
    await dialog.getByRole('combobox').fill('조용한');
    const row = dialog.getByRole('option').first();
    await expect(row).toHaveAttribute('aria-disabled', 'true');

    const moduleUrl = (part: string) =>
      page.evaluate(
        (p) =>
          performance
            .getEntriesByType('resource')
            .map((e) => e.name)
            .find((n) => n.includes(p)) ?? p,
        part,
      );
    // The autosave is debounced; the asset id is read from it.
    await expect
      .poll(() =>
        page.evaluate(() => !!localStorage.getItem('framewright:project')),
      )
      .toBe(true);
    const audioModule = await moduleUrl('/src/engine/audio.ts');
    const waveModule = await moduleUrl('/src/ui/waveform.ts');
    await page.evaluate(
      async ([audioUrl, waveUrl]) => {
        const A = await import(/* @vite-ignore */ audioUrl);
        const W = await import(/* @vite-ignore */ waveUrl);
        const saved = JSON.parse(localStorage.getItem('framewright:project')!);
        const id: string = saved.project.assets[0].id;
        const old = A.getAudioBuffer(id)!;
        const next = new AudioBuffer({
          numberOfChannels: 1,
          length: old.length,
          sampleRate: old.sampleRate,
        });
        const d = next.getChannelData(0);
        for (let i = 0; i < d.length; i++) {
          const t = i / old.sampleRate;
          d[i] =
            t < 0.9 || t >= 2.3
              ? 0.2 * Math.sin((2 * Math.PI * 220 * i) / old.sampleRate)
              : 0;
        }
        // In this order: a release refuses the buffer bound RIGHT NOW (the
        // old one), so the new one is reduced when asked for — the same
        // sequence a re-link goes through.
        W.releasePeaks(id);
        A.setAudioBuffer(id, next);
        W.requestPeaks(id);
      },
      [audioModule, waveModule],
    );

    // Nothing typed, nothing clicked: the row wakes up on its own.
    await expect(row).toHaveAttribute('aria-disabled', 'false', {
      timeout: 10_000,
    });
    await page.keyboard.press('Enter');
    await expect(clips(page)).toHaveCount(2);
  });
});
