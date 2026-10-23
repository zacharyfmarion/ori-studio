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

  it('resets for a test', async () => {
    const chunk = lazyModule(async () => ({ value: 3 }));
    await chunk.load();
    chunk.resetForTest();
    expect(chunk.loaded()).toBeNull();
  });
});
