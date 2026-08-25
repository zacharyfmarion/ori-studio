import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { storageKey, STORAGE_KEYS } from '../lib/storage';
import { PHONE_MEDIA_QUERY } from '../platform/mobileSurface';
import { createAppRouter, startupHomePath } from './appRouter';

const WELCOME_KEY = storageKey(STORAGE_KEYS.showWelcomeOnStartup);

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

  it('honors the preference on a phone, like everywhere else', () => {
    // A phone used to be forced to `/welcome` whatever the preference said,
    // because the workspaces were closed to it. Nothing is closed now, so
    // "start in Edit" means what it says on every device.
    mockPhoneViewport();
    localStorage.setItem(WELCOME_KEY, 'false');
    expect(startupHomePath()).toBe('/edit');
  });
});

/**
 * The workspace routes have no device gate, and these hold that open.
 *
 * A phone used to be redirected to `/welcome` however it got pointed at one —
 * a deep link, a bookmark, a shared URL — with a persisted "open it anyway"
 * override as the way past. The touch work removed the reason, and a shared
 * link that opens the landing page instead of the pattern someone sent you is
 * the failure worth pinning against.
 */
describe('the workspace routes on a phone', () => {
  it('leaves a deep link alone on a device that can run the app', async () => {
    await expect(resolve('/edit')).resolves.toBe('/edit');
  });

  it.each(['/edit', '/design', '/simulate'])('opens %s on a phone', async (path) => {
    mockPhoneViewport();
    await expect(resolve(path)).resolves.toBe(path);
  });

  it('still resolves a legacy Design sub-path to the Design workspace', async () => {
    mockPhoneViewport();
    await expect(resolve('/design/treemaker')).resolves.toBe('/design');
  });

  it('opens a share link rather than the landing page', async () => {
    mockPhoneViewport();
    await expect(resolve('/s/abcd1234')).resolves.toBe('/s/abcd1234');
  });
});
