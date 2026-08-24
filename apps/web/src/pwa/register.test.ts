import { describe, expect, it, vi } from 'vitest';
import { getDisplayMode, registerServiceWorker, shouldRegisterServiceWorker } from './register';

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
