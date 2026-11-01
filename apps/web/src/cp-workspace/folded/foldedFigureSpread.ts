/**
 * A flat folded figure's layer spread as Edit holds it, on the figure
 * (`OristudioCpFoldedFigureEntry.spread`). Like the figure's layer order, the
 * project file keeps it in the crease pattern's extensions bag, which every
 * build since v0.2.0 writes back as it came, so an older build carries a
 * spread rather than drop it
 * (`implementation-plans/spread-and-layer-order-in-edit-export-share.md`).
 *
 * The value is the shared spread setting (`layerSpreadSettings.ts`), the one
 * a Diagram pose and a Fold step hold, so a spread means the same thing in
 * every workspace.
 *
 * Pure.
 */

import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import type { LayerSpreadOptions } from './foldedLayerSpread';

export type FoldedFigureSpread =
  | {
      /** A spread this build reads: drawn whenever the figure can spread. */
      readonly kind: 'record';
      readonly spread: LayerSpreadOptions;
    }
  | {
      /**
       * A newer build's: that build's to change and draw. Its saved value,
       * written back as it came.
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
