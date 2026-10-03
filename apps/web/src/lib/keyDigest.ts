/**
 * 64 bits over a sequence of string keys, as two FNV-1a streams with different
 * bases and primes, prefixed with the caller's name for the algorithm.
 *
 * The crease fingerprints that are written into project files share it: a
 * folded figure's source (`foldedSourceFingerprint`, `cs1:`) and a References
 * plan's sheet (`sheetFingerprint`, `ps1:`). They differ in which creases they
 * take and how each is spelled; the digest over the result is one function.
 *
 * Two streams rather than one because a single 32-bit word leaves a 2^-32
 * chance that an edit reads as "unchanged", and the cost of that is a stale
 * answer that never says so. Consumed incrementally rather than over a joined
 * string, so it never materialises megabyte-scale text. A separator follows
 * each key, or `["ab", "c"]` and `["a", "bc"]` would be the same byte stream.
 *
 * The prefix names the algorithm in the value itself, so a stored value can be
 * told apart from one a later build would produce.
 */
export function keyDigest(keys: Iterable<string>, prefix: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9dc5811c;
  const mix = (code: number) => {
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
  };
  for (const key of keys) {
    for (let i = 0; i < key.length; i += 1) mix(key.charCodeAt(i));
    mix(0x3b);
  }
  const hex = (h: number) => (h >>> 0).toString(16).padStart(8, '0');
  return `${prefix}${hex(h1)}${hex(h2)}`;
}
