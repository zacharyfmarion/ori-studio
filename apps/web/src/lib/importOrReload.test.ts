import { afterEach, describe, expect, it, vi } from 'vitest';
import { importOrReload, isChunkLoadError } from './importOrReload';
import { storageKey, STORAGE_KEYS } from './storage';

const chromeMiss = new TypeError(
  'Failed to fetch dynamically imported module: https://oristudio.dev/assets/workspaceEntry-abc.js'
);
const webkitMiss = new TypeError('/assets/workspaceEntry-abc.js is not a valid JavaScript MIME type.');

function host() {
  return { location: { reload: vi.fn() } };
}

afterEach(() => {
  localStorage.removeItem(storageKey(STORAGE_KEYS.chunkReload));
  vi.useRealTimers();
});

describe('isChunkLoadError', () => {
  it('recognizes each engine’s wording for a missing chunk', () => {
    expect(isChunkLoadError(chromeMiss)).toBe(true);
    expect(isChunkLoadError(webkitMiss)).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
  });

  it('does not mistake an error thrown while the module ran', () => {
    expect(isChunkLoadError(new TypeError('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
  });
});

describe('importOrReload', () => {
  it('returns the module when it loads', async () => {
    const page = host();
    await expect(importOrReload(async () => ({ ok: true }), page)).resolves.toEqual({ ok: true });
    expect(page.location.reload).not.toHaveBeenCalled();
  });

  it('reloads once for a missing chunk, and never settles', async () => {
    const page = host();
    const settled = vi.fn();
    void importOrReload(() => Promise.reject(chromeMiss), page).then(settled, settled);
    await vi.waitFor(() => expect(page.location.reload).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
  });

  it('rethrows a second miss inside the window instead of looping', async () => {
    const first = host();
    void importOrReload(() => Promise.reject(webkitMiss), first);
    await vi.waitFor(() => expect(first.location.reload).toHaveBeenCalled());

    const second = host();
    await expect(importOrReload(() => Promise.reject(webkitMiss), second)).rejects.toBe(webkitMiss);
    expect(second.location.reload).not.toHaveBeenCalled();
  });

  it('reloads again once the window has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    const first = host();
    void importOrReload(() => Promise.reject(chromeMiss), first);
    await vi.waitFor(() => expect(first.location.reload).toHaveBeenCalled());

    vi.setSystemTime(new Date('2026-09-23T12:05:00Z'));
    const later = host();
    void importOrReload(() => Promise.reject(chromeMiss), later);
    await vi.waitFor(() => expect(later.location.reload).toHaveBeenCalled());
  });

  it('rethrows anything that is not a missing chunk', async () => {
    const page = host();
    const bug = new Error('workspace module threw while evaluating');
    await expect(importOrReload(() => Promise.reject(bug), page)).rejects.toBe(bug);
    expect(page.location.reload).not.toHaveBeenCalled();
  });
});
