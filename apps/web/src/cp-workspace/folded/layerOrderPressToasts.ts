/**
 * What a Layer order press in Edit says when it stops for an expected reason
 * (Layer order… on a figure, H3; Fold with layer order… on a selection, H5):
 * an ordinary message, never an error, since nothing went wrong. The store
 * writes nothing for these and answers the reason; the host says it here, as
 * a 3D figure's hold is said (`openFoldedFigureLayerOrder.ts`). A fault, a
 * kernel failure or an engine that never loaded, stays an error.
 *
 * - `undetermined`: Oriedita's search finds no layer order on these creases,
 *   which a plain Fold draws see-through (D3).
 * - `spatial`: the creases fold in 3D, and layer order is a flat fold's (D2).
 * - `moved`: a crease was edited, or another document opened, since the press
 *   (`foldPress.ts`): nothing was written.
 *
 * Copy only: `t` with literal keys, so the extractor sees every string.
 */
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { foldPressMovedMessage } from './foldPress';

/** A reason a Layer order press stops that is no fault: said as a message. */
export type LayerOrderPressRefusal = 'undetermined' | 'spatial' | 'moved';

/** Whether a press's `reason` is one of those, said here rather than as an error. */
export function isLayerOrderPressRefusal(reason: string): reason is LayerOrderPressRefusal {
  return reason === 'undetermined' || reason === 'spatial' || reason === 'moved';
}

/** Say why a Layer order press stopped, as an ordinary message. */
export function sayLayerOrderPressRefusal(refusal: LayerOrderPressRefusal, t: TFunction): void {
  switch (refusal) {
    case 'undetermined':
      toast.message(t('errors:cp.layerOrderUndeterminedSelection', 'Layer order couldn’t be determined for these creases.'));
      return;
    case 'spatial':
      toast.message(t('panels:creasePattern.selectionToolbar.foldWithLayerOrder3d', 'Layer order works on flat folds'));
      return;
    case 'moved':
      toast.message(foldPressMovedMessage(t));
      return;
  }
}
