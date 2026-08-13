import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

const DIST_PLACEHOLDER = 'apps/web/dist/.gitkeep';
const DIST_PLACEHOLDER_TEXT =
  "Placeholder so Tauri's compile-time context can resolve frontendDist in clean checkouts.\n";

/**
 * Put `dist/.gitkeep` back after a build.
 *
 * It is a *tracked* file, and `vite build` empties its output directory — so
 * building deletes it, and the next `git add -A` commits the deletion. The
 * result is a branch where `cargo test --workspace` fails on the Tauri crate
 * with "frontendDist … doesn't exist", nowhere near anything the branch
 * actually changed, and only on a clean checkout where nothing has built the
 * frontend yet. Cheaper to restore it here than to have everyone rediscover it.
 */
function keepTauriFrontendDistPath(): Plugin {
  return {
    name: 'keep-tauri-frontend-dist-path',
    apply: 'build',
    closeBundle() {
      const path = resolve(__dirname, '../../', DIST_PLACEHOLDER);
      if (!existsSync(path)) writeFileSync(path, DIST_PLACEHOLDER_TEXT);
    },
  };
}

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

/**
 * The release identity, defined here and used in exactly two places: the
 * sourcemap upload below, and `monitoring/bootstrap.ts` via `__SENTRY_RELEASE__`.
 *
 * It has to be one string, because it is the *join key*. Sentry symbolicates a
 * stack by matching the release an event reports against the release the
 * sourcemaps were uploaded under. Computing it twice — once here, once in the
 * app — is how that quietly breaks: the two agree until someone edits one
 * format string, and the symptom is minified stacks with no error anywhere.
 */
function sentryRelease(): string {
  const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
    version: string;
  };
  return `ori-studio@${version}+${appCommit()}`;
}

/**
 * Sourcemap upload is gated on the auth token, matching the "absence = disabled"
 * firewall the rest of the telemetry uses.
 *
 * The gate does double duty. Without a token we don't just skip the upload — we
 * don't *generate* sourcemaps at all, which is what stops them being deployed.
 * Cloudflare Pages serves whatever is in `dist`, so a generated-but-unuploaded
 * map is a public copy of the app's source. Belt and braces: the plugin also
 * deletes them after a successful upload.
 */
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const uploadSourcemaps = Boolean(sentryAuthToken);

export default defineConfig({
  plugins: [
    react(),
    keepTauriFrontendDistPath(),
    ...(uploadSourcemaps
      ? [
          sentryVitePlugin({
            // Not secrets, and already named in docs/analytics.md — a literal
            // here beats another env var nobody remembers to set.
            org: 'zachary-marion',
            project: 'ori-studio',
            authToken: sentryAuthToken,
            release: { name: sentryRelease() },
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.js.map'] },
            // The plugin reports its own usage to Sentry by default. Off, for
            // the same reason the SDK's session pings are.
            telemetry: false,
            // Measured, not assumed: with the default handler an expired or
            // wrong token logs a 401 and the build still exits 0, so the deploy
            // goes out green and every production stack is minified with nothing
            // to say why. Rethrowing turns that back into a failed build.
            errorHandler: (err) => {
              throw err;
            },
          }),
        ]
      : []),
  ],
  define: {
    __APP_COMMIT__: JSON.stringify(appCommit()),
    __SENTRY_RELEASE__: JSON.stringify(sentryRelease()),
  },
  server: {
    headers: crossOriginIsolationHeaders,
    /**
     * ExplOri search, in dev.
     *
     * In production `/api/explori/*` is a Pages Function; the dev server has no
     * Functions, so this stands in for it. It is not a convenience — the
     * upstream archive sends no CORS headers and answers `OPTIONS` with 501, so
     * a browser cannot reach it at all without a same-origin hop. Vite proxies
     * server-side, which is exactly the hop.
     *
     * The two differences from the real proxy are worth knowing while
     * developing against it: nothing is stripped (so a dev response carries the
     * ~47% pickle the Function drops), and nothing is rate-limited.
     */
    proxy: {
      '/api/explori/query': {
        target: 'https://225.designorigami.net',
        changeOrigin: true,
        rewrite: () => '/api/query',
      },
      '/api/explori/tiling': {
        target: 'https://225.designorigami.net',
        changeOrigin: true,
        rewrite: (path: string) =>
          `/api/fetch_tiling${path.slice(path.indexOf('?') === -1 ? path.length : path.indexOf('?'))}`,
      },
    },
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  build: {
    // `'hidden'` emits the maps but no `//# sourceMappingURL` comment: the
    // plugin matches them to the bundle by injected debug ID, not by that
    // comment, so the reference would only produce 404s in devtools for files
    // we are about to delete anyway.
    sourcemap: profiling ? true : uploadSourcemaps ? 'hidden' : false,
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
