import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { DEV_HOST, DEV_PORT } from './dev-server';

// framewright — web video editor (Vite + React + TS)
export default defineConfig({
  plugins: [react()],
  server: {
    host: DEV_HOST,
    port: DEV_PORT,
    // Fail loudly instead of silently moving to another port — that mismatch is
    // what breaks the Playwright webServer check.
    strictPort: true,
  },
});
