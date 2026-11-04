/**
 * "Fold with layer order…" on an Edit selection (`implementation-plans/layer-order-dialog.md`,
 * row H5): fold the creases, open the Layer order dialog on that fold, and
 * make the figure with the order its Apply chose, as one undo entry.
 *
 * - **A fold of the dialog's own.** The press folds the creases as Fold
 *   would, after the same pre-fold check (`prepareOristudioCpLayerOrderFold`),
 *   on a fold no figure holds: nothing appears on the canvas until Apply, and
 *   that fold is let go however the press ends.
 * - **One door.** The dialog is reached through its gateway alone. `applied`
 *   folds the new figure with the order chosen and saves its record;
 *   `unchanged` (Apply on the order it opened on) folds it with Oriedita's
 *   own order, as Fold does, and saves none. `cancelled`, `busy` and
 *   `unavailable` leave the canvas and the history as they were.
 * - **One undo entry,** "Fold model", as Fold's: the figure's fold runs inside
 *   the folded layer's bracket (`foldedFigureGesture`).
 * - **What the press found.** A crease edited or another document opened
 *   after the press stops it before the dialog opens, and again before Apply
 *   folds (`foldPress.ts`), with a message and nothing written. The figure
 *   lands with the creases' provenance as the press found them.
 * - **One press at a time,** from the press until the dialog has closed and
 *   Apply has folded: the opening's release ends it.
 *
 * React-free, as the figures' other verbs are (`foldedFigureVerbs.ts`), so the
 * selection toolbar and the shortcut run the same one.
 */
import type { TFunction } from 'i18next';
import {
  openLayerOrderDialog,
  prefetchLayerOrderDialog,
  type LayerOrderDialogOutcome,
} from '../../layer-order/dialog/layerOrderDialogGateway';
import type { LayerOrderRegion, LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { layerOrderSourceOf } from '../../lib/layerOrder/layerOrderSource';
import { layerOrderRegionOfLines } from '../regions/layerOrderRegion';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type {
  OristudioCpFoldWithChosenOrder,
  OristudioCpSelectionLayerOrderOpening,
} from '../../store/workspaceStore/types';
import { uprightRotationForView } from '../annotations/annotationTransform';
import { cpOverlayViewStore } from '../cpOverlayViewStore';
import { effectiveObjectPaperStyle } from '../paper/objectPaperStyle';
import { foldedFigureGesture } from './foldedFigureGesture';
import { foldPressMoved } from './foldPress';
import { isLayerOrderPressRefusal, sayLayerOrderPressRefusal } from './layerOrderPressToasts';
import { editFigureLook, editFigureView, turnFoldedFigureTo, type EditFigureView } from './openFoldedFigureLayerOrder';

/** How a press ended: the dialog's answer, or that it never opened. */
export type SelectionLayerOrderPress = LayerOrderDialogOutcome['kind'] | 'not-opened';

/**
 * What the dialog opens on for the selection's fold (`opening`), on the canvas
 * `view`: asked from a selection (`edit_pattern`, spec §10), not a figure;
 * the source it folded, with no record yet; the look of the figure
 * Apply makes (D18) — the app's display style with the pins a new figure
 * from this document gets (an Oriedita file's saved colours), front up,
 * turned as a new figure is placed (`rotation`, upright on screen), not
 * see-through; the order Fold would show (D19); the dialog's name for a
 * selection; and the sheet the selection lies on (`region`), which the crease
 * pattern pane shows alone.
 */
export function selectionLayerOrderRequest(
  opening: Extract<OristudioCpSelectionLayerOrderOpening, { status: 'ready' }>,
  view: EditFigureView,
  rotation: number,
  t: TFunction,
  region: LayerOrderRegion | null = null
): LayerOrderRequest {
  const style = effectiveObjectPaperStyle({ appearance: opening.figure.appearance }, view.display);
  return {
    surface: 'edit_pattern',
    source: layerOrderSourceOf(opening.source, opening.model),
    ...(region ? { region } : {}),
    record: null,
    look: editFigureLook(view, { style, rotation, model: opening.model, xray: false }),
    ...(opening.shown ? { shown: opening.shown } : {}),
    name: t('panels:creasePattern.layerOrderSelectionName', 'Selection'),
  };
}

/**
 * Fold `lineIds` with a layer order chosen in the dialog. Answers how the
 * press ended; only an Apply (`applied`, `unchanged`) makes a figure.
 */
export async function foldSelectionWithLayerOrder(
  lineIds: readonly number[],
  t: TFunction
): Promise<SelectionLayerOrderPress> {
  const store = useWorkspaceStore;
  // The dialog's code, while the creases fold: loads, never spawns.
  prefetchLayerOrderDialog();
  const opening = await store.getState().prepareOristudioCpLayerOrderFold(lineIds);
  if (opening.status !== 'ready') {
    // No fault: said as a message. A fault has said itself, as an error (`oristudioCpError`).
    if (isLayerOrderPressRefusal(opening.reason)) sayLayerOrderPressRefusal(opening.reason, t);
    return 'not-opened';
  }
  try {
    // The crease pattern the selection lies on, out of however many the canvas holds.
    const document = store.getState().oristudioCpDocument?.document;
    const region = document ? await layerOrderRegionOfLines(document, opening.lineIds) : null;
    const request = selectionLayerOrderRequest(opening, editFigureView(store.getState()), newFigureRotation(), t, region);
    const outcome = await openLayerOrderDialog(request);
    // Folded as the press found the creases, and only if they are still there (`foldPress.ts`).
    const { press, figure } = opening;
    let folded: boolean | undefined;
    if (outcome.kind === 'applied') {
      const { source, relations, record } = outcome.applied;
      const withOrder = { source, relations, record, press, figure };
      folded = await foldWithChosenOrderAsEntry(opening.lineIds, withOrder, t, outcome.turnDeg);
    } else if (outcome.kind === 'unchanged') {
      const withOrder = { source: request.source, relations: new Uint32Array(), record: null, press, figure };
      folded = await foldWithChosenOrderAsEntry(opening.lineIds, withOrder, t, outcome.turnDeg);
    }
    // Refused because the creases moved since the press: no fault, so a message.
    if (folded === false && foldPressMoved(press, store.getState())) sayLayerOrderPressRefusal('moved', t);
    return outcome.kind;
  } finally {
    await opening.release();
  }
}

/**
 * The new figure's fold, as Fold's own entry: "Fold model", or nothing when
 * it folds nothing. With `turnDeg`, the dialog's Rotate turned it: the new
 * figure starts turned so, in the same entry.
 */
function foldWithChosenOrderAsEntry(
  lineIds: readonly number[],
  withOrder: OristudioCpFoldWithChosenOrder,
  t: TFunction,
  turnDeg?: number
): Promise<boolean | undefined> {
  return foldedFigureGesture.run('verb', t('panels:creasePattern.foldModelAction', 'Fold model'), async () => {
    const store = useWorkspaceStore;
    const before = new Set(store.getState().oristudioCpFoldedFigures.map((entry) => entry.id));
    const folded = await store.getState().foldOristudioCpDocument({ startingFaceId: 1, lineIds: [...lineIds], withOrder });
    // The figure this fold made: the one the list did not hold before it.
    const made = folded ? store.getState().oristudioCpFoldedFigures.find((entry) => !before.has(entry.id)) : undefined;
    if (made && turnDeg !== undefined) turnFoldedFigureTo(made.id, turnDeg);
    return folded;
  });
}

/** How far a new figure is turned on the canvas: upright on screen, as a fold places it. */
function newFigureRotation(): number {
  return uprightRotationForView(cpOverlayViewStore.get()?.user ?? null);
}
