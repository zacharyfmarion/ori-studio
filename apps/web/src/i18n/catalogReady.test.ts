import { describe, expect, it } from 'vitest';
import i18n from './index';
import { whenCatalogReady } from './catalogReady';
import { preloadLocale } from '../test/preloadLocale';

describe('whenCatalogReady', () => {
  it('gives up at the limit when no catalog ever arrives', async () => {
    // Under jsdom the backend never delivers, so this is the cold path that
    // must not hang: the caller gets its English fallback after the bound.
    const started = performance.now();
    await whenCatalogReady(60);
    const waited = performance.now() - started;
    expect(waited).toBeGreaterThanOrEqual(50);
    expect(waited).toBeLessThan(1000);
  });

  it('resolves the moment the catalog lands', async () => {
    const pending = whenCatalogReady(5000);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    // What the backend does when the fetch completes.
    i18n.addResourceBundle(i18n.language, 'common', {}, true, false);
    await pending;
    expect(settled).toBe(true);
  });

  it('resolves at once when the catalog is already here', async () => {
    preloadLocale();
    const started = performance.now();
    await whenCatalogReady(5000);
    // Well inside the limit is the claim; the exact figure is a loaded CI box's.
    expect(performance.now() - started).toBeLessThan(500);
  });
});
