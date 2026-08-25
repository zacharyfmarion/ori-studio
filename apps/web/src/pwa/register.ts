/**
 * The client half of the PWA: registering the worker, and asking for storage
 * that the browser will not evict.
 *
 * Nothing here is user-visible, deliberately. Navigation is network-first
 * (`sw.ts`), so a deploy is picked up by the next launch on its own and there is
 * no update to prompt about — a toast saying "reload for the new version" on a
 * page that already *is* the new version is worse than silence.
 */

import { isWebRuntime } from '../platform/runtime';
import { WARM_COLD_START } from './swRoutes';

/**
 * The registered script.
 *
 * **This constant is the kill switch.** Point it at `/sw-kill.js` and deploy: a
 * registration whose script URL changes is replaced, and that worker takes over
 * immediately, empties the caches and unregisters itself. That is the whole
 * recovery procedure if the worker ever goes wrong in production — minutes, and
 * no support thread telling people how to clear site data.
 */
const SERVICE_WORKER_URL = '/sw.js';

/** How the app was launched. An analytics super property; see `bootstrap.ts`. */
export type DisplayMode = 'standalone' | 'browser';

interface DisplayModeProbe {
  matchMedia?: (query: string) => { matches: boolean };
  /** `standalone` is Apple's own, and is not in `lib.dom`. */
  navigator?: { standalone?: boolean };
}

/**
 * Whether this is the installed app rather than a browser tab.
 *
 * Both signals are needed. `display-mode: standalone` is the standard one and
 * what Chromium answers; `navigator.standalone` is Apple's, non-standard, and
 * the one iOS has always set for a home-screen web app. Either being true is
 * enough — the question is only "did this come off the home screen", and a false
 * negative would undercount exactly the population this phase exists to measure.
 */
export function getDisplayMode(
  probe: DisplayModeProbe | undefined = typeof window === 'undefined'
    ? undefined
    : (window as unknown as DisplayModeProbe)
): DisplayMode {
  if (!probe) return 'browser';
  if (probe.navigator?.standalone === true) return 'standalone';
  return probe.matchMedia?.('(display-mode: standalone)').matches ? 'standalone' : 'browser';
}

/** Whatever this registration gives us to post to — `active`, or the controller. */
interface MessageTarget {
  postMessage(message: unknown): void;
}

interface RegistrationHost {
  serviceWorker?: {
    register(url: string): Promise<{ active?: MessageTarget | null } | unknown>;
    getRegistrations?(): Promise<readonly { unregister(): Promise<boolean> }[]>;
    ready?: Promise<{ active?: MessageTarget | null }>;
    controller?: MessageTarget | null;
  };
  storage?: { persisted?(): Promise<boolean>; persist?(): Promise<boolean> };
  /** The Network Information API. Absent in Safari, which is fine — see below. */
  connection?: { saveData?: boolean };
}

/**
 * Whether to ask the worker to keep an offline copy of this session.
 *
 * `Save-Data` is the one refusal, and it is the whole condition. It is an
 * explicit statement that bytes cost the user something, and downloading a
 * second copy of an app they may not come back to is exactly what it is for.
 * Nothing breaks — that user gets the behaviour everyone had before this
 * existed, which is an app that works online. Safari does not implement the API,
 * so `connection` is undefined there and the default holds.
 *
 * It used to also require the load to have been *controlled*, to keep a first
 * visit from re-downloading what it had just fetched. That was the wrong call:
 * a first visit is precisely the one with nothing in the cache, so declining
 * there meant an installed app was not offline capable until its second launch —
 * which is the bug this now exists to fix. See invariant 5 in `sw.ts`.
 */
export function shouldWarmColdStart(host: RegistrationHost | undefined): boolean {
  return host?.connection?.saveData !== true;
}

/**
 * What this page loaded, as paths the worker can re-fetch.
 *
 * Resource timing rather than the build manifest, because the manifest is every
 * asset the build emitted and a given route loads a fraction of it. Filtered to
 * `/assets/` here as well as in the worker: the page has no business asking for
 * anything else stored cache-first, and sending less is better than sending more
 * and having it rejected.
 */
export function loadedAssetPaths(host: { performance?: Performance } = window): string[] {
  const entries = host.performance?.getEntriesByType?.('resource') ?? [];
  const paths = new Set<string>();
  for (const entry of entries) {
    try {
      const url = new URL(entry.name, window.location.href);
      if (url.origin === window.location.origin && url.pathname.startsWith('/assets/')) {
        paths.add(url.pathname);
      }
    } catch {
      // A resource entry with an unparseable name is not one we can re-fetch.
    }
  }
  return [...paths];
}

/**
 * Ask the worker to store this session's cold-start set, once the page is idle.
 *
 * On idle rather than on `load`, and that is the difference from the
 * install-time precache invariant 3 measured and rejected: the same bytes, but
 * after first paint instead of competing with it. On every visit after the first
 * the worker's per-entry cache check finds everything already stored and this
 * costs nothing.
 *
 * `registration.active` and not `controller`: a first visit is uncontrolled at
 * the moment it registers — the worker claims it a beat later — and a first
 * visit is exactly the one that needs this.
 */
function warmColdStartWhenIdle(host: RegistrationHost, worker: MessageTarget | null): void {
  if (!shouldWarmColdStart(host) || !worker) return;
  const ask = () =>
    worker.postMessage({ type: WARM_COLD_START, paths: loadedAssetPaths() });
  const idle = (window as unknown as { requestIdleCallback?: (fn: () => void) => void })
    .requestIdleCallback;
  // A timeout rather than nothing on Safari, which shipped `requestIdleCallback`
  // only recently: the point is "after the app has settled", and a few seconds
  // is a fair approximation of that on any engine.
  if (idle) idle(ask);
  else window.setTimeout(ask, 5000);
}

/**
 * Whether to register at all.
 *
 * Production-only: in dev, Vite serves unbundled modules whose URLs are not
 * content-hashed, and `dist/sw.js` does not exist to serve. Web-only: the
 * desktop shell loads from a custom protocol with its own asset handler, and has
 * nothing to gain from an HTTP cache layer it does not use.
 */
export function shouldRegisterServiceWorker(
  isProduction: boolean,
  host: RegistrationHost | undefined
): boolean {
  return isProduction && isWebRuntime() && Boolean(host?.serviceWorker);
}

/**
 * Ask for storage the browser will not evict under pressure.
 *
 * Only when installed, and that restraint is the point: Firefox shows a
 * permission prompt for persistent storage, and the current audience is people
 * in a desktop browser tab who did not ask for one. An installed app is a
 * different bargain — someone put it on a home screen, and the caches behind it
 * losing an eviction race is exactly what they would not expect.
 *
 * Home-screen apps on iPadOS are already outside ITP's seven-day
 * script-writable-storage cap, since they run outside Safari with their own
 * day-of-use counter. This is belt and braces on top of that.
 */
async function requestPersistentStorage(host: RegistrationHost): Promise<void> {
  const storage = host.storage;
  if (!storage?.persist || !storage.persisted) return;
  try {
    if (await storage.persisted()) return;
    await storage.persist();
  } catch {
    // Unsupported, or refused. Neither changes what the app can do.
  }
}

/**
 * Register the worker once the page has finished loading.
 *
 * After `load` on purpose: registration competes for the connection with the
 * app's own startup — the entry chunk and a 2.2 MB wasm kernel — and the install
 * it kicks off refetches most of them. First paint is worth more than a few
 * seconds of head start on a cache nobody needs yet.
 */
export function registerServiceWorker(
  host: RegistrationHost | undefined = typeof navigator === 'undefined' ? undefined : navigator,
  isProduction: boolean = import.meta.env.PROD
): void {
  if (!shouldRegisterServiceWorker(isProduction, host) || !host?.serviceWorker) {
    // A registration outlives the build that made it, and scope is per origin —
    // so anyone who serves `dist` on the port they later run `vite dev` on gets
    // a worker they never registered, quietly holding the previous build's
    // hashed assets and revalidating `/locales` from cache. Dev has no worker to
    // want, so the honest thing is to take it away.
    if (!isProduction) void host?.serviceWorker?.getRegistrations?.().then((all) =>
      Promise.all(all.map((registration) => registration.unregister()))
    ).catch(() => undefined);
    return;
  }

  const start = () => {
    void host.serviceWorker
      ?.register(SERVICE_WORKER_URL)
      .then((registration) => {
        // `active`, falling back to the controller. A registration that has just
        // been created is `installing`, not `active`, so the fallback is what a
        // *first* visit lands on once `activate` has claimed it — and a first
        // visit is the one with an empty cache. `ready` resolves on both.
        const activated = (registration as { active?: MessageTarget | null } | undefined)?.active;
        const target = activated ?? host.serviceWorker?.controller ?? null;
        if (target) warmColdStartWhenIdle(host, target);
        else {
          void host.serviceWorker?.ready
            ?.then((ready) => warmColdStartWhenIdle(host, ready.active ?? null))
            .catch(() => undefined);
        }
        if (getDisplayMode() === 'standalone') return requestPersistentStorage(host);
        return undefined;
      })
      .catch((error: unknown) => {
        // Private browsing, a disabled worker, or a bad deploy. The app works
        // without one, so this is diagnostic only.
        if (import.meta.env.DEV) console.info('[pwa] service worker not registered:', error);
      });
  };

  if (typeof window === 'undefined') return;
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
