/**
 * Which Edit figures draw their layers spread, and the paper scene a spread is
 * drawn from (`implementation-plans/spread-and-layer-order-in-edit-export-share.md`,
 * decisions 6 and 7).
 *
 * A spread needs the kernel's ordered paper scene, which is the `Paper5`
 * picture whatever the display style — so only a flat figure whose layer
 * order was solved has one to spread, and only the Paper and X-ray looks draw
 * it. Wireframe, the legacy styles, a 3D figure and a fold with no layer order
 * keep their snapshot, and keep their setting.
 *
 * The scene of a live figure is the one its handle answers for its current
 * fold (`foldedFlatScenes.ts`); a figure reopened without a fold draws from
 * the scene its file carried (`spreadScene`), and draws flat when it carried
 * none.
 *
 * Pure.
 */

import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import { isFolded3dFigure } from './foldedFigureCapabilities';
import { foldedFigureSpreadOptions } from './foldedFigureSpread';
import { foldedFlatScene, type FoldedFlatSceneTable } from './foldedFlatScenes';

/** Whether the figure draws its layers spread when its spread is on. */
export function foldedFigureSpreadDrawable(
  figure: Pick<OristudioCpFoldedFigureEntry, 'folded3d' | 'snapshot' | 'displayStyle'>
): boolean {
  return (
    !isFolded3dFigure(figure) &&
    figure.snapshot?.outcome === 'Solved' &&
    (figure.displayStyle === 'Paper5' || figure.displayStyle === 'Transparent3')
  );
}

/** Whether the figure's spread is on and it can draw it: what asks the kernel for its scene. */
export function foldedFigureWantsSpread(
  figure: Pick<OristudioCpFoldedFigureEntry, 'spread' | 'folded3d' | 'snapshot' | 'displayStyle'>
): boolean {
  return foldedFigureSpreadOptions(figure) !== null && foldedFigureSpreadDrawable(figure);
}

/**
 * The paper scene the figure's spread is drawn from: its handle's, for its
 * current fold, or the one its file carried while it has no handle. Null
 * while a live figure's is still being fetched, and for a reopened figure
 * whose file carried none.
 */
export function foldedFigureSpreadScene(
  figure: Pick<OristudioCpFoldedFigureEntry, 'handle' | 'snapshot' | 'spreadScene'>,
  table: FoldedFlatSceneTable
): OristudioCpFoldedPaperScene | null {
  // Handle 0 is a valid wasm slot index; only null/undefined means "not ready".
  if (figure.handle != null) return foldedFlatScene(figure.handle, figure.snapshot, table) ?? null;
  return figure.spreadScene ?? null;
}
