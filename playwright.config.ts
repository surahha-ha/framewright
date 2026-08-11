import { defineConfig, devices } from '@playwright/test';
import { DEV_URL } from './dev-server';

// WebCodecs needs a secure context, so tests run against the dev server on
// 127.0.0.1 (secure, and avoids the IPv6 `localhost` mismatch on Windows).
// The address comes from dev-server.ts so it can never drift from Vite's.
//
// Projects:
//   - `chromium` : Playwright's bundled Chromium.
//   - `chrome`   : your installed Google Chrome (`npm run e2e:chrome`).
// Tests that need H.264 self-skip when the browser cannot do it.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: DEV_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
  ],
  webServer: {
    command: 'npm run dev',
    url: DEV_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Surface Vite's output so a startup failure is visible, not just a timeout.
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
