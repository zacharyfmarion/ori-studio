import type { OristudioCpFoldedRenderSnapshot } from '../../engine/oristudioCpTypes';
import { creaseExportPalette, svgToPng, type CreaseExportTheme } from '../../lib/creaseExport';
import { foldedFigureSvgBody, projectedFoldedFigureBounds } from '../../lib/foldedFigureSvg';
import type { Point } from '../../lib/geometry';

/**
 * Export one folded figure on its own, straight from its render snapshot.
 *
 * Deliberately not routed through the crease-pattern export dialog: that dialog
 * is scoped to a crease pattern and *re-folds* a segment to draw its figure. A
 * figure on the canvas already has its geometry, so exporting it is a
 * serialization, not another fold — no kernel round trip, and the file is
 * exactly the figure the user is looking at.
 *
 * The figure's canvas placement (offset, scale, rotation) is not applied. That
 * transform says where the figure sits *on the crease-pattern canvas*, and a
 * standalone image has no canvas; the crease-pattern export draws its folded
 * figure from the snapshot alone for the same reason.
 */

/** Formats a folded figure can be exported to: it is geometry, so images only. */
export type FoldedFigureExportFormat = 'svg' | 'png';

/** Side of the exported image's longest edge, in px, before padding. */
const FIGURE_SIZE = 1024;
/** Padding around the figure, as a fraction of the longest edge. */
const PADDING_RATIO = 0.04;

export interface FoldedFigureExportOptions {
  theme?: CreaseExportTheme;
  /** Draw the page background. Off gives a transparent PNG / bare SVG. */
  showBackgroundColor?: boolean;
}

export interface FoldedFigureExportDocument {
  svg: string;
  width: number;
  height: number;
}

/**
 * Compose the standalone SVG page for a figure, fitted to its own bounds.
 * Null when the snapshot draws nothing — a figure mid-fold, errored, or empty.
 */
export function foldedFigureExportDocument(
  snapshot: OristudioCpFoldedRenderSnapshot | null | undefined,
  options: FoldedFigureExportOptions = {}
): FoldedFigureExportDocument | null {
  if (!snapshot) return null;
  const identity = (point: Point): Point => point;
  const bounds = projectedFoldedFigureBounds(snapshot, identity);
  if (!bounds) return null;

  const modelWidth = bounds.maxX - bounds.minX;
  const modelHeight = bounds.maxY - bounds.minY;
  const longest = Math.max(modelWidth, modelHeight);
  // A figure with no extent in either axis (a degenerate fold) would divide by
  // zero; there is nothing to draw at any scale.
  if (longest <= 0) return null;

  const scale = FIGURE_SIZE / longest;
  const padding = FIGURE_SIZE * PADDING_RATIO;
  const width = modelWidth * scale + padding * 2;
  const height = modelHeight * scale + padding * 2;
  const palette = creaseExportPalette(options.theme ?? 'light');

  const body = foldedFigureSvgBody(snapshot, {
    project: (point) => ({
      x: (point.x - bounds.minX) * scale + padding,
      y: (point.y - bounds.minY) * scale + padding,
    }),
    scale,
  });

  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(2)}" height="${height.toFixed(2)}" viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}" role="img" aria-label="Folded figure">`,
    options.showBackgroundColor === false
      ? ''
      : `  <rect width="100%" height="100%" fill="${palette.canvas}"/>`,
    body,
    '</svg>',
  ]
    .filter(Boolean)
    .join('\n');

  return { svg, width, height };
}

/** The figure as a standalone SVG file. Null when it draws nothing. */
export function serializeFoldedFigureSvg(
  snapshot: OristudioCpFoldedRenderSnapshot | null | undefined,
  options: FoldedFigureExportOptions = {}
): string | null {
  return foldedFigureExportDocument(snapshot, options)?.svg ?? null;
}

/** The figure rasterized to PNG bytes. Null when it draws nothing. */
export async function renderFoldedFigurePng(
  snapshot: OristudioCpFoldedRenderSnapshot | null | undefined,
  options: FoldedFigureExportOptions = {}
): Promise<Uint8Array | null> {
  const page = foldedFigureExportDocument(snapshot, options);
  if (!page) return null;
  return svgToPng(page.svg, page.width, page.height);
}
