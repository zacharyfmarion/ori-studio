import type { TFunction } from 'i18next';
import type { ControlVerb } from '../../lib/controlVerb';
import { FOLD_WITH_LAYER_ORDER_SHORTCUT_ID, type ShortcutActionId } from '../../keyboard/shortcuts';
import type { FoldRoute } from './foldRoute';

/**
 * The selection toolbar's fold verbs, as plain descriptors: Fold, and beside
 * it "Fold with layer order…" (`implementation-plans/layer-order-dialog.md`,
 * row H5, the approved Round 4 board). Only the selection toolbar offers the
 * second, never the viewport bar; Shift+G is the other way in
 * (`cp.action.fold-with-layer-order`), as G is Fold's.
 *
 * React-free and store-free: the toolbar binds `fold` and `foldWithLayerOrder`
 * and draws each verb by its `id`.
 */
export type SelectionFoldActionId = 'fold' | 'fold-with-layer-order';

export interface SelectionFoldCommand extends ControlVerb {
  id: SelectionFoldActionId;
  /** The key that runs the same verb on the selection, for the tooltip to name as it is bound. */
  shortcutId: ShortcutActionId;
}

export interface SelectionFoldActionDeps {
  t: TFunction;
  /** How the selection's creases fold (`resolveFoldRoute`). */
  route: FoldRoute['kind'];
  fold: () => void;
  foldWithLayerOrder: () => void;
}

export function selectionFoldActions(deps: SelectionFoldActionDeps): SelectionFoldCommand[] {
  const { t, route } = deps;
  // A layer order is a flat fold's (D2): creases that fold in 3D can't have one chosen yet.
  const spatial = route === 'spatial';
  return [
    {
      id: 'fold',
      label: t('panels:creasePattern.selectionToolbar.fold', 'Fold'),
      disabled: false,
      // The fold chord lands on Fold estimate, as the viewport bar's Fold reads it.
      shortcutId: 'cp.action.folding-estimate',
      run: deps.fold,
    },
    {
      id: 'fold-with-layer-order',
      label: foldWithLayerOrderLabel(t),
      disabled: spatial,
      shortcutId: FOLD_WITH_LAYER_ORDER_SHORTCUT_ID,
      // A crease selection's words (the board's): "…flat figures" is a figure's.
      ...(spatial
        ? { hint: t('panels:creasePattern.selectionToolbar.foldWithLayerOrder3d', 'Layer order works on flat folds') }
        : {}),
      run: deps.foldWithLayerOrder,
    },
  ];
}

/** The verb's name, on the toolbar's button and in Settings ▸ Shortcuts alike. */
export function foldWithLayerOrderLabel(t: TFunction): string {
  return t('panels:creasePattern.selectionToolbar.foldWithLayerOrder', 'Fold with layer order…');
}
