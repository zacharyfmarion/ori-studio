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
 * The scene of a live figure is the one its handle answers for the paper
 * scene its snapshot shows (`foldedFlatScenes.ts`, {@link foldedPaperSceneKey}):
 * one fetched before a write of the figure's colours still answers after it.
 * A figure reopened without a fold draws from the scene its file carried
 * (`spreadScene`), and draws flat when it carried none.
 *
 * Pure.
 */

import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import { foldedFigureSpreadBlock, foldedFigureSpreadOptions } from './foldedFigureSpread';
import { foldedFigureHasLayerOrder, foldedSnapshotCase } from './foldedFigureState';
import type { FoldedFlatSceneTable } from './foldedFlatScenes';

/**
 * Whether the figure draws its layers spread when its spread is on: when the
 * Properties sheet has no reason against it, and its fold has said it has
 * layers.
 */
export function foldedFigureSpreadDrawable(figure: OristudioCpFoldedFigureEntry): boolean {
  return foldedFigureSpreadBlock(figure, null) === null && foldedFigureHasLayerOrder(figure) === true;
}

/** Whether the figure's spread is on and it can draw it: what asks the kernel for its scene. */
export function foldedFigureWantsSpread(figure: OristudioCpFoldedFigureEntry): boolean {
  return foldedFigureSpreadOptions(figure) !== null && foldedFigureSpreadDrawable(figure);
}

/**
 * The paper scene the figure's spread is drawn from: its handle's, for the
 * paper scene its snapshot shows, or the one its file carried while it has no
 * handle. Null while a live figure's is still being fetched, and for a
 * reopened figure whose file carried none.
 */
export function foldedFigureSpreadScene(
  figure: Pick<OristudioCpFoldedFigureEntry, 'handle' | 'snapshot' | 'spreadScene'>,
  table: FoldedFlatSceneTable
): OristudioCpFoldedPaperScene | null {
  // Handle 0 is a valid wasm slot index; only null/undefined means "not ready".
  if (figure.handle != null) {
    const entry = table.get(figure.handle);
    return entry && figure.snapshot && sameFoldedPaperScene(entry.snapshot, figure.snapshot) ? entry.scene : null;
  }
  return figure.spreadScene ?? null;
}

/**
 * What of a kernel snapshot its handle's paper scene is drawn from, as one
 * key: the layer order shown (as `sameFoldedOrder` reads it), the side, and
 * the turn and scale of the kernel's camera. Another solution or a side flip
 * changes it; a write of the figure's colours — a pin, the paper-style
 * mirror, the model reconcile an undo runs — replaces the snapshot and keeps
 * it. A refold is a new handle.
 */
export function foldedPaperSceneKey(snapshot: OristudioCpFoldedFigureSnapshot): string {
  const { model } = snapshot;
  return [foldedSnapshotCase(snapshot), snapshot.shown_order ?? 'searched', model.state, model.rotation, model.scale].join(' ');
}

/** Whether two kernel snapshots of one handle show the same paper scene ({@link foldedPaperSceneKey}). */
export function sameFoldedPaperScene(
  a: OristudioCpFoldedFigureSnapshot,
  b: OristudioCpFoldedFigureSnapshot
): boolean {
  return a === b || foldedPaperSceneKey(a) === foldedPaperSceneKey(b);
}
