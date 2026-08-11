import { defineConfig } from 'vitest/config';

// Unit tests run in Node — pure engine logic only (no WebCodecs/Canvas/OPFS).
// Browser-only paths are covered by Playwright + the manual harness (see docs/TESTING.md).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
