/**
 * Adjust order's ask of the Layer order dialog
 * (`implementation-plans/fold-adjust-order.md`): the request it opens on,
 * and what of its answer the step takes.
 *
 * - **What the dialog analyses** is the engine's opening of the step on
 *   screen (`FoldAdjustOrderOpening`): the state's crease pattern as Edit
 *   folds it whole, and the state's own order drawn over those faces
 *   (`shown`), which the dialog opens on. There is no record: a step's order
 *   is its own, stored with it.
 * - **Its look is Fold's**, as Import CP's is (`foldLayerOrderLook`).
 * - **No Rotate** (`rotate: false`): the step keeps its parent's pose, so the
 *   dialog offers no turn, and the step never takes one. Its Front/Back is
 *   only a way to look at the paper; no side is written either.
 * - **What Apply hands back** is the chosen relations over the opening's
 *   faces and their digest: what the engine's pick lands. Every other
 *   outcome adds nothing.
 *
 * Pure: no React, no store, no engine.
 */
import type { LayerOrderDialogOutcome } from '../../layer-order/dialog/layerOrderDialogGateway';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { layerOrderSourceOf } from '../../lib/layerOrder/layerOrderSource';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import type { FoldAdjustOrderOpening } from '../engine/foldEngineIoWire';
import { foldLayerOrderLook, type FoldImportView } from '../io/foldImportLayerOrder';

/** What the dialog opens on for the step on screen (see the module docs). */
export function foldAdjustOrderRequest(opening: FoldAdjustOrderOpening, view: FoldImportView): LayerOrderRequest {
  return {
    surface: 'fold_adjust_order',
    source: layerOrderSourceOf(opening.source, DEFAULT_FOLDED_MODEL),
    record: null,
    look: foldLayerOrderLook(opening.look, view),
    shown: opening.shown,
    rotate: false,
  };
}

/** The order Apply chose, for the engine's pick: null for every outcome that adds no step. Never a turn or a side. */
export function foldAdjustOrderChosen(
  outcome: LayerOrderDialogOutcome
): { readonly digest: string; readonly relations: Uint32Array } | null {
  if (outcome.kind !== 'applied') return null;
  const { relations, source } = outcome.applied;
  return { digest: source.digest, relations };
}
