import {
  bodyCacheKey,
  callExplori,
  errorResponse,
  withEdgeCache,
  type ExploriContext,
} from '../../_lib/explori';

/**
 * `POST /api/explori/query` — search the archive for a drawn tree.
 *
 * Upstream is one person's single machine, and this endpoint is the only thing
 * between it and the public internet. So nothing here is forwarded verbatim:
 * the request is taken apart, every field is checked, and a *new* body is built
 * from the parts that survived. Relaying the client's object instead let three
 * things through that this shape makes impossible:
 *
 * - `db_configs` reached upstream unchecked, where each entry is interpolated
 *   into a path and `pickle.load`ed (`database/tilings/query.py`). A thousand
 *   entries in a 2 KB request meant a thousand index loads on that machine; a
 *   `symmetry` of `../../..` meant loading a file of the caller's choosing.
 * - Arbitrary sibling keys on `tree` rode along into an uncapped `rfile.read`.
 * - Edge endpoints naming absent nodes raised a `KeyError` out of upstream's
 *   graph builder and killed the handler thread.
 *
 * There is no rate limiter here, deliberately — see `_lib/explori.ts` for why,
 * and please read that before adding one. The load courtesy this endpoint owes
 * is the validation below, which stops one request becoming a thousand index
 * loads, and the cache, which stops us asking the same question twice.
 */

/**
 * How long an identical search is served from the edge.
 *
 * A search is ~0.8s of someone else's server, and the archive is a research
 * dataset that changes rarely — so the staleness this buys is a tiling added in
 * the last few hours not appearing, against every repeat of a query costing that
 * server nothing. Short enough that a growing archive surfaces the same day.
 */
const CACHE_SECONDS = 6 * 60 * 60;

/** Upstream's own floor, checked here so a doomed query never leaves our edge. */
const MIN_EDGES = 4;
const MAX_RESULTS = 50;
const MAX_NODES = 200;
/** A tree is a tree, not a mesh; this is far above anything a person draws. */
const MAX_EDGES = 400;
/** Four sizes x three symmetries is the whole archive. More is not a query. */
const MAX_DB_CONFIGS = 12;
const SYMMETRIES = new Set(['diag', 'book', 'none']);
const MIN_N = 1;
const MAX_N = 10;
/** Comfortably above a 200-node tree; far below anything worth relaying. */
const MAX_BODY_BYTES = 256 * 1024;
/** Upstream's own floor, applied here so the clamp is ours to reason about. */
const MIN_EDGE_LENGTH = 1e-5;
/** A tree is scale-free — only ratios matter — so this only excludes nonsense. */
const MAX_EDGE_LENGTH = 1e6;

interface QueryNode {
  id: number;
  x: number;
  y: number;
}

/** A node, or null when any part of it is missing or not finite. */
function readNode(value: unknown): QueryNode | null {
  if (!value || typeof value !== 'object') return null;
  const node = value as Record<string, unknown>;
  const id = node.id;
  const x = node.x;
  const y = node.y;
  if (!Number.isInteger(id) || typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { id: id as number, x, y };
}

export async function onRequestPost(context: ExploriContext): Promise<Response> {
  const { request, env } = context;

  const declared = Number.parseInt(request.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return errorResponse(413, 'invalid_body', 'That query is too large.');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'invalid_body', 'Expected a JSON body.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse(400, 'invalid_body', 'Expected a JSON object.');
  }

  const payload = body as Record<string, unknown>;
  const tree = payload.tree as { nodes?: unknown; edges?: unknown } | undefined;
  if (!tree || !Array.isArray(tree.nodes) || !Array.isArray(tree.edges)) {
    return errorResponse(400, 'invalid_tree', 'The query needs a tree with nodes and edges.');
  }
  if (tree.edges.length < MIN_EDGES) {
    return errorResponse(400, 'invalid_tree', 'Draw at least four branches before searching.');
  }
  if (tree.nodes.length > MAX_NODES || tree.edges.length > MAX_EDGES) {
    return errorResponse(400, 'invalid_tree', 'That tree is too large to search.');
  }

  const nodes: QueryNode[] = [];
  const ids = new Set<number>();
  for (const entry of tree.nodes) {
    const node = readNode(entry);
    if (!node) return errorResponse(400, 'invalid_tree', 'That tree has a malformed node.');
    if (ids.has(node.id)) {
      return errorResponse(400, 'invalid_tree', 'That tree names a node twice.');
    }
    ids.add(node.id);
    nodes.push(node);
  }

  const edges: { u: number; v: number; length: number }[] = [];
  for (const entry of tree.edges) {
    if (!entry || typeof entry !== 'object') {
      return errorResponse(400, 'invalid_tree', 'That tree has a malformed branch.');
    }
    const edge = entry as Record<string, unknown>;
    const { u, v } = edge;
    // Endpoints must name nodes that exist: upstream indexes its graph by id and
    // raises out of the handler thread when one is absent.
    if (!Number.isInteger(u) || !Number.isInteger(v) || !ids.has(u as number) || !ids.has(v as number)) {
      return errorResponse(400, 'invalid_tree', 'That tree has a branch with no endpoint.');
    }
    // `length` is the query signal, not decoration: upstream weights the graph
    // by it (`_build_query_graph`) and only falls back to Euclidean distance
    // when it is absent. Rebuilding the body without it would silently change
    // every search result, so it is carried through — clamped below exactly as
    // upstream clamps it, and bounded above so a hostile value cannot be.
    const length = edge.length;
    if (typeof length !== 'number' || !Number.isFinite(length) || length <= 0) {
      return errorResponse(400, 'invalid_tree', 'That tree has a branch with no length.');
    }
    edges.push({
      u: u as number,
      v: v as number,
      length: Math.min(MAX_EDGE_LENGTH, Math.max(MIN_EDGE_LENGTH, length)),
    });
  }

  if (!Array.isArray(payload.db_configs) || payload.db_configs.length === 0) {
    return errorResponse(400, 'invalid_body', 'Choose at least one database to search.');
  }
  if (payload.db_configs.length > MAX_DB_CONFIGS) {
    return errorResponse(400, 'invalid_body', 'That is more databases than exist.');
  }
  const dbConfigs: { N: number; symmetry: string }[] = [];
  const seen = new Set<string>();
  for (const entry of payload.db_configs) {
    if (!entry || typeof entry !== 'object') {
      return errorResponse(400, 'invalid_body', 'That database selection is malformed.');
    }
    const config = entry as Record<string, unknown>;
    const { N, symmetry } = config;
    if (!Number.isInteger(N) || (N as number) < MIN_N || (N as number) > MAX_N) {
      return errorResponse(400, 'invalid_body', 'That tiling size does not exist.');
    }
    if (typeof symmetry !== 'string' || !SYMMETRIES.has(symmetry)) {
      return errorResponse(400, 'invalid_body', 'That symmetry does not exist.');
    }
    // Deduplicated, so the same index is never loaded twice for one query.
    const key = `${N as number}:${symmetry}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dbConfigs.push({ N: N as number, symmetry });
  }

  const n = typeof payload.n === 'number' ? Math.min(MAX_RESULTS, Math.max(1, Math.round(payload.n))) : 5;

  // Rebuilt from validated parts, never the caller's object — which is also
  // what makes it a sound cache key: two equivalent searches serialize alike.
  const canonical = JSON.stringify({ tree: { nodes, edges }, db_configs: dbConfigs, n });

  return withEdgeCache(
    context,
    await bodyCacheKey(request, canonical),
    CACHE_SECONDS,
    () => callExplori(env, { path: '/api/query', method: 'POST', body: canonical })
  );
}
