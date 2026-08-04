import {
  type CpShareContext,
  type CpShareRecord,
  enforceRateLimit,
  hashToken,
  json,
  MAX_PAYLOAD_BYTES,
  randomShareId,
  randomToken,
  readShare,
  sanitizeAuthor,
  sanitizeCreaseCount,
  sanitizeTitle,
  shareUrl,
  storageFailure,
  validatePayload,
  writeShare,
} from '../_lib/cpShare';

interface CreateCpShareBody {
  payload?: unknown;
  title?: unknown;
  author?: unknown;
  creaseCount?: unknown;
}

/**
 * Create a share link.
 *
 * **Two** KV writes: the rate-limit counter and the record. That puts the free-plan
 * creation ceiling at 500 shares/day. The third write openscad-studio makes — stamping
 * `thumbnailKey` onto the record after upload — is avoided by deriving thumbnail
 * existence from R2 instead.
 */
export async function onRequestPost(context: CpShareContext): Promise<Response> {
  const { request, env } = context;

  if (!(request.headers.get('Content-Type') || '').includes('application/json')) {
    return json({ error: 'Expected application/json.', code: 'bad_request' }, { status: 400 });
  }

  let body: CreateCpShareBody;
  try {
    body = (await request.json()) as CreateCpShareBody;
  } catch {
    return json({ error: 'Malformed request body.', code: 'bad_request' }, { status: 400 });
  }

  const payloadError = validatePayload(body.payload);
  if (payloadError) {
    // Size gets 413 so the client can say something specific; everything else is a 400.
    const tooLarge = typeof body.payload === 'string' && body.payload.length > MAX_PAYLOAD_BYTES;
    return json(
      { error: payloadError, code: tooLarge ? 'payload_too_large' : 'bad_request' },
      { status: tooLarge ? 413 : 400 }
    );
  }

  const payload = body.payload as string;
  const title = sanitizeTitle(body.title);
  const author = sanitizeAuthor(body.author);
  const creaseCount = sanitizeCreaseCount(body.creaseCount);
  const thumbnailUploadToken = randomToken();
  const now = new Date();

  // Every KV access lives inside this try, rate limiting included. The rate-limit counter
  // is itself a KV write, so on a free-plan quota exhaustion it is the *first* thing to
  // throw — running it outside would surface the outage as an unhandled rejection and a
  // bare 500 rather than the 503 the client can explain.
  try {
    const limited = await enforceRateLimit(context, now);
    if (limited) return limited;

    // The collision check is a courtesy, not a guarantee — KV is eventually consistent, so
    // a concurrent write may not be visible here. What actually protects us is entropy:
    // 62^8 = 2.2e14, so at a million shares the birthday probability is ~0.2%.
    let id = '';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = randomShareId();
      if (!(await readShare(env, candidate))) {
        id = candidate;
        break;
      }
    }
    if (!id) {
      return json(
        { error: 'Could not create a share link right now.', code: 'id_collision' },
        { status: 500 }
      );
    }

    const record: CpShareRecord = {
      id,
      payload,
      title,
      author,
      createdAt: now.toISOString(),
      creaseCount,
      thumbnailUploadTokenHash: await hashToken(thumbnailUploadToken),
    };
    await writeShare(env, record);

    return json({
      id,
      url: shareUrl(new URL(request.url).origin, id),
      thumbnailUploadToken,
    });
  } catch (error) {
    return storageFailure(error);
  }
}
