import {
  callExplori,
  errorResponse,
  underRateLimit,
  type ExploriContext,
} from '../../_lib/explori';

/**
 * `GET /api/explori/tiling?id&N&sym` — one tiling, by its exact id.
 *
 * The endpoint a saved design reaches for, and the only one that returns folding
 * references. A tiling id is immutable, so the response is cached hard: a repeat
 * view, or reopening a file, need never touch upstream again.
 */

const RATE_LIMIT = 120;
const RATE_WINDOW_SECONDS = 60;
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

  if (!(await underRateLimit(env, request, RATE_LIMIT, RATE_WINDOW_SECONDS))) {
    return errorResponse(429, 'rate_limited', 'Too many requests — try again shortly.');
  }

  const response = await callExplori(env, {
    path: `/api/fetch_tiling?id=${id}&N=${N}&sym=${encodeURIComponent(symmetry)}`,
    method: 'GET',
  });
  if (!response.ok) return response;
  const cached = new Response(response.body, response);
  cached.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}, immutable`);
  return cached;
}
