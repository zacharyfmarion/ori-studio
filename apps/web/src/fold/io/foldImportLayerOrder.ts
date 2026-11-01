/**
 * Fold's Import CP choosing an imported crease pattern's layer order in the
 * Layer order dialog (`implementation-plans/layer-order-dialog.md`, row H10):
 * the request the dialog opens on, and its answer as the import flow acts on
 * it (`foldImportFlow.ts`, `chooseLayerOrder`).
 *
 * - **What the dialog analyses** is the engine's opening of the import
 *   (`FoldImportLayerOpening`): the stored crease pattern as Edit folds it
 *   whole, the faces Fold's import matched one for one, and the order the
 *   import would land by default drawn over them (`shown`), which the dialog
 *   opens on. There is no record yet: an import has never been ordered.
 * - **Its look is Fold's**: the shown sequence's paper style through Fold's
 *   policy, from the side Fold shows the state and turned as Fold turns it,
 *   with the crease pattern in Edit's pen, as Fold's crease pattern pane
 *   draws it.
 * - **One door.** The dialog is reached through its gateway alone. `applied`
 *   hands the flow the chosen relations and the digest of the faces they
 *   name; `unchanged` and `cancelled` pass through; `busy` and `unavailable`
 *   leave the import to its own chooser on the canvas, with a toast for
 *   `busy` (the gateway has already said why for `unavailable`). The flow's
 *   signal withdraws the ask when it lets the import go.
 *
 * No React: the app's flow (`useFoldImport.ts`) hands it the workspace's
 * view.
 */
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import {
  openLayerOrderDialog,
  type LayerOrderDialogOutcome,
} from '../../layer-order/dialog/layerOrderDialogGateway';
import {
  DEFAULT_ORISTUDIO_CP_LINE_STYLE,
  DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
  type OristudioCpLineStyle,
} from '../../lib/creasePatternViewport';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { layerOrderSourceOf } from '../../lib/layerOrder/layerOrderSource';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import { documentPaperStyleOf } from '../../lib/paper/documentPaperStyle';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import type { WorkspaceState } from '../../store/workspaceStore/types';
import { shownFoldSequence } from '../../store/workspaceStore/foldState';
import { foldStoredPaperStyle } from '../sequence/useFoldPaperStyle';
import type { FoldImportLayerOrderAnswer, FoldImportLayerOrderAsk } from './foldImportFlow';

/** What the Fold workspace adds to the dialog's look: its paper, and Edit's crease pen. */
export interface FoldImportView {
  /** The shown sequence's paper style, as Fold's folded pane draws it. */
  style: PaperStyle;
  /** Edit's view's line style and width, which Fold's crease pattern pane draws in too. */
  lineStyle: OristudioCpLineStyle;
  lineWidth: number;
}

/** The Fold workspace's view, as `state` holds it. */
export function foldImportView(state: Pick<WorkspaceState, 'foldSequences' | 'oristudioCpViewport'>): FoldImportView {
  return {
    style: documentPaperStyleOf(foldStoredPaperStyle(shownFoldSequence(state)?.document)),
    lineStyle: state.oristudioCpViewport.lineStyle ?? DEFAULT_ORISTUDIO_CP_LINE_STYLE,
    lineWidth: state.oristudioCpViewport.lineWidth ?? DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
  };
}

/**
 * What the dialog opens on for an import (see the module docs): asked from
 * Fold's Import CP (`fold_import`, spec §10), on the engine's opening of it,
 * with no record, in Fold's look, on the import's default order, named by its
 * file when it has one.
 *
 * **No `region`:** an import is one crease pattern, its whole sheet. Import
 * CP takes one closed border (a square or a rectangle; more loops are
 * refused, `import_outline_loops`), and Collapse and Update from CP hand it
 * the creases of one Edit sheet; the source is that pattern's creases and
 * nothing else, so the crease-pattern pane's own framing, the source's
 * creases, is the pattern.
 */
export function foldImportLayerOrderRequest(ask: FoldImportLayerOrderAsk, view: FoldImportView): LayerOrderRequest {
  const { opening, request } = ask;
  return {
    surface: 'fold_import',
    source: layerOrderSourceOf(opening.source, DEFAULT_FOLDED_MODEL),
    record: null,
    look: {
      style: view.style,
      policy: PAPER_STYLE_POLICIES.fold,
      turnDeg: opening.look.turn_deg,
      side: opening.look.side,
      xray: false,
      lineStyle: view.lineStyle,
      lineWidth: view.lineWidth,
    },
    shown: opening.shown,
    ...(request.kind === 'file' ? { name: request.name } : {}),
  };
}

/** The turn an Apply hands back, in the opening's `look` terms, when the dialog's Rotate moved it. */
function turnOf(outcome: { readonly turnDeg?: number }): { turnDeg?: number } {
  return outcome.turnDeg === undefined ? {} : { turnDeg: outcome.turnDeg };
}

/** The dialog's answer as the import flow acts on it (see the module docs). */
export function foldImportLayerOrderAnswer(outcome: LayerOrderDialogOutcome): FoldImportLayerOrderAnswer {
  switch (outcome.kind) {
    case 'applied': {
      const { relations, source } = outcome.applied;
      return { kind: 'applied', relations, digest: source.digest, ...turnOf(outcome) };
    }
    case 'unchanged':
      return { kind: 'unchanged', ...turnOf(outcome) };
    case 'cancelled':
      return { kind: 'cancelled' };
    case 'busy':
    case 'unavailable':
      return { kind: 'fallback' };
  }
}

/**
 * Ask the Layer order dialog for an import's order, and answer as the flow
 * acts on it. `signal` withdraws the ask: the dialog closes (`cancelled`).
 */
export async function chooseFoldImportLayerOrder(
  ask: FoldImportLayerOrderAsk,
  view: FoldImportView,
  t: TFunction,
  signal?: AbortSignal
): Promise<FoldImportLayerOrderAnswer> {
  const outcome = await openLayerOrderDialog(foldImportLayerOrderRequest(ask, view), signal ? { signal } : {});
  if (outcome.kind === 'busy') {
    toast(
      t(
        'toasts:layerOrder.foldImportBusy',
        'Layer order is already open, so choose this crease pattern’s layer order on the canvas.'
      )
    );
  }
  return foldImportLayerOrderAnswer(outcome);
}
