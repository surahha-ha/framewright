// framewright — single source of truth for the dev server address.
// Both vite.config.ts and playwright.config.ts read this, so changing the port
// in one place cannot leave the e2e runner pointing at the old one.
//
// Override without editing code:  FRAMEWRIGHT_PORT=1234 npm run dev
//
// Host is pinned to IPv4: on Windows `localhost` often resolves to ::1 first,
// which makes Playwright's webServer health check time out.
export const DEV_HOST = '127.0.0.1';
export const DEV_PORT = Number(process.env.FRAMEWRIGHT_PORT ?? 9990);
export const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`;
