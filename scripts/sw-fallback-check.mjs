/**
 * Drive the real service worker (`apps/web/src/pwa/sw.ts`) through the 2026-11-19 incident,
 * in WebKit and Chromium, without building the app.
 *
 * That day a request for a new entry script reached oristudio.dev a second before the file
 * did, and Pages answered with `index.html` at 200 under the one-year header `/assets/*`
 * carries. The worker's cache-first route stored any 200, kept that HTML as the entry and
 * replayed it on every load, so the app stayed blank after the edge was purged.
 *
 * The predicates that now prevent it (`isStorableSubresource`, `isHtmlResponse`) have unit
 * tests; their call sites in sw.ts do not. Undo one there (`cache.match` back in
 * `cacheFirst`, `isStorableResponse` back in a store) and the incident is back with every
 * unit test green. `webkit-pwa-check.mjs` cannot see it either: it only serves files that
 * exist. So this bundles sw.ts the way the build does (an IIFE with the manifest defined
 * in), serves it with the real `_headers` beside a page whose one module is the entry, and
 * plays the incident:
 *
 * 1. a healthy visit installs the worker;
 * 2. a deploy lands, and its new entry is answered with the fallback, as it was that day:
 *    the worker must not store it;
 * 3. the entry is served: the next visit must run, store the script, and stay
 *    cross-origin isolated. The browser's own HTTP cache may still hold the fallback
 *    under that name for a year, which is what the worker's retry is for;
 * 4. an HTML copy stored by a worker from before the fix must be replaced on one visit;
 * 5. a warm of a path the site no longer serves must store nothing and fetch it once, not
 *    twice: a worker outlives its build, and its warm list then answers with the fallback
 *    on every load.
 *
 * Every visit is a fresh page. Both engines answer a reload of the same page from an
 * in-process cache without asking the worker, so a reload says nothing about it.
 *
 *   node scripts/sw-fallback-check.mjs        # needs no build; ~10 s
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { headersFor, parseHeadersFile } from './lib/pages-headers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_OLD = '/assets/index-OLDBUILD.js';
const ENTRY_NEW = '/assets/index-NEWBUILD.js';
const GONE = '/assets/lazy-GONEBUILD.js';
/** `WARM_COLD_START` in `swRoutes.ts`. Renamed there, check 5 fails rather than passing. */
const WARM_MESSAGE = 'ori:warm-cold-start';
const CACHE_NAME = 'oristudio-v1';
const HTML = 'text/html; charset=utf-8';

async function bundleWorker() {
  const manifest = { entry: ENTRY_NEW, assets: [ENTRY_NEW], uncacheable: [], workers: [], kernels: [], chunks: [] };
  const result = await build({
    entryPoints: [path.join(repoRoot, 'apps/web/src/pwa/sw.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    define: { __ORI_SW_MANIFEST__: JSON.stringify(manifest) },
    logLevel: 'warning',
  });
  return result.outputFiles[0].text;
}

const page = (entry) =>
  `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div>` +
  `<script type="module" src="${entry}"></script>` +
  `<script>navigator.serviceWorker.register('/sw.js')</script></body></html>`;

/**
 * Pages, as far as this needs it: `_headers` by path, the SPA fallback for anything it
 * does not have, and a switch for whether the new entry exists yet.
 */
async function startServer(worker, rules) {
  const state = { entry: ENTRY_OLD, newEntryServed: false, hits: new Map() };
  const sockets = new Set();
  const server = createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    state.hits.set(pathname, (state.hits.get(pathname) ?? 0) + 1);
    const send = (type, cacheControl, body) => {
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cacheControl, ...headersFor(rules, pathname) });
      res.end(body);
    };
    const fallback = () => send(HTML, 'public, max-age=0, must-revalidate', page(state.entry));
    if (pathname === '/sw.js') return send('application/javascript', 'no-cache', worker);
    const isEntry = pathname === ENTRY_OLD || (pathname === ENTRY_NEW && state.newEntryServed);
    if (isEntry) return send('application/javascript', 'public, max-age=14400', `document.getElementById('root').textContent = 'app';`);
    return fallback();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    state,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  };
}

const results = [];
function check(engine, name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${engine}] ${name}${detail ? `  — ${detail}` : ''}`);
}

/** What the worker's cache holds under `pathname`: its content type, or null. */
const stored = (tab, pathname) =>
  tab.evaluate(
    async ([name, key]) => (await (await caches.open(name)).match(key))?.headers.get('Content-Type') ?? null,
    [CACHE_NAME, pathname]
  );

const rendered = (tab) =>
  tab
    .waitForFunction(() => document.getElementById('root')?.textContent === 'app', null, { timeout: 5_000 })
    .then(
      () => true,
      () => false
    );

async function run(engineName, engine, worker, rules) {
  const server = await startServer(worker, rules);
  const browser = await engine.launch();
  const context = await browser.newContext();
  let tab = await context.newPage();
  const visit = async () => {
    await tab.close();
    tab = await context.newPage();
    await tab.goto(server.origin, { waitUntil: 'load' });
  };
  try {
    // 1. A healthy visit, which installs the worker and lets it claim the page.
    await tab.goto(server.origin, { waitUntil: 'load' });
    await tab.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15_000 });
    check(engineName, 'a healthy visit runs and installs the worker', await rendered(tab));

    // 2. A deploy lands, and its new entry is not served yet: Pages' fallback answers.
    server.state.entry = ENTRY_NEW;
    await visit();
    await tab.waitForTimeout(500);
    const duringRace = await stored(tab, ENTRY_NEW);
    check(
      engineName,
      'the fallback answering for the entry is not stored under its name',
      duringRace === null,
      duringRace ? `stored as ${duringRace}` : ''
    );

    // 3. The entry is served now. The HTTP cache may still hold the fallback.
    server.state.newEntryServed = true;
    await visit();
    const recovered = await rendered(tab);
    const afterRecovery = await stored(tab, ENTRY_NEW);
    const isolated = await tab.evaluate(() => crossOriginIsolated && Boolean(navigator.serviceWorker.controller));
    check(engineName, 'the next visit runs once the entry is served', recovered);
    check(
      engineName,
      'and stores the script, not the fallback',
      afterRecovery?.includes('javascript') ?? false,
      String(afterRecovery)
    );
    check(engineName, 'and stays cross-origin isolated under the worker', isolated);

    // 4. An HTML copy left by a worker from before the fix.
    await tab.evaluate(
      async ([name, key]) =>
        (await caches.open(name)).put(key, new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })),
      [CACHE_NAME, ENTRY_NEW]
    );
    await visit();
    const replaced = await rendered(tab);
    const afterReplace = await stored(tab, ENTRY_NEW);
    check(
      engineName,
      'an HTML copy an older worker stored is replaced on one visit',
      replaced && (afterReplace?.includes('javascript') ?? false),
      String(afterReplace)
    );

    // 5. A warm naming a file the site no longer serves.
    await tab.evaluate(
      ([type, paths]) => navigator.serviceWorker.controller.postMessage({ type, paths }),
      [WARM_MESSAGE, [GONE]]
    );
    for (let i = 0; i < 40 && !server.state.hits.get(GONE); i += 1) await tab.waitForTimeout(250);
    await tab.waitForTimeout(1_000);
    const goneHits = server.state.hits.get(GONE) ?? 0;
    const goneStored = await stored(tab, GONE);
    check(
      engineName,
      'a warm stores nothing for a file the site no longer serves, and asks for it once',
      goneHits === 1 && goneStored === null,
      `${goneHits} request(s), stored: ${goneStored}`
    );
  } finally {
    await browser.close();
    await server.close();
  }
}

async function main() {
  const worker = await bundleWorker();
  const rules = parseHeadersFile(await readFile(path.join(repoRoot, 'apps/web/public/_headers'), 'utf8'));
  for (const [name, engine] of [
    ['webkit', webkit],
    ['chromium', chromium],
  ]) {
    await run(name, engine, worker, rules);
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed) process.exit(1);
}

await main().catch((error) => {
  console.error(`\nThe check threw before it finished: ${error?.stack ?? error}`);
  process.exit(1);
});
