import { afterEach, describe, expect, it, vi } from 'vitest';
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

/**
 * What the query proxy will and will not pass to upstream.
 *
 * This endpoint is the only thing between the public internet and one person's
 * single machine, so these are about what it *refuses*. Every case below reached
 * that machine before: `db_configs` was checked only for `Array.isArray` and
 * non-empty, and `tree` was re-serialized whole.
 *
 * `callExplori` is stubbed — nothing here contacts upstream.
 */
describe('POST /api/explori/query — what reaches upstream', () => {
  const NODES = [
    { id: 0, x: 0, y: 0 },
    { id: 1, x: 1, y: 0 },
    { id: 2, x: -1, y: 0 },
    { id: 3, x: 0, y: 1 },
    { id: 4, x: 0, y: -1 },
  ];
  const EDGES = [
    { u: 0, v: 1, length: 1 },
    { u: 0, v: 2, length: 1 },
    { u: 0, v: 3, length: 1 },
    { u: 0, v: 4, length: 1 },
  ];

  async function post(body: unknown) {
    vi.resetModules();
    const sent: { body?: string } = {};
    vi.doMock('../_lib/explori', async () => {
      const actual = await vi.importActual<typeof import('../_lib/explori')>('../_lib/explori');
      return {
        ...actual,
        callExplori: async (_env: unknown, call: { body?: string }) => {
          sent.body = call.body;
          return new Response('{}', { status: 200 });
        },
      };
    });
    const { onRequestPost } = await import('../api/explori/query');
    const response = await onRequestPost({
      request: new Request('https://x/api/explori/query', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      env: {},
    } as never);
    return { response, forwarded: sent.body ? JSON.parse(sent.body) : null };
  }

  const valid = { tree: { nodes: NODES, edges: EDGES }, db_configs: [{ N: 4, symmetry: 'book' }], n: 5 };

  it('forwards a well-formed query, keeping each edge length', async () => {
    const { response, forwarded } = await post(valid);
    expect(response.status).toBe(200);
    // The length is the query signal — upstream weights the graph by it — so
    // dropping it while rebuilding the body would silently change every result.
    expect(forwarded.tree.edges).toEqual(EDGES);
    expect(forwarded.db_configs).toEqual([{ N: 4, symmetry: 'book' }]);
  });

  it('refuses a symmetry that would escape upstream’s cache path', async () => {
    // Upstream interpolates this into `db_{N}_{sym}` and `pickle.load`s it.
    const { response, forwarded } = await post({
      ...valid,
      db_configs: [{ N: 4, symmetry: '../../../../tmp/x' }],
    });
    expect(response.status).toBe(400);
    expect(forwarded).toBeNull();
  });

  it('refuses more databases than the archive holds', async () => {
    // 5,000 entries in a 2 KB request meant 5,000 index loads on one machine.
    const { response } = await post({
      ...valid,
      db_configs: Array.from({ length: 5000 }, () => ({ N: 4, symmetry: 'none' })),
    });
    expect(response.status).toBe(400);
  });

  it('collapses a repeated database rather than loading it twice', async () => {
    const { forwarded } = await post({
      ...valid,
      db_configs: [
        { N: 4, symmetry: 'book' },
        { N: 4, symmetry: 'book' },
      ],
    });
    expect(forwarded.db_configs).toEqual([{ N: 4, symmetry: 'book' }]);
  });

  it('refuses a branch whose endpoint names no node', async () => {
    // This raised a KeyError out of upstream's handler thread.
    const { response } = await post({
      ...valid,
      tree: { nodes: NODES, edges: [...EDGES.slice(1), { u: 0, v: 999, length: 1 }] },
    });
    expect(response.status).toBe(400);
  });

  it('drops sibling keys instead of relaying them', async () => {
    const { forwarded } = await post({
      ...valid,
      tree: { ...valid.tree, pad: 'x'.repeat(10_000) },
      unexpected: 'y'.repeat(10_000),
    });
    expect(Object.keys(forwarded)).toEqual(['tree', 'db_configs', 'n']);
    expect(Object.keys(forwarded.tree)).toEqual(['nodes', 'edges']);
  });

  it('refuses an oversized body by its declared length', async () => {
    vi.resetModules();
    const { onRequestPost } = await import('../api/explori/query');
    const request = new Request('https://x/api/explori/query', {
      method: 'POST',
      body: JSON.stringify(valid),
      headers: { 'Content-Length': String(1024 * 1024) },
    });
    const response = await onRequestPost({ request, env: {} } as never);
    expect(response.status).toBe(413);
  });

  it('refuses a non-finite coordinate', async () => {
    const { response } = await post({
      ...valid,
      tree: { nodes: [...NODES.slice(1), { id: 0, x: 'NaN', y: 0 }], edges: EDGES },
    });
    expect(response.status).toBe(400);
  });
});

/**
 * The edge cache, which is the whole of this proxy's load courtesy.
 *
 * It replaced a per-IP KV counter, and it protects the archive's server better
 * than that ever did: a counter refuses one client while letting every distinct
 * expensive query through, whereas a hit costs upstream nothing at all. It also
 * costs us nothing — `caches.default` has no write quota, so ExplOri traffic can
 * no longer exhaust the budget share links depend on.
 */
describe('the edge cache', () => {
  /** A minimal stand-in for `caches.default`, keyed by URL. */
  function stubCache() {
    const store = new Map<string, Response>();
    const cache = {
      async match(key: Request) {
        return store.get(key.url)?.clone();
      },
      async put(key: Request, response: Response) {
        store.set(key.url, response);
      },
    };
    vi.stubGlobal('caches', { default: cache });
    return store;
  }

  const NODES = [
    { id: 0, x: 0, y: 0 },
    { id: 1, x: 1, y: 0 },
    { id: 2, x: -1, y: 0 },
    { id: 3, x: 0, y: 1 },
    { id: 4, x: 0, y: -1 },
  ];
  const EDGES = [
    { u: 0, v: 1, length: 1 },
    { u: 0, v: 2, length: 1 },
    { u: 0, v: 3, length: 1 },
    { u: 0, v: 4, length: 2 },
  ];
  const query = { tree: { nodes: NODES, edges: EDGES }, db_configs: [{ N: 4, symmetry: 'book' }], n: 5 };

  /** Post through the real endpoint, counting how often upstream was reached. */
  async function harness() {
    vi.resetModules();
    let upstreamCalls = 0;
    vi.doMock('../_lib/explori', async () => {
      const actual = await vi.importActual<typeof import('../_lib/explori')>('../_lib/explori');
      return {
        ...actual,
        callExplori: async () => {
          upstreamCalls += 1;
          return new Response(JSON.stringify({ results: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      };
    });
    const { onRequestPost } = await import('../api/explori/query');
    const send = (body: unknown) =>
      onRequestPost({
        request: new Request('https://x/api/explori/query', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
        env: {},
      } as never);
    return { send, calls: () => upstreamCalls };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('asks upstream once for a repeated search', async () => {
    stubCache();
    const { send, calls } = await harness();

    const first = await send(query);
    expect(first.headers.get('X-Ori-Cache')).toBe('miss');
    expect(calls()).toBe(1);

    const second = await send(query);
    expect(second.headers.get('X-Ori-Cache')).toBe('hit');
    expect(calls()).toBe(1);
  });

  it('treats a different tree as a different question', async () => {
    stubCache();
    const { send, calls } = await harness();
    await send(query);
    // One edge length changed: a genuinely different search.
    await send({
      ...query,
      tree: { nodes: NODES, edges: [...EDGES.slice(0, 3), { u: 0, v: 4, length: 7 }] },
    });
    expect(calls()).toBe(2);
  });

  it('keys on the validated body, so an equivalent search still hits', async () => {
    stubCache();
    const { send, calls } = await harness();
    await send(query);
    // Same query, but the client sent a duplicate database and extra keys the
    // proxy strips. It rebuilds the same canonical body, so it is the same key.
    await send({
      ...query,
      tree: { ...query.tree, note: 'ignored' },
      db_configs: [
        { N: 4, symmetry: 'book' },
        { N: 4, symmetry: 'book' },
      ],
    });
    expect(calls()).toBe(1);
  });

  it('never caches a failure', async () => {
    stubCache();
    vi.resetModules();
    let upstreamCalls = 0;
    vi.doMock('../_lib/explori', async () => {
      const actual = await vi.importActual<typeof import('../_lib/explori')>('../_lib/explori');
      return {
        ...actual,
        callExplori: async () => {
          upstreamCalls += 1;
          return actual.errorResponse(502, 'upstream_error', 'nope');
        },
      };
    });
    const { onRequestPost } = await import('../api/explori/query');
    const send = () =>
      onRequestPost({
        request: new Request('https://x/api/explori/query', {
          method: 'POST',
          body: JSON.stringify(query),
        }),
        env: {},
      } as never);

    expect((await send()).status).toBe(502);
    expect((await send()).status).toBe(502);
    // A 502 must not become what everyone gets for the next six hours.
    expect(upstreamCalls).toBe(2);
  });

  it('works with no edge cache at all, as under wrangler --local', async () => {
    vi.stubGlobal('caches', undefined);
    const { send, calls } = await harness();
    expect((await send(query)).status).toBe(200);
    expect(calls()).toBe(1);
  });
});
