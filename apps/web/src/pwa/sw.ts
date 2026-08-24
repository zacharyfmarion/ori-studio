/**
 * The Ori Studio service worker. Bundled to `dist/sw.js` by `oriServiceWorker()`
 * in `vite.config.ts`, which is also where its manifest is injected.
 *
 * This file is wiring. Every decision it makes is in `swRoutes.ts`, which is
 * pure and has tests; what is here is the `Cache` plumbing those decisions drive,
 * plus the two invariants below, which are the reason the worker is hand-written
 * rather than generated.
 *
 * ## 1. Never build a `Response`
 *
 * The document's cross-origin isolation is decided by the headers on whatever
 * `Response` object reaches `respondWith` — HTML's *obtain an embedder policy*
 * reads `Cross-Origin-Embedder-Policy` off the response's header list and does
 * not care whether it came from the network or from here. So a
 * `new Response(body)` silently drops `COOP`/`COEP`, and with them
 * `SharedArrayBuffer` — which is the channel `lib/foldCancellation.ts` uses to
 * stop a running fold. Nothing throws; the Stop button just reports itself
 * unavailable.
 *
 * Measured, in Playwright WebKit 26.4 and Chromium 148, against a page served
 * with both headers:
 *
 * | worker returns                        | 1st load | 2nd load |
 * | ------------------------------------- | -------- | -------- |
 * | the cached `Response` untouched       | isolated | isolated |
 * | `new Response(body, {headers})`       | isolated | isolated |
 * | `new Response(body)`                  | isolated | **not**  |
 *
 * Note the second column. The first load is still isolated because the cache was
 * empty and the network response passed through — so a smoke test that loads
 * once and reloads once passes. `scripts/webkit-pwa-check.mjs` asserts on the
 * *second* load for exactly this reason.
 *
 * Cache Storage preserves both headers verbatim, so replaying a hit as-is is
 * safe. This file therefore only ever returns a `Response` it got from `fetch`
 * or from `Cache.match`, and constructs none.
 *
 * ## 2. One cache, pruned by manifest — not a cache per build
 *
 * Cloudflare Pages deploys on every merge, and `/assets/` names are content
 * hashed, so entries from two builds can never collide. Keying the cache on the
 * build id would therefore re-download every unchanged byte — including the
 * 2.2 MB CP kernel, which changes rarely — on every deploy. Instead there is one
 * cache, and `activate` deletes the `/assets/` entries this build did not emit.
 *
 * ## 3. Nothing is precached on install
 *
 * This started as an install-time precache of the editor's cold-start set, which
 * is what every guide to writing one of these says to do. Measured against the
 * real build, in both engines, counting requests the server actually received on
 * a first visit:
 *
 * | engine   | bytes re-downloaded by the precache |
 * | -------- | ----------------------------------- |
 * | Chromium | 0                                   |
 * | WebKit   | **5.83 MB** (every entry, twice)    |
 *
 * A service-worker `fetch()` in WebKit 26.4 does not read the page's HTTP cache,
 * so `install` refetched the entry chunk, the CSS, the CP worker and the 2.2 MB
 * CP kernel that the page had just downloaded — and delaying the install by six
 * seconds changed nothing, so it is not a race. Chromium serves all of it from
 * the HTTP cache and pays nothing.
 *
 * Which puts the whole cost on the platform this exists for: a tablet, often on
 * cellular. And it bought nothing — a first visit registers on `load`, so the
 * page has already fetched everything by the time the worker can claim it, and
 * the precached subset was never enough to boot offline on its own anyway.
 * Everything the app touches is cached by the first *controlled* load instead,
 * for free, because those responses were being fetched regardless.
 *
 * The practical shape: install, launch once online, offline works from then on.
 * For a home-screen app the launch after installing is that load.
 *
 * ## 4. Except the worker scripts, which are warmed on a load this worker serves
 *
 * Invariant 3 rests on "the page fetches it, so we see it and store it", and
 * there is exactly one thing a controlled page fetches that this worker never
 * sees: the script passed to `new Worker()`. Measured on the reload that fills
 * the cache — WebKit answers that one request out of the web process's own
 * in-memory resource cache, with no network request and **no `fetch` event**,
 * while every other asset on the same load goes through here and is stored. The
 * result was a cache holding all seventeen entries the page needs bar one.
 *
 * That one is `oristudioCpWorker`, which is the editor. Offline start then does
 * something worse than fail: `shellFirst` finds the shell and the entry chunk
 * cached, serves them, React renders — and the CP worker cannot be constructed.
 * A dead editor, rather than the browser's offline page. Reproduced by launching
 * offline in a *fresh* page, which is what a relaunch is and what the in-process
 * cache above does not survive: shell renders, `#root` fills, the request for
 * `/assets/oristudioCpWorker-*.js` fails, no canvas.
 *
 * So `manifest.workers` is fetched and stored here instead. Three things keep
 * that from being the precache invariant 3 removed:
 *
 * - **It is triggered by a navigation this worker handled**, which a first visit
 *   does not have — the page was uncontrolled when it navigated, and registers
 *   only on `load`. Measured against this build, warm on and warm off: a first
 *   visit is byte-identical either way, 7 asset requests and 7,138,573 B with
 *   nothing fetched twice. The cost lands on the second load — 7,099,526 B →
 *   7,287,280 B, **+187,754 B**, which is the five files exactly.
 * - **That is 2.6% of the load it lands on**, against 5.83 MB for the precache,
 *   and unlike the precache it is the only way those bytes reach the cache at all.
 * - **It is sequential**, so it takes one connection at a time from a page that
 *   is still loading rather than five.
 *
 * All five, not the two `/edit` happens to construct: a warm that covered only
 * the editor would leave the Design and Simulate workspaces failing offline in
 * exactly the way described above. Which worker scripts exist is a build fact;
 * which ones a given route constructs is a runtime accident that changes the
 * next time someone moves an import.
 *
 * A fresh page *does* reach this worker for a worker script — that is how the
 * failure above was reproduced — so a later online relaunch would eventually
 * store it unprompted. That is not a guarantee worth resting offline start on:
 * it needs a relaunch, while online, before the first launch without a network.
 *
 * ## 5. And the engine kernels, on the page's say-so
 *
 * Invariant 3 also rests on "the page fetches it", and one class of asset is
 * fetched only if the session happened to *use* that engine: the wasm kernels.
 * `initEngine` pulls the CP and TreeMaker bridges at boot, so any session that
 * reached a workspace caches those two. The box-pleat kernel is fetched when the
 * first BP document is created, and the detector's not at all.
 *
 * So an installed app whose only online session opened the Edit canvas has a
 * cache with every kernel it will need bar box-pleat — and offline, choosing
 * "Box-pleated" hits a `cacheFirst` miss and a `fetch` that cannot resolve.
 * Reported from a real device, and it is the same shape as invariant 4: an
 * offline app that boots and then cannot do one specific thing.
 *
 * Warmed on a **message from the page**, not from the `fetch` handler like the
 * worker scripts. The trigger has to be different because the cost is: these are
 * megabytes, and two of the three are ones the page itself is fetching on the
 * same load. Warming them from a navigation would race the page for the CP
 * kernel — `cache.match` only sees a response once it has been stored — and
 * double-download 2.1 MB to save nothing. The page asks when it is idle instead
 * (see `register.ts`), by which time its own fetches have landed and this
 * reduces to the one kernel nobody asked for.
 */

import {
  isShellResponse,
  isStorableResponse,
  routeRequest,
  shellEntryPath,
  WARM_KERNELS,
  type ServiceWorkerManifest,
} from './swRoutes';

/** Injected by `oriServiceWorker()` at build time. */
declare const __ORI_SW_MANIFEST__: ServiceWorkerManifest;

/**
 * The service-worker globals this file touches.
 *
 * Declared here rather than pulled in from `lib.webworker.d.ts`: that lib
 * redeclares `self`, `caches`, `fetch` and friends with worker types, and adding
 * it to a project whose `lib` includes `DOM` makes every one of them a duplicate
 * identifier. Everything else the worker uses — `Cache`, `Request`, `Response`,
 * `URL` — is in the DOM lib already and identical in both.
 */
interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
}

interface MessageEventLike extends ExtendableEventLike {
  readonly data: unknown;
}

interface ServiceWorkerGlobalScopeLike {
  readonly clients: { claim(): Promise<void> };
  readonly location: Location;
  addEventListener(
    type: 'install' | 'activate',
    listener: (event: ExtendableEventLike) => void
  ): void;
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
}

const worker = self as unknown as ServiceWorkerGlobalScopeLike;

const manifest = __ORI_SW_MANIFEST__;
const uncacheable = new Set(manifest.uncacheable);
const currentAssets = new Set(manifest.assets);

/**
 * Bumped by hand, and only when the *shape* of what is stored changes. The build
 * id deliberately does not appear: see invariant 2 above.
 */
const CACHE_NAME = 'oristudio-v1';

/**
 * The offline fallback's key. `/` rather than `/index.html` because Pages
 * redirects the latter, and a redirected response cannot be replayed to a
 * navigation.
 */
const SHELL_KEY = '/';

/** Swallow a cache write. Quota is the caller's problem, not the page's. */
async function put(cache: Cache, key: RequestInfo, response: Response): Promise<void> {
  try {
    await cache.put(key, response);
  } catch {
    // Out of quota, or a response the cache refuses. Either way the network
    // answer already went to the page; there is nothing to recover.
  }
}

/**
 * Fetch and store paths the page will not fetch for us.
 *
 * Sequential, and each entry is checked before it is fetched — so this takes one
 * connection at a time from a page that may still be loading, and a later call
 * over a warm cache reaches the network not at all.
 */
async function storeAll(paths: readonly string[]): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  for (const path of paths) {
    if (await cache.match(path)) continue;
    const response = await fetch(path);
    if (isStorableResponse(response)) await put(cache, path, response);
  }
}

/** One warm per set per worker lifetime, in flight or finished. */
const warming = new Map<string, Promise<void>>();

function warmOnce(key: string, paths: readonly string[]): Promise<void> {
  const existing = warming.get(key);
  if (existing) return existing;
  const started = storeAll(paths).catch(() => {
    // Woke up offline, or a deploy moved these paths mid-flight. Forget the
    // attempt, so the next trigger tries again rather than this worker spending
    // its life believing it has warmed.
    warming.delete(key);
  });
  warming.set(key, started);
  return started;
}

/** Drop `/assets/` entries this build did not emit — i.e. the previous build's. */
async function pruneStaleAssets(): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  await Promise.all(
    keys.map(async (request) => {
      const path = new URL(request.url).pathname;
      if (!path.startsWith('/assets/') || currentAssets.has(path)) return;
      await cache.delete(request);
    })
  );
}

/**
 * Network first, cached shell second.
 *
 * This is what stops a service worker from stranding anyone on an old build. The
 * HTML is fetched fresh on every navigation, so a deploy is picked up on the
 * *first* launch after it, and the new hashed asset URLs it names miss the cache
 * and go to the network by themselves. Pages serves HTML `max-age=0,
 * must-revalidate` with an ETag, so online this is usually a 304.
 */
async function shellFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (isShellResponse(response)) {
      const copy = response.clone();
      void caches.open(CACHE_NAME).then((cache) => put(cache, SHELL_KEY, copy));
    }
    return response;
  } catch (error) {
    const cache = await caches.open(CACHE_NAME);
    const shell = await cache.match(SHELL_KEY);
    // Both, not just the shell. A cache holding `index.html` but not the script
    // it loads — a tab closed halfway through its first controlled load, or a
    // rollback whose assets this worker pruned — would otherwise "work" offline
    // by rendering an empty `<div id="root">` and failing silently. The
    // browser's own offline page is better than that.
    //
    // The entry asked for is the one the *cached shell* names, not this build's:
    // see `shellEntryPath`, and the sequence it was written against. Reading the
    // clone leaves `shell` itself untouched, which invariant 1 requires — what
    // is returned has to be the cached `Response`, headers and all.
    if (shell) {
      const html = await shell.clone().text();
      if (await cache.match(shellEntryPath(html, manifest.entry))) return shell;
    }
    // Rethrow so the browser shows its offline page. A hand-written one would
    // be the `new Response` trap in invariant 1.
    throw error;
  }
}

/** Cache first. Sound only for content-hashed names, which is where it is used. */
async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (isStorableResponse(response)) {
    const copy = response.clone();
    void put(cache, request, copy);
  }
  return response;
}

/**
 * Serve the cached copy, refresh it behind the page. For the unhashed files
 * under `public/` — locales, images, the manifest — where cache-first would
 * pin a translation fix behind a cache nobody can clear.
 */
async function staleWhileRevalidate(event: FetchEventLike): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(event.request);
  const update = fetch(event.request).then(async (response) => {
    if (isStorableResponse(response)) await put(cache, event.request, response.clone());
    return response;
  });
  if (!hit) return update;
  // Legal after the `await`s above: a `FetchEvent` stays active while the
  // promise handed to `respondWith` is pending, and this is that promise.
  event.waitUntil(update.catch(() => undefined));
  return hit;
}

// No `install` listener: there is nothing to do there (invariant 3), and an
// empty one would only suggest otherwise.

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await pruneStaleAssets();
      // Claim the page that registered us, so whatever it fetches from here on
      // — the locale catalogs, a lazily imported chunk — is already cached
      // rather than waiting for the next load. There is deliberately no
      // `skipWaiting()` anywhere in this file: swapping the controller
      // mid-session can hand a running page chunks from a different build, and
      // network-first navigation already means nobody is waiting on it for
      // fresh content.
      await worker.clients.claim();
    })()
  );
});

/**
 * The one message this worker answers: the page reporting that it is idle and
 * the engine kernels can be fetched now. Invariant 5.
 *
 * Everything else is ignored rather than logged — a page can post anything, and
 * an unknown message is not an error worth carrying a branch for.
 */
worker.addEventListener('message', (event) => {
  if ((event.data as { type?: unknown } | null)?.type !== WARM_KERNELS) return;
  event.waitUntil(warmOnce('kernels', manifest.kernels));
});

worker.addEventListener('fetch', (event) => {
  const route = routeRequest(event.request, worker.location.origin, uncacheable);
  switch (route) {
    case 'shell':
      // A navigation reaching here is a load this worker already controls, so
      // it is never the first visit — which is the whole of why warming the
      // worker scripts costs a first visit nothing. Invariant 4.
      event.waitUntil(warmOnce('workers', manifest.workers));
      event.respondWith(shellFirst(event.request));
      return;
    case 'immutable':
      event.respondWith(cacheFirst(event.request));
      return;
    case 'revalidate':
      event.respondWith(staleWhileRevalidate(event));
      return;
    case 'bypass':
      // No `respondWith`: the browser fetches it, exactly as with no worker.
      return;
  }
});
