import { defineConfig } from 'vitest/config';

// Tests run in plain Node — they import the Worker default export
// directly and inject a stubbed D1 binding. We don't need miniflare /
// `@cloudflare/vitest-pool-workers` for the smoke checks Phase 2 ships.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
