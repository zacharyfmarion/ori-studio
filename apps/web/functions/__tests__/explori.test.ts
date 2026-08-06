import { describe, expect, it } from 'vitest';
import { trimExploriBundle } from '../_lib/explori';

describe('trimming an ExplOri bundle', () => {
  it('drops the pickle, which is 47% of a response and unusable by any client', () => {
    const trimmed = trimExploriBundle({
      query_id: 'x',
      bundle_pickle_b64: 'gASV…',
      results: [],
    }) as Record<string, unknown>;
    expect(trimmed).not.toHaveProperty('bundle_pickle_b64');
    expect(trimmed.query_id).toBe('x');
  });

  it('drops per-result heat, which feeds a normalization upstream no longer uses', () => {
    const trimmed = trimExploriBundle({
      results: [{ rank: 1, heat: { query: [1, 2], result: [3, 4] }, cp: { vertices: [], edges: [] } }],
    }) as { results: Record<string, unknown>[] };
    expect(trimmed.results[0]).not.toHaveProperty('heat');
    expect(trimmed.results[0].rank).toBe(1);
  });

  it('keeps fields it has never heard of', () => {
    // A removal, not a whitelist: upstream is unversioned and may add fields, and
    // silently discarding them would turn "we do not use that yet" into "we
    // cannot see it".
    const trimmed = trimExploriBundle({
      results: [{ rank: 1, something_new: 42 }],
      also_new: true,
    }) as { results: Record<string, unknown>[]; also_new: boolean };
    expect(trimmed.results[0].something_new).toBe(42);
    expect(trimmed.also_new).toBe(true);
  });

  it('passes a non-object through untouched rather than inventing a shape', () => {
    expect(trimExploriBundle(null)).toBeNull();
    expect(trimExploriBundle([1, 2])).toEqual([1, 2]);
  });
});
