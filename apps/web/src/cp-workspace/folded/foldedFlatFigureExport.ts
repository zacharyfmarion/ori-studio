/**
 * Which flat folded figures export the kernel's paper scene, and at what size.
 *
 * The flat figure's display stays on the oracle-checked drawer's stream, and
 * its export used to serialize that stream — one fill per subface, no buried
 * layer, every stroke at the kernel's own width (F2, F4 in
 * `implementation-plans/unified-paper-style-and-export.md`). Now the export
 * dialog paints the kernel's read-only paper scene (`folded_figure_paper_scene`,
 * beside the untouched drawer) through the shared painter
 * (`foldedFigureExportTarget.ts`), so the file is what the canvas shows, and
 * every layer is in it for a drawing editor to peel back (D4, D6).
 *
 * Only a figure with a **live kernel** can: the scene is read from the wasm
 * handle, so a figure reopened from a file and not yet rehydrated exports its
 * stored `renderSnapshot` as it was drawn (`foldedFigureExport.ts`). So do the
 * two display styles the paper scene has no form for — `Wire2` is the
 * wireframe the drawer draws and `None0` is nothing, and the paper scene is
 * the `Paper5` picture whatever the style — and a fold with no layer
 * ordering: the kernel rewinds a search that found no solutions, or hit a
 * contradiction, to `Transparent3`, and that figure has no `Paper5` picture to
 * paint. Only a *solved* figure the user views as `Transparent3` takes the
 * scene, and exports as opaque paper with every layer kept, as the 3D
 * figure's X-ray view does.
 */

import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { foldedFigureUserPerModelUnit } from '../adapters/cpFoldedToScene';

/**
 * Whether a figure's export is the kernel's paper scene: a flat figure with a
 * live handle, a solved layer ordering, and a display style the scene has a
 * form for. Anything else keeps the stored picture.
 *
 * The ordering is read off the fold's own `outcome`, because the display
 * style cannot say: `Transparent3` is both a view the user can pick on a
 * solved figure and where the kernel parks a fold it could not order.
 */
export function foldedFlatFigureExportsScene(
  figure: OristudioCpFoldedFigureEntry
): figure is OristudioCpFoldedFigureEntry & { handle: number } {
  return (
    !figure.folded3d &&
    figure.handle !== null &&
    figure.snapshot?.outcome === 'Solved' &&
    (figure.displayStyle === 'Paper5' || figure.displayStyle === 'Transparent3')
  );
}

/**
 * Scene px per kernel unit for a figure: its placement's scale through the
 * paper affine, at the canvas's CSS px per user unit. The linear part of the
 * affine the canvas draws the figure's render snapshot through; the picture's
 * position on the canvas, and its turn, are not a standalone image's.
 */
export function foldedFlatFigureScenePxPerUnit(
  figure: Pick<OristudioCpFoldedFigureEntry, 'placement'>,
  cssPerUserUnit = 1
): number {
  return foldedFigureUserPerModelUnit(figure) * cssPerUserUnit;
}
