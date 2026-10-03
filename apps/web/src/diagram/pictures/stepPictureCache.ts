/**
 * Painted step pictures as `data:` URLs, kept across renders and the dock's
 * remounts, least recently used out first, bounded by bytes rather than count:
 * one upload can be 2 MB and another 2 KB.
 *
 * `data:` URLs, never `blob:` (D7): an `<img>` gives the document an opaque
 * origin, and there is no URL to revoke while something still shows it.
 */
import { bytesToBase64 } from '../../lib/base64';

export const STEP_PICTURE_CACHE_MAX_BYTES = 48 * 1024 * 1024;

const entries = new Map<string, string>();
let totalBytes = 0;

/**
 * The cached URL for `key`, or the one `paint` makes, stored. `paint` returning
 * `null` (nothing to draw) is not cached.
 */
export function cachedPictureUrl(key: string, paint: () => string | null): string | null {
  const hit = entries.get(key);
  if (hit !== undefined) {
    // Most recent last: re-inserting moves it to the end of the Map's order.
    entries.delete(key);
    entries.set(key, hit);
    return hit;
  }
  const url = paint();
  if (url === null) return null;
  entries.set(key, url);
  totalBytes += url.length;
  for (const [oldest, value] of entries) {
    if (totalBytes <= STEP_PICTURE_CACHE_MAX_BYTES || oldest === key) break;
    entries.delete(oldest);
    totalBytes -= value.length;
  }
  return url;
}

/** An SVG document as a `data:` URL. Base64, so `#` and `%` in the markup need no care. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}`;
}

/**
 * A number per object, for keys: the same asset object is the same picture,
 * whatever its id — two opens of one project make two objects, and a file
 * edited between them must not show the first one's picture.
 */
const serials = new WeakMap<object, number>();
let nextSerial = 1;
export function objectSerial(value: object): number {
  let serial = serials.get(value);
  if (serial === undefined) {
    serial = nextSerial++;
    serials.set(value, serial);
  }
  return serial;
}

export function clearStepPictureCacheForTests(): void {
  entries.clear();
  totalBytes = 0;
}

export function stepPictureCacheBytesForTests(): number {
  return totalBytes;
}
