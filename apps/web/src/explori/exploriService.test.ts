import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './__fixtures__/queryResponse.json';
import { createExploriDocument, type ExploriDocument } from './document';
import {
  ExploriError,
  exploriDbConfigsForQuery,
  exploriQueryBlocker,
  exploriQueryTree,
  queryExplori,
} from './exploriService';

function documentWith(overrides: Partial<ExploriDocument> = {}): ExploriDocument {
  const base = createExploriDocument();
  return {
    ...base,
    nodes: [
      { id: 0, loc: { x: 0, y: 0 }, name: '' },
      { id: 1, loc: { x: 0, y: 2 }, name: '' },
      { id: 2, loc: { x: 1.5, y: -1 }, name: '' },
      { id: 3, loc: { x: -1.5, y: -1 }, name: '' },
      { id: 4, loc: { x: 0, y: -2 }, name: '' },
    ],
    edges: [
      { id: 1, vertices: [0, 1], length: 2 },
      { id: 2, vertices: [0, 2], length: 1.8 },
      { id: 3, vertices: [0, 3], length: 1.8 },
      { id: 4, vertices: [0, 4], length: 2 },
    ],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the query payload', () => {
  it('sends lengths read from the drawing, unscaled', () => {
    const tree = exploriQueryTree(documentWith());
    // The embedding weights each edge by 1/length and its spectrum is not
    // scale-invariant, so these numbers decide which patterns come back — a
    // rescaled tree is a different query, not the same one drawn larger.
    expect(tree.edges[0].length).toBeCloseTo(2, 9);
    expect(tree.edges[1].length).toBeCloseTo(Math.hypot(1.5, 1), 9);
    expect(tree.nodes).toHaveLength(5);
  });

  it("reproduces upstream's 5-book-includes-6-book quirk", () => {
    expect(exploriDbConfigsForQuery([{ N: 5, symmetry: 'book' }])).toEqual([
      { N: 5, symmetry: 'book' },
      { N: 6, symmetry: 'book' },
    ]);
    expect(exploriDbConfigsForQuery([{ N: 5, symmetry: 'diag' }])).toEqual([
      { N: 5, symmetry: 'diag' },
    ]);
  });

  it('refuses locally what the service would refuse anyway', () => {
    expect(exploriQueryBlocker(createExploriDocument())).toBe('too-simple');
    // Empty *and* chosen. An empty stored list on a document the user has not
    // touched is not "no databases" — the selection is still following the
    // drawing at that point, and following it to a non-empty set.
    expect(
      exploriQueryBlocker(documentWith({ dbConfigs: [], dbConfigsDirty: true }))
    ).toBe('no-database');
    expect(exploriQueryBlocker(documentWith({ dbConfigs: [] }))).toBeNull();
    expect(exploriQueryBlocker(documentWith())).toBeNull();
  });
});

describe('reading a response', () => {
  function stubFetch(body: unknown, init: { status?: number; text?: string } = {}) {
    const response = new Response(init.text ?? JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
    vi.stubGlobal('fetch', vi.fn(async () => response));
  }

  it('parses a real archive response', async () => {
    stubFetch(fixture);
    const response = await queryExplori(documentWith());
    expect(response.results).toHaveLength(1);
    const [result] = response.results;
    expect(result.symmetry).toBe('book');
    expect(result.tilingId).toBe(fixture.results[0].tiling_id);
    expect(result.cp.vertices.length).toBeGreaterThan(0);
    expect(result.fold?.faces.length).toBeGreaterThan(0);
  });

  it('drops a result with no crease pattern rather than rendering an empty card', async () => {
    stubFetch({ query_id: 'x', results: [{ rank: 1, distance: 0 }, fixture.results[0]] });
    const response = await queryExplori(documentWith());
    expect(response.results).toHaveLength(1);
  });

  it('rejects a vertex with a zero denominator', async () => {
    // The one malformed value that turns an exact rational into a non-finite
    // coordinate, which would otherwise propagate silently into the geometry.
    stubFetch({
      query_id: 'x',
      results: [{ ...fixture.results[0], cp: { vertices: [[1, 0, 0, 1, 0, 1, 0, 1]], edges: [] } }],
    });
    const response = await queryExplori(documentWith());
    expect(response.results).toHaveLength(0);
  });

  it('reads an HTML error page as the timeout it is', async () => {
    // Upstream answers a timeout with an error page rather than JSON, which its
    // own client special-cases too. "Invalid JSON" would name the symptom.
    stubFetch(null, { status: 502, text: '<!DOCTYPE html><html><body>Gateway</body></html>' });
    await expect(queryExplori(documentWith())).rejects.toMatchObject({ code: 'timeout' });
  });

  it('names a rate limit as one', async () => {
    stubFetch({ code: 'rate_limited', error: 'slow down' }, { status: 429 });
    await expect(queryExplori(documentWith())).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('refuses to leave the machine when the tree is too simple', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(queryExplori(createExploriDocument())).rejects.toBeInstanceOf(ExploriError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
