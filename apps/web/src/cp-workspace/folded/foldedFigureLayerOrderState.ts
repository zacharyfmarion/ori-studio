/**
 * What an Edit folded figure's layer order allows at rest, read from saved
 * data only (`implementation-plans/layer-order-dialog.md`, rows H3 and H4,
 * approach 5): whether "Layer order…" can open on it and why not, whether a
 * chosen order holds it, and whether its constraints need a look since an
 * edit. Nothing here asks the engine or the kernel, so the toolbar, the
 * context menu and the Properties pane can ask it on every render, selection
 * and file open.
 *
 * React-free and store-free.
 */
import type { TFunction } from 'i18next';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { withLayerOrderAttention, type LayerOrderLossCause } from '../../layer-order/host/layerOrderResolution';
import { solutionsHeldForReview } from '../../layer-order/host/solutionCursorTable';
import type { LayerOrderAttention, LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import { isFolded3dFigure } from './foldedFigureCapabilities';
import { foldedFigureHasLayerOrder } from './foldedFigureState';

/**
 * Why "Layer order…" cannot open on a figure, in the order they are asked:
 *
 * - `3d`: its creases fold in 3D (D13);
 * - `waiting`: a fold, a refold or a step is running, or the figure failed;
 *   disabled with no reason, as every other verb waits;
 * - `undetermined`: its fold found no layer order to choose from (D3);
 * - `newer`: its record is a newer build's, carried as it came (H1's lock);
 * - `no-source`: it has no live fold and no recorded source creases to fold
 *   again, as a figure saved before they were recorded.
 *
 * A figure whose creases changed since it was folded is not held: the dialog
 * opens on its creases as they are now, and says that Apply also refolds it
 * (D12).
 */
export type FoldedFigureLayerOrderBlock = '3d' | 'waiting' | 'undetermined' | 'newer' | 'no-source';

/** Why "Layer order…" cannot open on `figure`, or null when it can. */
export function foldedFigureLayerOrderBlock(figure: OristudioCpFoldedFigureEntry): FoldedFigureLayerOrderBlock | null {
  const awaitsFlat = foldedFigureAwaitsFlatRefold(figure);
  if (isFolded3dFigure(figure) && !awaitsFlat) return '3d';
  if (figure.status !== 'ready') return 'waiting';
  // A stale figure on flat creases: opened on them, as any stale figure is (D12).
  if (awaitsFlat) return figure.sourceBounds == null ? 'no-source' : null;
  const found = foldedFigureHasLayerOrder(figure);
  if (found === null) return 'waiting';
  if (!found) return 'undetermined';
  if (figure.layerOrder?.kind === 'newer') return 'newer';
  // A live fold is its own source (`folded_figure_source`); one reopened from a
  // file is folded again from the creases it was folded from.
  if (figure.handle === null && figure.sourceBounds == null) return 'no-source';
  return null;
}

/**
 * How a chosen layer order holds a flat figure, read from the record it
 * carries: `record` when this build reads it, `newer` when a newer build's;
 * null for a figure Oriedita's search orders, as every figure did before the
 * dialog, and for a 3D one, whose record waits until it folds flat again
 * (D13).
 */
export function foldedFigureLayerOrderHold(figure: OristudioCpFoldedFigureEntry): 'record' | 'newer' | null {
  if (isFolded3dFigure(figure) && !foldedFigureAwaitsFlatRefold(figure)) return null;
  return figure.layerOrder?.kind ?? null;
}

/** The record a figure carries, when this build reads it. */
export function foldedFigureLayerOrderRecord(figure: OristudioCpFoldedFigureEntry): LayerOrderRecord | null {
  return figure.layerOrder?.kind === 'record' ? figure.layerOrder.record : null;
}

/**
 * Whether a constrained figure's ‹ › wait for its constraints to be reviewed:
 * they need a look since an edit (D14, {@link foldedFigureLayerOrderAttention}),
 * as when they clash and no order fits them all, so there is nothing to step
 * through until they are. Read from saved data alone, by every host's rule
 * (`solutionsHeldForReview`); the verbs and the store both ask this.
 */
export function foldedFigureSolutionsHeldForReview(figure: OristudioCpFoldedFigureEntry): boolean {
  return solutionsHeldForReview(foldedFigureLayerOrderAttention(figure));
}

/**
 * A 3D figure whose creases fold flat again, and whose record a refold on
 * them did not draw: it keeps its 3D picture, and its record a summary other
 * than waiting for flat creases (D10 after D13). It is a stale figure on flat
 * creases: flagged, opened on them, and refolded flat by an Apply.
 */
export function foldedFigureAwaitsFlatRefold(figure: OristudioCpFoldedFigureEntry): boolean {
  if (!isFolded3dFigure(figure)) return false;
  const attention = foldedFigureLayerOrderRecord(figure)?.attention;
  return attention !== undefined && attention.reason !== 'route-3d';
}

/**
 * Why a figure's constraints need a look since its creases changed, as its
 * record stores it (D10, D11): the summary a refold kept the old picture
 * with, or drew the rest of the constraints without. Null for a figure whose
 * record needs nothing, a figure with none, and a 3D figure whose record
 * waits for its creases to fold flat again and says so on its own row (D13).
 */
export function foldedFigureLayerOrderAttention(figure: OristudioCpFoldedFigureEntry): LayerOrderAttention | null {
  if (isFolded3dFigure(figure) && !foldedFigureAwaitsFlatRefold(figure)) return null;
  return foldedFigureLayerOrderRecord(figure)?.attention ?? null;
}

/**
 * A record a reload detached from this figure, shown for review: while the
 * figure is flat and holds no record of its own, through its refolds, moves
 * and renames; never once the user settled it, by an Apply or Dismiss.
 * Never used to fold (`foldedFigureLayerOrders.ts`).
 */
export function foldedFigureDetachedLayerOrder(figure: OristudioCpFoldedFigureEntry): LayerOrderRecord | null {
  const detached = figure.detachedLayerOrder;
  if (!detached || detached.settled || figure.layerOrder || isFolded3dFigure(figure)) return null;
  return detached.record;
}

/**
 * What a figure's flag says, read from saved data alone: its constraints need
 * a look since an edit (`attention`, D10, D14), or a reload detached them
 * because an older build folded it again (`detached`); null when there is
 * nothing to look at. `constraints` is how many the record holds; none is an
 * order chosen with no constraint (D16).
 */
export type FoldedFigureLayerOrderFlag =
  | { readonly kind: 'attention'; readonly attention: LayerOrderAttention; readonly constraints: number }
  | { readonly kind: 'detached'; readonly constraints: number };

export function foldedFigureLayerOrderFlag(figure: OristudioCpFoldedFigureEntry): FoldedFigureLayerOrderFlag | null {
  const attention = foldedFigureLayerOrderAttention(figure);
  if (attention) {
    return { kind: 'attention', attention, constraints: foldedFigureLayerOrderRecord(figure)?.constraints.length ?? 0 };
  }
  const detached = foldedFigureDetachedLayerOrder(figure);
  return detached ? { kind: 'detached', constraints: detached.constraints.length } : null;
}

/**
 * The record "Layer order…" and Review… open the dialog on: the figure's
 * own, or one detached for review, flagged as detached so that even an
 * untouched Apply takes it up; null with neither.
 */
export function foldedFigureLayerOrderDialogRecord(figure: OristudioCpFoldedFigureEntry): LayerOrderRecord | null {
  const own = foldedFigureLayerOrderRecord(figure);
  if (own) return own;
  const detached = foldedFigureDetachedLayerOrder(figure);
  return detached
    ? withLayerOrderAttention(detached, { reason: 'detached', count: detached.constraints.length })
    : null;
}

/**
 * Whether Refold is held on `figure`: only while a newer build's record holds
 * it. A refold of a figure this build's record holds keeps the record (H4,
 * D10, D13); a newer build's order is that build's to fold again, and a
 * refold here would draw Oriedita's search under it, which a reload then
 * detaches. The toolbar, the menu and the store all ask this.
 */
export function refoldHeldByLayerOrder(figure: OristudioCpFoldedFigureEntry): boolean {
  return figure.layerOrder?.kind === 'newer';
}

/** Why, in the words the toolbar shows and a refused call reports. */
export function refoldHeldByLayerOrderReason(t: TFunction): string {
  return t('panels:foldedFigureActions.layerOrderNewer', 'Made with a newer Ori Studio: its layer constraints can’t be changed here.');
}

/**
 * What a refold of a figure with a chosen layer order came to, for the verb
 * to say (`foldedFigureLayerOrderToasts.ts`); the store has already written
 * what it keeps. Never sent for a figure with no record, a Stop, or a figure
 * that moved on while it folded.
 *
 * - `applied`: drawn in the order that fits; `attention` the constraints
 *   left out (ambiguous or gone), null when every one held;
 * - `kept`: not drawn (D10): the figure keeps its picture, and its record is
 *   flagged with `attention` — they clash, the check ran out of time, or the
 *   engine or the kernel refused;
 * - `lost`: the engine was not there (offline, crashed): nothing was checked
 *   and nothing written.
 */
export type FoldedFigureLayerOrderRefold =
  | { readonly kind: 'applied'; readonly attention: LayerOrderAttention | null }
  | {
      readonly kind: 'kept';
      readonly outcome: 'clash' | 'timed_out' | 'refused';
      readonly attention: LayerOrderAttention;
    }
  | { readonly kind: 'lost'; readonly cause: LayerOrderLossCause };
