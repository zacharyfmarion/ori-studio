/**
 * A 3D folded figure as a painted page: the window's scene through the shared
 * painter.
 *
 * The figure's export used to be the projector's picture — a second builder
 * of the same geometry as the window's mesh, with its own cull, merge and
 * camera (F9 in `implementation-plans/unified-paper-style-and-export.md`).
 * Now it is the same path the simulator's view export takes: the mesh the
 * window uploads, `folded3dPaperScene` at the camera the window shows, and
 * `paperSceneToSvg` on the export page. What the file shows is what the
 * window shows because nothing between them is a second interpretation (D5).
 *
 * Only a figure with a **live kernel** can take this path: the render model
 * lives against the wasm handle (`folded3dRenderModels.ts`), so a figure
 * reopened from a file and not yet rehydrated has nothing to build a scene
 * from. That figure keeps exporting its stored `renderSnapshot` through
 * `foldedFigureExport.ts` — the same picture the canvas and the CP export
 * dialog draw for it (R7) — until the projector retires in Phase 7 and the
 * scene is what gets stored. `null` here is that answer, and the caller falls
 * back; it is never a failure.
 */

import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import type { PaperPage } from '../../lib/paper/paperPage';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, surfacePaperStyle } from '../../lib/paper/paperStyleResolve';
import { paperSceneToSvg, type PaperSvgResult } from '../../lib/paper/paperSvg';
import { folded3dMesh } from './folded3dMesh';
import { folded3dRenderModel } from './folded3dRenderModels';
import { folded3dFigureBoxCssPx, folded3dPaperScene, folded3dSceneCamera } from './folded3dScene';

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
  const folded3d = figure.folded3d;
  const model = folded3dRenderModel(figure.handle);
  if (!folded3d || !model) return null;
  const built = folded3dMesh(model);
  if (built.kind !== 'mesh') return null;
  const box = folded3dFigureBoxCssPx(figure, cssPerUserUnit);
  if (box === null) return null;

  const camera = folded3dSceneCamera(figure.camera, built.mesh, box);
  const scene = folded3dPaperScene(built.mesh, model, camera, {
    style,
    // A page that keeps buried faces has no use for the hidden test, which is
    // the expensive half of building the scene.
    markHidden: !page.keepHiddenFaces,
    tolerances: folded3d.diagnostics.tolerances,
    displayStyle: figure.displayStyle,
  });
  if (scene.items.length === 0) return null;
  // The painter takes the style as the window sees it — every crease at the
  // edge pen, the fields the policy does not apply at their defaults — as the
  // simulator hands its own policy's view to the painter. The scene producer
  // applies the same policy for its light and pen width; it is idempotent.
  return paperSceneToSvg(scene, surfacePaperStyle(style, PAPER_STYLE_POLICIES['folded-3d']), page);
}
