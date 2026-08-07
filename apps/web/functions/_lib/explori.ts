/**
 * Shared plumbing for the ExplOri search proxy.
 *
 * Ori Studio does not call `225.designorigami.net` from the browser, and cannot:
 * that server sends no `Access-Control-Allow-Origin` and answers `OPTIONS` with
 * 501, so a JSON POST from our origin dies at the preflight. This is the hop
 * that makes the feature possible — and it earns its keep three more ways:
 *
 * - **It strips the dead weight.** `bundle_pickle_b64` is 47% of a query
 *   response and is a Python pickle no browser client can use (nor should ever
 *   deserialize); `heat` is another ~3.7 KB per result and feeds a normalization
 *   upstream's own results grid has stopped using. Dropping both roughly halves
 *   the bytes we ask a user to download.
 * **Deliberately absent: rate limiting and caching.** Both were here and both
 * were removed on purpose, so please do not add either back by reflex.
 *
 * Throttling and caching belong to the service that owns the resource. It knows
 * its capacity and its data's freshness; we know neither, so anything we chose
 * would be a guess — and our guesses cost real money and real complexity. The
 * rate limiter was a per-IP KV counter that bounded no aggregate, was bypassable
 * since the archive is directly reachable without this hop, failed open under
 * load, and spent a write per request from the same daily budget share links
 * depend on. The cache that briefly replaced it keyed on hand-drawn coordinates,
 * so it almost never hit.
 *
 * What is left is what a proxy is actually for: it exists because CORS makes the
 * direct call impossible, it halves the bytes, it gives one stable error shape,
 * and it identifies our traffic. That is the whole job.
 *
 * Binding shapes are declared locally rather than pulled from
 * `@cloudflare/workers-types`, matching `cpShare.ts`: the surface used is small
 * and stable, so this stays typechecked with no dependency.
 */

export interface Env {
  /** Overridable so a staging deploy can point somewhere else. */
  EXPLORI_ORIGIN?: string;
}

export interface ExploriContext {
  request: Request;
  env: Env;
}

export const DEFAULT_EXPLORI_ORIGIN = 'https://225.designorigami.net';

/** Identifies our traffic in upstream's logs, so they can see what we send. */
export const EXPLORI_USER_AGENT = 'OriStudio/1.0 (+https://github.com/zacharyfmarion/ori-studio)';

/** Upstream is a single small server; a slow query is better than a wrong one. */
export const UPSTREAM_TIMEOUT_MS = 40_000;

export function jsonResponse(status: number, payload: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function errorResponse(status: number, code: string, error: string): Response {
  return jsonResponse(status, { code, error });
}

/**
 * Drop the two fields nothing downstream reads.
 *
 * Deliberately a *removal* rather than a whitelist: upstream is unversioned and
 * may add fields, and a whitelist here would silently discard them, turning "we
 * do not use that yet" into "we cannot see it".
 */
export function trimExploriBundle(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const bundle = { ...(payload as Record<string, unknown>) };
  delete bundle.bundle_pickle_b64;
  if (Array.isArray(bundle.results)) {
    bundle.results = bundle.results.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
      const result = { ...(entry as Record<string, unknown>) };
      delete result.heat;
      return result;
    });
  }
  return bundle;
}

export interface UpstreamCall {
  path: string;
  method: 'GET' | 'POST';
  body?: string;
}

/** Call upstream and hand back the trimmed JSON, or a typed error response. */
export async function callExplori(env: Env, call: UpstreamCall): Promise<Response> {
  const origin = env.EXPLORI_ORIGIN ?? DEFAULT_EXPLORI_ORIGIN;
  let upstream: Response;
  try {
    upstream = await fetch(`${origin}${call.path}`, {
      method: call.method,
      headers: {
        'User-Agent': EXPLORI_USER_AGENT,
        ...(call.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: call.body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return errorResponse(504, 'upstream_unreachable', 'The ExplOri search service did not respond.');
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    // Upstream answers a timeout with an HTML error page. Passing that through
    // as-is would make every client re-derive what it means.
    const isHtml = text.trim().toLowerCase().startsWith('<');
    return errorResponse(
      upstream.status === 400 ? 400 : 502,
      isHtml ? 'upstream_timeout' : 'upstream_error',
      isHtml ? 'The search service timed out.' : text.slice(0, 200) || 'The search service failed.'
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return errorResponse(502, 'upstream_error', 'The search service sent an unreadable response.');
  }
  return jsonResponse(200, trimExploriBundle(payload));
}
