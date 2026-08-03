/**
 * Share-link URLs.
 *
 * The payload rides in the **fragment**, never the query. RFC 3986 §3.5 means a
 * fragment is not sent to the server, so request-line limits do not apply, the
 * design never lands in an access log, and it is stripped from cross-origin
 * `Referer`. The *route* is the outermost extension point: a server-stored short
 * link would be a different path, not a different fragment key.
 *
 * This module knows nothing about crease patterns — it only assembles and reads
 * URLs. The payload itself is produced and validated by the Rust codec.
 */

import { SHARE_PATH } from '../routing/paths';

/**
 * The route a share link lands on. It reads the payload and redirects to Edit,
 * which is what keeps the payload out of the URL the user ends up on.
 *
 * The payload is the whole fragment — no `key=` prefix, because the route
 * already says what it is, and the format version lives in the payload's own
 * magic bytes.
 */
export { SHARE_PATH };

/**
 * Length at which we warn that a link may not survive the trip.
 *
 * 2,000 characters is the practical floor across the places people actually
 * paste links: Discord truncates around there, IE's 2,083 limit still echoes
 * through tooling, and RFC 5322's 998-octet line means anything long gets
 * wrapped — and therefore broken — by some mail clients. Browsers themselves
 * handle far more; this is about everything in between.
 */
export const SHARE_LENGTH_WARNING = 2000;

/** Build the full shareable URL for an encoded payload. */
export function buildShareUrl(payload: string, origin: string = window.location.origin): string {
  return `${origin}${SHARE_PATH}#${payload}`;
}

/** Characters a base64url payload can contain, and nothing else. */
const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Read a share payload out of a fragment, or null if there isn't one.
 *
 * Accepts the fragment with or without its leading `#`. Anything that is not a
 * bare base64url string is rejected here rather than handed to the decoder —
 * the route can be reached with any fragment at all, and a shape check is
 * cheaper and clearer than a decode failure.
 */
export function readShareFragment(fragment: string): string | null {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (!raw || !PAYLOAD_PATTERN.test(raw)) return null;
  return raw;
}

/** Whether a link is long enough to be at risk of truncation in transit. */
export function isShareLinkLong(url: string): boolean {
  return url.length > SHARE_LENGTH_WARNING;
}

/**
 * Copy text to the clipboard, returning whether it worked.
 *
 * `navigator.clipboard` is unavailable on insecure origins and can reject when
 * the document is not focused, so the caller needs the boolean to decide between
 * a success toast and leaving the link on screen to be copied by hand.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
