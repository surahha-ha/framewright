// framewright — persona scenarios (docs/TESTERS.md).
// These are not extra coverage of the same code paths; they encode what each
// virtual tester blocks on. A change is not done until this file is green.
import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supportsH264 } from './helpers';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'sample-h264.mp4',
);

async function importFixture(page: Page) {
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

const clipLabel = async (page: Page, index = 0) =>
  (await page
    .locator('.timeline .clip')
    .nth(index)
    .getAttribute('aria-label')) ?? '';

const clipFrames = async (page: Page, index = 0) =>
  Number((await clipLabel(page, index)).match(/(\d+)프레임/)?.[1] ?? '0');

// ---------------------------------------------------------------- novice

test.describe('tester-novice — never edited video before', () => {
  test('the first screen says what to do, and says it in plain words', async ({
    page,
  }) => {
    await page.goto('/');
    // A hint, not a blank canvas.
    await expect(page.locator('.track-hint')).toBeVisible();
    const hint = await page.locator('.track-hint').innerText();
    // No jargon a first-timer would have to look up.
    for (const jargon of ['in-point', 'out-point', 'ripple', 'CFR', 'codec']) {
      expect(hint.toLowerCase()).not.toContain(jargon.toLowerCase());
    }
  });

  test('every enabled control says what it does before you click it', async ({
    page,
  }) => {
    await page.goto('/');
    const buttons = page.getByRole('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const name = (await buttons.nth(i).getAttribute('aria-label')) ?? '';
      const text = (await buttons.nth(i).innerText()).trim();
      // Something readable must identify the button — an icon alone is a dead end.
      expect(
        (name + text).replace(/[^\p{L}\p{N}]/gu, '').length,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * Two names collide when one is the other, or when one contains the other.
   * Compared BY POSITION, never by value: `l !== label` would let two buttons
   * carrying the identical string cancel each other out and pass.
   */
  function collisions(labels: string[]): string[] {
    const out: string[] = [];
    labels.forEach((label, i) => {
      labels.forEach((other, j) => {
        if (i !== j && other.includes(label))
          out.push(`"${label}" ⊂ "${other}"`);
      });
    });
    return out;
  }

  test('no two toolbar buttons share a shape or a word', async ({ page }) => {
    // The toolbar is scanned, not read: two buttons that look the same or whose
    // names contain one another are a coin flip. `✂` (split) sat three buttons
    // from `✁` (clipboard cut), and "잘라내기" was the whole of one label and
    // the tail of two others — someone wanting to drop the first 30 seconds had
    // no way to pick. See src/engine/vocabulary.test.ts for the engine half.
    await page.goto('/');
    const texts = await page
      .locator('.toolbar button')
      .evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()));
    expect(texts.length).toBeGreaterThan(5);

    const icons: string[] = [];
    const labels: string[] = [];
    for (const text of texts) {
      const [, icon, label] = text.match(/^(\S+)\s+([\s\S]+)$/) ?? [];
      // A button with no glyph is allowed; one with no name is caught above.
      if (icon && label) {
        icons.push(icon);
        labels.push(label.trim());
      }
    }
    expect(new Set(icons).size, `repeated icon in ${icons.join(' ')}`).toBe(
      icons.length,
    );
    expect(collisions(labels)).toEqual([]);
  });

  test('the shortcut list names every action distinctly, too', async ({
    page,
  }) => {
    // The toolbar is only the visible third. The keyboard-only commands — the
    // six nudges — and every app action (undo, copy, cut) meet for the first
    // time in this dialog and in the palette, and that is where the two closest
    // names in the app sit side by side: "재생 위치까지 앞부분 줄이기" and
    // "앞부분 한 프레임 줄이기". The engine spec cannot see this list at all;
    // it is built from `entries()`, which spans commands AND app actions.
    await page.goto('/');
    await page.getByRole('button', { name: '단축키', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '단축키' });
    const labels = (
      await sheet
        .locator('.keylist .key-label')
        .evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()))
    ).map((text) => text.replace(/^\S+\s+/, '').trim());
    expect(labels.length).toBeGreaterThan(10);
    expect(labels.filter((l) => l.length === 0)).toEqual([]);
    expect(collisions(labels)).toEqual([]);
  });

  test('a mis-drag is always recoverable in one step', async ({ page }) => {
    await importFixture(page);
    const before = await clipLabel(page);
    const box = (await page.locator('.timeline .clip').first().boundingBox())!;
    const y = box.y + box.height / 2;

    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, y, { steps: 6 });
    await page.mouse.up();

    await expect(page.locator('.timeline .clip').first()).not.toHaveAttribute(
      'aria-label',
      before,
    );
    await page.keyboard.press('Control+z');
    // One undo restores the position — and does NOT take the import with it.
    await expect(page.locator('.timeline .clip')).toHaveCount(1);
    await expect(page.locator('.timeline .clip').first()).toHaveAttribute(
      'aria-label',
      before,
    );
  });
});

// ------------------------------------------------------------------ a11y

test.describe('tester-a11y — keyboard only, screen reader', () => {
  test('the timeline is a real slider and announces where it is', async ({
    page,
  }) => {
    await importFixture(page);
    const ruler = page.locator('.ruler');
    await expect(ruler).toHaveAttribute('role', 'slider');
    const before = await ruler.getAttribute('aria-valuenow');
    await ruler.focus();
    await page.keyboard.press('ArrowRight');
    await expect(ruler).not.toHaveAttribute('aria-valuenow', before ?? '');
    expect(await ruler.getAttribute('aria-valuetext')).toBeTruthy();

    // The clips must NOT be inside the slider: a slider's descendants are
    // presentational, which strips every clip's name and state from the a11y tree.
    await expect(page.locator('.ruler .clip')).toHaveCount(0);
    await expect(page.locator('.track')).not.toHaveAttribute('role', 'slider');
  });

  test('a clip can be trimmed and moved without ever touching the mouse', async ({
    page,
  }) => {
    await importFixture(page);
    const clip = page.locator('.timeline .clip').first();
    const startLength = await clipFrames(page);

    await clip.focus();
    await expect(clip).toBeFocused();

    // Tail shorter, then back.
    await page.keyboard.press('Alt+Control+ArrowLeft');
    expect(await clipFrames(page)).toBe(startLength - 1);
    await page.keyboard.press('Alt+Control+ArrowRight');
    expect(await clipFrames(page)).toBe(startLength);

    // Move right, then back — length must survive both.
    await page.keyboard.press('Alt+ArrowRight');
    expect(await clipFrames(page)).toBe(startLength);
    await page.keyboard.press('Alt+ArrowLeft');
    expect(await clipFrames(page)).toBe(startLength);
    await expect(clip).toBeFocused();
  });

  test('state changes are announced, not just drawn', async ({ page }) => {
    await importFixture(page);
    await expect(page.locator('.statusbar')).toHaveAttribute('role', 'status');
    const clip = page.locator('.timeline .clip').first();
    await clip.focus();
    await page.keyboard.press('Alt+ArrowRight');
    // The status line must describe the edit that just happened. Alt+→ can only
    // ever move, so it can only ever say 옮겼어요 — the alternative that used to
    // be here ("잘랐") was a string the app never emitted.
    await expect(page.locator('.statusbar')).toContainText('옮겼어요');
  });

  test('selection is visible to assistive tech, not only by colour', async ({
    page,
  }) => {
    await importFixture(page);
    const clip = page.locator('.timeline .clip').first();
    await expect(clip).toHaveAttribute('aria-pressed', 'false');
    const name = await clipLabel(page);
    await clip.click();
    await expect(clip).toHaveAttribute('aria-pressed', 'true');
    // Selecting must not rewrite the clip's NAME — a name that moves with state
    // makes a screen reader re-announce the whole clip on every click.
    expect(await clipLabel(page)).toBe(name);
  });
});

// -------------------------------------------------------------------- qa

test.describe('tester-qa — adversarial, correctness first', () => {
  test('moving a clip changes position only, never its frame count', async ({
    page,
  }) => {
    await importFixture(page);
    const before = await clipFrames(page);
    const clip = page.locator('.timeline .clip').first();
    const box = (await clip.boundingBox())!;
    const y = box.y + box.height / 2;

    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, y, { steps: 8 });
    await page.mouse.up();

    expect(await clipFrames(page)).toBe(before);
  });

  test('closing gaps is exactly reversible', async ({ page }) => {
    await importFixture(page);
    // Split, then move the right-hand piece away to open a gap.
    await page.locator('.track').click({ position: { x: 200, y: 20 } });
    await page.keyboard.press('c');
    await expect(page.locator('.timeline .clip')).toHaveCount(2);

    const second = page.locator('.timeline .clip').nth(1);
    await second.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('Alt+ArrowRight');

    const closeGaps = page.getByRole('button', { name: /빈 곳 없애기/ });
    await expect(closeGaps).toBeEnabled();
    const lengths = [await clipFrames(page, 0), await clipFrames(page, 1)];
    const totalBefore = await page.locator('.transport .dim').innerText();

    await closeGaps.click();
    // Lengths are untouched; only positions move.
    expect([await clipFrames(page, 0), await clipFrames(page, 1)]).toEqual(
      lengths,
    );
    await expect(closeGaps).toBeDisabled();

    await page.keyboard.press('Control+z');
    await expect(page.locator('.transport .dim')).toHaveText(totalBefore);
    await expect(closeGaps).toBeEnabled();
  });

  test('a press with no movement is not an edit', async ({ page }) => {
    await importFixture(page);
    const clip = page.locator('.timeline .clip').first();
    const box = (await clip.boundingBox())!;
    // Press exactly on the trim handle and release without moving.
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();

    // The import is the only thing on the undo stack: one undo must empty the
    // timeline. If the press had recorded a patch, this would leave a clip.
    await page.keyboard.press('Control+z');
    await expect(page.locator('.timeline .clip')).toHaveCount(0);
  });

  test('trimming cannot invent media that is not in the source', async ({
    page,
  }) => {
    await importFixture(page);
    const before = await clipFrames(page);
    const clip = page.locator('.timeline .clip').first();
    const box = (await clip.boundingBox())!;
    const y = box.y + box.height / 2;

    // Drag the tail far past the end of the source.
    await page.mouse.move(box.x + box.width - 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 600, y, { steps: 10 });
    await page.mouse.up();

    // The fixture is 90 frames; nothing may extend beyond it.
    expect(await clipFrames(page)).toBeLessThanOrEqual(before);
  });

  test('mashing edit keys on an empty timeline never throws', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    for (const key of [
      'Alt+ArrowRight',
      'Alt+ArrowLeft',
      'Alt+Shift+ArrowLeft',
      'Alt+Control+ArrowRight',
      'c',
      'Delete',
      'Control+z',
    ]) {
      await page.keyboard.press(key);
    }
    await page.waitForTimeout(150);
    expect(errors).toEqual([]);
  });
});
