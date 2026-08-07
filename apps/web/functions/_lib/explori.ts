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
 * - **It caches.** Every response is served from the edge cache when we have
 *   already asked upstream the same question. This is the whole of our
 *   load courtesy: it removes requests rather than refusing them.
 *
 * **Deliberately absent: a rate limiter.** There was one — a per-IP KV counter —
 * removed on purpose, so please do not re-add one by reflex. It bounded nothing
 * that mattered (per-IP, so no cap on the aggregate load that is the only
 * quantity the archive's server cares about); it was trivially bypassed, since
 * that server is directly reachable without this hop; it failed open exactly
 * when traffic was highest; and it spent a KV write per request from the same
 * 1,000/day budget share links depend on, so a busy day here broke share links
 * for everyone.
 *
 * Throttling is the archive owner's call, not ours: he knows his headroom and we
 * do not, so any number we invented would be a guess. What we owe instead, and
 * what this proxy does, is send nothing pathological (the validation in
 * `query.ts`), send nothing avoidable (the cache), never retry — no path here or
 * in the client does — and stay identifiable through {@link EXPLORI_USER_AGENT},
 * so he can throttle or block Ori Studio as one client, at his own edge, on his
 * own terms.
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
  waitUntil?: (promise: Promise<unknown>) => void;
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

/**
 * Serve from the edge cache, or ask upstream and fill it.
 *
 * `caches.default` is edge-local and free — no quota, unlike the KV counter this
 * replaced. It is per-colo rather than global, so a fill in one city does not
 * help another; that still removes the pattern that dominates in practice, which
 * is the same person asking the same thing again.
 *
 * Failures are never cached: a timeout or a 502 must not become what every
 * caller gets for the rest of the TTL.
 */
export async function withEdgeCache(
  context: ExploriContext,
  key: Request,
  maxAgeSeconds: number,
  produce: () => Promise<Response>,
  directives = ''
): Promise<Response> {
  // Absent under vitest and `wrangler dev --local`; the endpoint still works
  // there, it just asks upstream every time.
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!cache) return produce();

  const hit = await cache.match(key);
  if (hit) {
    const served = new Response(hit.body, hit);
    served.headers.set('X-Ori-Cache', 'hit');
    return served;
  }

  const response = await produce();
  if (!response.ok) return response;

  const fresh = new Response(response.body, response);
  fresh.headers.set('Cache-Control', `public, max-age=${maxAgeSeconds}${directives}`);
  fresh.headers.set('X-Ori-Cache', 'miss');
  // Backgrounded: filling the cache must not delay an answer we already have.
  const put = cache.put(key, fresh.clone());
  if (context.waitUntil) context.waitUntil(put);
  else await put;
  return fresh;
}

/**
 * A cache key for a request whose identity is its *body*.
 *
 * The Cache API keys on a GET URL, so a POST needs a stand-in. The body hashes
 * cleanly because `query.ts` rebuilds it from validated fields in a fixed order
 * before this sees it: two equivalent searches produce byte-identical JSON, and
 * so the same key.
 */
export async function bodyCacheKey(request: Request, canonicalBody: string): Promise<Request> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalBody));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const url = new URL(request.url);
  url.search = `?body=${hex}`;
  return new Request(url.toString(), { method: 'GET' });
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
