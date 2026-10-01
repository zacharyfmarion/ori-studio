/**
 * The largest PNG a browser will rasterise for us.
 *
 * `svgToPng` draws the page onto a canvas of the exact pixel size asked for,
 * and a canvas past the engine's limit is not an error anyone reports: the
 * context comes back null, or `toBlob` hands back nothing, and the export fails
 * after the save dialog with no word about why. So the dialog checks the size
 * first and says what is wrong while the options are still in front of the
 * reader.
 *
 * The cap is the tightest engine the app runs on, so a page that passes here
 * passes everywhere: 16 384 px a side — WebKit's, for Safari and the desktop
 * app's WKWebView — and, on iPhone and iPad, an *area* of 4 096² px. Those two
 * are WebKit's published limits, not yet measured here. Chromium is looser:
 * measured in the app (Chromium 152), it encodes a 65 535 px strip and an
 * 8 192² page.
 */

export interface PngCanvasLimit {
  /** The longest side, in px. */
  maxSide: number;
  /** Width × height, in px. */
  maxArea: number;
}

export const DESKTOP_PNG_CANVAS_LIMIT: PngCanvasLimit = { maxSide: 16_384, maxArea: 16_384 * 16_384 };

export const APPLE_MOBILE_PNG_CANVAS_LIMIT: PngCanvasLimit = { maxSide: 16_384, maxArea: 4_096 * 4_096 };

/** Whether a page of this pixel size fits the canvas the engine will give us. */
export function pngFitsCanvas(
  size: { width: number; height: number },
  limit: PngCanvasLimit = DESKTOP_PNG_CANVAS_LIMIT
): boolean {
  return (
    size.width <= limit.maxSide &&
    size.height <= limit.maxSide &&
    size.width * size.height <= limit.maxArea
  );
}
