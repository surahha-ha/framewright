import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// framewright — web video editor (Vite + React + TS)
export default defineConfig({
  plugins: [react()],
  server: { port: 9990 },
});
