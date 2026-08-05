import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The fixture and golden suites run the CPU ReferenceSolver for hundreds of
    // steps over meshes up to 6.5k vertices; the xl fixtures exceed vitest's 5s
    // default on a CI runner even though they finish in ~2s on a dev machine.
    // A generous ceiling here, rather than per-test timeouts scattered across
    // the suites, so adding a fixture does not mean remembering to raise one.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
