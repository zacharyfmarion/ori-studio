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
import { WARM_KERNELS } from './swRoutes';

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

interface RegistrationHost {
  serviceWorker?: {
    register(url: string): Promise<unknown>;
    getRegistrations?(): Promise<readonly { unregister(): Promise<boolean> }[]>;
    controller?: { postMessage(message: unknown): void } | null;
  };
  storage?: { persisted?(): Promise<boolean>; persist?(): Promise<boolean> };
  /** The Network Information API. Absent in Safari, which is fine — see below. */
  connection?: { saveData?: boolean };
}

/**
 * Whether to ask the worker to fetch the engine kernels it has not seen.
 *
 * Two conditions, and the first one is the expensive lesson.
 *
 * **The load must already have been controlled** — `controller` read *before*
 * registering, not after. On a first visit the page fetches everything itself
 * over the network while uncontrolled, and only then registers; the worker
 * claims it moments later, so by the time any callback runs `controller` is set
 * and the page looks controlled while holding a cache the worker never saw.
 * Warming there re-downloads what was just fetched: measured by the WebKit lane
 * as **2,240,930 duplicate bytes**, the CP kernel, on a first visit — which is
 * the exact cost invariant 3 in `sw.ts` exists to keep off this platform. Read
 * early, a first visit answers false and pays nothing; the next launch is
 * genuinely controlled and warms then.
 *
 * **And Save-Data is a refusal.** It is an explicit statement that bytes cost
 * the user something, and prefetching a design type they may never open is
 * exactly what it is for. Nothing breaks: the kernel is still fetched on demand,
 * as before this existed. Safari does not implement the API, so `connection` is
 * undefined there and only the first condition applies.
 */
export function shouldWarmKernels(
  host: RegistrationHost | undefined,
  controlledAtLoad: boolean
): boolean {
  return controlledAtLoad && host?.connection?.saveData !== true;
}

/**
 * Ask the controlling worker to fill in the kernels this session did not touch.
 *
 * On idle, which is the reason this lives in the page rather than in the
 * worker's `fetch` handler beside the worker-script warm. Two of the three
 * kernels are ones the page fetches during startup, and the cache only reflects
 * a response once it has been stored — so a warm that started with the
 * navigation would race the page for the CP kernel and fetch it twice even on a
 * controlled load. By the time the browser reports idle, the page's own fetches
 * have landed and `storeAll`'s per-entry cache check skips them, leaving the one
 * kernel nobody asked for.
 */
function warmKernelsWhenIdle(host: RegistrationHost, controlledAtLoad: boolean): void {
  if (!shouldWarmKernels(host, controlledAtLoad)) return;
  const ask = () => host.serviceWorker?.controller?.postMessage({ type: WARM_KERNELS });
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

  // Read now, synchronously, and not inside `start` or the `then` below. This is
  // called during module evaluation — long before `load`, and long before a
  // fresh worker's `clients.claim()` can set it — so it answers "was this
  // *navigation* served by a worker", which is the question. Later it answers
  // "is there a worker now", which on a first visit is true and wrong. See
  // `shouldWarmKernels`.
  const controlledAtLoad = Boolean(host.serviceWorker.controller);

  const start = () => {
    void host.serviceWorker
      ?.register(SERVICE_WORKER_URL)
      .then(() => {
        warmKernelsWhenIdle(host, controlledAtLoad);
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
