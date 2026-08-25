import { describe, expect, it, vi } from 'vitest';
import {
  getDisplayMode,
  loadedAssetPaths,
  registerServiceWorker,
  shouldRegisterServiceWorker,
  shouldWarmColdStart,
} from './register';
import { WARM_COLD_START } from './swRoutes';

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
   * A first visit fetches its whole cold-start set before the worker exists —
   * registration happens on `load` — so nothing it loaded is in the cache and
   * the next launch offline fails on the navigation itself. Measured on the real
   * build: two entries after one online session. The page therefore has to hand
   * the worker its own resource list once it is idle.
   */
  it('asks the worker to store this session, once idle', async () => {
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
      const withWorker = {
        ...host,
        serviceWorker: {
          ...host.serviceWorker,
          register: vi.fn(async () => ({ active: { postMessage } })),
        },
      };

      registerServiceWorker(withWorker, true);

      await vi.waitFor(() =>
        expect(postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: WARM_COLD_START })
        )
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('warms a first visit, which has nothing cached at all', async () => {
    // The regression this replaced: gating on "was the load controlled" declined
    // exactly the visit with an empty cache, so an installed app was not offline
    // capable until its second launch. A fresh registration is `installing`, not
    // `active`, so the page waits on `ready`.
    vi.stubGlobal('requestIdleCallback', (fn: () => void) => {
      fn();
      return 1;
    });
    try {
      const postMessage = vi.fn();
      const { host } = devHost();
      const firstVisit = {
        ...host,
        serviceWorker: {
          ...host.serviceWorker,
          // No controller and no active worker at registration time.
          controller: null,
          register: vi.fn(async () => ({ active: null })),
          ready: Promise.resolve({ active: { postMessage } }),
        },
      };

      registerServiceWorker(firstVisit, true);

      await vi.waitFor(() =>
        expect(postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: WARM_COLD_START })
        )
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('shouldWarmColdStart', () => {
  it('keeps an offline copy by default', () => {
    // Safari does not implement the Network Information API, so `connection` is
    // undefined there — and it is the platform this whole phase exists for.
    expect(shouldWarmColdStart({})).toBe(true);
    expect(shouldWarmColdStart(undefined)).toBe(true);
    expect(shouldWarmColdStart({ connection: {} })).toBe(true);
    expect(shouldWarmColdStart({ connection: { saveData: false } })).toBe(true);
  });

  it('respects Save-Data', () => {
    // An explicit statement that bytes cost the user something. That user gets
    // the behaviour everyone had before this existed: an app that works online.
    expect(shouldWarmColdStart({ connection: { saveData: true } })).toBe(false);
  });
});

describe('loadedAssetPaths', () => {
  const perf = (names: string[]) =>
    ({ getEntriesByType: () => names.map((name) => ({ name })) }) as unknown as Performance;

  it('reports this build output, deduplicated', () => {
    const paths = loadedAssetPaths({
      performance: perf([
        `${window.location.origin}/assets/index-abc.js`,
        `${window.location.origin}/assets/index-abc.js`,
        `${window.location.origin}/assets/index-abc.css`,
      ]),
    });

    expect(paths.sort()).toEqual(['/assets/index-abc.css', '/assets/index-abc.js']);
  });

  it('reports nothing it has no business caching first', () => {
    // Locales and icons are stale-while-revalidate for a reason, `/api` and `/s`
    // are Pages Functions, and a third-party URL is not ours to store at all.
    const paths = loadedAssetPaths({
      performance: perf([
        `${window.location.origin}/locales/en/common.json`,
        `${window.location.origin}/api/explori/query`,
        `${window.location.origin}/icons/icon-192.png`,
        'https://example.com/assets/other-build.js',
      ]),
    });

    expect(paths).toEqual([]);
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
