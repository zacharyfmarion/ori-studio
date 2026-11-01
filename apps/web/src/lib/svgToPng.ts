import { APPLE_MOBILE_PNG_CANVAS_LIMIT, pngFitsCanvas, type PngCanvasLimit } from './paper/pngCanvasLimits';

/**
 * Rasterize a standalone SVG document through an offscreen canvas, at the pixel
 * size given. The image is scaled to the canvas whatever size the document
 * declares for itself, so a page in points rasterises at whatever density the
 * caller chose. Shared by the crease-pattern page, the folded-figure export and
 * the paper painter.
 */
export async function svgToPng(svg: string, width: number, height: number): Promise<Uint8Array> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to render export SVG'));
    });
    image.src = url;
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas rendering is unavailable');
    drawSvgPage(ctx, image, svg, { x: 0, y: 0, width: canvas.width, height: canvas.height });
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Failed to encode export PNG'));
      }, 'image/png');
    });
    return new Uint8Array(await pngBlob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface Size {
  width: number;
  height: number;
}

/**
 * The largest a page is drawn before it is shrunk: the tightest canvas the app
 * runs on, an iPhone's area, so the large canvas never fails an export that
 * would have worked, nor holds more than 64 MB. A page past it is drawn at its
 * size, which only a dense export reaches, and there a bitmap is not shrunk.
 */
const OVERSAMPLE_LIMIT: PngCanvasLimit = APPLE_MOBILE_PNG_CANVAS_LIMIT;

/**
 * How many times larger than its place a page is drawn before it is shrunk
 * into it: for a page that embeds a bitmap, twice the larger of its place and
 * its own size, or twice its place, whichever `limit` holds; once for a page
 * of vectors alone, as it always was.
 *
 * The SVG renderer shrinks an embedded bitmap with a cheap filter, and a 300
 * dpi spread figure is shrunk about 2.2 times onto a crease pattern's page, so
 * its thin pens came out jagged. Drawn at twice the page, the bitmap lands
 * near 1:1, and shrinking the whole page by halves ({@link drawSvgPage})
 * smooths it. A share card shrinks the page further, so it is drawn at twice
 * the page too.
 */
export function svgPageOversample(
  svg: string,
  place: Size,
  source: Size,
  limit: PngCanvasLimit = OVERSAMPLE_LIMIT
): number {
  if (!/<image[\s/>]/.test(svg)) return 1;
  for (const factor of [2 * Math.max(1, source.width / place.width), 2]) {
    if (pngFitsCanvas({ width: Math.round(place.width * factor), height: Math.round(place.height * factor) }, limit)) {
      return factor;
    }
  }
  return 1;
}

/**
 * Draw a loaded SVG page, of `source` size, into `place` on `ctx`, first at
 * the size {@link svgPageOversample} says. Shared by the PNG export and the
 * share card.
 */
export function drawSvgPage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  svg: string,
  place: { x: number; y: number; width: number; height: number },
  source: Size = place
): void {
  const factor = svgPageOversample(svg, place, source);
  let large = factor > 1 ? canvasOf(Math.round(place.width * factor), Math.round(place.height * factor)) : null;
  if (!large) {
    ctx.drawImage(image, place.x, place.y, place.width, place.height);
    return;
  }
  large.ctx.drawImage(image, 0, 0, large.canvas.width, large.canvas.height);
  // Shrunk by halves, which smoothing averages exactly, until one more step
  // would pass the place: one larger shrink skips pixels and leaves the pens
  // jagged again, high quality or not.
  while (large.canvas.width / 2 > place.width) {
    const half = canvasOf(Math.round(large.canvas.width / 2), Math.round(large.canvas.height / 2));
    if (!half) break;
    half.ctx.drawImage(large.canvas, 0, 0, half.canvas.width, half.canvas.height);
    release(large.canvas);
    large = half;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(large.canvas, place.x, place.y, place.width, place.height);
  release(large.canvas);
}

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/** Let a canvas's memory go now, not at the next collection: WebKit counts canvases against a budget. */
function release(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}
