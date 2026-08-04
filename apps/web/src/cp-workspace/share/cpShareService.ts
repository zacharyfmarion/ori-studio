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
  creaseCount: number;
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
  creaseCount: number;
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
 * Upload the preview card. Fire-and-forget at the call site: a share link is useful
 * without an image, so a failure here must never surface as a failed share.
 */
export async function uploadCpShareThumbnail(
  shareId: string,
  png: Blob,
  token: string
): Promise<void> {
  const response = await fetch(
    `${shareApiBase()}/api/cp/${encodeURIComponent(shareId)}/thumbnail`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` },
      body: png,
    }
  );
  if (!response.ok) throw await toShareError(response, 'Preview image upload failed.');
}

/** The author name, remembered so it is not retyped on every share. */
export function readRememberedAuthor(): string {
  return readString(storageKey(STORAGE_KEYS.shareAuthor)) ?? '';
}

export function rememberAuthor(author: string): void {
  writeString(storageKey(STORAGE_KEYS.shareAuthor), author.trim());
}
