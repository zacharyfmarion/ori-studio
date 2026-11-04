/**
 * A folded figure's layer spread as Edit holds it, on the figure
 * (`OristudioCpFoldedFigureEntry.spread`). Like the figure's layer order, the
 * project file keeps it in the crease pattern's extensions bag, which every
 * build since v0.2.0 writes back as it came, so an older build carries a
 * spread rather than drop it (`foldedFigureSpreads.ts`,
 * `implementation-plans/spread-and-layer-order-in-edit-export-share.md`).
 *
 * The value is the shared spread setting (`layerSpreadSettings.ts`), the one
 * a Diagram pose and a Fold step hold, so a spread means the same thing in
 * every workspace.
 *
 * Pure.
 */

import type {
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
} from '../../engine/oristudioCpTypes';
import type { LayerSpreadOptions } from './foldedLayerSpread';
import type { FoldedFigureSpreadStatus } from './foldedFigureSpreadStatus';
import { foldedFigureHasLayerOrder } from './foldedFigureState';

export interface SpatialSpread { readonly kind: 'spatial'; readonly version: 1; readonly amount: number }
export type FoldedFigureSpread =
  | SpatialSpread
  | {
      /** A spread this build reads: drawn whenever the figure can spread. */
      readonly kind: 'record';
      readonly spread: LayerSpreadOptions;
    }
  | {
      /**
       * A newer build's: that build's to change and draw. Its saved entry in
       * the bag (`foldedFigureSpreads.ts`), written back as it came.
       */
      readonly kind: 'newer';
      readonly saved: unknown;
    };

/** The spread a figure shows: none when it has none, or only a newer build's. */
export function foldedFigureSpreadOptions(
  figure: Pick<OristudioCpFoldedFigureEntry, 'spread'>
): LayerSpreadOptions | null {
  return figure.spread?.kind === 'record' ? figure.spread.spread : null;
}

/** Whether a look draws a spread: Paper, and X-ray (decision 7); never Wireframe or a legacy style. */
export function foldedFigureSpreadLook(style: OristudioCpFoldedFigureDisplayStyle): boolean {
  return style === 'Paper5' || style === 'Transparent3';
}

/**
 * Why a figure's layers cannot be spread now, worst first, or null when they
 * can — or will, once its solve lands:
 *
 * - `newer`: its spread is a newer build's, to change and draw there;
 * - `recipe`: the saved recipe belongs to a different fold dimensionality;
 * - `no-layer-order`: its fold found no layer order, so it has no layers;
 * - `look`: it is drawn as Wireframe, or a legacy style;
 * - `refold`: it has no fold to spread — reopened from a file without the
 *   scene its spread needs (over the budget, or refolded by an older build),
 *   or its last fold failed — until it is folded again;
 * - `unavailable`: the canvas could not spread its layers
 *   (`foldedFigureSpreadStatus.ts`).
 *
 * A spread set on such a figure is kept, never cleared: switching back to
 * Paper, or folding again, shows it.
 */
export type FoldedFigureSpreadBlock = 'newer' | 'no-layer-order' | 'look' | 'spatial-look' | 'recipe' | 'refold' | 'unavailable';

export function foldedFigureSpreadBlock(
  figure: OristudioCpFoldedFigureEntry,
  status: FoldedFigureSpreadStatus | null
): FoldedFigureSpreadBlock | null {
  if (figure.spread?.kind === 'newer') return 'newer';
  if (figure.folded3d != null) {
    if (figure.folded3d.verdict.verdict !== 'folded') return 'no-layer-order';
    if (figure.displayStyle !== 'Paper5') return 'spatial-look';
    if (figure.spread?.kind === 'record') return 'recipe';
    if (figure.status === 'error' || figure.handle == null) return 'refold';
    return status === 'unavailable' ? 'unavailable' : null;
  }
  if (figure.spread?.kind === 'spatial') return 'recipe';
  if (foldedFigureHasLayerOrder(figure) === false) return 'no-layer-order';
  if (!foldedFigureSpreadLook(figure.displayStyle)) return 'look';
  if (figure.status === 'error' || (figure.handle == null && figure.spreadScene == null)) return 'refold';
  if (status === 'unavailable') return 'unavailable';
  return null;
}

/**
 * Whether a save reads the figure's paper scene from its live fold, to keep
 * with its spread: a figure this build spreads, flat, folded and drawn in a
 * look that spreads.
 */
export function foldedFigureSavesLiveSpreadScene(
  figure: OristudioCpFoldedFigureEntry
): figure is OristudioCpFoldedFigureEntry & { handle: number } {
  return (
    figure.spread?.kind === 'record' &&
    figure.handle != null &&
    figure.status === 'ready' &&
    figure.folded3d == null &&
    foldedFigureHasLayerOrder(figure) === true &&
    foldedFigureSpreadLook(figure.displayStyle)
  );
}

/**
 * The figure folded again: the scene its file carried gives way to the live
 * fold's, which supersedes it, and its spread stays. The very entry when it
 * carries none.
 */
export function withoutSavedSpreadScene<T extends Pick<OristudioCpFoldedFigureEntry, 'spreadScene'>>(figure: T): T {
  if (figure.spreadScene == null) return figure;
  const { spreadScene: _superseded, ...rest } = figure;
  return rest as T;
}
