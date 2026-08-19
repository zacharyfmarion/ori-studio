import { describe, expect, it, vi } from 'vitest';
import {
  type CpShareContext,
  type CpShareR2Object,
  type Env,
  escapeHtmlAttribute,
  escapeJsonForScript,
  enforceRateLimit,
  hashToken,
  isPng,
  isValidShareId,
  MAX_PAYLOAD_BYTES,
  randomShareId,
  RATE_LIMIT_PER_HOUR,
  readShareIdParam,
  sanitizeAuthor,
  sanitizeTitle,
  shareKey,
  validatePayload,
} from '../_lib/cpShare';
import { onRequestPost } from '../api/cp';
import { onRequestGet as getShare } from '../api/cp/[id]';
import {
  onRequestGet as getThumbnail,
  onRequestPut as putThumbnail,
} from '../api/cp/[id]/thumbnail';
import { onRequestGet as getSharePage } from '../s/[[shareId]]';
import { renderSharedCpHtml, shareCardDescription, shareCardTitle } from '../_lib/cpShareHtml';

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="description"
      content="Ori Studio is a web and desktop origami design environment."
    />
    <meta property="og:title" content="Ori Studio" />
    <meta
      property="og:description"
      content="Design origami tree structures."
    />
    <meta property="og:url" content="https://oristudio.pages.dev/" />
    <meta property="og:type" content="website" />
    <title>Ori Studio</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

function createEnv(): Env & { kv: Map<string, string>; r2: Map<string, ArrayBuffer> } {
  const kv = new Map<string, string>();
  const r2 = new Map<string, ArrayBuffer>();
  const asObject = (bytes: ArrayBuffer): CpShareR2Object => ({
    body: null,
    httpEtag: '"fake"',
    writeHttpMetadata: (headers) => headers.set('Content-Type', 'image/png'),
    // Kept so assertions can check what was stored.
    ...({ size: bytes.byteLength } as object),
  });
  return {
    kv,
    r2,
    SHARE_KV: {
      get: async (key) => kv.get(key) ?? null,
      put: async (key, value) => {
        kv.set(key, value);
      },
    },
    SHARE_R2: {
      get: async (key) => (r2.has(key) ? asObject(r2.get(key)!) : null),
      head: async (key) => (r2.has(key) ? asObject(r2.get(key)!) : null),
      put: async (key, value) => {
        r2.set(key, value);
      },
    },
  };
}

function createContext(
  env: Env,
  request: Request,
  params: Record<string, string | string[] | undefined> = {},
  next: (request?: Request) => Promise<Response> = async () =>
    new Response(INDEX_HTML, { headers: { 'Content-Type': 'text/html' } }),
): CpShareContext {
  return { request, env, params, next };
}

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://oristudio.pages.dev/api/cp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const VALID_PAYLOAD = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRob';

describe('share id validation', () => {
  it('accepts 8 to 12 alphanumeric characters', () => {
    // 8 for links minted before ids widened, 10 for what is minted now, and headroom
    // either side so a future change does not invalidate everything already shared.
    expect(isValidShareId('a3bK9xmQ')).toBe(true);
    expect(isValidShareId('a3bK9xmQwe')).toBe(true);
    expect(isValidShareId('a3bK9xmQwert')).toBe(true);
  });

  it('rejects everything else, which is what keeps null reads off the KV quota', () => {
    for (const bad of [
      'a3bK9xm',
      'a3bK9xmQwertyu',
      'a3bK-xmQ',
      'a3bK_xmQ',
      '',
      '../../etc',
      'a3bK9xm ',
    ]) {
      expect(isValidShareId(bad)).toBe(false);
    }
  });

  it('mints ids at the width the collision margin assumes', () => {
    // The 6e-7 birthday probability is a property of the *length*, and the existence check
    // cannot be relied on to catch a collision, so this is the only thing enforcing it.
    expect(randomShareId()).toHaveLength(10);
  });

  it('normalises the route param, including single-element catch-all arrays', () => {
    expect(readShareIdParam('a3bK9xmQwe')).toBe('a3bK9xmQwe');
    expect(readShareIdParam(['a3bK9xmQwe'])).toBe('a3bK9xmQwe');
    expect(readShareIdParam(['a3bK9xmQwe', 'extra'])).toBeNull();
    expect(readShareIdParam(undefined)).toBeNull();
    expect(readShareIdParam('nope')).toBeNull();
  });

  it('generates ids that pass its own validator', () => {
    for (let i = 0; i < 200; i += 1) expect(isValidShareId(randomShareId())).toBe(true);
  });
});

describe('field sanitisation', () => {
  it('caps and defaults the title', () => {
    expect(sanitizeTitle('  Bird base  ')).toBe('Bird base');
    expect(sanitizeTitle('')).toBe('Untitled crease pattern');
    expect(sanitizeTitle(undefined)).toBe('Untitled crease pattern');
    expect(sanitizeTitle('x'.repeat(500))).toHaveLength(100);
  });

  it('collapses an absent author to null so the card has one empty case', () => {
    expect(sanitizeAuthor('Zachary Marion')).toBe('Zachary Marion');
    expect(sanitizeAuthor('   ')).toBeNull();
    expect(sanitizeAuthor(undefined)).toBeNull();
    expect(sanitizeAuthor(42)).toBeNull();
    expect(sanitizeAuthor('y'.repeat(200))).toHaveLength(60);
  });
});

describe('payload validation', () => {
  it('accepts unpadded base64url', () => {
    expect(validatePayload(VALID_PAYLOAD)).toBeNull();
    expect(validatePayload('a-b_c')).toBeNull();
  });

  it('rejects padding, non-base64url characters, and empties', () => {
    expect(validatePayload('abc=')).not.toBeNull();
    expect(validatePayload('abc+def')).not.toBeNull();
    expect(validatePayload('abc/def')).not.toBeNull();
    expect(validatePayload('')).not.toBeNull();
    expect(validatePayload(null)).not.toBeNull();
  });

  it('caps size at 64 KB', () => {
    expect(validatePayload('a'.repeat(MAX_PAYLOAD_BYTES))).toBeNull();
    expect(validatePayload('a'.repeat(MAX_PAYLOAD_BYTES + 1))).not.toBeNull();
  });
});

describe('POST /api/cp', () => {
  it('stores the payload verbatim and returns a share url', async () => {
    const env = createEnv();
    const response = await onRequestPost(
      createContext(env, postRequest({ payload: VALID_PAYLOAD, title: 'Bird base' })),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      id: string;
      url: string;
      thumbnailUploadToken: string;
    };
    expect(isValidShareId(body.id)).toBe(true);
    expect(body.url).toBe(`https://oristudio.pages.dev/s/${body.id}`);

    const record = JSON.parse(env.kv.get(shareKey(body.id))!);
    expect(record.payload).toBe(VALID_PAYLOAD);
    expect(record.title).toBe('Bird base');
    expect(record.author).toBeNull();
  });

  it('stores only the hash of the upload token, never the token', async () => {
    const env = createEnv();
    const response = await onRequestPost(
      createContext(env, postRequest({ payload: VALID_PAYLOAD, title: 'x' })),
    );
    const body = (await response.json()) as { id: string; thumbnailUploadToken: string };
    const stored = env.kv.get(shareKey(body.id))!;
    expect(stored).not.toContain(body.thumbnailUploadToken);
    expect(JSON.parse(stored).thumbnailUploadTokenHash).toBe(
      await hashToken(body.thumbnailUploadToken),
    );
  });

  it('costs exactly two KV writes: the rate-limit counter and the record', async () => {
    const env = createEnv();
    const put = vi.spyOn(env.SHARE_KV, 'put');
    await onRequestPost(createContext(env, postRequest({ payload: VALID_PAYLOAD, title: 'x' })));
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-JSON content type', async () => {
    const env = createEnv();
    const request = new Request('https://oristudio.pages.dev/api/cp', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'nope',
    });
    expect((await onRequestPost(createContext(env, request))).status).toBe(400);
  });

  it('returns 413 for an oversized payload and 400 for a malformed one', async () => {
    const env = createEnv();
    const tooBig = await onRequestPost(
      createContext(env, postRequest({ payload: 'a'.repeat(MAX_PAYLOAD_BYTES + 1) })),
    );
    expect(tooBig.status).toBe(413);

    const malformed = await onRequestPost(
      createContext(env, postRequest({ payload: 'has spaces' })),
    );
    expect(malformed.status).toBe(400);
  });

  it('rate-limits by hashed IP and never stores the address', async () => {
    const env = createEnv();
    const now = new Date('2026-08-03T12:00:00Z');
    const ip = '203.0.113.7';
    const context = () =>
      createContext(env, postRequest({ payload: VALID_PAYLOAD }, { 'cf-connecting-ip': ip }));

    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i += 1) {
      expect(await enforceRateLimit(context(), now)).toBeNull();
    }
    const blocked = await enforceRateLimit(context(), now);
    expect(blocked?.status).toBe(429);

    for (const key of env.kv.keys()) expect(key).not.toContain(ip);
  });

  it('maps a KV quota failure to 503 rather than a generic 500', async () => {
    const env = createEnv();
    vi.spyOn(env.SHARE_KV, 'put').mockRejectedValue(
      new Error('KV PUT failed: daily limit exceeded'),
    );
    const response = await onRequestPost(
      createContext(env, postRequest({ payload: VALID_PAYLOAD })),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('storage_quota');
  });
});

describe('GET /api/cp/[id]', () => {
  it('rejects a bad id shape without touching KV', async () => {
    const env = createEnv();
    const get = vi.spyOn(env.SHARE_KV, 'get');
    const response = await getShare(
      createContext(env, new Request('https://x/api/cp/nope'), { id: 'nope' }),
    );
    expect(response.status).toBe(400);
    expect(get).not.toHaveBeenCalled();
  });

  it('404s a well-formed id that does not exist', async () => {
    const env = createEnv();
    const response = await getShare(
      createContext(env, new Request('https://x/api/cp/a3bK9xmQ'), { id: 'a3bK9xmQ' }),
    );
    expect(response.status).toBe(404);
  });

  it('returns the record without the token hash', async () => {
    const env = createEnv();
    const created = (await (
      await onRequestPost(
        createContext(env, postRequest({ payload: VALID_PAYLOAD, title: 'Crane', author: 'Zach' })),
      )
    ).json()) as { id: string };

    const response = await getShare(
      createContext(env, new Request(`https://x/api/cp/${created.id}`), { id: created.id }),
    );
    const body = await response.json();
    expect(body.payload).toBe(VALID_PAYLOAD);
    expect(body.author).toBe('Zach');
    expect(body).not.toHaveProperty('thumbnailUploadTokenHash');
  });
});

describe('thumbnail endpoint', () => {
  async function createShare(env: Env) {
    return (await (
      await onRequestPost(createContext(env, postRequest({ payload: VALID_PAYLOAD })))
    ).json()) as { id: string; thumbnailUploadToken: string };
  }

  /** A real 8-byte PNG signature; the endpoint checks it, so a shorter stub is rejected. */
  const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const pngBytes = (extra = 0) => new Uint8Array([...PNG_HEAD, ...new Array(extra).fill(0)]);

  function putRequest(id: string, token: string, bytes: Uint8Array): Request {
    return new Request(`https://oristudio.pages.dev/api/cp/${id}/thumbnail`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` },
      body: bytes.buffer as ArrayBuffer,
    });
  }

  it('accepts one upload and rejects the second with 409', async () => {
    const env = createEnv();
    const share = await createShare(env);
    const png = pngBytes();

    const first = await putThumbnail(
      createContext(env, putRequest(share.id, share.thumbnailUploadToken, png), { id: share.id }),
    );
    expect(first.status).toBe(200);

    const second = await putThumbnail(
      createContext(env, putRequest(share.id, share.thumbnailUploadToken, png), { id: share.id }),
    );
    expect(second.status).toBe(409);
  });

  it('rejects a wrong token with 401', async () => {
    const env = createEnv();
    const share = await createShare(env);
    const response = await putThumbnail(
      createContext(env, putRequest(share.id, 'not-the-token', pngBytes()), {
        id: share.id,
      }),
    );
    expect(response.status).toBe(401);
  });

  it('rejects an oversized image with 413', async () => {
    const env = createEnv();
    const share = await createShare(env);
    const response = await putThumbnail(
      createContext(env, putRequest(share.id, share.thumbnailUploadToken, pngBytes(512 * 1024)), {
        id: share.id,
      }),
    );
    expect(response.status).toBe(413);
  });

  it('never writes KV on upload — existence lives in R2', async () => {
    const env = createEnv();
    const share = await createShare(env);
    const put = vi.spyOn(env.SHARE_KV, 'put');
    await putThumbnail(
      createContext(env, putRequest(share.id, share.thumbnailUploadToken, pngBytes()), {
        id: share.id,
      }),
    );
    expect(put).not.toHaveBeenCalled();
  });

  it('falls back to the default card when no thumbnail exists', async () => {
    const env = createEnv();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    const response = await getThumbnail(
      createContext(env, new Request('https://oristudio.pages.dev/api/cp/a3bK9xmQ/thumbnail'), {
        id: 'a3bK9xmQ',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    // Short cache, so the card recovers as soon as the real upload lands.
    expect(response.headers.get('Cache-Control')).toContain('max-age=60');
    expect(fetchSpy).toHaveBeenCalledWith('https://oristudio.pages.dev/og-default.png');
    fetchSpy.mockRestore();
  });
});

describe('card metadata', () => {
  it('puts the author on the headline, where a chat client bolds it', () => {
    expect(shareCardTitle({ title: 'Lamprey V1', author: 'Gyosh' })).toBe('Lamprey V1 — Gyosh');
  });

  it('falls back to the app name only when there is no author to name', () => {
    expect(shareCardTitle({ title: 'Lamprey V1', author: null })).toBe('Lamprey V1 — Ori Studio');
  });

  it('uses the second line to say what tapping does', () => {
    // The image has already said what the thing is; by the time anyone reads this they
    // need to know what happens if they act on it.
    expect(shareCardDescription()).toBe('View this crease pattern in Ori Studio');
  });
});

describe('GET /s/[[shareId]]', () => {
  const meta = {
    id: 'a3bK9xmQ',
    title: 'Bird base',
    author: 'Zach',
    shareUrl: 'https://oristudio.pages.dev/s/a3bK9xmQ',
    imageUrl: 'https://oristudio.pages.dev/api/cp/a3bK9xmQ/thumbnail',
  };

  it('replaces existing meta tags rather than duplicating them', () => {
    const html = renderSharedCpHtml(INDEX_HTML, meta, VALID_PAYLOAD);
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html.match(/property="og:description"/g)).toHaveLength(1);
    expect(html).toContain('content="Bird base — Zach"');
    expect(html).not.toContain('content="Ori Studio"');
  });

  it('appends tags index.html does not already carry', () => {
    const html = renderSharedCpHtml(INDEX_HTML, meta, VALID_PAYLOAD);
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain(`property="og:image" content="${meta.imageUrl}"`);
    expect(html).toContain(`name="twitter:image" content="${meta.imageUrl}"`);
  });

  it('inlines the payload so the SPA needs no fetch', () => {
    const html = renderSharedCpHtml(INDEX_HTML, meta, VALID_PAYLOAD);
    expect(html).toContain('<script type="application/json" id="shared-cp">');
    expect(html).toContain(VALID_PAYLOAD);
  });

  it('escapes a title that would otherwise break out of the script or an attribute', () => {
    const hostile = {
      ...meta,
      title: '</script><img src=x onerror=alert(1)>',
      author: 'a" onload="x',
    };
    const html = renderSharedCpHtml(INDEX_HTML, hostile, VALID_PAYLOAD);

    // The property that matters is that no user-supplied `<` or `"` survives as markup.
    // Inside the JSON block `<` becomes `\u003c`, so the parser cannot be walked out of
    // the element; inside attributes it becomes `&lt;`. The *text* `onerror=alert(1)>`
    // still appears in both, escaped and inert — asserting on its absence would be
    // asserting on the wrong thing.
    const script = html.match(/<script[^>]*id="shared-cp">([\s\S]*?)<\/script>/)![1];
    expect(script).not.toContain('<');
    expect(script).toContain('\\u003c/script');
    expect(JSON.parse(script).title).toBe(hostile.title);

    const head = html.slice(0, html.indexOf('<script'));
    expect(head).toContain('&lt;/script&gt;&lt;img');
    expect(head).toContain('a&quot; onload=&quot;x');
    expect(head).not.toContain('<img');
    expect(head).not.toContain('a" onload="x');
  });

  it('re-asserts COOP/COEP, which _headers does not do for Function responses', async () => {
    const env = createEnv();
    const created = (await (
      await onRequestPost(
        createContext(env, postRequest({ payload: VALID_PAYLOAD, title: 'Crane' })),
      )
    ).json()) as { id: string };

    const response = await getSharePage(
      createContext(env, new Request(`https://oristudio.pages.dev/s/${created.id}`), {
        shareId: created.id,
      }),
    );
    expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
    expect(await response.text()).toContain(VALID_PAYLOAD);
  });

  it('serves the SPA untouched, and reads no KV, for a non-share-shaped path', async () => {
    const env = createEnv();
    const get = vi.spyOn(env.SHARE_KV, 'get');
    const response = await getSharePage(
      createContext(env, new Request('https://oristudio.pages.dev/s/../../etc/passwd'), {
        shareId: '../../etc/passwd',
      }),
    );
    expect(get).not.toHaveBeenCalled();
    expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(await response.text()).toContain('<title>Ori Studio</title>');
  });

  it('asks for index.html unconditionally, so a cached copy cannot preempt the rewrite', async () => {
    // Every share serves the same index.html, so its ETag is identical for every link. A
    // client that has seen any other page sends If-None-Match, the asset handler answers
    // 304, and the OpenGraph tags never reach it -- after throwing, because a 304 cannot
    // carry the body we tried to give it.
    const env = createEnv();
    const created = (await (
      await onRequestPost(
        createContext(env, postRequest({ payload: VALID_PAYLOAD, title: 'Crane' })),
      )
    ).json()) as { id: string };

    let seen: Headers | null = null;
    const next = async (request?: Request) => {
      seen = new Headers(request?.headers);
      if (seen.has('If-None-Match')) return new Response(null, { status: 304 });
      return new Response(INDEX_HTML, { headers: { 'Content-Type': 'text/html' } });
    };

    const request = new Request(`https://oristudio.pages.dev/s/${created.id}`, {
      headers: { 'If-None-Match': '"abc"', 'If-Modified-Since': 'Mon, 01 Jan 2024 00:00:00 GMT' },
    });
    const response = await getSharePage(createContext(env, request, { shareId: created.id }, next));

    expect(seen!.has('If-None-Match')).toBe(false);
    expect(seen!.has('If-Modified-Since')).toBe(false);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(VALID_PAYLOAD);
  });

  it('passes through a response it cannot rewrite rather than throwing', async () => {
    // `new Response(html, { status: 304 })` is a TypeError; a share must degrade to the
    // plain asset instead of a Worker exception page.
    const env = createEnv();
    const created = (await (
      await onRequestPost(
        createContext(env, postRequest({ payload: VALID_PAYLOAD, title: 'Crane' })),
      )
    ).json()) as { id: string };

    const response = await getSharePage(
      createContext(
        env,
        new Request(`https://oristudio.pages.dev/s/${created.id}`),
        { shareId: created.id },
        async () => new Response(null, { status: 304 }),
      ),
    );
    expect(response.status).toBe(304);
    expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });

  it('serves the SPA for a well-formed id that no longer exists', async () => {
    const env = createEnv();
    const response = await getSharePage(
      createContext(env, new Request('https://oristudio.pages.dev/s/a3bK9xmQ'), {
        shareId: 'a3bK9xmQ',
      }),
    );
    expect(await response.text()).toContain('<title>Ori Studio</title>');
  });
});

describe('escaping helpers', () => {
  it('escapes HTML attribute delimiters', () => {
    expect(escapeHtmlAttribute('a"b<c>d&e\'f')).toBe('a&quot;b&lt;c&gt;d&amp;e&#39;f');
  });

  it('escapes script-terminating and line-separator characters in JSON', () => {
    expect(escapeJsonForScript({ a: '</script>' })).toBe('{"a":"\\u003c/script>"}');
    expect(escapeJsonForScript({ a: '\u2028\u2029' })).toBe('{"a":"\\u2028\\u2029"}');
  });
});

describe('PNG validation on upload', () => {
  it('rejects bytes that only claim to be a PNG', async () => {
    // Content-Type is the uploader's word for it; this endpoint stores what it is given and
    // serves it back from our own origin, so the signature is what actually decides.
    const env = createEnv();
    const share = (await (
      await onRequestPost(createContext(env, postRequest({ payload: VALID_PAYLOAD })))
    ).json()) as { id: string; thumbnailUploadToken: string };

    const notAPng = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    const response = await putThumbnail(
      createContext(
        env,
        new Request(`https://oristudio.pages.dev/api/cp/${share.id}/thumbnail`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'image/png',
            Authorization: `Bearer ${share.thumbnailUploadToken}`,
          },
          body: notAPng.buffer as ArrayBuffer,
        }),
        { id: share.id },
      ),
    );

    expect(response.status).toBe(400);
    expect(env.r2.size).toBe(0);
  });

  it('accepts real PNG bytes', () => {
    expect(
      isPng(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).buffer),
    ).toBe(true);
    expect(isPng(new Uint8Array([0x89, 0x50]).buffer)).toBe(false);
    expect(isPng(new Uint8Array([]).buffer)).toBe(false);
  });
});
