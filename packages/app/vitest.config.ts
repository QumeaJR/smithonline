import { defineConfig } from 'vitest/config';

// Store and codec tests run in plain Node; component tests (ui-*.test.tsx) opt into jsdom per file.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // the broadband search tours take about 5 s alone and longer when 50 test files run at once
    testTimeout: 30000,
    // half the cores: the timing checks (help parsing, labels, live network) stay meaningful on a busy machine
    maxWorkers: '50%',
  },
});
