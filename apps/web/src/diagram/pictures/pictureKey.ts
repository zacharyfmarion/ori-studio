/**
 * A short, stable digest of a string, for cache keys: two FNV-1a-style lanes
 * with different offsets and primes, so a collision needs both to collide. Not
 * cryptographic — it keys a cache, it guards nothing.
 */
export function digest(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9dc5811c;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}
