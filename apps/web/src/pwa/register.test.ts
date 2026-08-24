import { describe, expect, it, vi } from 'vitest';
import {
  getDisplayMode,
  registerServiceWorker,
  shouldRegisterServiceWorker,
  shouldWarmKernels,
} from './register';
import { WARM_KERNELS } from './swRoutes';

const HOST = { serviceWorker: { register: async () => undefined } };

describe('shouldRegisterServiceWorker', () => {
  it('registers on a production web build', () => {
    expect(shouldRegisterServiceWorker(true, HOST)).toBe(true);
  });

  // Dev serves unbundled modules at URLs that carry no content hash, and there
  // is no `dist/sw.js` to serve in the first place.
  it('does not register in dev', () => {
    expect(shouldRegisterServiceWorker(false, HOST)).toBe(false);
  });

  it('does not register without browser support', () => {
    expect(shouldRegisterServiceWorker(true, {})).toBe(false);
    expect(shouldRegisterServiceWorker(true, undefined)).toBe(false);
  });

  it('does not register inside the desktop shell', () => {
    const tauri = globalThis as unknown as Record<string, unknown>;
    tauri.__TAURI_INTERNALS__ = {};
    try {
      expect(shouldRegisterServiceWorker(true, HOST)).toBe(false);
    } finally {
      delete tauri.__TAURI_INTERNALS__;
    }
  });
});

describe('registerServiceWorker', () => {
  function devHost() {
    const unregister = vi.fn(async () => true);
    return {
      unregister,
      host: {
        serviceWorker: {
          register: vi.fn(async () => undefined),
          getRegistrations: vi.fn(async () => [{ unregister }]),
        },
      },
    };
  }

  // A registration outlives the build that made it and is scoped to the origin,
  // so serving `dist` on the port you later run `vite dev` on leaves a worker
  // nobody registered holding the previous build's assets.
  it('clears a leftover registration when running in dev', async () => {
    const { host, unregister } = devHost();
    registerServiceWorker(host, false);
    await vi.waitFor(() => expect(unregister).toHaveBeenCalled());
    expect(host.serviceWorker.register).not.toHaveBeenCalled();
  });

  it('registers instead of unregistering in production', async () => {
    const { host, unregister } = devHost();
    registerServiceWorker(host, true);
    await vi.waitFor(() => expect(host.serviceWorker.register).toHaveBeenCalledWith('/sw.js'));
    expect(unregister).not.toHaveBeenCalled();
  });

  /**
   * The engine kernels are fetched only if a session used that engine, so an
   * installed app whose one online session opened the Edit canvas has every
   * kernel it needs bar box-pleat — and offline, choosing it fails. The page
   * asks the worker to fill the gap once it is idle; the worker cannot decide
   * this for itself, because two of the three kernels are ones the page is
   * fetching on the same load and a warm from the `fetch` handler would race it.
   */
  it('asks the worker to warm the kernels once idle', async () => {
    // jsdom has no `requestIdleCallback`, and the production fallback is a five
    // second timer — so the idle hook is stubbed rather than waited out. Which
    // hook fires is not the subject; that the message is sent from one is.
    vi.stubGlobal('requestIdleCallback', (fn: () => void) => {
      fn();
      return 1;
    });
    try {
      const postMessage = vi.fn();
      const { host } = devHost();
      const withController = {
        ...host,
        serviceWorker: { ...host.serviceWorker, controller: { postMessage } },
      };

      registerServiceWorker(withController, true);

      await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: WARM_KERNELS }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not warm on a first visit, which was never controlled', async () => {
    // The expensive case. A first visit fetches everything itself over the
    // network and only then registers; the worker claims it moments later, so a
    // late `controller` read says "controlled" while the cache holds nothing the
    // page loaded. Warming there re-downloads it — the WebKit lane measured
    // 2,240,930 duplicate bytes, the CP kernel, before this was read early.
    vi.stubGlobal('requestIdleCallback', (fn: () => void) => {
      fn();
      return 1;
    });
    try {
      const postMessage = vi.fn();
      const { host } = devHost();
      const claimedLater = {
        ...host,
        serviceWorker: {
          ...host.serviceWorker,
          // Absent when `registerServiceWorker` reads it, present afterwards —
          // which is exactly what `clients.claim()` does to a first visit.
          controller: undefined as { postMessage: typeof postMessage } | undefined,
        },
      };
      registerServiceWorker(claimedLater, true);
      claimedLater.serviceWorker.controller = { postMessage };

      await vi.waitFor(() => expect(host.serviceWorker.register).toHaveBeenCalled());
      expect(postMessage).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('shouldWarmKernels', () => {
  it('warms a controlled load by default', () => {
    // Safari does not implement the Network Information API, so `connection` is
    // undefined there — and it is the platform this whole phase exists for.
    expect(shouldWarmKernels({}, true)).toBe(true);
    expect(shouldWarmKernels(undefined, true)).toBe(true);
    expect(shouldWarmKernels({ connection: {} }, true)).toBe(true);
    expect(shouldWarmKernels({ connection: { saveData: false } }, true)).toBe(true);
  });

  it('never warms a load that was not controlled', () => {
    // The page fetched everything itself; nothing it loaded is in the cache, so
    // a warm re-downloads rather than fills in.
    expect(shouldWarmKernels({}, false)).toBe(false);
    expect(shouldWarmKernels({ connection: { saveData: false } }, false)).toBe(false);
  });

  it('respects Save-Data', () => {
    // An explicit statement that bytes cost the user something. Prefetching a
    // design type they may never open is exactly what it is for; the kernel is
    // still fetched on demand, as before.
    expect(shouldWarmKernels({ connection: { saveData: true } }, true)).toBe(false);
  });
});

describe('getDisplayMode', () => {
  it('reads the standard display-mode query', () => {
    expect(getDisplayMode({ matchMedia: () => ({ matches: true }) })).toBe('standalone');
    expect(getDisplayMode({ matchMedia: () => ({ matches: false }) })).toBe('browser');
  });

  // iOS home-screen apps have always set this, and it is the signal that must
  // not be missed: undercounting standalone sessions undercounts exactly the
  // population the PWA phase exists to measure.
  it('accepts Apple’s non-standard flag on its own', () => {
    expect(
      getDisplayMode({ navigator: { standalone: true }, matchMedia: () => ({ matches: false }) })
    ).toBe('standalone');
  });

  it('answers browser when it cannot tell', () => {
    expect(getDisplayMode(undefined)).toBe('browser');
    expect(getDisplayMode({})).toBe('browser');
  });
});
