import {
  callExplori,
  errorResponse,
  underRateLimit,
  type ExploriContext,
} from '../../_lib/explori';

/**
 * `POST /api/explori/query` — search the archive for a drawn tree.
 *
 * The body is forwarded almost verbatim; the only thing this endpoint decides is
 * whether the request is well-formed enough to be worth someone else's CPU, and
 * how many of them one client may send.
 */

/** A search is ~0.8s of someone else's server. Generous for a person, not a loop. */
const RATE_LIMIT = 40;
const RATE_WINDOW_SECONDS = 60;

/** Upstream's own floor, checked here so a doomed query never leaves our edge. */
const MIN_EDGES = 4;
const MAX_RESULTS = 50;
const MAX_NODES = 200;

export async function onRequestPost(context: ExploriContext): Promise<Response> {
  const { request, env } = context;
  if (!(await underRateLimit(env, request, RATE_LIMIT, RATE_WINDOW_SECONDS))) {
    return errorResponse(429, 'rate_limited', 'Too many searches — try again shortly.');
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
  const tree = payload.tree as { nodes?: unknown[]; edges?: unknown[] } | undefined;
  if (!tree || !Array.isArray(tree.nodes) || !Array.isArray(tree.edges)) {
    return errorResponse(400, 'invalid_tree', 'The query needs a tree with nodes and edges.');
  }
  if (tree.edges.length < MIN_EDGES) {
    return errorResponse(400, 'invalid_tree', 'Draw at least four branches before searching.');
  }
  if (tree.nodes.length > MAX_NODES) {
    return errorResponse(400, 'invalid_tree', 'That tree is too large to search.');
  }
  if (!Array.isArray(payload.db_configs) || payload.db_configs.length === 0) {
    return errorResponse(400, 'invalid_body', 'Choose at least one database to search.');
  }

  const n = typeof payload.n === 'number' ? Math.min(MAX_RESULTS, Math.max(1, Math.round(payload.n))) : 5;

  return callExplori(env, {
    path: '/api/query',
    method: 'POST',
    body: JSON.stringify({ tree, db_configs: payload.db_configs, n }),
  });
}
