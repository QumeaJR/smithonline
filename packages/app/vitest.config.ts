import { defineConfig } from 'vitest/config';

// Store and codec tests run in plain Node; component tests come with Playwright later.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
