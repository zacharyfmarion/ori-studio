import {
  type CpShareContext,
  hashToken,
  isPng,
  json,
  MAX_THUMBNAIL_BYTES,
  readShare,
  readShareIdParam,
  thumbnailObjectKey,
  thumbnailUrl,
  withSecurityHeaders,
} from '../../../_lib/cpShare';

/** Cache lifetime for the placeholder served when a share has no thumbnail yet. */
const FALLBACK_CACHE_CONTROL = 'public, max-age=60';
/** Real thumbnails never change, and expire from R2 rather than being replaced. */
const THUMBNAIL_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/**
 * Serve the generic card for a share whose thumbnail is missing — not yet uploaded, upload
 * failed, or expired by the R2 lifecycle rule after a year.
 *
 * Bytes rather than a redirect: crawler redirect-following is inconsistent, and an
 * `og:image` that 302s is an `og:image` some platforms silently drop. Serving *something*
 * unconditionally is what lets `/s/<id>` emit `og:image` and `summary_large_image` without
 * knowing whether an upload ever happened.
 */
async function serveFallbackCard(request: Request, includeBody: boolean): Promise<Response> {
  const origin = new URL(request.url).origin;
  const upstream = await fetch(`${origin}/og-default.png`);
  if (!upstream.ok) {
    return json({ error: 'Thumbnail not found.', code: 'not_found' }, { status: 404 });
  }
  return new Response(includeBody ? upstream.body : null, {
    headers: withSecurityHeaders(
      new Headers({ 'Content-Type': 'image/png', 'Cache-Control': FALLBACK_CACHE_CONTROL })
    ),
  });
}

async function serveThumbnail(context: CpShareContext, includeBody: boolean): Promise<Response> {
  const id = readShareIdParam(context.params.id);
  if (!id) {
    return json({ error: 'Not a share link.', code: 'bad_id' }, { status: 400 });
  }

  // R2 directly, with no KV read: whether a thumbnail exists is a question R2 can answer,
  // and asking it here is what removes the second KV write from share creation.
  const key = thumbnailObjectKey(id);
  const object = includeBody
    ? await context.env.SHARE_R2.get(key)
    : await context.env.SHARE_R2.head(key);
  if (!object) {
    return serveFallbackCard(context.request, includeBody);
  }

  const headers = withSecurityHeaders(new Headers());
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', THUMBNAIL_CACHE_CONTROL);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'image/png');
  return new Response(includeBody ? object.body : null, { headers });
}

export async function onRequestGet(context: CpShareContext): Promise<Response> {
  return serveThumbnail(context, true);
}

export async function onRequestHead(context: CpShareContext): Promise<Response> {
  return serveThumbnail(context, false);
}

/**
 * Upload the preview card, once.
 *
 * The token is minted at share creation, returned to the creator's browser, and never
 * stored in plaintext — only its SHA-256 lives in the record. Existence in R2 is the
 * write-once gate, so a second upload is a 409 without a KV write.
 */
export async function onRequestPut(context: CpShareContext): Promise<Response> {
  const id = readShareIdParam(context.params.id);
  if (!id) {
    return json({ error: 'Not a share link.', code: 'bad_id' }, { status: 400 });
  }

  if (!(context.request.headers.get('Content-Type') || '').includes('image/png')) {
    return json({ error: 'Expected image/png.', code: 'bad_request' }, { status: 400 });
  }

  const token = bearerToken(context.request);
  if (!token) {
    return json({ error: 'Missing upload token.', code: 'unauthorized' }, { status: 401 });
  }

  const share = await readShare(context.env, id);
  if (!share) {
    return json({ error: 'This crease pattern no longer exists.', code: 'not_found' }, { status: 404 });
  }
  if (!share.thumbnailUploadTokenHash) {
    return json({ error: 'This share cannot accept a preview image.', code: 'conflict' }, { status: 409 });
  }
  if ((await hashToken(token)) !== share.thumbnailUploadTokenHash) {
    return json({ error: 'Invalid upload token.', code: 'unauthorized' }, { status: 401 });
  }

  const key = thumbnailObjectKey(id);
  if (await context.env.SHARE_R2.head(key)) {
    return json({ error: 'A preview image already exists.', code: 'conflict' }, { status: 409 });
  }

  const bytes = await context.request.arrayBuffer();
  if (bytes.byteLength === 0) {
    return json({ error: 'Empty preview image.', code: 'bad_request' }, { status: 400 });
  }
  if (bytes.byteLength > MAX_THUMBNAIL_BYTES) {
    return json({ error: 'Preview image is too large.', code: 'payload_too_large' }, { status: 413 });
  }
  // `Content-Type: image/png` is the uploader's claim. These eight bytes are the fact, and
  // this endpoint serves what it stores back from our own origin.
  if (!isPng(bytes)) {
    return json({ error: 'Expected a PNG image.', code: 'bad_request' }, { status: 400 });
  }

  await context.env.SHARE_R2.put(key, bytes, {
    httpMetadata: { contentType: 'image/png', cacheControl: THUMBNAIL_CACHE_CONTROL },
  });

  return json({ thumbnailUrl: thumbnailUrl(new URL(context.request.url).origin, id) });
}
