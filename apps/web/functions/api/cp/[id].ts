import { type CpShareContext, json, readShareIdParam, readShare } from '../../_lib/cpShare';

/**
 * Fetch a share record as JSON.
 *
 * **Not on the happy path.** `/s/<id>` inlines the payload into the HTML it already
 * generates, so opening a link makes no request here at all — that is what halves the KV
 * read cost per click. This endpoint exists for the eventual-consistency retry (a link
 * pasted across continents can 404 for up to a minute) and because a JSON shape is what
 * anything built later will want.
 */
export async function onRequestGet(context: CpShareContext): Promise<Response> {
  // Shape first, before any KV access: null reads are billed, and on the free plan an
  // exhausted read quota takes every real link down until 00:00 UTC.
  const id = readShareIdParam(context.params.id);
  if (!id) {
    return json({ error: 'Not a share link.', code: 'bad_id' }, { status: 400 });
  }

  const share = await readShare(context.env, id);
  if (!share) {
    return json(
      { error: 'This crease pattern no longer exists.', code: 'not_found' },
      { status: 404 },
    );
  }

  return json(
    {
      id: share.id,
      payload: share.payload,
      title: share.title,
      author: share.author,
      createdAt: share.createdAt,
    },
    // Records are immutable, so a client that retries after a consistency miss can cache
    // the result — but only briefly, because the miss it is retrying is itself a cache
    // artifact.
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}
