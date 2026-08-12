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
    // ALWAYS reuse a dev server that is already up. The default
    // (`!process.env.CI`) turns "I have `npm run dev` open" into a hard failure
    // the moment anything sets CI — which is exactly what `npm run handoff`
    // does. Reuse is safe here: Vite serves modules from disk, so a running
    // server is never stale. (Restart it by hand after changing vite.config.ts
    // or dependencies.)
    reuseExistingServer: true,
    timeout: 120_000,
    // Surface Vite's output so a startup failure is visible, not just a timeout.
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
