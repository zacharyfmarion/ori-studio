import { describe, expect, it } from 'vitest';
import { coordinateKey, createReferenceFinderCache, solutionCacheKey } from './cache';
import type { ExtractedSolution } from './extractor';

const solutions: ExtractedSolution[] = [];

describe('createReferenceFinderCache', () => {
  it('misses, then hits, on the same key', () => {
    const cache = createReferenceFinderCache();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.has('a')).toBe(false);
    cache.set('a', solutions);
    expect(cache.get('a')).toBe(solutions);
    expect(cache.has('a')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('evicts the least recently used entry past its limit', () => {
    const cache = createReferenceFinderCache(2);
    cache.set('a', solutions);
    cache.set('b', solutions);
    // Touch `a` so `b` is the least recently used.
    cache.get('a');
    cache.set('c', solutions);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.size).toBe(2);
  });

  it('replaces an existing key without growing', () => {
    const cache = createReferenceFinderCache(2);
    const other: ExtractedSolution[] = [];
    cache.set('a', solutions);
    cache.set('a', other);
    expect(cache.get('a')).toBe(other);
    expect(cache.size).toBe(1);
  });

  it('clears', () => {
    const cache = createReferenceFinderCache();
    cache.set('a', solutions);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('rejects a non-positive limit', () => {
    expect(() => createReferenceFinderCache(0)).toThrow(RangeError);
  });
});

describe('keys', () => {
  it('joins database, query settings and target into one key', () => {
    expect(solutionCacheKey('db', 'q', 'line:x')).toBe('db#q#line:x');
  });

  it('keys coordinates at 1e-9 so identical inputs hit and different ones miss', () => {
    expect(coordinateKey('point', [0.5, 0.25])).toBe('point:0.5,0.25');
    expect(coordinateKey('line', [0, 1 / 3], [1, 0.5])).toBe('line:0,0.333333333;1,0.5');
    expect(coordinateKey('point', [0.5 + 1e-12, 0.25])).toBe(coordinateKey('point', [0.5, 0.25]));
    expect(coordinateKey('point', [0.5 + 1e-6, 0.25])).not.toBe(coordinateKey('point', [0.5, 0.25]));
  });
});
