import { defineConfig } from 'vitest/config';

// Benchmarks live outside the test config's `include` on purpose: they are slow
// and machine-dependent, so `npm test` must not pick them up. Run them with
// `npm run bench:sim`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['bench/**/*.bench.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
