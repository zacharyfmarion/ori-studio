import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exploriMockEnabled, loadFixturePool, rankFixtures, treeShape } from './exploriMock';

/**
 * The dev mock's ranking over the local fixture pool. Not a search — a
 * size-alike ordering that fills every rendering state — but it has rules, and
 * the rules should hold. The pool is private data in an ignored directory, so
 * the tests over it skip where it is absent.
 */

// Vitest runs with `apps/web` as its root; the fixtures are two up.
const { pool } = loadFixturePool(resolve(process.cwd(), '../../'));

const fiveFlaps = {
  nodes: [0, 1, 2, 3, 4, 5].map((id) => ({ id })),
  edges: [1, 2, 3, 4, 5].map((v) => ({ u: 0, v })),
};

describe('the ExplOri dev mock', () => {
  it('is off unless asked for by name', () => {
    expect(exploriMockEnabled({})).toBe(false);
    expect(exploriMockEnabled({ EXPLORI_MOCK: 'true' })).toBe(false);
    expect(exploriMockEnabled({ EXPLORI_MOCK: '1' })).toBe(true);
  });

  it.skipIf(pool.length === 0)('loads the local bundles', () => {
    expect(pool.every((result) => typeof result.tiling_id === 'number' && result.tree)).toBe(true);
  });

  it('counts leaves and nodes', () => {
    expect(treeShape(fiveFlaps)).toEqual({ leaves: 5, nodes: 6 });
    expect(treeShape(null)).toEqual({ leaves: 0, nodes: 0 });
  });

  it.skipIf(pool.length === 0)('answers only from the databases asked for, nearest sizes first', () => {
    const { results, fellBack } = rankFixtures(pool, {
      tree: fiveFlaps,
      dbConfigs: [{ N: 2, symmetry: 'book' }],
      n: 3,
    });
    expect(fellBack).toBe(false);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.N === 2 && result.symmetry === 'book')).toBe(true);
    expect(results.map((result) => result.rank)).toEqual(results.map((_, index) => index + 1));
    const scores = results.map((result) => Math.abs(treeShape(result.tree).leaves - 5));
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
    for (const result of results) expect(result.distance as number).toBeGreaterThan(0);
  });

  it.skipIf(pool.length === 0)('falls back to the whole pool when nothing matches, and says so', () => {
    const { results, fellBack } = rankFixtures(pool, {
      tree: fiveFlaps,
      dbConfigs: [{ N: 9, symmetry: 'none' }],
      n: 2,
    });
    expect(fellBack).toBe(true);
    expect(results).toHaveLength(2);
  });
});
