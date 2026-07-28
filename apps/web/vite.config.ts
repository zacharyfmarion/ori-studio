import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const crossOriginIsolationHeaders = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/**
 * The commit stamped into the bundle, so a copied error report identifies the
 * exact build it came from. (The version needs no define — `constants/release.ts`
 * already imports it from package.json.) Degrades to `'unknown'`: a tarball with
 * no git checkout must still build.
 */
function appCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

// `PROFILE=1 vite build` produces a production build that keeps function names
// and emits sourcemaps, so a CPU profile in production shows readable frames
// instead of minified `a`/`b`. Everything else is a normal prod build (React in
// production mode, so no dev-only overhead), which is what you want to judge
// real performance.
const profiling = process.env.PROFILE === '1';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_COMMIT__: JSON.stringify(appCommit()),
  },
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
