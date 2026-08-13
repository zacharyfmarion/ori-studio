import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { storageKey, STORAGE_KEYS } from '../lib/storage';
import { PHONE_MEDIA_QUERY } from '../platform/mobileSurface';
import { createAppRouter, startupHomePath } from './appRouter';

const WELCOME_KEY = storageKey(STORAGE_KEYS.showWelcomeOnStartup);
const OVERRIDE_KEY = storageKey(STORAGE_KEYS.phoneOverride);

/** Report a phone-sized coarse-pointer viewport to `platform/mobileSurface`. */
function mockPhoneViewport() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === PHONE_MEDIA_QUERY,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/**
 * One router for the whole file. `createBrowserRouter` initializes itself, and a
 * browser history tolerates only one active listener, so a router per test
 * throws on the second construction. Sharing one is also the more faithful test:
 * the gate is a loader, so it is re-evaluated on every navigation rather than
 * baked in when the router is built.
 */
let router: ReturnType<typeof createAppRouter> | null = null;

/** Drive the real route table and report where `path` actually settles. */
async function resolve(path: string): Promise<string> {
  router ??= createAppRouter();
  await router.navigate(path);
  return router.state.location.pathname;
}

afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'matchMedia');
});

afterAll(() => {
  router?.dispose();
  router = null;
});

describe('startupHomePath', () => {
  it('defaults to the welcome screen', () => {
    expect(startupHomePath()).toBe('/welcome');
  });

  it('is the welcome screen when the preference is on', () => {
    localStorage.setItem(WELCOME_KEY, 'true');
    expect(startupHomePath()).toBe('/welcome');
  });

  it('is the Edit workspace when the preference is off', () => {
    localStorage.setItem(WELCOME_KEY, 'false');
    expect(startupHomePath()).toBe('/edit');
  });

  it('is the welcome screen on a phone even with the preference off', () => {
    mockPhoneViewport();
    localStorage.setItem(WELCOME_KEY, 'false');
    expect(startupHomePath()).toBe('/welcome');
  });

  it('honors the preference again once a phone takes the override', () => {
    mockPhoneViewport();
    localStorage.setItem(WELCOME_KEY, 'false');
    localStorage.setItem(OVERRIDE_KEY, 'true');
    expect(startupHomePath()).toBe('/edit');
  });
});

describe('the blocked-device gate on the workspace routes', () => {
  it('leaves a deep link alone on a device that can run the app', async () => {
    await expect(resolve('/edit')).resolves.toBe('/edit');
  });

  it.each(['/edit', '/design', '/simulate'])('bounces %s to the welcome page on a phone', async (path) => {
    mockPhoneViewport();
    await expect(resolve(path)).resolves.toBe('/welcome');
  });

  it('bounces a legacy Design sub-path too, without following its redirect first', async () => {
    mockPhoneViewport();
    await expect(resolve('/design/treemaker')).resolves.toBe('/welcome');
  });

  it('bounces a share link, which would otherwise land in Edit', async () => {
    mockPhoneViewport();
    await expect(resolve('/s/abcd1234')).resolves.toBe('/welcome');
  });

  it('lets a phone through once the override is set', async () => {
    mockPhoneViewport();
    localStorage.setItem(OVERRIDE_KEY, 'true');
    await expect(resolve('/edit')).resolves.toBe('/edit');
  });
});
