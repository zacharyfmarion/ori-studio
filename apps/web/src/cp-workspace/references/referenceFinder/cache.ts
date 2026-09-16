/**
 * Memo of extracted solutions, keyed by everything that can change the answer.
 *
 * A ReferenceFinder answer depends on the database (every build-time setting,
 * `databaseKey`), the query settings (`querySettingsKey`), and the target. The
 * target part of the key is the caller's: the planner computes canonical line
 * keys in Rust (`line_keys()` on the planner handle — two segments of one
 * infinite line share a key, and TS never canonicalises geometry), so the
 * client takes a precomputed key string and only falls back to a
 * coordinate-derived key, which hits on identical inputs alone.
 *
 * Bounded LRU on a `Map`'s insertion order: a CP-wide analysis asks once per
 * distinct line, so a few thousand entries covers the largest real designs.
 */
import type { ExtractedSolution } from './extractor';
import type { RfPoint } from './solution';

export interface ReferenceFinderCache {
  get(key: string): ExtractedSolution[] | undefined;
  set(key: string, solutions: ExtractedSolution[]): void;
  has(key: string): boolean;
  clear(): void;
  readonly size: number;
}

export const DEFAULT_CACHE_LIMIT = 4000;

export function createReferenceFinderCache(limit = DEFAULT_CACHE_LIMIT): ReferenceFinderCache {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`cache limit must be a positive integer, got ${limit}`);
  }
  const entries = new Map<string, ExtractedSolution[]>();
  return {
    get(key) {
      const value = entries.get(key);
      if (value === undefined) return undefined;
      // Re-insert so the most recently used entry is last in iteration order.
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, solutions) {
      entries.delete(key);
      entries.set(key, solutions);
      while (entries.size > limit) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    has(key) {
      return entries.has(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

/** The full cache key: database, query settings, then the target's own key. */
export function solutionCacheKey(
  databaseKey: string,
  querySettingsKey: string,
  targetKey: string
): string {
  return `${databaseKey}#${querySettingsKey}#${targetKey}`;
}

/** Coordinates at 1e-9 as a key. Identical inputs only — not a canonical line key. */
export function coordinateKey(kind: 'point' | 'line', ...points: RfPoint[]): string {
  const fixed = (value: number) => (Math.round(value * 1e9) / 1e9).toString();
  return `${kind}:${points.map((p) => `${fixed(p[0])},${fixed(p[1])}`).join(';')}`;
}
