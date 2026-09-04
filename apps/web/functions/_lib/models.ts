/**
 * The model store's front door: `/models/*` streamed out of R2.
 *
 * Why a Function and not a static asset: the detector is 45 MB and Cloudflare
 * Pages caps a static file at 25 MiB, so the model cannot ship with the site.
 * R2 has no egress charge, and a `GetObject` is a read of a fraction of a cent
 * per thousand, so the model lives there at immutable versioned keys and this
 * serves it from the site's own origin — same-origin for the web app, so the
 * page's `require-corp` is satisfied without a cross-origin dance, and with
 * CORS open so the desktop shell can fetch the same files from its own origin.
 *
 * Two cache lifetimes. Versioned objects (`cp-detector/<id>/…`) never change
 * and are immutable for a year, at the browser and at the edge — the edge
 * cache is what keeps R2 reads to one per location per version. The registry
 * (`registry.json`) is the pointer that moves, so it is fresh within five
 * minutes.
 */

export interface ModelsR2Object {
  body: ReadableStream | null;
  size: number;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
}

export interface ModelsR2Range {
  offset: number;
  length?: number;
}

export interface ModelsR2 {
  get(key: string, options?: { range?: ModelsR2Range }): Promise<ModelsR2Object | null>;
  head(key: string): Promise<ModelsR2Object | null>;
}

export interface ModelsEnv {
  MODELS_R2: ModelsR2;
}

export interface ModelsEdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface ModelsContext {
  request: Request;
  env: ModelsEnv;
  params: { path?: string | string[] };
  waitUntil?: (promise: Promise<unknown>) => void;
}

export const REGISTRY_KEY = 'registry.json';
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The R2 key for a request path, or null for anything that is not a plain
 * `family/id/file` (or the registry): no traversal, no hidden files, nothing
 * that is not JSON or ONNX.
 */
export function modelKey(path: string | string[] | undefined): string | null {
  const segments = (Array.isArray(path) ? path : (path ?? '').split('/')).filter(
    (segment) => segment.length > 0
  );
  if (segments.length === 1 && segments[0] === REGISTRY_KEY) return REGISTRY_KEY;
  if (segments.length !== 3) return null;
  if (!segments.every((segment) => SEGMENT.test(segment) && segment !== '..')) return null;
  const file = segments[2];
  if (!file.endsWith('.onnx') && !file.endsWith('.json')) return null;
  return segments.join('/');
}

export function cacheControlFor(key: string): string {
  return key === REGISTRY_KEY
    ? 'public, max-age=300, must-revalidate'
    : 'public, max-age=31536000, immutable';
}

function contentTypeFor(key: string): string {
  return key.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream';
}

/** `bytes=a-b` / `bytes=a-`, the one range form a download resumer or a first-byte probe sends. */
export function parseRange(header: string | null, size: number): ModelsR2Range | null {
  if (!header) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const offset = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Number(match[2]);
  if (!(offset >= 0) || offset >= size || end < offset) return null;
  return { offset, length: Math.min(end, size - 1) - offset + 1 };
}

function baseHeaders(key: string, object: ModelsR2Object): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', contentTypeFor(key));
  headers.set('Cache-Control', cacheControlFor(key));
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, ETag');
  headers.set('X-Content-Type-Options', 'nosniff');
  return headers;
}

function notFound(): Response {
  return new Response(JSON.stringify({ code: 'not_found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Serve one model object. Whole GETs of immutable keys go through the edge
 * cache; ranged reads and the registry go straight to R2.
 */
export async function handleModels(
  context: ModelsContext,
  edgeCache: ModelsEdgeCache | null
): Promise<Response> {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD, OPTIONS' } });
  }
  const key = modelKey(context.params.path);
  if (!key) return notFound();

  const cacheable = key !== REGISTRY_KEY && method === 'GET' && !request.headers.has('Range');
  const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' });
  if (cacheable && edgeCache) {
    const hit = await edgeCache.match(cacheKey);
    if (hit) return hit;
  }

  const head = await env.MODELS_R2.head(key);
  if (!head) return notFound();

  const range = method === 'GET' ? parseRange(request.headers.get('Range'), head.size) : null;
  if (request.headers.has('Range') && method === 'GET' && !range) {
    const headers = baseHeaders(key, head);
    headers.set('Content-Range', `bytes */${head.size}`);
    return new Response(null, { status: 416, headers });
  }

  if (method === 'HEAD') {
    const headers = baseHeaders(key, head);
    headers.set('Content-Length', String(head.size));
    return new Response(null, { status: 200, headers });
  }

  const object = await env.MODELS_R2.get(key, range ? { range } : undefined);
  if (!object) return notFound();
  const headers = baseHeaders(key, object);
  if (range) {
    const end = range.offset + (range.length ?? head.size - range.offset) - 1;
    headers.set('Content-Range', `bytes ${range.offset}-${end}/${head.size}`);
    headers.set('Content-Length', String(end - range.offset + 1));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(head.size));
  const response = new Response(object.body, { status: 200, headers });
  if (cacheable && edgeCache) {
    const stored = edgeCache.put(cacheKey, response.clone());
    if (context.waitUntil) context.waitUntil(stored);
    else await stored;
  }
  return response;
}
