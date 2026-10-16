/** Bytes as base64: for `data:` URLs of SVG pages, captured bitmaps and fonts. */
export function bytesToBase64(bytes: Uint8Array): string {
  // Modern engines encode directly, avoiding a large intermediate character array.
  const native = bytes as Uint8Array & { toBase64?: () => string };
  if (native.toBase64) return native.toBase64();
  let binary = '';
  // In chunks: spreading a 2 MB array into one call overflows the argument limit.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}
