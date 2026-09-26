import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // Each test file gets its own in-memory PGlite database via startTestServer()…
    fileParallelism: true,
    // …which is why the pool is bounded: one PGlite (WASM) per worker, and a worker per CPU
    // ran V8 out of memory ("Fatal process out of memory: Zone") on a 41-file suite.
    maxWorkers: 4,
  },
});
