import type { ExploriDocument } from './document';
import { exploriEdgeLength } from './document';
import type {
  ExploriCp,
  ExploriDbConfig,
  ExploriFold,
  ExploriGraph,
  ExploriQueryResponse,
  ExploriResult,
  ExploriSymmetry,
  ExploriTilingRef,
} from './types';
import { EXPLORI_SYMMETRIES } from './types';

/**
 * Client for the ExplOri search API.
 *
 * It talks to **our** proxy, never to `225.designorigami.net` directly, and not
 * as a matter of taste: that server sends no `Access-Control-Allow-Origin` and
 * answers `OPTIONS` with 501, so a JSON POST from a browser dies at the
 * preflight and the request never happens. The proxy also strips the 47% of
 * every response that is a Python pickle no client can use, rate-limits us so a
 * bug here cannot hammer someone's personal server, and caches tilings by id.
 *
 * Everything crossing this boundary is validated. The upstream API carries no
 * version and can change without notice, so a response is treated as untrusted
 * input rather than as the shape we expect.
 */

/** Where the proxy lives. Same origin in production; overridable for dev. */
export function exploriApiBase(): string {
  const configured = import.meta.env.VITE_EXPLORI_API_URL;
  if (typeof configured === 'string' && configured.length > 0) return configured;
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/** Upstream's own floor: fewer edges than this and it refuses the query. */
export const EXPLORI_MIN_EDGES = 4;

export type ExploriErrorCode =
  | 'network'
  | 'timeout'
  | 'upstream_error'
  | 'invalid_tree'
  | 'rate_limited'
  | 'unknown';

export class ExploriError extends Error {
  readonly code: ExploriErrorCode;

  constructor(code: ExploriErrorCode, message: string) {
    super(message);
    this.name = 'ExploriError';
    this.code = code;
  }
}

/**
 * The tree, in the shape the archive expects.
 *
 * Lengths are sent in **tree units, unscaled**. The embedding weights each edge
 * by `1/length`, so the Laplacian spectrum is not scale-invariant and the
 * absolute numbers change which patterns come back — a tree sent at twice the
 * size is a different query, not the same one drawn larger.
 */
export function exploriQueryTree(document: ExploriDocument): {
  nodes: { id: number; x: number; y: number }[];
  edges: { u: number; v: number; length: number }[];
} {
  return {
    nodes: document.nodes.map((node) => ({ id: node.id, x: node.loc.x, y: node.loc.y })),
    edges: document.edges.map((edge) => ({
      u: edge.vertices[0],
      v: edge.vertices[1],
      length: Math.max(1e-5, exploriEdgeLength(document, edge)),
    })),
  };
}

/**
 * Databases to query, including upstream's one hardcoded quirk: choosing
 * `5 book` also searches `6 book`, which is not offered separately.
 */
export function exploriDbConfigsForQuery(configs: readonly ExploriDbConfig[]): ExploriDbConfig[] {
  const out = [...configs];
  if (configs.some((config) => config.N === 5 && config.symmetry === 'book')) {
    out.push({ N: 6, symmetry: 'book' });
  }
  return out;
}

/** Why a search cannot run yet, or null when it can. */
export function exploriQueryBlocker(document: ExploriDocument): 'too-simple' | 'no-database' | null {
  if (document.edges.length < EXPLORI_MIN_EDGES) return 'too-simple';
  if (document.dbConfigs.length === 0) return 'no-database';
  return null;
}

const REQUEST_TIMEOUT_MS = 45_000;

async function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${exploriApiBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: composed,
    });
  } catch (error) {
    if (timeout.aborted) throw new ExploriError('timeout', 'The search timed out.');
    if (signal?.aborted) throw error;
    throw new ExploriError('network', 'Could not reach the ExplOri search service.');
  }
  return readResponse(response);
}

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${exploriApiBase()}${path}`, { signal: composed });
  } catch (error) {
    if (timeout.aborted) throw new ExploriError('timeout', 'The request timed out.');
    if (signal?.aborted) throw error;
    throw new ExploriError('network', 'Could not reach the ExplOri search service.');
  }
  return readResponse(response);
}

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Upstream answers a timeout with an HTML error page rather than JSON, which
    // their own client special-cases too. Reporting "invalid JSON" here would
    // name the symptom instead of the cause.
    if (text.trim().toLowerCase().startsWith('<')) {
      throw new ExploriError('timeout', 'The search service timed out.');
    }
    throw new ExploriError('upstream_error', 'The search service sent an unreadable response.');
  }
  if (!response.ok) {
    const record = isRecord(payload) ? payload : {};
    const code = typeof record.code === 'string' ? record.code : '';
    const message = typeof record.error === 'string' ? record.error : '';
    if (response.status === 429 || code === 'rate_limited') {
      throw new ExploriError('rate_limited', 'Too many searches just now — try again shortly.');
    }
    if (response.status === 400) {
      throw new ExploriError('invalid_tree', message || 'The search service refused this tree.');
    }
    throw new ExploriError('upstream_error', message || 'The search service returned an error.');
  }
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function numberField(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseCp(value: unknown): ExploriCp | null {
  if (!isRecord(value) || !Array.isArray(value.vertices) || !Array.isArray(value.edges)) return null;
  const vertices: number[][] = [];
  for (const entry of value.vertices) {
    if (!Array.isArray(entry) || entry.length < 8) return null;
    const components = entry.map((component) => numberField(component, Number.NaN));
    if (components.some((component) => !Number.isFinite(component))) return null;
    // A zero denominator is the one value that turns an exact rational into a
    // non-finite coordinate, and it would propagate silently into the geometry.
    if (components[1] === 0 || components[3] === 0 || components[5] === 0 || components[7] === 0) {
      return null;
    }
    vertices.push(components);
  }
  const edges: ExploriCp['edges'] = [];
  for (const entry of value.edges) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const [from, to, lineType] = entry as unknown[];
    if (typeof from !== 'number' || typeof to !== 'number') continue;
    if (!vertices[from] || !vertices[to]) continue;
    edges.push([from, to, String(lineType ?? '') as ExploriCp['edges'][number][2]]);
  }
  return { vertices, edges };
}

function parseFold(value: unknown): ExploriFold | null {
  if (!isRecord(value) || !Array.isArray(value.faces)) return null;
  const faces: [number, number][][] = [];
  for (const face of value.faces) {
    if (!Array.isArray(face)) continue;
    const points: [number, number][] = [];
    for (const point of face) {
      if (!Array.isArray(point) || point.length < 2) continue;
      points.push([numberField(point[0]), numberField(point[1])]);
    }
    if (points.length >= 3) faces.push(points);
  }
  const multiplicities = Array.isArray(value.multiplicities)
    ? value.multiplicities.map((entry) => Math.max(1, Math.round(numberField(entry, 1))))
    : [];
  return { faces, multiplicities };
}

function parseGraph(value: unknown): ExploriGraph | null {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null;
  const nodes: ExploriGraph['nodes'] = [];
  for (const entry of value.nodes) {
    if (!isRecord(entry)) continue;
    const id = entry.id;
    if (typeof id !== 'number' && typeof id !== 'string') continue;
    const pos = Array.isArray(entry.pos) && entry.pos.length >= 2
      ? ([numberField(entry.pos[0]), numberField(entry.pos[1])] as [number, number])
      : undefined;
    nodes.push({ id, ...(pos ? { pos } : {}) });
  }
  const edges: ExploriGraph['edges'] = [];
  for (const entry of value.edges) {
    if (!isRecord(entry)) continue;
    const u = entry.u;
    const v = entry.v;
    if ((typeof u !== 'number' && typeof u !== 'string') || (typeof v !== 'number' && typeof v !== 'string')) {
      continue;
    }
    edges.push({ u, v, length: numberField(entry.length, 1) });
  }
  return { nodes, edges };
}

function parseSymmetry(value: unknown): ExploriSymmetry {
  return EXPLORI_SYMMETRIES.includes(value as ExploriSymmetry) ? (value as ExploriSymmetry) : 'none';
}

function parseResult(value: unknown, index: number): ExploriResult | null {
  if (!isRecord(value)) return null;
  const cp = parseCp(value.cp);
  // A result with no crease pattern is the one thing we cannot show or send, so
  // it is dropped rather than rendered as an empty card.
  if (!cp) return null;
  return {
    rank: numberField(value.rank, index + 1),
    distance: numberField(value.distance),
    N: numberField(value.N, 0),
    symmetry: parseSymmetry(value.symmetry),
    topologyId: numberField(value.topology_id, -1),
    tilingId: numberField(value.tiling_id, -1),
    cp,
    packing: parseCp(value.packing) ?? cp,
    fold: parseFold(value.fold),
    tree: parseGraph(value.tree),
    refs: isRecord(value.refs) ? value.refs : {},
  };
}

function parseQueryResponse(payload: unknown): ExploriQueryResponse {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new ExploriError('upstream_error', 'The search service sent an unexpected response.');
  }
  const results = payload.results
    .map((entry, index) => parseResult(entry, index))
    .filter((result): result is ExploriResult => result !== null);
  return {
    queryId: typeof payload.query_id === 'string' ? payload.query_id : '',
    results,
  };
}

export async function queryExplori(
  document: ExploriDocument,
  signal?: AbortSignal
): Promise<ExploriQueryResponse> {
  const blocker = exploriQueryBlocker(document);
  if (blocker === 'too-simple') {
    throw new ExploriError('invalid_tree', 'Draw at least four branches before searching.');
  }
  if (blocker === 'no-database') {
    throw new ExploriError('invalid_tree', 'Choose at least one database to search.');
  }
  const payload = await postJson(
    '/api/explori/query',
    {
      tree: exploriQueryTree(document),
      db_configs: exploriDbConfigsForQuery(document.dbConfigs),
      n: document.resultLimit,
    },
    signal
  );
  return parseQueryResponse(payload);
}

/**
 * One tiling, by its exact id.
 *
 * The endpoint a saved design reaches for: a stored `(N, symmetry, tilingId)`
 * resolves to the same tiling forever, and it is also the only endpoint that
 * returns folding references.
 */
export async function fetchExploriTiling(
  ref: ExploriTilingRef,
  signal?: AbortSignal
): Promise<ExploriResult | null> {
  const query = new URLSearchParams({
    id: String(ref.tilingId),
    N: String(ref.N),
    sym: ref.symmetry,
  });
  const payload = await getJson(`/api/explori/tiling?${query.toString()}`, signal);
  const parsed = parseQueryResponse(payload);
  return parsed.results[0] ?? null;
}
