import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storageKey, STORAGE_KEYS } from '../lib/storage';
import { fetchDesktopRelease, resetDesktopReleaseCache } from './desktopRelease';

const CACHE_KEY = storageKey(STORAGE_KEYS.desktopRelease);

const RELEASE = {
  tag_name: 'v0.4.0',
  assets: [
    { name: 'Ori.Studio_0.4.0_aarch64.dmg', browser_download_url: 'https://example.test/arm.dmg', size: 36432845 },
    { name: 'Ori.Studio_0.4.0_x64-setup.exe', browser_download_url: 'https://example.test/setup.exe', size: 26522343 },
  ],
};

function okResponse(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  resetDesktopReleaseCache();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchDesktopRelease', () => {
  it('reads the newest release and caches it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(RELEASE));

    const release = await fetchDesktopRelease(fetchImpl as unknown as typeof fetch, 1_000);

    expect(release?.version).toBe('0.4.0');
    expect(release?.builds.map((build) => build.id)).toEqual(['macos-arm64', 'windows-x64']);
    expect(localStorage.getItem(CACHE_KEY)).toContain('0.4.0');
  });

  it('serves a fresh cache without asking GitHub', async () => {
    const seed = vi.fn().mockResolvedValue(okResponse(RELEASE));
    await fetchDesktopRelease(seed as unknown as typeof fetch, 1_000);
    resetDesktopReleaseCache();

    const fetchImpl = vi.fn();
    const release = await fetchDesktopRelease(fetchImpl as unknown as typeof fetch, 2_000);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(release?.builds[0]?.url).toBe('https://example.test/arm.dmg');
  });

  it('refetches once the cache is a day old', async () => {
    const seed = vi.fn().mockResolvedValue(okResponse(RELEASE));
    await fetchDesktopRelease(seed as unknown as typeof fetch, 0);
    resetDesktopReleaseCache();

    const fetchImpl = vi.fn().mockResolvedValue(okResponse(RELEASE));
    await fetchDesktopRelease(fetchImpl as unknown as typeof fetch, 25 * 60 * 60 * 1000);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('opens one request for concurrent callers', async () => {
    // Three download controls mount together on the landing page. Each opening
    // its own request would spend three of an hourly sixty on one answer.
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(RELEASE));

    const [a, b, c] = await Promise.all([
      fetchDesktopRelease(fetchImpl as unknown as typeof fetch, 1_000),
      fetchDesktopRelease(fetchImpl as unknown as typeof fetch, 1_000),
      fetchDesktopRelease(fetchImpl as unknown as typeof fetch, 1_000),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('resolves null on a rate-limited response instead of throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 } as unknown as Response);

    await expect(fetchDesktopRelease(fetchImpl as unknown as typeof fetch, 1_000)).resolves.toBeNull();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it('resolves null when the network is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(fetchDesktopRelease(fetchImpl as unknown as typeof fetch, 1_000)).resolves.toBeNull();
  });

  it('retries after a failure rather than memoizing it', async () => {
    const failing = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await fetchDesktopRelease(failing as unknown as typeof fetch, 1_000);

    const fetchImpl = vi.fn().mockResolvedValue(okResponse(RELEASE));
    await expect(fetchDesktopRelease(fetchImpl as unknown as typeof fetch, 1_000)).resolves.not.toBeNull();
  });

  it('ignores a cache entry it cannot understand', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: 1_000, release: { version: '9.9.9' } }));
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(RELEASE));

    const release = await fetchDesktopRelease(fetchImpl as unknown as typeof fetch, 1_500);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(release?.version).toBe('0.4.0');
  });

  it('resolves null on a host with no fetch, rather than reaching for one', async () => {
    // The prerender runs under Node with no network intent at all; asking for a
    // release there must be a no-op, not a crash in the build.
    vi.stubGlobal('fetch', undefined);

    await expect(fetchDesktopRelease(undefined, 1_000)).resolves.toBeNull();

    vi.unstubAllGlobals();
  });

  it('keeps a cached build whose id it still knows and drops one it does not', async () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        fetchedAt: 1_000,
        release: {
          version: '0.4.0',
          builds: [
            { id: 'macos-arm64', os: 'macos', url: 'https://example.test/arm.dmg', size: 1 },
            { id: 'haiku-x86', os: 'haiku', url: 'https://example.test/nope', size: 1 },
          ],
        },
      })
    );
    const fetchImpl = vi.fn();

    const release = await fetchDesktopRelease(fetchImpl as unknown as typeof fetch, 1_500);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(release?.builds.map((build) => build.id)).toEqual(['macos-arm64']);
  });
});
