import {
  type CpShareContext,
  readShare,
  readShareIdParam,
  shareUrl,
  thumbnailUrl,
  withSecurityHeaders,
} from '../_lib/cpShare';
import { renderSharedCpHtml, type ShareCardMeta } from '../_lib/cpShareHtml';

/**
 * Ask the asset handler for `index.html` **unconditionally**.
 *
 * Every share serves the same underlying `index.html`, so its ETag is the same for every
 * link. A client that has seen any other page will therefore send `If-None-Match` and the
 * asset handler will answer `304 Not Modified` — with no body to rewrite, and at a status
 * that legally cannot carry one. That is not merely a crash (`new Response(html, {status:
 * 304})` throws): a 304 means the client reuses its cached copy, so the share's OpenGraph
 * tags and inlined payload would never reach it at all.
 *
 * Stripping the validators is what makes the per-share rewrite reachable. The response we
 * send is marked `must-revalidate`, so nothing downstream caches it either.
 */
function unconditional(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete('If-None-Match');
  headers.delete('If-Modified-Since');
  return new Request(request.url, { method: request.method, headers });
}

/**
 * Serve a shared crease pattern.
 *
 * Does two jobs in one KV read: writes the OpenGraph card (crawlers do not run JS, which
 * is the entire reason this scheme is server-backed rather than fragment-based) and
 * inlines the payload so the SPA renders the pattern with no follow-up request.
 */
async function handleShare(context: CpShareContext, includeBody: boolean): Promise<Response> {
  const shareId = readShareIdParam(context.params.shareId);
  const response = await context.next(unconditional(context.request));

  // Not a share-shaped id — a truncated paste, a crawler probing, `/s` on its own. Serve
  // the SPA untouched and, critically, without a KV read: null reads are billed, and an
  // exhausted free-plan read quota takes every real link down until 00:00 UTC.
  if (!shareId) return withIsolationHeaders(response);

  // Anything that is not an HTML body is not ours to rewrite — an error page, a redirect,
  // or a status that cannot carry a body at all.
  const contentType = response.headers.get('Content-Type') || '';
  if (!response.ok || !contentType.includes('text/html')) {
    return withIsolationHeaders(response);
  }

  const share = await readShare(context.env, shareId);
  if (!share) return withIsolationHeaders(response);

  const origin = new URL(context.request.url).origin;
  const meta: ShareCardMeta = {
    id: share.id,
    title: share.title,
    author: share.author,
    shareUrl: shareUrl(origin, share.id),
    imageUrl: thumbnailUrl(origin, share.id),
  };

  const html = renderSharedCpHtml(await response.text(), meta, share.payload);
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  // Per-share HTML: never shared between links, and cheap to regenerate.
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  // Both are the upstream asset's, and neither describes what we just built.
  headers.delete('Content-Length');
  headers.delete('ETag');

  // A HEAD reply must carry the headers and none of the body. Building it from `html`
  // and trusting the runtime to strip it would send a Content-Length nothing follows.
  return withIsolationHeaders(new Response(includeBody ? html : null, { status: 200, headers }));
}

/**
 * Re-assert cross-origin isolation.
 *
 * `public/_headers` sets COOP/COEP for static assets, but Cloudflare Pages does not apply
 * `_headers` to Function responses. Without this, `/s/<id>` would be the one entry path
 * where `SharedArrayBuffer` is unavailable — a bug that would only ever reproduce for
 * people arriving from a shared link.
 *
 * The CP wasm module's memory is **not** shared (`flags 0x0`), so the engine boots without
 * isolation; the earlier claim here that it "fails to boot" was wrong. What actually
 * depends on `SharedArrayBuffer` is stopping a running fold — the only channel that reaches
 * a worker blocked inside the kernel. Lose these headers and folds still run, but the Stop
 * button reports itself unavailable (see `store/workspaceStore/foldCancellation.ts`).
 */
function withIsolationHeaders(response: Response): Response {
  const headers = withSecurityHeaders(new Headers(response.headers));
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function onRequestGet(context: CpShareContext): Promise<Response> {
  return handleShare(context, true);
}

export async function onRequestHead(context: CpShareContext): Promise<Response> {
  return handleShare(context, false);
}
