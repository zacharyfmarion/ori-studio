/**
 * Shared plumbing for the crease-pattern share endpoints.
 *
 * The Worker stores the codec payload **verbatim** and never learns what a crease
 * pattern is: no compression, no base64 round-trip, no parsing. That is deliberate —
 * a store that cannot interpret its contents cannot corrupt them, and the codec's
 * own frame (magic, version, CRC) is already the integrity check.
 *
 * Binding shapes are declared locally rather than pulled from `@cloudflare/workers-types`.
 * The surface actually used here is four methods wide and stable, so a local
 * declaration keeps this typechecked with no dependency, and documents exactly what
 * the feature depends on.
 */

export interface CpShareKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface CpShareR2Object {
  body: ReadableStream | null;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
}

export interface CpShareR2 {
  get(key: string): Promise<CpShareR2Object | null>;
  head(key: string): Promise<CpShareR2Object | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }
  ): Promise<unknown>;
}

export interface Env {
  SHARE_KV: CpShareKv;
  SHARE_R2: CpShareR2;
}

/** The subset of Pages' `EventContext` these handlers touch. */
export interface CpShareContext {
  request: Request;
  env: Env;
  params: Record<string, string | string[] | undefined>;
  next: () => Promise<Response>;
}

export interface CpShareRecord {
  id: string;
  /** base64url codec output, stored exactly as the client produced it. */
  payload: string;
  title: string;
  author: string | null;
  createdAt: string;
  creaseCount: number;
  /** SHA-256 of the one-time upload token. Null once a thumbnail exists. */
  thumbnailUploadTokenHash: string | null;
}

const encoder = new TextEncoder();

/** Alphabet for share ids. Alphanumeric only, so the id is safe everywhere unescaped. */
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const SHARE_ID_LENGTH = 8;

/**
 * The id shape, checked **before any KV access**.
 *
 * Cloudflare bills "fetches for non-existent keys that return a null or HTTP 404", and
 * exceeding a free-plan limit fails hard rather than billing. So an unfiltered
 * `/s/<garbage>` flood would exhaust the day's read quota and take every real share link
 * down with it until 00:00 UTC. Rejecting on shape first makes that attack free to defend.
 */
export const SHARE_ID_PATTERN = /^[a-zA-Z0-9]{8}$/;

/** Unpadded base64url, which is all the codec ever emits. */
const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * 64 KB. The largest payload in the 563-document corpus is ~24 KB, so this is 2.7x
 * headroom over anything real while bounding what a single write can cost us.
 */
export const MAX_PAYLOAD_BYTES = 65_536;
export const MAX_THUMBNAIL_BYTES = 512 * 1024;
export const MAX_TITLE_CHARS = 100;
export const MAX_AUTHOR_CHARS = 60;

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function isValidShareId(value: unknown): value is string {
  return typeof value === 'string' && SHARE_ID_PATTERN.test(value);
}

/**
 * Read the `[id]` route param. Pages hands a catch-all through as an array, so both
 * shapes are normalized here rather than at every call site.
 */
export function readShareIdParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return isValidShareId(value) ? value : null;
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
    return isValidShareId(value[0]) ? value[0] : null;
  }
  return null;
}

export function shareKey(id: string): string {
  return `cp:${id}`;
}

export function thumbnailObjectKey(id: string): string {
  return `thumbnails/${id}.png`;
}

export function shareUrl(origin: string, id: string): string {
  return `${origin}/s/${id}`;
}

export function thumbnailUrl(origin: string, id: string): string {
  return `${origin}/api/cp/${id}/thumbnail`;
}

export function sanitizeTitle(value: unknown): string {
  if (typeof value !== 'string') return 'Untitled crease pattern';
  const next = value.trim().slice(0, MAX_TITLE_CHARS);
  return next || 'Untitled crease pattern';
}

/**
 * Author is optional and unverified — a display name the sharer typed, not an identity
 * claim. Empty and whitespace-only collapse to null so the card and the OG description
 * have one absent case to handle rather than two.
 */
export function sanitizeAuthor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const next = value.trim().slice(0, MAX_AUTHOR_CHARS);
  return next || null;
}

export function sanitizeCreaseCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/** Validate a payload, returning an error message or null. */
export function validatePayload(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return 'Missing or invalid payload.';
  }
  if (!PAYLOAD_PATTERN.test(value)) {
    return 'Payload must be unpadded base64url.';
  }
  // base64url is ASCII, so character count is byte count.
  if (value.length > MAX_PAYLOAD_BYTES) {
    return 'Crease pattern is too large to share.';
  }
  return null;
}

export function randomShareId(length: number = SHARE_ID_LENGTH): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join('');
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return bytesToBase64Url(bytes);
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function readShare(env: Env, id: string): Promise<CpShareRecord | null> {
  const raw = await env.SHARE_KV.get(shareKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CpShareRecord;
  } catch {
    // A record we cannot parse is a record we cannot serve. Treat it as absent rather
    // than 500-ing: the link is dead either way, and 404 is the honest status.
    return null;
  }
}

export async function writeShare(env: Env, record: CpShareRecord): Promise<void> {
  await env.SHARE_KV.put(shareKey(record.id), JSON.stringify(record));
}

/** Share links one connection may create per hour. */
export const RATE_LIMIT_PER_HOUR = 30;

/**
 * Rate-limit key: a salted hash of the client IP, never the IP itself.
 *
 * The hash is one-way and the key expires in an hour, so no record that can be linked
 * back to a person outlives the window — which is what makes "we store nothing about
 * anyone" true rather than merely mitigated.
 */
export async function rateLimitKey(request: Request, now: Date): Promise<string> {
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'anonymous';
  const hour = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}-${now.getUTCHours()}`;
  return `rl:${await hashToken(`cp-share:${ip}`)}:${hour}`;
}

/**
 * Returns a 429 when the caller is over the limit, or null to proceed.
 *
 * **This costs the second KV write per share, and it is the reason the free creation
 * ceiling is 500/day rather than 1,000.** The platform rate-limiting binding would cost
 * zero writes, but `ratelimits` is not among the bindings Cloudflare Pages supports —
 * only `vars`, `d1_databases`, `durable_objects`, `hyperdrive`, `kv_namespaces`,
 * `queues.producers`, `r2_buckets`, `vectorize`, `services`, `analytics_engine_datasets`
 * and `ai`. Two ways out, both deferred: a WAF rate-limiting rule (zero KV cost, and it
 * rejects before the Function is even invoked) once there is a custom domain to attach one
 * to, or migrating off Pages to Workers Static Assets, where the binding exists.
 *
 * It is a speed bump, not a defence — IPs are cheap. What actually bounds damage is the
 * free plan's own daily write ceiling and the payload cap.
 */
export async function enforceRateLimit(context: CpShareContext, now: Date): Promise<Response | null> {
  const key = await rateLimitKey(context.request, now);
  const current = Number((await context.env.SHARE_KV.get(key)) || '0');
  if (current >= RATE_LIMIT_PER_HOUR) {
    return json(
      {
        error: 'Too many share links from this connection. Try again in a few minutes.',
        code: 'rate_limited',
      },
      { status: 429 }
    );
  }
  await context.env.SHARE_KV.put(key, String(current + 1), { expirationTtl: 3600 });
  return null;
}

/**
 * Map a KV failure to a response.
 *
 * On the free plan, exceeding a daily limit does not bill — it fails. That is an outage
 * with a known end time (00:00 UTC), not a bug, and it deserves a status the client can
 * distinguish from "your crease pattern is bad".
 */
export function storageFailure(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = /limit|quota|exceeded/i.test(message);
  return json(
    {
      error: exhausted
        ? 'Sharing is temporarily unavailable. Please try again later.'
        : 'Could not create a share link right now.',
      code: exhausted ? 'storage_quota' : 'storage_failure',
    },
    { status: exhausted ? 503 : 500 }
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Escape for an HTML attribute value. Title and author are user-supplied. */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape a JSON string for embedding in a `<script>` element.
 *
 * `JSON.stringify` alone is not enough: a title containing `</script>` would close the
 * element and everything after it would parse as markup. Escaping `<` (and the line
 * separators JSON leaves raw) closes that off.
 */
export function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
