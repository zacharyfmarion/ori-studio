import { callExplori, errorResponse, withEdgeCache, type ExploriContext } from '../../_lib/explori';

/**
 * `GET /api/explori/tiling?id&N&sym` — one tiling, by its exact id.
 *
 * The endpoint a saved design reaches for, and the only one that returns folding
 * references. A tiling id is immutable, so the response is cached for a year —
 * in the *edge* cache, not merely with a header. Setting `Cache-Control` alone
 * was not enough: Cloudflare does not cache a Pages Function response on its
 * strength, so that only ever bought the one browser's cache, and every other
 * visitor still reached upstream.
 *
 * There is no rate limiter here, deliberately — see `_lib/explori.ts`.
 */

const SYMMETRIES = new Set(['diag', 'book', 'none']);
/** A year. The archive may gain tilings; it does not rewrite the ones it has. */
const CACHE_SECONDS = 31_536_000;

export async function onRequestGet(context: ExploriContext): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = Number.parseInt(url.searchParams.get('id') ?? '', 10);
  const N = Number.parseInt(url.searchParams.get('N') ?? '', 10);
  const symmetry = url.searchParams.get('sym') ?? '';

  if (!Number.isInteger(id) || id < 0) {
    return errorResponse(400, 'invalid_id', 'A tiling id is required.');
  }
  if (!Number.isInteger(N) || N < 1 || N > 10) {
    return errorResponse(400, 'invalid_id', 'That tiling size does not exist.');
  }
  if (!SYMMETRIES.has(symmetry)) {
    return errorResponse(400, 'invalid_id', 'That symmetry does not exist.');
  }

  // Keyed on the validated triple rather than the caller's URL, so parameter
  // order or stray extras cannot mint a second entry for the same tiling.
  const key = new Request(
    `${url.origin}${url.pathname}?id=${id}&N=${N}&sym=${encodeURIComponent(symmetry)}`,
    { method: 'GET' }
  );
  return withEdgeCache(context, key, CACHE_SECONDS, () =>
    callExplori(env, {
      path: `/api/fetch_tiling?id=${id}&N=${N}&sym=${encodeURIComponent(symmetry)}`,
      method: 'GET',
    })
  , ', immutable');
}
