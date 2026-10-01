import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the shared test setup', () => {
  // A test's `fetch` stub is for its own requests. "The desktop app asks for no release"
  // is a spy that must never be called, and it failed when a catalog load landed in it.
  it('loads i18n catalogs without the global fetch, so no test’s stub sees one', async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);

    // A reload goes to the backend even for a catalog it already holds.
    await i18n.reloadResources(['en', 'ja'], ['common', 'site']);

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
