import { describe, expect, it, vi } from 'vitest';
import { PreparedModelCache } from './preparedModelCache';
import type { PreparedOrigamiModel } from '@treemaker/origami-simulator';

function fakeModel(tag: string): PreparedOrigamiModel {
  return { tag } as unknown as PreparedOrigamiModel;
}

describe('PreparedModelCache', () => {
  it('builds on miss and reuses on hit', () => {
    const cache = new PreparedModelCache(2);
    const factory = vi.fn(() => fakeModel('a'));
    const first = cache.get('a', factory);
    const second = cache.get('a', factory);
    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('evicts the least-recently-used entry past capacity', () => {
    const cache = new PreparedModelCache(2);
    cache.get('a', () => fakeModel('a'));
    cache.get('b', () => fakeModel('b'));
    // Touch 'a' so 'b' becomes least-recently-used.
    cache.get('a', () => fakeModel('a-again'));
    cache.get('c', () => fakeModel('c')); // evicts 'b', now { a, c }
    expect(cache.size).toBe(2);

    // 'a' and 'c' survived — re-selecting them does not rebuild.
    const rebuildA = vi.fn(() => fakeModel('a3'));
    cache.get('a', rebuildA);
    expect(rebuildA).not.toHaveBeenCalled();
    const rebuildC = vi.fn(() => fakeModel('c3'));
    cache.get('c', rebuildC);
    expect(rebuildC).not.toHaveBeenCalled();

    // 'b' was evicted — re-selecting it rebuilds.
    const rebuildB = vi.fn(() => fakeModel('b2'));
    cache.get('b', rebuildB);
    expect(rebuildB).toHaveBeenCalledTimes(1);
  });

  it('clears all entries', () => {
    const cache = new PreparedModelCache(4);
    cache.get('a', () => fakeModel('a'));
    cache.clear();
    expect(cache.size).toBe(0);
    const factory = vi.fn(() => fakeModel('a'));
    cache.get('a', factory);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
