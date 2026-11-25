/**
 * Adjust order's window (`implementation-plans/fold-adjust-order.md`), as the
 * plain descriptor the one Fold window renderer draws
 * (`components/fold/FoldToolWindow`).
 *
 * The window offers one thing: to open the Layer order dialog on the step on
 * screen. A line says what the tool does, and one button opens the dialog
 * (Enter, as every tool's commit). Its Apply adds the step
 * (`useFoldAdjustOrderTool`); nothing is located on the canvas and nothing is
 * previewed there.
 *
 * - **Unavailable**, the button is disabled and a note says why: at the flat
 *   sheet there are no layers to order; on paper that folds in 3D, "Layer
 *   order works on flat folds", the words every other host says it in; and on
 *   paper the dialog cannot read, a line of its own.
 * - A sequence that cannot change is the rail's read-only reason, as every
 *   tool's is.
 *
 * React-free and store-free.
 */
import type { TFunction } from 'i18next';
import { foldToolDescription, foldToolLabel } from '../tools/foldToolCatalog';
import {
  settingsMeta,
  type FoldToolHost,
  type FoldToolWindowModel,
  type FoldToolWindowVerbs,
  type FoldToolWindowView,
} from '../tools/foldToolWindow';

/**
 * Why the dialog cannot open on the step on screen: the flat sheet, which has
 * no layers; paper that folds in 3D; or paper the dialog's engine cannot read.
 */
export type FoldAdjustOrderUnavailable = 'sheet' | 'not_flat' | 'unreadable';

/** What Adjust order's window is drawn from, beside every tool's view. */
export interface FoldAdjustOrderWindowView {
  /** Why the dialog cannot open now; null while it can, or while that is still being asked. */
  unavailable: FoldAdjustOrderUnavailable | null;
  /** The engine is still reading the step's paper: nothing to open yet. */
  checking: boolean;
  /** The dialog is open, or its Apply is being added. */
  busy: boolean;
  /** The last Apply added no step: the step on screen changed under it, or the engine refused the order. */
  failed: boolean;
}

function unavailableNote(t: TFunction, unavailable: FoldAdjustOrderUnavailable): string {
  switch (unavailable) {
    case 'sheet':
      return t('panels:fold.return.empty', 'Fold a step first.');
    case 'not_flat':
      return t('panels:diagram.layerOrder.needsFlat', 'Layer order works on flat folds');
    case 'unreadable':
      return t('tools:fold.adjustOrder.unreadable', 'The Layer order dialog can’t read this step’s layers.');
  }
}

/** Adjust order's window: what it does, and the one button that opens the Layer order dialog. */
export function adjustOrderToolWindow(
  t: TFunction,
  view: FoldToolWindowView,
  adjust: FoldAdjustOrderWindowView,
  verbs: FoldToolWindowVerbs,
  host: FoldToolHost
): FoldToolWindowModel {
  const readOnly = view.readOnly !== null;
  const notes = [
    ...(adjust.unavailable ? [unavailableNote(t, adjust.unavailable)] : []),
    ...(adjust.failed && !adjust.unavailable
      ? [t('tools:fold.adjustOrder.failed', 'That order could not be added as a step. Open the dialog and try again.')]
      : []),
    ...(host.coarse || adjust.unavailable ? [] : [t('tools:fold.adjustOrder.enter', 'Enter opens the Layer order dialog.')]),
  ];
  return {
    phase: 'preview',
    title: foldToolLabel(t, 'adjust-order'),
    meta: settingsMeta(t, 0),
    instructions: {
      heading: t('tools:fold.window.instructions', 'Instructions'),
      intro: foldToolDescription(t, 'adjust-order'),
      items: [],
      current: 0,
      notes,
    },
    lineMode: null,
    kind: null,
    movingSide: null,
    layers: null,
    refusal: null,
    divide: null,
    footer: {
      commit: {
        label: t('tools:fold.adjustOrder.open', 'Edit layer order…'),
        shortcut: 'fold.commit',
        disabled: readOnly || adjust.unavailable !== null || adjust.checking || adjust.busy,
        run: verbs.commit,
      },
    },
  };
}
