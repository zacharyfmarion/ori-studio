import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { build as bundle, type Rollup } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import type { ServiceWorkerManifest } from './src/pwa/swRoutes';

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

/**
 * ONNX Runtime's JS entry point — the only one of the three ids below that is a
 * *module* rather than an asset URL, and so the only one the dev-time dependency
 * optimizer has anything to say about. Named because {@link ORT_RUNTIME_IDS} and
 * `optimizeDeps.include` must not be able to drift apart.
 */
const ORT_JS_ENTRY = 'onnxruntime-web/webgpu';

/** Everything `workers/cpDetectWorker.ts` imports from ONNX Runtime. */
const ORT_RUNTIME_IDS = new Set([
  ORT_JS_ENTRY,
  'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url',
  'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url',
]);

const ORT_RUNTIME_STUB = '\0ori-ort-runtime-stub';

/**
 * Keep ONNX Runtime out of builds that cannot reach the CP detector.
 *
 * `cpDetectWorker.ts` gates its ORT `import()` on `isCpDetectBuildEnabled`
 * (`platform/features.ts`): every dev build, and a production build only with
 * `VITE_CP_DETECT=1` at build time — the same switch the "Detect CP from
 * Image..." capability reads. Rollup does tree-shake the JS back out of a
 * production build whose gate is shut. That is not enough on its own, because
 * assets are emitted while the graph is still being *built*:
 * Rollup loads and transforms a module before deciding it is unreachable, and
 * anything `emitFile`d during that transform is written regardless. Two
 * separate things emitted the runtime that way — the worker's own `?url`
 * imports, and `ort.webgpu.bundle.min.mjs`, which carries a
 * `new URL('…asyncify.wasm', import.meta.url)` that Vite rewrites into an
 * emitted asset. Between them production `dist` kept 22.6 MiB that no chunk
 * referenced and no user could ever fetch.
 *
 * Resolving the imports to an inert stub is what actually drops them, and it
 * has to cover the JS entry point as well as the two URLs — stubbing only the
 * URLs leaves ORT's own `new URL` to re-emit the `.wasm`.
 *
 * The stub is in place for exactly the builds whose gate in the worker is
 * shut: `isProduction` is the config-side spelling of `!import.meta.env.DEV`,
 * and `config.env.VITE_CP_DETECT` is the flag as the worker will see it. It
 * used to read `isProduction` alone, from when the detector was dev-only, and
 * the first deploy with the flag on shipped the dialog with a stubbed runtime
 * behind it — "ONNX Runtime is excluded from this build" on the first Detect.
 * `scripts/verify-cp-detect-build.mjs` fails a deploy on that shape now.
 */
function dropUnreachableOrtRuntime(): Plugin {
  let gated = false;
  return {
    name: 'ori-drop-unreachable-ort-runtime',
    // Ahead of `vite:resolve`, which would otherwise resolve these first and
    // emit the assets before this hook ever sees them.
    enforce: 'pre',
    configResolved(config) {
      gated = config.isProduction && config.env.VITE_CP_DETECT !== '1';
    },
    resolveId(source) {
      return gated && ORT_RUNTIME_IDS.has(source) ? ORT_RUNTIME_STUB : null;
    },
    load(id) {
      // Only ever reached if the worker's gate is somehow open in a build that
      // stubbed the runtime, and a rejected `import()` is the honest answer.
      return id === ORT_RUNTIME_STUB
        ? 'throw new Error("ONNX Runtime is excluded from this build");'
        : null;
    },
  };
}

/**
 * Emitted, but never precached: the detector, fetched on the first Detect.
 *
 * `cpDetectWorker` is only instantiated by `store/workspaceStore/cpDetectRuntime.ts`
 * when the user opens the detector, and it is what references the detector
 * wasm (2.3 MB) and, in a build with `VITE_CP_DETECT=1`, ONNX Runtime — the
 * WebGPU entry point and its threaded wasm, 22.6 MiB between them. None of it
 * belongs in a precache that every visitor pays for on their first load; the
 * browser's HTTP cache keeps it after the one Detect that needs it.
 *
 * Unlike the precache patterns these are allowed to match nothing: a build
 * without the flag stubs the runtime and has no ONNX assets to exclude.
 */
const UNCACHEABLE_PATTERNS: readonly RegExp[] = [
  /^assets\/cpDetectWorker-[^/]+\.js$/,
  /^assets\/oristudio_cp_detect_wasm_bg-[^/]+\.wasm$/,
  // `ort.webgpu.bundle.min-*.js`, `ort-wasm-simd-threaded.asyncify-*.{js,mjs,wasm}`.
  /^assets\/ort[.-][^/]+$/,
];

/** Where {@link simPerfLogSink} appends. Gitignored (`artifacts/`). */
const SIM_PERF_LOG = 'artifacts/sim-perf/sim-perf.log';

/**
 * Dev-only sink for the `oristudio:sim-perf` readout.
 *
 * The desktop shell is a WKWebView, and its inspector does not give up console
 * text the way a browser's does — which makes the one build whose numbers matter
 * most the one you cannot get numbers out of. Posting them to the dev server
 * writes them to a file instead, identically from Chrome, Safari and the Tauri
 * window, so runs across engines land in one place and compare directly.
 *
 * `apply: 'serve'` — there is no production counterpart and there should not be
 * one. The body is written verbatim: the client formats, this only appends, and
 * a debug sink must never be able to fail the dev server.
 */
function simPerfLogSink(): Plugin {
  return {
    name: 'ori-sim-perf-log',
    apply: 'serve',
    configureServer(server) {
      const path = resolve(__dirname, '../../', SIM_PERF_LOG);
      server.middlewares.use('/__sim-perf', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
          // A runaway client must not fill the disk.
          if (body.length > 1_000_000) req.destroy();
        });
        req.on('end', () => {
          try {
            mkdirSync(dirname(path), { recursive: true });
            appendFileSync(path, body.endsWith('\n') ? body : `${body}\n`);
          } catch {
            // Nothing to do and nothing worth failing a page load over.
          }
          res.statusCode = 204;
          res.end();
        });
      });
      server.config.logger.info(`  ➜  sim-perf log:  ${SIM_PERF_LOG}`);
    },
  };
}

/**
 * Read the build's own output into the facts `src/pwa/sw.ts` needs.
 *
 * The service worker cannot discover any of this at runtime: the filenames are
 * content-hashed, and which of them a user can actually reach is a build-time
 * decision (see {@link UNCACHEABLE_PATTERNS}).
 */
function serviceWorkerManifest(
  bundleOutput: Rollup.OutputBundle,
  fail: (message: string) => never
): ServiceWorkerManifest & { buildId: string } {
  const assets = Object.keys(bundleOutput)
    .sort()
    .filter((name) => name.startsWith('assets/'));

  const entry = Object.values(bundleOutput).find((file) => file.type === 'chunk' && file.isEntry);
  if (!entry) fail('no entry chunk — the service worker has nothing to gate the shell on');

  const uncacheable = assets
    .filter((name) => UNCACHEABLE_PATTERNS.some((pattern) => pattern.test(name)))
    .map((name) => `/${name}`);

  // Vite builds each `new Worker(new URL(...))` through its own plugin container
  // and `emitFile`s the result, so a worker bundle lands in the output as an
  // `asset` while every chunk Rollup itself produced — entry, dynamic import,
  // shared — is a `chunk`. That distinction is the whole test, and it beats
  // matching `*Worker-*.js`: it keeps holding the day someone names one
  // `cpKernelHost.ts`. Verified against this build — six assets, six workers,
  // and every other `/assets/*.js` a chunk.
  //
  // Empty is a legal answer (an app that spawns no workers has nothing to warm),
  // so this does not fail the build. What would catch a miss is the WebKit lane,
  // which asserts every asset the page loads ends up in the cache.
  const workers = assets
    .filter((name) => name.endsWith('.js') && bundleOutput[name]?.type === 'asset')
    .map((name) => `/${name}`)
    .filter((path) => !uncacheable.includes(path));

  // The engine kernels. Every `.wasm` this build emits, minus the ones no user
  // can reach — which today is exactly the CP detector's, already listed in
  // `uncacheable`. An extension match rather than a name pattern, for the same
  // reason `workers` uses a bundle-type test: `oristudio_bp_wasm_bg-*.wasm` is
  // wasm-bindgen's naming, not ours, and a regex over it stops matching the day
  // the crate is renamed. See invariant 5 in `sw.ts` for why these are warmed.
  const kernels = assets
    .filter((name) => name.endsWith('.wasm'))
    .map((name) => `/${name}`)
    .filter((path) => !uncacheable.includes(path));

  const body = {
    entry: `/${entry.fileName}`,
    assets: assets.map((name) => `/${name}`),
    uncacheable,
    workers,
    kernels,
  };
  return {
    ...body,
    // Provenance for the banner, and nothing else — `sw.ts` never reads it. The
    // first draft put it *in* the manifest and esbuild dead-code-eliminated it,
    // which was the right answer: what makes a new worker install is `sw.js`
    // being byte-different, and the asset list above already changes whenever
    // anything the worker caches does. Hashed here rather than stamped from the
    // commit so a deploy that rebuilt identical output stays identical, instead
    // of running every client through an install-and-wait cycle for nothing.
    buildId: createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 12),
  };
}

/**
 * Emit `dist/sw.js` and `dist/sw-kill.js`.
 *
 * Hand-rolled rather than `vite-plugin-pwa@1.3.0`, which depends on
 * `workbox-build` and its 37 direct dependencies — `@babel/core`,
 * `@babel/preset-env`, `@rollup/plugin-terser` — to solve the one problem this
 * repo does not have. What Workbox is for is not knowing your own output
 * filenames, and `dropUnreachableOrtRuntime` above already decides what ships by
 * reading the graph.
 *
 * The part that mattered more: a service worker's effect on cross-origin
 * isolation is invisible, shows up only on the second load, and can only be
 * checked by *reading* the worker. Workbox's precaching would most likely have
 * preserved it — it does `cache.put` the network response — but "most likely" is
 * the wrong confidence for a silent failure, in a generated file nobody opens.
 *
 * Bundled as a classic (IIFE) script even though WebKit 26.4 accepts
 * `{ type: 'module' }` — measured. Vite inlines the imports either way, so
 * classic costs nothing and removes a compatibility variable on a target that is
 * whatever iPadOS the user happens to be on.
 */
function oriServiceWorker(): Plugin {
  let manifest: ReturnType<typeof serviceWorkerManifest> | null = null;
  let outDir = '';

  return {
    name: 'ori-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundleOutput) {
      manifest = serviceWorkerManifest(bundleOutput, (message) => this.error(message));
    },
    async closeBundle() {
      if (!manifest) return;
      const { buildId, ...runtimeManifest } = manifest;
      for (const [entry, fileName] of [
        ['src/pwa/sw.ts', 'sw.js'],
        ['src/pwa/swKill.ts', 'sw-kill.js'],
      ]) {
        const output = await bundle({
          configFile: false,
          logLevel: 'warn',
          define: { __ORI_SW_MANIFEST__: JSON.stringify(runtimeManifest) },
          build: {
            write: false,
            // Left readable on purpose. It is a few kilobytes either way, and it
            // is the one script in the build whose behaviour cannot be observed
            // from the page — the first thing anyone debugging a stale-cache
            // report will do is open it. esbuild drops the comments even so,
            // hence the banner pointing at the source that still has them.
            minify: false,
            target: 'es2022',
            lib: { entry: resolve(__dirname, entry), formats: ['iife'], name: 'oriServiceWorker' },
          },
        });
        // `build()` widens to include the watcher it cannot return here.
        const built = Array.isArray(output) ? output[0] : output;
        if (!('output' in built)) this.error(`${entry} produced a watcher, not a build`);
        const chunk = built.output[0];
        if (chunk.type !== 'chunk') this.error(`${entry} produced no code`);
        // Prepended here rather than through `rollupOptions.output.banner`,
        // which lib mode overrides with its own output config and silently drops.
        const banner = `// Generated from apps/web/${entry} — do not edit. Build ${buildId}.\n`;
        writeFileSync(resolve(outDir, fileName), banner + chunk.code);
      }
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
    oriServiceWorker(),
    simPerfLogSink(),
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
  /**
   * Pre-bundle ONNX Runtime at dev-server start instead of the first time the
   * detector runs.
   *
   * Dev-only, and purely cosmetic — but the cosmetic failure is bad: opening
   * "Detect CP from Image…" turned the page white and reloaded it, which reads
   * as a crash rather than as a build step. What actually happened is in the dev
   * server log:
   *
   *     ✨ new dependencies optimized: onnxruntime-web/webgpu
   *     ✨ optimized dependencies changed. reloading
   *
   * Vite's dependency *scanner* is what missed it, and the reason is worth
   * knowing before adding anything else to this list. The scanner walks the
   * module graph from the HTML entry, following both static and dynamic
   * `import()`s — it finds `@tauri-apps/plugin-updater` and the rest of the lazy
   * platform imports perfectly well (verified: a forced re-optimize from a cold
   * cache lists all four). What it cannot follow is `new Worker(new URL(…))`,
   * which is a constructor call and not an import, so nothing inside
   * `src/workers/` is ever scanned. ORT is imported *there*, and only there.
   *
   * So the rule this entry stands for is narrower than "lazy deps go here": it
   * is **bare specifiers imported by a worker**. Of those there are exactly two
   * — this and `comlink` — and `comlink` is also imported from `engines/`, on
   * the main graph, so the scanner already has it. Adding deps the scanner
   * finds on its own would only cost cold-start time.
   *
   * The pre-bundle itself is close to free — measured at ~1.45s for the whole
   * dependency set with or without it, because ORT ships pre-built ESM and the
   * 129 MB it occupies in `node_modules` is nearly all `.wasm`, which is an
   * asset and not a dep. What lands in `.vite/deps` is 157 KB of glue.
   *
   * Dev-only by construction: `optimizeDeps` is the dev server's, and the
   * production build still stubs this same id out through
   * {@link dropUnreachableOrtRuntime}.
   */
  optimizeDeps: {
    include: [ORT_JS_ENTRY],
  },
  // `cpDetectWorker.ts` is a worker, and Vite builds workers through their own
  // plugin container seeded from `worker.plugins` alone — a plugin registered
  // above never sees a worker's imports. This is where the ORT stub has to be.
  worker: {
    // Every `new Worker` in the app passes `type: 'module'`, so this only makes
    // the output match how it is loaded — but it is also load-bearing. Vite
    // defaults to `'iife'`, which cannot code-split, and `cpDetectWorker.ts`
    // splits the moment its ORT `import()` is reachable. Under the default the
    // build fails with "UMD and IIFE output formats are not supported for
    // code-splitting builds", and only in the build that un-gates the detector
    // — which is the one build nobody runs until they need it to work.
    format: 'es',
    plugins: () => [dropUnreachableOrtRuntime()],
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
