/**
 * Which caching strategy a request gets — the whole of the service worker's
 * policy, as a pure function, so it is unit-testable without a worker.
 *
 * The default is {@link ServiceWorkerRoute.bypass}: anything this module does not
 * recognize is left to the network exactly as it behaves with no service worker
 * at all. That direction matters more than the coverage. An asset we forget to
 * cache costs a round trip; an asset we cache by accident is a support thread.
 */

/** What `sw.ts` does with a request. */
export type ServiceWorkerRoute =
  /** Don't call `respondWith` — the browser fetches it itself. */
  | 'bypass'
  /** Network first, falling back to the cached app shell. */
  | 'shell'
  /** Cache first. Only for content-hashed names, which cannot go stale. */
  | 'immutable'
  /** Serve the cached copy, refresh it in the background. */
  | 'revalidate';

/** The fields {@link routeRequest} reads off a `Request`. */
export interface RoutedRequest {
  readonly url: string;
  readonly method: string;
  /** A `RequestMode`; only `'navigate'` is distinguished. */
  readonly mode: string;
}

/**
 * The build-time facts the worker needs, injected by `oriServiceWorker()` in
 * `vite.config.ts`. Nothing here is discoverable at runtime: the filenames are
 * content-hashed, and which of them are reachable is a build decision.
 */
export interface ServiceWorkerManifest {
  /**
   * This build's entry chunk. Not to precache — only as the fallback for
   * {@link shellEntryPath}, which prefers the entry the cached shell actually
   * names.
   */
  readonly entry: string;
  /** Every `/assets/` path this build emitted. Anything else there is last build's. */
  readonly assets: readonly string[];
  /** Emitted but unreachable in production (the CP detector). Never cached. */
  readonly uncacheable: readonly string[];
  /**
   * The reachable `new Worker()` scripts — the one part of the cold-start set
   * the worker cannot cache by watching what the page asks for, because WebKit
   * answers these without asking it. Warmed instead; see invariant 4 in `sw.ts`.
   */
  readonly workers: readonly string[];
}

/**
 * Served by Pages Functions, not by the asset handler. `/s` is the share route
 * (`functions/s/[[shareId]].ts`), which does a KV read and rewrites `index.html`
 * with the share payload and its OpenGraph tags — answering it from a cached
 * shell would render an empty editor and lose the pattern. `/api` is the share
 * and ExplOri API, including POSTs.
 */
const FUNCTION_PATHS = ['/api', '/s'];

/** Content-hashed build output. Immutable by construction. */
const ASSET_PREFIX = '/assets/';

/**
 * Static files under `public/`, which are *not* content-hashed — so they are
 * served stale-while-revalidate rather than cache-first, and a change to one
 * reaches the user on the load after the one that fetched it.
 */
const REVALIDATE_PREFIXES = ['/icons/', '/landing/', '/locales/', '/start/'];
const REVALIDATE_PATHS = ['/favicon.png', '/manifest.webmanifest', '/og-default.png'];

function isUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/**
 * Decide how to serve one request.
 *
 * `uncacheable` is the manifest's list rather than a name pattern because the
 * files it names are content-hashed: `cpDetectWorker-104q6JuY.js` and its 2.3 MB
 * wasm ship in every production build and no user can reach them — the feature
 * is behind `import.meta.env.DEV`. Precaching them would be pure waste, and a
 * regex over `cpDetect` would silently stop matching the day a chunk is renamed.
 */
export function routeRequest(
  request: RoutedRequest,
  scopeOrigin: string,
  uncacheable: ReadonlySet<string>
): ServiceWorkerRoute {
  // `cache.put` rejects a non-GET request, and a cross-origin response would
  // have to clear COEP's resource-policy check to be replayable at all.
  if (request.method !== 'GET') return 'bypass';

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return 'bypass';
  }
  if (url.origin !== scopeOrigin) return 'bypass';

  const path = url.pathname;
  if (FUNCTION_PATHS.some((base) => isUnder(path, base))) return 'bypass';

  if (request.mode === 'navigate') return 'shell';

  if (path.startsWith(ASSET_PREFIX)) {
    return uncacheable.has(path) ? 'bypass' : 'immutable';
  }

  if (REVALIDATE_PATHS.includes(path)) return 'revalidate';
  if (REVALIDATE_PREFIXES.some((prefix) => path.startsWith(prefix))) return 'revalidate';

  return 'bypass';
}

/**
 * Whether a response may be stored — and, for the shell, replayed to a
 * navigation.
 *
 * `redirected` is the one that is easy to miss and expensive to debug: replaying
 * a redirected response to a navigation throws, so a redirect that slipped into
 * the cache would break offline start rather than merely miss.
 */
export function isStorableResponse(response: Response): boolean {
  return response.status === 200 && response.type === 'basic' && !response.redirected;
}

/**
 * The entry script a cached shell loads, read out of the shell's own HTML.
 *
 * **Not `ServiceWorkerManifest.entry`.** Navigation is network first, so the
 * cached shell is refreshed the moment a deploy lands, while the worker keeps
 * waiting until every tab closes — after any deploy those two are different
 * builds, by construction. Checking the worker's own entry therefore checks a
 * file the shell does not load, and passes on it, which is exactly the failure
 * the check exists to stop: an offline start that serves the shell and renders
 * an empty `<div id="root">`. Reproduced against the real build in WebKit before
 * this existed.
 *
 * `index.html` carries one module script and Vite writes it as a plain
 * `src="/assets/…"`, so a regex is the whole of it. A shell that matches nothing
 * falls back to the manifest, i.e. to the old behaviour rather than to no
 * offline start at all.
 */
export function shellEntryPath(html: string, fallback: string): string {
  return /<script[^>]*\ssrc="(\/assets\/[^"]+\.js)"/.exec(html)?.[1] ?? fallback;
}

/**
 * Whether a navigation response is the SPA shell, and so worth keeping as the
 * offline fallback.
 *
 * Every in-scope path answers with `index.html` — Pages has no `404.html`, by
 * design (see `public/_headers`) — but a *direct* navigation to an asset URL is
 * still a navigation, and storing that PNG as the shell would replace the app
 * with a picture the next time the network was gone.
 */
export function isShellResponse(response: Response): boolean {
  return (
    isStorableResponse(response) &&
    (response.headers.get('Content-Type') ?? '').includes('text/html')
  );
}
