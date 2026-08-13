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
  // Each worker runs its own Chromium, and one instance peaks around 425MB
  // (renderer ~148 · network+storage utilities ~122 · gpu ~81 · browser ~82).
  // Playwright's default is half the cores, which here means one worker per
  // spec file — four instances, ~1.1GB, for no time gain, because the run is
  // bottlenecked by the longest single file. Two workers cost nothing and save
  // a third of that. Measured on this suite (peak resident, wall clock):
  //
  //   workers=4   ~1110MB   26-28s      workers=1   ~425MB   43s
  //   workers=2    ~770MB   27s
  //
  // `npm run e2e:lowmem` (--workers=1) trades 16s for another 45%. See
  // docs/TESTING.md.
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: DEV_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
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
