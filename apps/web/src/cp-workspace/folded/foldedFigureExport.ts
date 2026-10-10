import type { OristudioCpFoldedRenderSnapshot } from '../../engine/oristudioCpTypes';
import { creaseExportPalette, type CreaseExportTheme } from '../../lib/creaseExport';
import { foldedFigureSvgBody, projectedFoldedFigureBounds } from '../../lib/foldedFigureSvg';
import { turnClockwise } from '../../lib/geometry';

/**
 * A folded figure's stored render snapshot as a standalone page: what a figure
 * with no scene to paint exports — the export dialog's fixed picture (E9 in
 * `implementation-plans/paper-export-dialog.md`).
 *
 * A figure with a live kernel exports its scene through the shared painter
 * instead — the window's scene for a 3D figure, the kernel's paper scene for a
 * flat one (`foldedFigureExportTarget.ts`) — so the file is the picture the
 * canvas shows, on the export style and page, with every layer in it. What
 * comes through here is a figure reopened from a file and not yet rehydrated:
 * it has no render model or handle to build a scene from, so its stored
 * `renderSnapshot` — the same picture the canvas and the CP export dialog draw
 * for it (R7) — is serialized as it always was, a serialization rather than
 * another fold. So does a flat figure in a display style the paper scene has
 * no form for (`Wire2`, `None0`, the development views).
 *
 * The figure's canvas placement (offset, scale, rotation) is not applied. That
 * transform says where the figure sits *on the crease-pattern canvas*, and a
 * standalone image has no canvas.
 *
 * A **3D** figure reaches here only from a file written before its stored
 * picture became a `PaperScene`: a figure with a scene and no handle re-paints
 * that scene through the painter instead. Such a snapshot is fitted to the
 * figure's frame at any zoom, and keeps the **red annotation** on cells whose
 * order the solver could not decide, which nothing draws any more.
 */

/** Side of the exported image's longest edge, in px, before padding. */
const FIGURE_SIZE = 1024;
/** Padding around the figure, as a fraction of the longest edge. */
const PADDING_RATIO = 0.04;

export interface FoldedFigureExportOptions {
  theme?: CreaseExportTheme;
  /** Draw the page background. Off gives a transparent PNG / bare SVG. */
  showBackgroundColor?: boolean;
  /**
   * Turn the figure clockwise by this many degrees before it is fitted: a
   * Diagram step's pose. Absent or 0 draws it as the kernel did.
   */
  rotationDeg?: number;
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
  const turn = turnClockwise(options.rotationDeg ?? 0);
  const bounds = projectedFoldedFigureBounds(snapshot, turn);
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
    project: (point) => {
      const turned = turn(point);
      return {
        x: (turned.x - bounds.minX) * scale + padding,
        y: (turned.y - bounds.minY) * scale + padding,
      };
    },
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
