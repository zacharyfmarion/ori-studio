// Global Vitest setup: initialize i18next once so `t('ns:key', 'English default')` resolves
// to the inline English default in every test (matching runtime before locale JSON loads),
// rather than returning the raw key. Importing the app's i18n module triggers its init side
// effect; the http backend's fetches are harmless no-ops under jsdom.
import '../i18n';

/**
 * No unit test reaches the network.
 *
 * jsdom does not supply `fetch`, so the global here is **Node's real one**, and
 * anything a component requests on mount goes out for real: the desktop-download
 * controls ask GitHub for the newest release, several surfaces mount one, and a
 * run of this suite was measured resolving a live `0.4.0` from `api.github.com`.
 * That is a unit suite depending on the internet, against a rate limit counted
 * per IP and shared across CI runners.
 *
 * Assigned rather than `vi.stubGlobal`, so a test file's `vi.unstubAllGlobals()`
 * restores *this* and not the real implementation. A test that needs a response
 * stubs `fetch` itself.
 */
globalThis.fetch = (() =>
  Promise.reject(
    new Error('Unit tests must not reach the network. Stub `fetch` in the test that needs a response.')
  )) as typeof fetch;
