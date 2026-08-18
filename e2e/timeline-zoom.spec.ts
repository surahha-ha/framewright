// framewright — timeline zoom and ruler ticks (ADR-0010).
//
// The arithmetic is unit-tested in `src/engine/timelineView.test.ts`. What
// cannot be tested in Node is the half that actually decides whether zoom
// works: that the strip really scrolls, that the ruler really draws marks, that
// a click still lands on the frame under the pointer once the scale is no
// longer "the whole document across the container", and that zooming never
// touches the document.
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
}

const zoomIn = (page: Page) => page.getByRole('button', { name: '크게 보기' });
const zoomOut = (page: Page) => page.getByRole('button', { name: '작게 보기' });
const zoomFit = (page: Page) => page.getByRole('button', { name: '전체 보기' });

/** What the browser itself thinks about the strip, not what we hope it thinks. */
async function strip(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('.strip') as HTMLElement;
    const track = document.querySelector('.track') as HTMLElement;
    return {
      viewport: el.clientWidth,
      content: el.scrollWidth,
      scrollLeft: el.scrollLeft,
      trackWidth: track.getBoundingClientRect().width,
      trackLeft: track.getBoundingClientRect().left,
    };
  });
}

/**
 * Zoom in until the control refuses, and say how many steps that took.
 *
 * The number is NOT a constant to hardcode: it falls out of the window width
 * and the length of the footage (the fixture is three seconds, so a wide window
 * is already most of the way to the ceiling). A test that clicks a fixed number
 * of times passes on one screen and hangs on another.
 */
async function zoomToCeiling(page: Page): Promise<number> {
  for (let steps = 0; steps < 20; steps++) {
    if ((await zoomIn(page).getAttribute('aria-disabled')) === 'true') {
      return steps;
    }
    await zoomIn(page).click();
  }
  throw new Error('zoom never reached its ceiling');
}

const playheadFrame = async (page: Page) =>
  Number(await page.locator('.ruler').getAttribute('aria-valuenow'));

const clipFrames = async (page: Page) =>
  Number(
    (
      (await page.locator('.clip').first().getAttribute('aria-label')) ?? ''
    ).match(/(\d+)프레임/)?.[1] ?? '0',
  );

test.describe('timeline zoom', () => {
  test('fitted is the default: the whole document, nothing to scroll', async ({
    page,
  }) => {
    await withClip(page);
    const s = await strip(page);
    // The content is the viewport, to the pixel — this is the behaviour the
    // timeline had before it could zoom, and zoom must not have changed it.
    expect(s.content).toBe(s.viewport);
    expect(s.trackWidth).toBeCloseTo(s.viewport, 0);
    await expect(zoomOut(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(zoomFit(page)).toHaveAttribute('aria-disabled', 'true');
  });

  test('zooming in makes the strip longer than its window, and fit undoes it', async ({
    page,
  }) => {
    await withClip(page);
    const before = await strip(page);
    await zoomIn(page).click();
    const after = await strip(page);
    expect(after.content).toBeGreaterThan(before.content);
    expect(after.content).toBeGreaterThan(after.viewport);
    expect(after.viewport).toBe(before.viewport); // the window did not move

    await zoomFit(page).click();
    await expect
      .poll(async () => (await strip(page)).content)
      .toBe(before.content);
  });

  test('zooming changes what you see and NOTHING about the document', async ({
    page,
  }) => {
    await withClip(page);
    // A real edit first, so the top of the undo stack is a known thing.
    const clip = page.locator('.timeline .clip').first();
    const box = (await clip.boundingBox())!;
    await clip.click({ position: { x: box.width * 0.5, y: box.height / 2 } });
    await page.keyboard.press('c');
    await expect(page.locator('.timeline .clip')).toHaveCount(2);

    const frames = await clipFrames(page);
    const playhead = await playheadFrame(page);
    await zoomIn(page).click();
    expect(await clipFrames(page)).toBe(frames);
    expect(await playheadFrame(page)).toBe(playhead);

    // The decisive one: undo takes back the SPLIT. If zooming had pushed an
    // entry, Ctrl+Z would have spent itself undoing the zoom and the two clips
    // would still be there.
    await page.keyboard.press('Control+z');
    await expect(page.locator('.timeline .clip')).toHaveCount(1);
  });

  test('says so when it has zoomed as far in as it goes', async ({ page }) => {
    await withClip(page);
    const steps = await zoomToCeiling(page);
    expect(steps).toBeGreaterThan(0);
    await expect(zoomIn(page)).toHaveAttribute('aria-disabled', 'true');
    // `force` because Playwright refuses to click an aria-disabled control —
    // but a real user can, and what they get back has to be a sentence.
    await zoomIn(page).click({ force: true });
    await expect(page.locator('.statusbar')).toContainText('더 크게는 안 돼요');
  });

  test('a click still lands on the frame under the pointer when zoomed', async ({
    page,
  }) => {
    await withClip(page);
    await zoomIn(page).click();
    await zoomIn(page).click();

    // Click a known offset into the visible window and work out, from the
    // browser's own numbers, which frame that has to be. If the component and
    // the engine ever disagree about the coordinate system, this is where it
    // shows: at fit the two were indistinguishable.
    const s = await strip(page);
    const totalFrames = await clipFrames(page);
    const scale = s.trackWidth / totalFrames;
    const offset = 200;
    const box = (await page.locator('.track').boundingBox())!;
    await page.mouse.click(s.trackLeft + offset, box.y + box.height / 2);
    expect(await playheadFrame(page)).toBe(
      Math.floor((s.scrollLeft + offset) / scale),
    );
  });

  test('the ruler draws marks, and labels them with timecodes', async ({
    page,
  }) => {
    await withClip(page);
    const marks = page.locator('.ruler .tick');
    expect(await marks.count()).toBeGreaterThan(2);
    const labels = await page
      .locator('.ruler .tick-label')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
    expect(labels.length).toBeGreaterThan(0);
    // m:ss (h:mm:ss past an hour) — NOT the mm:ss:ff of the transport readout.
    // A row of mm:ss:ff labels reads as hours:minutes:seconds, and a
    // three-second clip was being labelled up to "00:02:25".
    for (const label of labels)
      expect(label).toMatch(/^\d+:[0-5]\d(:[0-5]\d)?$/);
    // Every label names a distinct moment: a sub-second step would print the
    // same text several times in a row, which is why the labelled ladder
    // starts at one second.
    expect(new Set(labels).size).toBe(labels.length);
    // Every mark is a real position in the document, not a stray at the origin.
    const lefts = await marks.evaluateAll((els) =>
      els.map((e) => parseFloat((e as HTMLElement).style.left)),
    );
    expect(lefts.every((l) => Number.isFinite(l) && l >= 0)).toBe(true);
    expect(new Set(lefts).size).toBe(lefts.length);
  });

  test('zooming in draws MORE marks over the same footage', async ({
    page,
  }) => {
    await withClip(page);
    const fitted = await page.locator('.ruler .tick').count();
    await zoomToCeiling(page);
    // Ticks are built for the visible range only, so the count stays modest —
    // the point is that the ruler subdivides instead of stretching.
    const zoomedIn = await page.locator('.ruler .tick').count();
    expect(zoomedIn).toBeGreaterThan(0);
    expect(zoomedIn).toBeLessThan(fitted * 20);
  });

  test('the strip follows the playhead out of the visible window', async ({
    page,
  }) => {
    await withClip(page);
    await zoomToCeiling(page);
    expect((await strip(page)).scrollLeft).toBe(0);

    // Walk the playhead to the end with the keyboard only.
    await page.locator('.ruler').focus();
    await page.keyboard.press('End');
    await expect
      .poll(async () => (await strip(page)).scrollLeft)
      .toBeGreaterThan(0);
    // ...and back again.
    await page.keyboard.press('Home');
    await expect.poll(async () => (await strip(page)).scrollLeft).toBe(0);
  });

  test('the keys do what the buttons do, and say when they cannot', async ({
    page,
  }) => {
    await withClip(page);
    const before = (await strip(page)).content;
    await page.keyboard.press('=');
    await expect
      .poll(async () => (await strip(page)).content)
      .toBeGreaterThan(before);
    await page.keyboard.press('\\');
    await expect.poll(async () => (await strip(page)).content).toBe(before);

    // Already fitted: the refusal is said out loud rather than swallowed, which
    // is the only feedback a screen-reader user gets from a key that does
    // nothing (see `whyNot` in src/ui/useShortcuts.ts).
    await page.keyboard.press('-');
    await expect(page.locator('.statusbar')).toContainText('전체가 다 보이고');
  });

  test('emptying the timeline puts the view back to fitted', async ({
    page,
  }) => {
    // Otherwise a scale chosen for the document that was just deleted is
    // applied to the next import, and a fresh video opens showing a sliver of
    // itself — which reads as the file having failed to load.
    await withClip(page);
    await zoomToCeiling(page);
    expect((await strip(page)).content).toBeGreaterThan(
      (await strip(page)).viewport,
    );

    await page.locator('.timeline .clip').first().click();
    await page.keyboard.press('Delete');
    await expect(page.locator('.timeline .clip')).toHaveCount(0);
    await expect
      .poll(async () => (await strip(page)).content)
      .toBe((await strip(page)).viewport);
    await expect(zoomFit(page)).toHaveAttribute('aria-disabled', 'true');
  });

  test('zooming out to the floor leaves the view FITTED, not merely fitted-sized', async ({
    page,
  }) => {
    // A number that happens to equal the fitted scale looks identical and then
    // stops following the document. "전체 보기" going disabled is the only
    // outward sign of the difference, so it is what this asserts.
    await withClip(page);
    await zoomIn(page).click();
    await expect(zoomFit(page)).not.toHaveAttribute('aria-disabled', 'true');
    for (let i = 0; i < 6; i++) {
      if ((await zoomOut(page).getAttribute('aria-disabled')) === 'true') break;
      await zoomOut(page).click();
    }
    await expect(zoomFit(page)).toHaveAttribute('aria-disabled', 'true');
    expect((await strip(page)).content).toBe((await strip(page)).viewport);
  });

  test('a zoom step keeps the clip the keyboard is on, not just the playhead', async ({
    page,
  }) => {
    // Centring on the playhead regardless would scroll a focused clip off
    // screen while it keeps DOM focus — a focus ring the user cannot see.
    await withClip(page);
    // Cut twice, so the first clip is SHORT and the playhead can end up far
    // enough away that centring on it would leave the first clip off screen
    // entirely. With one cut the two halves always overlap the window and the
    // assertion below would pass whatever the anchor was.
    const split = async (fraction: number) => {
      const clip = page.locator('.timeline .clip').last();
      const box = (await clip.boundingBox())!;
      await clip.click({
        position: { x: box.width * fraction, y: box.height / 2 },
      });
      await page.keyboard.press('c');
    };
    await split(0.2);
    await expect(page.locator('.timeline .clip')).toHaveCount(2);
    await split(0.9);
    await expect(page.locator('.timeline .clip')).toHaveCount(3);

    // Focus the FIRST clip while the playhead sits near the end of the strip,
    // then zoom with the KEY — clicking the button would move focus to the
    // button, which is the case this is not about.
    await page.locator('.timeline .clip').first().focus();
    await page.keyboard.press('=');
    await page.keyboard.press('=');

    const seen = await page.evaluate(() => {
      const strip = (
        document.querySelector('.strip') as HTMLElement
      ).getBoundingClientRect();
      const clip = (
        document.querySelector('.clip') as HTMLElement
      ).getBoundingClientRect();
      return {
        focusedIsAClip: !!document.activeElement?.classList.contains('clip'),
        onScreen: clip.right > strip.left && clip.left < strip.right,
        scrolled: (document.querySelector('.strip') as HTMLElement).scrollLeft,
      };
    });
    // The premise: focus never left the clip, so a focus ring is being drawn.
    expect(seen.focusedIsAClip).toBe(true);
    expect(seen.onScreen).toBe(true);
  });

  test('the strip says how much footage is on screen, and keeps saying it', async ({
    page,
  }) => {
    // The only standing answer to "how zoomed am I": the ruler covers the whole
    // document at every zoom, the ticks are hidden from assistive tech, and the
    // status line says what changed, once.
    await withClip(page);
    const readout = page.locator('.zoom-span');
    await expect(readout).toContainText('한 화면에');
    const fitted = await readout.innerText();
    await zoomToCeiling(page);
    await expect(readout).not.toHaveText(fitted);
    await expect(readout).toContainText('한 화면에');
  });

  test('the view controls carry a word, not only a glyph', async ({ page }) => {
    // A first-timer who cannot click a narrow clip has to be able to SEE what
    // these do; a name that lives only in `title` is a name behind a hover.
    await withClip(page);
    for (const [button, word] of [
      [zoomOut(page), '작게'],
      [zoomIn(page), '크게'],
      [zoomFit(page), '전체'],
    ] as const) {
      await expect(button).toContainText(word);
      // WCAG 2.5.3: the accessible name has to contain the visible word.
      expect((await button.getAttribute('aria-label')) ?? '').toContain(word);
    }
  });

  test('a refused zoom button explains itself instead of doing nothing', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    // No media at all: every zoom is meaningless, and says so.
    await expect(zoomIn(page)).toHaveAttribute('aria-disabled', 'true');
    // `force` because Playwright refuses to click an aria-disabled control —
    // but nothing stops a real user, and silence is what makes a control feel
    // broken.
    await zoomIn(page).click({ force: true });
    await expect(page.locator('.statusbar')).toContainText('먼저 영상을');
  });
});
