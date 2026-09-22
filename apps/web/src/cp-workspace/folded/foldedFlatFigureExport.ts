/**
 * A flat folded figure as a painted page: the kernel's paper scene through the
 * shared painter.
 *
 * The flat figure's display stays on the oracle-checked drawer's stream, and
 * its export used to serialize that stream — one fill per subface, no buried
 * layer, every stroke at the kernel's own width (F2, F4 in
 * `implementation-plans/unified-paper-style-and-export.md`). Now it is the
 * path the 3D figure and the simulator take: the kernel's read-only paper
 * scene (`folded_figure_paper_scene`, beside the untouched drawer), the flat
 * producer's whole faces in painter's order, and `paperSceneToSvg` on the
 * export page. What the file shows is what the canvas shows — the producer's
 * tests hold the visible face of every subface to the drawer's — and every
 * layer is in it for a drawing editor to peel back (D4, D6).
 *
 * Only a figure with a **live kernel** can take this path: the scene is read
 * from the wasm handle, so a figure reopened from a file and not yet rehydrated
 * has nothing to build one from. That figure keeps exporting its stored
 * `renderSnapshot` through `foldedFigureExport.ts` — the picture the canvas
 * draws for it — until the scene is what gets stored (Phase 7). So do the two
 * display styles the paper scene has no form for: `Wire2` is the wireframe
 * the drawer draws and `None0` is nothing, and the paper scene is the `Paper5`
 * picture whatever the style. And so does a fold with no layer ordering: the
 * kernel rewinds a search that found no solutions, or hit a contradiction, to
 * `Transparent3`, and that figure has no `Paper5` picture to paint — its
 * stored snapshot is the transparent development with the offending faces
 * marked. Only a *solved* figure the user views as `Transparent3` takes the
 * scene path, and exports as opaque paper with every layer kept, as the 3D
 * figure's X-ray view does.
 *
 * The caller reads the scene, because that read is asynchronous and lives in
 * the runtime; this module is the pure half, so a test can hand it a scene the
 * kernel folded in Node.
 */

import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import type { PaperPage } from '../../lib/paper/paperPage';
import type { ScenePoint } from '../../lib/paper/paperScene';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, surfacePaperStyle } from '../../lib/paper/paperStyleResolve';
import { paperSceneToSvg, type PaperSvgResult } from '../../lib/paper/paperSvg';
import type { Point } from '../../lib/geometry';
import { foldedFigureUserPerModelUnit } from '../adapters/cpFoldedToScene';
import { foldedFlatPaperScene } from './foldedFlatScene';

export interface FoldedFlatFigureExportOptions {
  /** The figure's effective export style: the app's export style with its own pins on top. */
  style: PaperStyle;
  page: PaperPage;
  /**
   * CSS px per crease-pattern user unit at the canvas the figure is on — what
   * sizes its picture on screen, and so the page (D3: the default sheet size
   * is the on-screen size). `1` when no canvas is mounted, which is the
   * picture at zoom 1.
   */
  cssPerUserUnit?: number;
}

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

/**
 * The figure's picture, painted on `page`, from the kernel's scene for its
 * handle. `null` when the scene draws nothing (an empty model); the caller
 * keeps the stored picture.
 */
export function foldedFlatFigureExportPage(
  figure: OristudioCpFoldedFigureEntry,
  kernel: OristudioCpFoldedPaperScene,
  { style, page, cssPerUserUnit = 1 }: FoldedFlatFigureExportOptions
): PaperSvgResult | null {
  const scale = foldedFlatFigureScenePxPerUnit(figure, cssPerUserUnit);
  const scene = foldedFlatPaperScene(kernel, {
    // A page that keeps buried faces has no use for the hidden test.
    markHidden: !page.keepHiddenFaces,
    toScenePx: (point: Point): ScenePoint => [point.x * scale, point.y * scale],
    scale,
  });
  if (scene.items.length === 0) return null;
  // The painter takes the style as the canvas sees it — every crease at the
  // edge pen, no light — as the 3D figure hands its own policy's view.
  return paperSceneToSvg(scene, surfacePaperStyle(style, PAPER_STYLE_POLICIES['folded-flat']), page);
}
