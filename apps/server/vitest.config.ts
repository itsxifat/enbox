import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // Each test file gets its own in-memory PGlite database via startTestServer().
    fileParallelism: true,
  },
});
