/**
 * Which MIME types name an image a browser might actually decode.
 *
 * `File.type` is not a statement about content. It is the operating system's
 * extension table talking, and that table answers a different question than
 * "can this be drawn onto a canvas". macOS maps `.ori` to the UTI
 * `com.olympus.raw-image`, which conforms to `public.image`, so a browser hands
 * us `image/x-olympus-orf` for an Oriedita crease pattern — and no engine
 * decodes camera raw at all. Testing the `image/` prefix therefore routes files
 * to an importer that can only ever throw `InvalidStateError`.
 *
 * So the image path tests membership here instead. The list is deliberately
 * generous about engine differences — TIFF and HEIC decode in Safari and not in
 * Chrome, and which of the two you are running is `createImageBitmap`'s question
 * to answer, not ours. What it excludes is the camera-raw family, which no
 * engine decodes and which is the family that collides with extensions this app
 * owns.
 */
const DECODABLE_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/apng',
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/jpeg',
  // Non-standard, but some platforms still emit it for `.jpg`.
  'image/jpg',
  'image/png',
  'image/svg+xml',
  'image/tiff',
  'image/vnd.microsoft.icon',
  'image/webp',
  'image/x-icon',
]);

/**
 * File extensions for the same set, for the places that must state the formats
 * up front rather than test a file: an `<input accept>` list, which is what
 * decides whether the platform's file picker even offers a file.
 */
export const DECODABLE_IMAGE_EXTENSIONS = [
  'apng',
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
] as const;

/** `accept` value for a file input that takes reference images. */
export const DECODABLE_IMAGE_ACCEPT = DECODABLE_IMAGE_EXTENSIONS.map(
  (extension) => `.${extension}`
).join(',');

/**
 * True when a MIME type names an image format a browser may be able to decode.
 *
 * Takes the raw `File.type` / `DataTransferItem.type` string: those are
 * lowercased per spec, but a type can still carry parameters (`;charset=…`), so
 * both are normalized away rather than assumed absent.
 */
export function isDecodableImageType(type: string): boolean {
  const essence = type.split(';', 1)[0].trim().toLowerCase();
  return DECODABLE_IMAGE_MIME_TYPES.has(essence);
}
