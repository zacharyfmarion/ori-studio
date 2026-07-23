import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const crossOriginIsolationHeaders = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

// `PROFILE=1 vite build` produces a production build that keeps function names
// and emits sourcemaps, so a CPU profile in production shows readable frames
// instead of minified `a`/`b`. Everything else is a normal prod build (React in
// production mode, so no dev-only overhead), which is what you want to judge
// real performance.
const profiling = process.env.PROFILE === '1';

export default defineConfig({
  plugins: [react()],
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  build: {
    sourcemap: profiling,
  },
  esbuild: {
    // esbuild strips function/class names during minify; keep them when
    // profiling so a CPU profile shows real frames.
    keepNames: profiling,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
