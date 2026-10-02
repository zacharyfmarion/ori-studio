/**
 * An SVG file as a picture: read its size, then draw it through an `<img>`.
 *
 * No engine decodes an SVG `Blob` with `createImageBitmap` — Chromium throws
 * `InvalidStateError` — so the bitmap path every other image format takes is
 * closed to it. An `<img>` draws one, but only once it has a size: a viewBox-only
 * file reports the 300×150 default object size, and `createImageBitmap(img)`
 * refuses it outright. So the size is read here from `width`/`height`/`viewBox`
 * and written back onto the root as plain pixels before the image loads.
 *
 * Nothing here can run the file. `DOMParser` executes no script, and an SVG
 * loaded as an image runs none and fetches nothing outside itself. The markup is
 * never inserted into the document; only the pixels drawn from it are kept.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * CSS pixels per unit, for the units an SVG length may carry that an image can
 * resolve: the absolute ones, and `em`/`rem` at the 16 px default font size an
 * SVG document starts from.
 */
const PX_PER_UNIT: Readonly<Record<string, number>> = {
  '': 1,
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  pt: 96 / 72,
  pc: 16,
  em: 16,
  rem: 16,
};

const LENGTH = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(px|in|cm|mm|q|pt|pc|r?em)?$/i;

/** An XML declaration's `encoding`, which is ASCII whatever encoding it names. */
const DECLARED_ENCODING = /^<\?xml\s[^>]*?\bencoding\s*=\s*["']([A-Za-z][\w.:-]*)["']/;

/** The size an `<img>` gives an SVG that states nothing about its own. */
const DEFAULT_OBJECT_SIZE = { width: 300, height: 150 } as const;

export interface SvgSize {
  width: number;
  height: number;
}

export interface SvgViewBox extends SvgSize {
  x: number;
  y: number;
}

/**
 * The encoding an XML parser would read an SVG file's bytes in: a byte-order
 * mark, then the XML declaration, then UTF-8. `Blob.text()` asks none of them
 * and reads every file as UTF-8.
 */
export function svgTextEncoding(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 1024));
  const label = DECLARED_ENCODING.exec(head)?.[1];
  if (!label) return 'utf-8';
  let encoding: string;
  try {
    encoding = new TextDecoder(label).encoding;
  } catch {
    return 'utf-8';
  }
  // Bytes with no BOM that a declaration could be read from are not UTF-16,
  // whatever the declaration claims; a parser ignores the claim too.
  return encoding.startsWith('utf-16') ? 'utf-8' : encoding;
}

/** An SVG file's bytes as text, in the encoding {@link svgTextEncoding} finds. */
export function decodeSvgText(bytes: Uint8Array): string {
  return new TextDecoder(svgTextEncoding(bytes)).decode(bytes);
}

/**
 * An SVG `width`/`height` attribute in CSS pixels, or null when it gives no
 * usable size. Percentages resolve against a container an image does not have,
 * so they count as absent and the viewBox decides instead, as do the font units
 * that depend on a font's own metrics (`ex`, `ch`).
 */
export function parseSvgLength(value: string | null): number | null {
  if (value === null) return null;
  const match = LENGTH.exec(value.trim());
  if (!match) return null;
  const px = Number(match[1]) * PX_PER_UNIT[(match[2] ?? '').toLowerCase()];
  return Number.isFinite(px) && px > 0 ? px : null;
}

/** A `viewBox` attribute, or null when it is absent or one the engine would ignore. */
export function parseSvgViewBox(value: string | null): SvgViewBox | null {
  if (value === null) return null;
  const parts = value.trim().split(/[\s,]+/);
  if (parts.length !== 4) return null;
  const [x, y, width, height] = parts.map(Number);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/**
 * The size the root's attributes give the drawing, in CSS pixels.
 *
 * Explicit `width` and `height` win. One of them alone takes the other from the
 * viewBox's aspect; neither takes the viewBox's own extent, which is only an
 * aspect ratio and a unit of measure — callers scale the result anyway. With no
 * viewBox either, a missing side is the default object size's, as in an `<img>`.
 */
export function svgIntrinsicSize(
  width: number | null,
  height: number | null,
  viewBox: SvgViewBox | null
): SvgSize {
  if (width !== null && height !== null) return { width, height };
  if (viewBox) {
    const aspect = viewBox.width / viewBox.height;
    if (width !== null) return { width, height: width / aspect };
    if (height !== null) return { width: height * aspect, height };
    return { width: viewBox.width, height: viewBox.height };
  }
  return {
    width: width ?? DEFAULT_OBJECT_SIZE.width,
    height: height ?? DEFAULT_OBJECT_SIZE.height,
  };
}

/**
 * Whole pixels for drawing `size` with its longer side at `maxDimension`.
 *
 * Scaled up as well as down: a vector has no resolution of its own, and the
 * size it declares — a 24 px icon, an A4 page in millimetres — says nothing
 * about how closely it will be looked at once it is under a crease pattern.
 */
export function svgRasterSize(size: SvgSize, maxDimension: number): SvgSize {
  const scale = maxDimension / Math.max(size.width, size.height);
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

export interface PreparedSvg extends SvgSize {
  /**
   * The root element, re-serialized and sized to `width`×`height` pixels. The
   * root alone: the XML declaration would name the file's encoding, and this
   * text is encoded as UTF-8; internal entities were expanded by the parse.
   */
  markup: string;
}

/**
 * Parse an SVG file's text and size its root for drawing at `maxDimension`.
 * Throws when the text is not an SVG document.
 *
 * The root always leaves with a viewBox. Without one, user units are CSS pixels
 * and a larger `width`/`height` would only widen the canvas around a drawing of
 * the same size; the viewBox it would have had makes the drawing scale with it.
 *
 * The size is stated twice, as attributes and as important inline style. WebKit
 * lets the root's CSS override the attributes — a `max-width` as Mermaid writes
 * it, a `width` in a `<style>` rule — and would then draw into a corner of the
 * canvas; an important inline declaration outranks all of them.
 */
export function prepareSvgForRaster(text: string, maxDimension: number): PreparedSvg {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (
    root.namespaceURI !== SVG_NS ||
    root.localName !== 'svg' ||
    doc.getElementsByTagName('parsererror').length > 0
  ) {
    throw new Error('The file is not an SVG document');
  }
  const viewBox = parseSvgViewBox(root.getAttribute('viewBox'));
  const intrinsic = svgIntrinsicSize(
    parseSvgLength(root.getAttribute('width')),
    parseSvgLength(root.getAttribute('height')),
    viewBox
  );
  const raster = svgRasterSize(intrinsic, maxDimension);
  const box = viewBox ?? { x: 0, y: 0, ...intrinsic };
  root.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
  root.setAttribute('width', String(raster.width));
  root.setAttribute('height', String(raster.height));
  const style = root.getAttribute('style');
  root.setAttribute('style', `${style ? `${style};` : ''}${rootSizeStyle(raster)}`);
  return { markup: new XMLSerializer().serializeToString(root), ...raster };
}

function rootSizeStyle({ width, height }: SvgSize): string {
  return [
    `width:${width}px`,
    `height:${height}px`,
    'min-width:0',
    'min-height:0',
    'max-width:none',
    'max-height:none',
  ]
    .map((declaration) => `${declaration} !important`)
    .join(';');
}

export interface LoadedSvgImage extends SvgSize {
  /** Loaded and ready to draw at `width`×`height`; never attached to the document. */
  image: HTMLImageElement;
}

/**
 * Load an SVG file as an image, its longer side `maxDimension` pixels. Rejects
 * when the file is not an SVG or the engine cannot render it.
 *
 * From a `data:` URL rather than a `blob:` one, which leaves nothing to revoke.
 */
export async function loadSvgImage(file: Blob, maxDimension: number): Promise<LoadedSvgImage> {
  const text = decodeSvgText(new Uint8Array(await file.arrayBuffer()));
  const prepared = prepareSvgForRaster(text, maxDimension);
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The SVG could not be rendered'));
  });
  image.src = await dataUrl(new Blob([prepared.markup], { type: 'image/svg+xml;charset=utf-8' }));
  await loaded;
  return { image, width: prepared.width, height: prepared.height };
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('The SVG could not be read'));
    reader.readAsDataURL(blob);
  });
}
