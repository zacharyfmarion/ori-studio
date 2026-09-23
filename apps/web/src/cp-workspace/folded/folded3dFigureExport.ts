/**
 * A 3D folded figure as a painted page: the window's scene through the shared
 * painter.
 *
 * The figure's export used to be a CPU projector's picture — a second builder
 * of the same geometry as the window's mesh, with its own cull, merge and
 * camera (F9 in `implementation-plans/unified-paper-style-and-export.md`).
 * Now it is the same path the simulator's view export takes: the mesh the
 * window uploads, `folded3dPaperScene` at the camera the window shows, and
 * `paperSceneToSvg` on the export page. What the file shows is what the
 * window shows because nothing between them is a second interpretation (D5).
 *
 * Only a figure with a **live kernel** can build a *fresh* scene: the render
 * model lives against the wasm handle (`folded3dRenderModels.ts`), so a figure
 * reopened from a file and not yet rehydrated has nothing to build one from.
 * That figure re-paints the scene it was saved with, which is the picture the
 * canvas is drawing for it (R7) — the same painter, the export style, and the
 * same page, since the stored picture is carried into the space the live path
 * builds at (`folded3dStoredSceneInCssPx`); what it cannot do is re-frame, so
 * the picture is the view it was saved at. A figure older still carries a `renderSnapshot`
 * and no scene; `null` here is that answer and the caller falls back to the
 * snapshot path. It is never a failure.
 */

import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import type { PaperPage } from '../../lib/paper/paperPage';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, surfacePaperStyle } from '../../lib/paper/paperStyleResolve';
import { paperSceneToSvg, type PaperSvgResult } from '../../lib/paper/paperSvg';
import { folded3dAuxLinesOf } from './folded3dAuxLines';
import { folded3dRenderModel } from './folded3dRenderModels';
import { folded3dFigureScene, folded3dStoredSceneInCssPx } from './folded3dStoredScene';

export interface Folded3dFigureExportOptions {
  /** The figure's effective export style: the app's export style with its own pins on top. */
  style: PaperStyle;
  page: PaperPage;
  /**
   * CSS px per crease-pattern user unit at the canvas the figure is on — what
   * sizes its on-screen box, and so the page (D3: the default sheet size is
   * the on-screen size). `1` when no canvas is mounted, which is the box at
   * zoom 1.
   */
  cssPerUserUnit?: number;
}

/**
 * The figure's window, painted on `page`. `null` when the scene cannot be
 * built — no 3D fold, no live kernel, a model past the mesh's vertex budget,
 * a figure with no frame to size the box from — or when it draws nothing (a
 * `None0` figure, an empty model); the caller keeps the stored picture.
 */
export function folded3dFigureExportPage(
  figure: OristudioCpFoldedFigureEntry,
  { style, page, cssPerUserUnit = 1 }: Folded3dFigureExportOptions
): PaperSvgResult | null {
  if (!figure.folded3d) return null;
  const model = folded3dRenderModel(figure.handle);
  const scene = model
    ? folded3dFigureScene(figure, model, {
        style,
        space: cssPerUserUnit,
        // A page that keeps buried faces has no use for the hidden test, which
        // is the expensive half of building the scene.
        markHidden: !page.keepHiddenFaces,
        aux: folded3dAuxLinesOf(figure.handle),
      })
    : // The stored picture is in the figure's local user space, and the page is
      // sized in CSS px at pens that keep their pt widths — so it is carried
      // into the space the live path builds at rather than painted where it
      // lies, or the same figure would export at two ink-to-paper ratios
      // depending only on whether it had been rehydrated.
      figure.scene &&
      folded3dStoredSceneInCssPx(figure.scene, figure.placement, cssPerUserUnit);
  if (!scene || scene.items.length === 0) return null;
  // The painter takes the style as the window sees it — every crease at the
  // edge pen, the fields the policy does not apply at their defaults — as the
  // simulator hands its own policy's view to the painter. The scene producer
  // applies the same policy for its light and pen width; it is idempotent.
  return paperSceneToSvg(scene, surfacePaperStyle(style, PAPER_STYLE_POLICIES['folded-3d']), page);
}
