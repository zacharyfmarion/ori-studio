import {
  type CpShareContext,
  readShare,
  readShareIdParam,
  shareUrl,
  thumbnailUrl,
} from '../_lib/cpShare';
import { renderSharedCpHtml, type ShareCardMeta } from '../_lib/cpShareHtml';

/**
 * Serve a shared crease pattern.
 *
 * Does two jobs in one KV read: writes the OpenGraph card (crawlers do not run JS, which
 * is the entire reason this scheme is server-backed rather than fragment-based) and
 * inlines the payload so the SPA renders the pattern with no follow-up request.
 */
async function handleShare(context: CpShareContext): Promise<Response> {
  const shareId = readShareIdParam(context.params.shareId);
  const response = await context.next();

  // Not a share-shaped id — a truncated paste, a crawler probing, `/s` on its own. Serve
  // the SPA untouched and, critically, without a KV read: null reads are billed, and an
  // exhausted free-plan read quota takes every real link down until 00:00 UTC.
  if (!shareId) return withIsolationHeaders(response);

  const share = await readShare(context.env, shareId);
  if (!share) return withIsolationHeaders(response);

  const origin = new URL(context.request.url).origin;
  const meta: ShareCardMeta = {
    id: share.id,
    title: share.title,
    author: share.author,
    creaseCount: share.creaseCount,
    shareUrl: shareUrl(origin, share.id),
    imageUrl: thumbnailUrl(origin, share.id),
  };

  const html = renderSharedCpHtml(await response.text(), meta, share.payload);
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  // Per-share HTML: never shared between links, and cheap to regenerate.
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  headers.delete('Content-Length');

  return withIsolationHeaders(
    new Response(html, { status: response.status, statusText: response.statusText, headers })
  );
}

/**
 * Re-assert cross-origin isolation.
 *
 * `public/_headers` sets COOP/COEP for static assets, but Cloudflare Pages does not apply
 * `_headers` to Function responses. Without this, `/s/<id>` would be the one entry path
 * where `SharedArrayBuffer` is unavailable and the wasm engine fails to boot — a bug that
 * would only ever reproduce for people arriving from a shared link.
 */
function withIsolationHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function onRequestGet(context: CpShareContext): Promise<Response> {
  return handleShare(context);
}

export async function onRequestHead(context: CpShareContext): Promise<Response> {
  return handleShare(context);
}
