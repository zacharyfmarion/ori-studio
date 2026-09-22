/**
 * A painted page as a PNG: the SVG rasterised at a chosen density.
 *
 * The page is in points, so the pixel size follows from the dpi alone —
 * `pt / 72 × dpi` — whatever screen the scene came from. The default keeps
 * the PNG at twice the CSS page (96 dpi is 1 CSS px per pt × 4/3), because a
 * diagram dropped into a document is usually looked at larger than the panel
 * it came from, and 1:1 gives a soft image at exactly the moment somebody
 * wanted the detail.
 */
import { svgToPng } from '../svgToPng';
import type { PaperSvgResult } from './paperSvg';

export const DEFAULT_PAPER_PNG_DPI = 192;

/** The densities the UI offers. */
export const PAPER_PNG_DPI_RANGE = { min: 36, max: 1200, step: 1 } as const;

const PT_PER_INCH = 72;

/** The pixel size a page rasterises to at this density, rounded to whole px. */
export function paperPngSize(
  page: Pick<PaperSvgResult, 'widthPt' | 'heightPt'>,
  dpi: number
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round((page.widthPt / PT_PER_INCH) * dpi)),
    height: Math.max(1, Math.round((page.heightPt / PT_PER_INCH) * dpi)),
  };
}

export function paperSvgToPng(
  page: PaperSvgResult,
  dpi: number = DEFAULT_PAPER_PNG_DPI
): Promise<Uint8Array> {
  const { width, height } = paperPngSize(page, dpi);
  return svgToPng(page.svg, width, height);
}
