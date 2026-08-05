/**
 * Client for the crease-pattern share API.
 *
 * Thin on purpose: it moves strings to and from the Worker and knows nothing about
 * crease patterns. The payload it posts is the codec's own base64url output, produced
 * by `shareFoldFrameAsLink`, and the Worker stores it verbatim.
 */

import { readString, storageKey, STORAGE_KEYS, writeString } from '../../lib/storage';

/** Where the share API lives. Same origin in production; overridable for `share:dev`. */
export function shareApiBase(): string {
  const configured = import.meta.env.VITE_SHARE_API_URL;
  if (typeof configured === 'string' && configured.length > 0) return configured;
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/**
 * Whether the share UI is offered at all.
 *
 * Off in dev unless explicitly opted in, because a dev build points at the *production*
 * API unless `VITE_SHARE_API_URL` says otherwise, and nobody wants a stray test link in
 * the real namespace. Also off on desktop: Tauri routes through `createMemoryRouter` and
 * has no address bar, so a share link has nowhere to land.
 */
export function isShareEnabled(runtimeIsDesktop: boolean): boolean {
  if (runtimeIsDesktop) return false;
  if (import.meta.env.PROD) return true;
  return import.meta.env.VITE_SHARE_API_URL !== undefined;
}

export interface CreateCpShareRequest {
  payload: string;
  title: string;
  author: string | null;
}

export interface CreateCpShareResponse {
  id: string;
  url: string;
  thumbnailUploadToken: string;
}

export interface CpShareData {
  id: string;
  payload: string;
  title: string;
  author: string | null;
  createdAt: string;
}

/** An API failure carrying the status and the Worker's own error code. */
export class CpShareError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'CpShareError';
    this.status = status;
    this.code = code;
  }
}

async function toShareError(response: Response, fallback: string): Promise<CpShareError> {
  try {
    const body = (await response.json()) as { error?: string; code?: string };
    return new CpShareError(
      response.status,
      body.code ?? 'unknown',
      body.error?.trim() || fallback
    );
  } catch {
    return new CpShareError(response.status, 'unknown', fallback);
  }
}

export async function createCpShare(
  request: CreateCpShareRequest
): Promise<CreateCpShareResponse> {
  const response = await fetch(`${shareApiBase()}/api/cp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw await toShareError(response, 'Could not create a share link.');
  return (await response.json()) as CreateCpShareResponse;
}

/**
 * Fetch a share by id.
 *
 * Only used when the payload was not inlined into the page — a hand-typed URL, or a
 * link opened within the ~60s KV takes to propagate globally. The happy path reads
 * `window.__SHARED_CP` and makes no request at all.
 */
export async function fetchCpShare(shareId: string): Promise<CpShareData> {
  const response = await fetch(`${shareApiBase()}/api/cp/${encodeURIComponent(shareId)}`);
  if (!response.ok) throw await toShareError(response, 'Could not open this share link.');
  return (await response.json()) as CpShareData;
}

/**
 * Backoff for the eventual-consistency retry, summing to ~60s.
 *
 * Cloudflare documents KV as taking up to 60 seconds to propagate globally, and a link is
 * most often pasted to someone the moment it is created — so the *first* person to open a
 * share is the one most likely to hit a colo that has not seen the write yet.
 */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Fetch a share, retrying a 404 until KV has had time to propagate.
 *
 * **Only** a 404 is retried. Every other failure is either permanent (a malformed id) or
 * will not be fixed by waiting (a 503 from an exhausted quota lasts until 00:00 UTC), and
 * retrying those would just make the user wait a minute for the same answer.
 */
export async function fetchCpShareWithRetry(
  shareId: string,
  options: { signal?: AbortSignal; onRetry?: (attempt: number) => void } = {}
): Promise<CpShareData> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchCpShare(shareId);
    } catch (error) {
      const isMissing = error instanceof CpShareError && error.status === 404;
      if (!isMissing || attempt >= RETRY_DELAYS_MS.length) throw error;
      options.onRetry?.(attempt + 1);
      await delay(RETRY_DELAYS_MS[attempt]!, options.signal);
    }
  }
}

/** Backoff for the card upload. Short, because nobody is waiting on it. */
const UPLOAD_RETRY_DELAYS_MS = [500, 2_000];

/**
 * Smallest card we will publish.
 *
 * Canvas fingerprinting defences can make `toBlob` return a blank or near-empty image, and
 * the upload is write-once — a blank card cannot be replaced later. The smallest real card
 * measured on the corpus was 30 KB, so anything at this scale is not a crease pattern.
 */
export const MIN_CARD_BYTES = 2_048;

/**
 * Upload the preview card. Fire-and-forget at the call site: a share link is useful
 * without an image, so a failure here must never surface as a failed share.
 *
 * Retried, because the token exists only in memory — one transient network error and that
 * share keeps the generic card permanently, with no path back.
 */
export async function uploadCpShareThumbnail(
  shareId: string,
  png: Blob,
  token: string
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(
      `${shareApiBase()}/api/cp/${encodeURIComponent(shareId)}/thumbnail`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` },
        body: png,
      }
    );
    if (response.ok) return;

    const error = await toShareError(response, 'Preview image upload failed.');
    // 409 means a card is already there and 401 that the token is wrong; neither improves
    // by asking again. Only transport and server faults are worth another attempt.
    const worthRetrying = error.status >= 500 || error.status === 0;
    if (!worthRetrying || attempt >= UPLOAD_RETRY_DELAYS_MS.length) throw error;
    await delay(UPLOAD_RETRY_DELAYS_MS[attempt]!);
  }
}

/** The author name, remembered so it is not retyped on every share. */
export function readRememberedAuthor(): string {
  return readString(storageKey(STORAGE_KEYS.shareAuthor)) ?? '';
}

export function rememberAuthor(author: string): void {
  writeString(storageKey(STORAGE_KEYS.shareAuthor), author.trim());
}
