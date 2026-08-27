// framewright — the thumbnail strip inside a clip.
//
// The arithmetic is unit-tested in `src/engine/thumbnails.test.ts`. What cannot
// be tested in Node is everything that decides whether a picture ever appears:
// WebCodecs, `createImageBitmap`, and a canvas that has to stay small enough
// for the browser to allocate while the clip it lives in is arbitrarily wide.
//
// Two of these need real H.264 and therefore self-skip on Playwright's bundled
// Chromium (`npm run e2e:chrome` runs them for real). The size and
// accessibility assertions do not — they are the ones that catch a canvas the
// browser silently refused to allocate, which reports nothing at all.
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
const zoomFit = (page: Page) => page.getByRole('button', { name: '전체 보기' });

const clipFrames = async (page: Page) =>
  Number(
    (
      (await page.locator('.clip').first().getAttribute('aria-label')) ?? ''
    ).match(/(\d+)프레임/)?.[1] ?? '0',
  );

/** The canvas's CSS size and the viewport it must never outgrow. */
async function canvasSize(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.clip-thumbs') as HTMLCanvasElement;
    const strip = document.querySelector('.strip') as HTMLElement;
    const clip = document.querySelector('.clip') as HTMLElement;
    return {
      cssWidth: canvas?.getBoundingClientRect().width ?? -1,
      cssHeight: canvas?.getBoundingClientRect().height ?? -1,
      bufferWidth: canvas?.width ?? -1,
      bufferHeight: canvas?.height ?? -1,
      viewport: strip.clientWidth,
      clipWidth: clip.getBoundingClientRect().width,
      clipHeight: clip.getBoundingClientRect().height,
    };
  });
}

/** How many pixels of the canvas were actually painted. Zero means the strip
 *  is an empty box — which looks exactly like "the footage is black". */
async function paintedPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.clip-thumbs') as HTMLCanvasElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || canvas.width === 0) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    return painted;
  });
}

test.describe('clip thumbnails', () => {
  test('a clip carries a picture strip, and it gets painted', async ({
    page,
  }) => {
    await withClip(page);
    await expect(page.locator('.clip .clip-thumbs')).toHaveCount(1);
    // Decoding is asynchronous and deliberately serial, so this is a wait, not
    // an immediate read.
    await expect
      .poll(() => paintedPixels(page), { timeout: 15_000 })
      .toBeGreaterThan(0);
  });

  test('the canvas never outgrows the window, however far in you zoom', async ({
    page,
  }) => {
    // The reason the strip is drawn on a window-sized canvas rather than a
    // clip-sized one. A canvas wider than the browser will allocate does not
    // throw: it stays in the DOM and stops drawing, and nothing reports it.
    await withClip(page);
    for (let step = 0; step < 12; step++) {
      const size = await canvasSize(page);
      expect(size.cssWidth).toBeGreaterThan(0);
      // Overhang is by design: the grid starts on a step boundary at or before
      // the left edge and ends on one at or after the right, so that scrolling
      // keeps hitting the cache. A slot is between THUMB_PX and twice that
      // (the step is a power of two), so two slots is at most ~288px.
      expect(size.cssWidth).toBeLessThanOrEqual(size.viewport + 288);
      expect(size.bufferWidth).toBeLessThanOrEqual(8192);
      if ((await zoomIn(page).getAttribute('aria-disabled')) === 'true') break;
      await zoomIn(page).click();
    }
    const end = await canvasSize(page);
    // Proof the loop was worth running: the clip really did outgrow the window,
    // and the canvas stayed a fraction of it rather than following it.
    expect(end.clipWidth).toBeGreaterThan(end.viewport);
    expect(end.cssWidth).toBeLessThan(end.clipWidth / 2);
  });

  test('the picture strip is the height of the CLIP, and stays there', async ({
    page,
  }) => {
    // A canvas is a replaced element: absolutely positioned with `height: auto`
    // it takes its intrinsic height (the `height` attribute) and ignores
    // `bottom`. The component sizes that attribute from `clientHeight`, so the
    // two fed each other and the canvas grew a few percent per render — 894px
    // tall inside a 42px clip, every frame drawn ten times too large and
    // cropped to its middle. Nothing threw. The gate and four reviewers all
    // passed it; looking at it in a browser is what found it.
    await withClip(page);
    // The fixture is three seconds, so the ceiling is only a step or two away
    // on a wide window — stop when the control refuses rather than guessing.
    for (let step = 0; step < 4; step++) {
      if ((await zoomIn(page).getAttribute('aria-disabled')) === 'true') break;
      await zoomIn(page).click();
      await page.waitForTimeout(150);
    }
    await zoomFit(page).click();
    await page.waitForTimeout(400);
    const size = await canvasSize(page);
    expect(size.cssHeight).toBeGreaterThan(20);
    expect(size.cssHeight).toBeLessThanOrEqual(size.clipHeight);
    // The buffer follows the CSS height, so a runaway shows up here first.
    expect(size.bufferHeight).toBeLessThan(size.clipHeight * 3);
  });

  test('the pictures stay out of the accessibility tree', async ({ page }) => {
    // A clip is a button whose name is the media it holds. Decoration that
    // joins that name makes every clip announce itself twice over.
    await withClip(page);
    const clip = page.locator('.clip').first();
    const before = await clip.getAttribute('aria-label');
    await expect(page.locator('.clip-thumbs')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    await zoomIn(page).click();
    expect(await clip.getAttribute('aria-label')).toBe(before);
    // The name is still a name, not something painted over by the footage.
    await expect(clip.locator('.clip-name')).toBeVisible();
    // The DOM contract: identity + position + length, never state. "This
    // clip's file is missing" is state and belongs in a description.
    expect(before).not.toMatch(/다시 선택|선택 필요/);
  });

  test('a clip with its media bound is not marked as missing it', async ({
    page,
  }) => {
    // The other half of the unlinked cue: it must not fire on a healthy clip.
    // A false ⚠ on every clip would be worse than no ⚠ at all.
    await withClip(page);
    const clip = page.locator('.clip').first();
    await expect(clip).not.toHaveClass(/unlinked/);
    expect(await clip.getAttribute('aria-describedby')).toBeNull();
    await expect(clip.locator('.clip-warn')).toHaveCount(0);
  });

  test('the strip survives a clip being trimmed to nothing much', async ({
    page,
  }) => {
    // A one-frame clip is under a pixel wide when fitted. `drawImage` with a
    // zero width throws, and a throw inside a layout effect blanks the editor.
    await withClip(page);
    await page.locator('.clip').first().click();
    // `clip.tailShrink`. It refuses at one frame, so over-pressing is safe and
    // the count does not have to match the fixture's length exactly.
    for (let i = 0; i < 95; i++) {
      await page.keyboard.press('Control+Alt+ArrowLeft');
    }
    expect(await clipFrames(page)).toBeLessThan(5);
    await expect(page.locator('.clip')).toHaveCount(1);
    await expect(page.locator('.timeline')).toBeVisible();
  });
});
