/**
 * Share-link URLs.
 *
 * Links are `https://<host>/s/<8-char id>`. The crease pattern lives server-side, keyed
 * by that id, because an OpenGraph crawler does not execute JS — a payload carried in
 * the fragment can never produce a preview card, which is the whole reason the scheme is
 * server-backed. See `implementation-plans/cp-share-links.md`.
 *
 * The older `/s#<payload>` form still decodes. Links already in the wild must not break,
 * and supporting them costs one branch: a fragment payload is self-contained, so it needs
 * no network at all.
 *
 * This module knows nothing about crease patterns — it only assembles and reads URLs.
 * The payload itself is produced and validated by the Rust codec.
 */

import { SHARE_PATH } from '../routing/paths';

export { SHARE_PATH };

/** Build the shareable URL for a stored share id. */
export function buildShareUrl(shareId: string, origin: string = window.location.origin): string {
  return `${origin}${SHARE_PATH}/${shareId}`;
}

/**
 * The id shape the Worker mints and validates — kept in step with `SHARE_ID_PATTERN` in
 * `functions/_lib/cpShare.ts`. The range spans older 8-character links and the 10 minted now.
 */
const SHARE_ID_PATTERN = /^[a-zA-Z0-9]{8,12}$/;

/** Characters a legacy base64url payload can contain, and nothing else. */
const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isShareId(value: string): boolean {
  return SHARE_ID_PATTERN.test(value);
}

/**
 * Read a legacy share payload out of a fragment, or null if there isn't one.
 *
 * Accepts the fragment with or without its leading `#`. Anything that is not a bare
 * base64url string is rejected here rather than handed to the decoder — the route can be
 * reached with any fragment at all, and a shape check is cheaper and clearer than a
 * decode failure.
 */
export function readShareFragment(fragment: string): string | null {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (!raw || !PAYLOAD_PATTERN.test(raw)) return null;
  return raw;
}

/**
 * Copy text to the clipboard, returning whether it worked.
 *
 * `navigator.clipboard` is unavailable on insecure origins and can reject when the
 * document is not focused, so the caller needs the boolean to decide between a success
 * toast and leaving the link on screen to be copied by hand.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
