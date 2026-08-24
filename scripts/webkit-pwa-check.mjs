/**
 * Drive the built web client through real WebKit and check the PWA holds.
 *
 * The lane exists because iPadOS is the one engine nothing in this repo tests:
 * vitest runs in jsdom, `folded-grid-screenshot.mjs` runs Chromium, and until
 * now a Safari-only regression reached users before it reached CI. Playwright
 * already ships WebKit and is already a devDependency, so the cost is a browser
 * download and about fifteen seconds.
 *
 * **What it is really guarding.** A service worker decides the document's
 * cross-origin isolation, because HTML reads `Cross-Origin-Embedder-Policy` off
 * whatever `Response` reaches `respondWith` and does not care where it came
 * from. Return a `new Response(body)` and `crossOriginIsolated` goes false,
 * `SharedArrayBuffer` disappears, and the Stop button on a running fold reports
 * itself unavailable — with nothing thrown and nothing logged. Measured in both
 * WebKit 26.4 and Chromium 148, and the reason it needs a test rather than
 * review: **the first load still passes.** The cache is empty then, so the
 * network response goes through untouched. It only breaks on the load after.
 *
 * So the assertions below are ordered to reach the cached path deliberately:
 * load, reload, then take the server away and load again. Only the third one
 * is served by the worker from cache, and only it can catch this.
 *
 * The reload in the middle is not padding. Registration happens on `load`, so a
 * first visit has already fetched everything by the time the worker can claim
 * it — the cache fills on the first *controlled* load, which is the second one.
 * That is also the real sequence for the thing this phase ships: visit the site,
 * add it to the home screen, launch it. Going offline after one load would test
 * a state no installed user is ever in.
 *
 * The third load runs in a **page that has never loaded the app**, and that is
 * load-bearing rather than tidiness — see the comment above it. WebKit's
 * in-process resource cache answers some of the app's cold-start set without
 * consulting either the service worker or the network, so an offline start in
 * the page that just filled the cache can pass with entries missing from it.
 * That is not hypothetical: it is how a dead-editor offline start passed this
 * lane for a week.
 *
 *   node scripts/webkit-pwa-check.mjs        # needs apps/web/dist to be built
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(repoRoot, 'apps/web/dist');

/** Marks the share HTML, so an intercepted `/s/` shows up as a missing string. */
const SHARE_MARKER = '<!--ori-share-payload-->';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
};

/**
 * The `_headers` rules, read from the file Cloudflare Pages actually reads.
 *
 * Parsed rather than hardcoded on purpose: COOP/COEP live in
 * `apps/web/public/_headers`, and hardcoding them here would leave the one test
 * that can catch their removal passing after they were removed.
 *
 * Read from `dist/`, not from `public/`, for the same reason. Pages serves the
 * copy in the deployed output; a build that stopped copying it would ship with
 * no isolation at all, and a check reading the source would stay green through
 * it.
 */
function parseHeadersFile(text) {
  const rules = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: [] };
      rules.push(current);
      continue;
    }
    const colon = line.indexOf(':');
    if (colon === -1 || !current) continue;
    current.headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

function headersFor(rules, pathname) {
  const out = {};
  for (const rule of rules) {
    const re = new RegExp(`^${rule.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    if (re.test(pathname)) for (const [key, value] of rule.headers) out[key] = value;
  }
  return out;
}

/**
 * Stand in for Cloudflare Pages: static assets, `_headers`, the SPA fallback,
 * and enough of `functions/s/[[shareId]].ts` to tell an intercepted share from a
 * served one.
 */
async function startServer() {
  const rules = parseHeadersFile(await readFile(path.join(distDir, '_headers'), 'utf8'));
  const sockets = new Set();
  const seen = [];
  /** Response size per path, so a duplicate download can be priced, not just named. */
  const sizes = new Map();

  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(req.url.split('?')[0]);
    seen.push(pathname);
    // `_headers` last: on Pages it overrides the defaults, not the other way round.
    const send = (status, body, extra = {}) => {
      sizes.set(pathname, Buffer.byteLength(body ?? ''));
      res.writeHead(status, { ...extra, ...headersFor(rules, pathname) });
      res.end(req.method === 'HEAD' ? undefined : body);
    };

    // The share route is a Pages Function, so `_headers` does not apply to it —
    // it re-asserts isolation itself. Mirrored here, including that detail.
    if (pathname === '/s' || pathname.startsWith('/s/')) {
      const shell = await readFile(path.join(distDir, 'index.html'), 'utf8');
      send(200, shell.replace('</head>', `${SHARE_MARKER}</head>`), {
        'Content-Type': MIME['.html'],
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      });
      return;
    }

    const file = path.join(distDir, pathname);
    if (!file.startsWith(distDir)) return send(403, 'no');
    if (pathname !== '/' && existsSync(file) && !pathname.endsWith('/')) {
      const body = await readFile(file);
      send(200, body, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        // What Pages serves for hashed assets vs HTML. The worker's whole
        // freshness story rests on the shell not being HTTP-cached.
        'Cache-Control': pathname.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=0, must-revalidate',
      });
      return;
    }

    // Every unmatched path is the SPA shell. Pages has no `404.html`, by design.
    send(200, await readFile(path.join(distDir, 'index.html')), {
      'Content-Type': MIME['.html'],
      'Cache-Control': 'public, max-age=0, must-revalidate',
    });
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    seen,
    sizes,
    /** Hard stop. `close()` alone waits on keep-alive sockets forever. */
    kill: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  };
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/** The three facts a document reports about its own isolation. */
const readIsolation = (page) =>
  page.evaluate(() => ({
    isolated: crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    controlled: Boolean(navigator.serviceWorker.controller),
  }));

const cacheKeys = (page) =>
  page.evaluate(async () =>
    (await (await caches.open('oristudio-v1')).keys()).map((request) => new URL(request.url).pathname)
  );

/**
 * Wait until the server stops being asked for anything.
 *
 * A fixed sleep measures the author's patience rather than the worker's
 * behaviour, and on a check that reports *absence* that is the difference
 * between a result and a coincidence. Measured against this build: a precache
 * moved behind a six-second timer walked straight past a four-second wait and
 * `a first visit downloads nothing twice` reported zero over 2.24 MB of
 * duplicate download. Idle-based, so the window is as long as the visit needs;
 * the floor covers a worker that is quiet for a moment before it starts.
 */
async function settleServer(page, server, { idleMs = 3000, floorMs = 8000, capMs = 25_000 } = {}) {
  const started = Date.now();
  let count = server.seen.length;
  let lastChange = started;
  while (Date.now() - started < capMs) {
    await page.waitForTimeout(250);
    if (server.seen.length !== count) {
      count = server.seen.length;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= idleMs && Date.now() - started >= floorMs) return;
  }
}

/**
 * Wait until the cache stops growing.
 *
 * Killing the server with writes still in flight is the difference between
 * testing offline start and testing a torn cache — and it fails as a
 * hard-to-place burst of load errors rather than as a timeout, so it is worth
 * the few seconds.
 */
async function settleCache(page) {
  let previous = -1;
  for (let i = 0; i < 40; i += 1) {
    const size = (await cacheKeys(page)).length;
    if (size === previous && size > 0) return size;
    previous = size;
    await page.waitForTimeout(500);
  }
  return previous;
}

/**
 * Wait for the kernel warm, which is deliberately late.
 *
 * `settleCache` cannot stand in for it: the warm is scheduled on
 * `requestIdleCallback` with a five-second timer where that is absent, and
 * settling returns as soon as two readings a half-second apart agree — so it
 * reports a quiet cache several seconds before the warm starts. Waited for
 * explicitly, with its own bound.
 */
async function waitForKernels(page, expected) {
  for (let i = 0; i < 40; i += 1) {
    const cached = await cacheKeys(page);
    const found = expected.filter((name) => cached.some((p) => p.includes(name)));
    if (found.length === expected.length) return found.length;
    await page.waitForTimeout(500);
  }
  const cached = await cacheKeys(page);
  return expected.filter((name) => cached.some((p) => p.includes(name))).length;
}

async function main() {
  if (!existsSync(path.join(distDir, 'sw.js'))) {
    console.error('apps/web/dist/sw.js is missing. Run `npm run build:web` first.');
    process.exit(1);
  }

  const server = await startServer();
  const browser = await webkit.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // ---- The manifest, which is what actually makes the install offer appear.
    const manifestResponse = await page.goto(`${server.origin}/manifest.webmanifest`);
    const webManifest = await manifestResponse.json();
    check(
      'web app manifest is installable',
      webManifest.name === 'Ori Studio' &&
        webManifest.display === 'standalone' &&
        webManifest.start_url === '/' &&
        webManifest.icons.some((icon) => icon.sizes === '512x512'),
      `${webManifest.icons.length} icons`
    );
    for (const icon of [...webManifest.icons.map((i) => i.src), '/icons/apple-touch-icon.png']) {
      const res = await page.request.get(`${server.origin}${icon}`);
      check(`icon ${icon} is served`, res.ok(), `${res.status()}`);
    }

    // ---- Cold load. Registration happens on `load`, so everything here has
    // already been fetched by the time the worker exists.
    server.seen.length = 0;
    await page.goto(`${server.origin}/edit`, { waitUntil: 'load' });
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 30_000 });
    const cold = await readIsolation(page);
    check('cold load is cross-origin isolated', cold.isolated && cold.sharedArrayBuffer);
    check('service worker takes control without a reload', cold.controlled);

    // The worker must not make a first visit more expensive than no worker at
    // all. It did, once: an install-time precache refetched every entry it
    // warmed, because a service-worker `fetch()` in WebKit does not read the
    // page's HTTP cache — 5.83 MB of duplicate download on the exact platform
    // this ships for, and none on Chromium, so nothing but this would have
    // noticed. Waited out rather than sampled: the point is that no refetch
    // happens at all, not that none has happened yet.
    //
    // The worker-script warm (invariant 4 in `sw.ts`) is deliberately hung off a
    // navigation this worker served, and a first visit has none — so it belongs
    // to the load after this one and this stays at zero. Priced as well as
    // named, so a regression reports what it costs rather than only that it
    // happened.
    //
    // Over every path the server was asked for, not only `/assets/`. The
    // precache that caused this was all hashed assets, so scoping it there
    // looked equivalent — it is not: refetching the four largest files under
    // `/landing/` costs 1.9 MB on the same first visit and scored zero
    // duplicate bytes. `/locales/` is another 3.7 MB with the same shape.
    //
    // What it still cannot see is an *extra* — a first visit that downloads
    // something once that it never needed. Measured: precaching the 1.93 MB BP
    // kernel, which `/edit` never asks for, passes here and shows up only as a
    // larger path count in the detail. Catching that needs a baseline run with
    // no worker at all to diff against, which is a second cold load this lane
    // has not paid for.
    await settleServer(page, server);
    const requested = [...server.seen];
    const count = (url) => requested.filter((seen) => seen === url).length;
    const repeated = [...new Set(requested)].filter((url) => count(url) > 1);
    const duplicateBytes = repeated.reduce(
      (total, url) => total + (count(url) - 1) * (server.sizes.get(url) ?? 0),
      0
    );
    check(
      'a first visit downloads nothing twice',
      repeated.length === 0,
      repeated.length
        ? `${duplicateBytes} duplicate bytes — ${repeated.join(', ')}`
        : `0 duplicate bytes over ${new Set(requested).size} paths`
    );

    // ---- First controlled load. This is where the cache actually fills.
    await page.reload({ waitUntil: 'load' });
    const warm = await readIsolation(page);
    check('controlled load is cross-origin isolated', warm.isolated && warm.sharedArrayBuffer);
    check(
      'app boots through the worker',
      await page.evaluate(() => !!document.querySelector('#root')?.firstElementChild)
    );

    const settled = await settleCache(page);
    const cached = await cacheKeys(page);
    check(
      'one controlled load caches the shell and the CP kernel',
      cached.includes('/') && cached.some((p) => /oristudio_cp_wasm_bg-.*\.wasm$/.test(p)),
      `${settled} entries`
    );
    check(
      'the dev-gated CP detector is never cached',
      !cached.some((p) => p.includes('cp_detect') || p.includes('cpDetect')),
      '2.3MB that ships and nobody can reach'
    );

    // An engine's wasm is fetched only if the session used that engine, and
    // `initEngine` pulls two of the three at boot. So an installed app whose one
    // online session opened the Edit canvas has every kernel it needs bar
    // box-pleat — and offline, choosing "Box-pleated" hit a cache miss and a
    // fetch that could not resolve, which is a real report from a real device.
    // The page asks for the rest once it is idle (`pwa/register.ts`).
    const kernels = ['oristudio_cp_wasm_bg', 'treemaker_wasm_bg', 'oristudio_bp_wasm_bg'];
    const warmed = await waitForKernels(page, kernels);
    check(
      'an idle controlled load fetches the kernels this session never used',
      warmed === kernels.length,
      `${warmed}/${kernels.length} engine kernels cached`
    );

    // Everything the page loaded has to be in the *worker's* cache, stated
    // directly rather than inferred from the offline phase below. Measured —
    // routing the stylesheet to `bypass`, so the worker stores none of it, left
    // every offline check below green and the page fully styled, because
    // WebKit's own caches covered for it. This is the assertion that does not
    // care which cache answered: it reads what is in Cache Storage.
    const used = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((entry) => new URL(entry.name).pathname)
        .filter((pathname) => pathname.startsWith('/assets/'))
    );
    const uncached = [...new Set(used)].filter((pathname) => !cached.includes(pathname));
    check(
      'every asset the page loaded is in the worker cache',
      used.length > 0 && uncached.length === 0,
      uncached.join(', ') || `${new Set(used).size} requested`
    );

    // What the cache costs on the device, against what the device will give us.
    // Cache Storage holds decoded bytes, so the number here is the raw size, not
    // the gzipped one — the figure worth knowing before asking anyone to install
    // this on a tablet.
    //
    // `navigator.storage` is absent from the Linux WebKit build Playwright ships,
    // and present in the macOS one — so this read threw an uncaught TypeError on
    // CI while passing locally, thirteen checks in. The quota half is therefore
    // best-effort: when the API is missing the cache is measured by summing its
    // own entries, which is the part this check actually exists to assert. Quota
    // headroom is a nice-to-have that only one of the two engines can answer.
    const storage = await page.evaluate(async () => {
      const estimate =
        typeof navigator.storage?.estimate === 'function'
          ? await navigator.storage.estimate()
          : null;
      let usage = estimate?.usage ?? 0;
      if (estimate === null) {
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const request of await cache.keys()) {
            const response = await cache.match(request);
            if (response) usage += (await response.clone().blob()).size;
          }
        }
      }
      return {
        usage,
        quota: estimate?.quota ?? null,
        persisted:
          typeof navigator.storage?.persisted === 'function'
            ? await navigator.storage.persisted()
            : null,
      };
    });
    check(
      'the cache is real, measurable, and small against quota',
      storage.usage > 2_000_000 && (storage.quota === null || storage.usage < storage.quota / 10),
      `${(storage.usage / 1e6).toFixed(1)} MB used of ` +
        (storage.quota === null
          ? 'an unreported quota (no navigator.storage on this engine)'
          : `${Math.round(storage.quota / 1e6)} MB quota`) +
        `, persisted=${storage.persisted}`
    );

    // ---- The share route is a Pages Function, and the worker must leave it
    // alone. Online that is hard to see directly — network-first would fetch the
    // right bytes even while intercepting — so the tell is the side effect: a
    // `/s/` navigation the worker handled is HTML, and would be stored as the
    // offline shell. Then every offline start would open somebody's shared
    // pattern instead of the editor.
    const beforeShare = server.seen.length;
    await page.goto(`${server.origin}/s/probe-after-install`, { waitUntil: 'load' });
    check(
      'share route reaches the server',
      (await page.content()).includes(SHARE_MARKER) &&
        server.seen.slice(beforeShare).includes('/s/probe-after-install')
    );
    check(
      'a share page never becomes the cached shell',
      await page.evaluate(async (marker) => {
        const hit = await (await caches.open('oristudio-v1')).match('/');
        return hit ? !(await hit.text()).includes(marker) : true;
      }, SHARE_MARKER)
    );
    const share = await readIsolation(page);
    check('share route is cross-origin isolated', share.isolated && share.sharedArrayBuffer);

    // ---- Offline. This is the only path served from the cache, and so the only
    // one that can catch a worker that rebuilt the response instead of replaying it.
    await page.goto(`${server.origin}/edit`, { waitUntil: 'load' });
    await settleCache(page);
    await server.kill();

    // In a page that has never loaded this app, and that is the load-bearing
    // part. WebKit keeps a resource cache in the web process, and it answers
    // `new Worker()` without asking the service worker or the network — so going
    // offline in the page that just filled the cache tests that cache, not ours.
    // Measured, against a build whose worker never stored the CP worker script:
    // offline in the same page rendered a canvas and logged nothing, and offline
    // in a fresh page rendered the shell, failed on
    // `/assets/oristudioCpWorker-*.js`, and produced no canvas at all. A real
    // relaunch is the fresh page — which is also, exactly, a home-screen launch.
    const relaunch = await context.newPage();
    const offlineErrors = [];
    relaunch.on('console', (message) => {
      if (message.type() === 'error') offlineErrors.push(message.text());
    });
    // Caught rather than awaited bare: a worker that cannot serve the shell
    // rejects the navigation, and an uncaught rejection here would report the
    // regression as a stack trace and skip the four checks after it.
    let offlineStart = '';
    await relaunch
      .goto(`${server.origin}/edit`, { waitUntil: 'load' })
      .catch((error) => (offlineStart = String(error.message).split('\n')[0]));
    check('offline start answers the navigation', offlineStart === '', offlineStart);
    const offline = offlineStart
      ? { isolated: false, sharedArrayBuffer: false }
      : await readIsolation(relaunch);
    check(
      'offline start is STILL cross-origin isolated',
      offline.isolated && offline.sharedArrayBuffer,
      'the cached shell must be replayed, never rebuilt'
    );
    // A canvas means the CP kernel booted from cache — the app, not a shell.
    await relaunch.waitForSelector('canvas', { timeout: 20_000 }).catch(() => {});
    check(
      'offline start runs the editor, not just the shell',
      await relaunch.evaluate(() => !!document.querySelector('canvas'))
    );
    check(
      'offline start loads every resource it asks for',
      offlineErrors.length === 0,
      offlineErrors.slice(0, 3).join(' | ')
    );

    // A share link inherently needs the KV read, so offline it has to fail.
    // Anything the worker could serve here would be a lie — the editor, empty,
    // where the person expected a pattern.
    let shareOffline = 'served';
    await relaunch.goto(`${server.origin}/s/probe-offline`, { waitUntil: 'load' }).catch(() => {
      shareOffline = 'failed';
    });
    check('offline share link fails rather than faking an empty editor', shareOffline === 'failed');
  } finally {
    await browser.close();
    await server.kill().catch(() => {});
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

/**
 * A throw is a failed lane, not a crashed one.
 *
 * Without this an unexpected error exits on an uncaught exception, which reports
 * a stack trace and *nothing about the checks* — including how many never ran.
 * That is how a missing `navigator.storage` on the Linux WebKit build read as
 * "the PWA check is broken" when what it meant was "check 14 of 22 hit an API
 * this engine does not have, and 15 through 22 were never attempted".
 *
 * Same exit code either way, so CI is no less strict; the difference is entirely
 * in what the log says happened.
 */
await main().catch((error) => {
  console.error(`\nThe lane threw before it finished: ${error?.stack ?? error}`);
  console.error(
    'Checks after this point did not run. If this is an API the engine lacks, ' +
      'guard the read rather than deleting the check.'
  );
  process.exit(1);
});
