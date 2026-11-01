import { afterEach, describe, expect, it, vi } from 'vitest';

const importMocks = vi.hoisted(() => ({
  importOrReload: vi.fn(<T>(load: () => Promise<T>) => load()),
}));
vi.mock('./importOrReload', () => importMocks);

import { lazyModule } from './lazyModule';

afterEach(() => vi.clearAllMocks());

describe('lazyModule', () => {
  it('imports once, whoever asks, through the reload guard', async () => {
    const importer = vi.fn(async () => ({ value: 1 }));
    const chunk = lazyModule(importer);
    expect(chunk.loaded()).toBeNull();
    const [first, second] = await Promise.all([chunk.load(), chunk.load()]);
    expect(first).toBe(second);
    expect(chunk.loaded()).toBe(first);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(importMocks.importOrReload).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed import, so the next ask retries', async () => {
    const importer = vi
      .fn<() => Promise<{ value: number }>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ value: 2 });
    const chunk = lazyModule(importer);
    await expect(chunk.load()).rejects.toThrow('offline');
    expect(chunk.loaded()).toBeNull();
    await expect(chunk.load()).resolves.toEqual({ value: 2 });
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('with reload off, imports plainly: a chunk that is not there fails the load and never reloads the page', async () => {
    const missing = new TypeError('Failed to fetch dynamically imported module: /src/x.ts');
    const importer = vi.fn<() => Promise<{ value: number }>>().mockRejectedValueOnce(missing).mockResolvedValueOnce({ value: 4 });
    const chunk = lazyModule(importer, { reload: false });
    await expect(chunk.load()).rejects.toBe(missing);
    expect(importMocks.importOrReload).not.toHaveBeenCalled();
    await expect(chunk.load()).resolves.toEqual({ value: 4 });
  });

  it('resets for a test', async () => {
    const chunk = lazyModule(async () => ({ value: 3 }));
    await chunk.load();
    chunk.resetForTest();
    expect(chunk.loaded()).toBeNull();
  });
});
