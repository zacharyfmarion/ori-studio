import { describe, expect, it } from 'vitest';
import { exploriResultUrl, exploriTilingLabel } from './types';

/**
 * The link out to ExplOri's own viewer.
 *
 * Upstream parses `?id=` with `^(\d)([nbd])(\d+)$` — no separator — while the
 * label we show carries a dot. They are the same three parts, so the risk worth
 * testing is that the two compositions drift.
 */
describe('exploriResultUrl', () => {
  const result = { N: 4, symmetry: 'book' as const, tilingId: 23841 };

  it('is the label without its dot, on the viewer route', () => {
    expect(exploriTilingLabel(result)).toBe('4b.23841');
    expect(exploriResultUrl(result)).toBe('https://225.designorigami.net/view?id=4b23841');
  });

  it('matches the pattern upstream parses, for every symmetry', () => {
    const upstream = /^(\d)([nbd])(\d+)$/;
    for (const symmetry of ['book', 'diag', 'none'] as const) {
      const id = new URL(exploriResultUrl({ ...result, symmetry })).searchParams.get('id');
      expect(id).toMatch(upstream);
      const [, n, letter, tilingId] = upstream.exec(id ?? '') ?? [];
      expect(Number(n)).toBe(result.N);
      expect(Number(tilingId)).toBe(result.tilingId);
      expect(letter).toBe(exploriTilingLabel({ ...result, symmetry }).charAt(1));
    }
  });
});
