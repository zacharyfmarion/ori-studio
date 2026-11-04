import { useCallback } from 'react';
import type { FaceLetters } from '../../layer-order/engine/faceIndex';
import { statusView } from '../../layer-order/model/layerOrderSelectors';
import type { LayerOrderAction, LayerOrderDialogState } from '../../layer-order/model/layerOrderState';
import { LayerOrderBuilder } from './LayerOrderBuilder';
import { LayerOrderConstraintList } from './LayerOrderConstraintList';
import type { LayerHintContext, LayerOrderCopy } from './layerOrderInspectorCopy';
import { LayerOrderStatus } from './LayerOrderStatus';

export interface LayerOrderInspectorProps {
  readonly state: LayerOrderDialogState;
  readonly dispatch: (action: LayerOrderAction) => void;
  readonly copy: LayerOrderCopy;
  readonly letters: FaceLetters | null;
  readonly hint: LayerHintContext;
}

/**
 * The Layer order dialog's inspector column (A3, `Round3`; its states in
 * `Round4-States`, the phone in `Round4-Phone`, compound constraints in
 * `Round5-Compound`): the solutions and their stepper, "Add a constraint",
 * then the constraints. It draws the model's state (`layerOrderSelectors.ts`)
 * and sends its actions; the frame places it. The status and the list are
 * memoised past a pane hover; the builder is not, since its hint names the
 * face pointed at.
 */
export function LayerOrderInspector({ state, dispatch, copy, letters, hint }: LayerOrderInspectorProps) {
  const status = statusView(state);
  const onStep = useCallback((direction: 'previous' | 'next') => dispatch({ type: 'step', direction }), [dispatch]);
  return (
    <>
      {status && (
        <LayerOrderStatus
          status={status}
          copy={copy}
          counting={state.solutions.runs}
          countDone={state.solutions.count?.done === true}
          side={state.view.side}
          onStep={onStep}
        />
      )}
      <LayerOrderBuilder state={state} dispatch={dispatch} copy={copy} letters={letters} hint={hint} />
      <LayerOrderConstraintList state={state} dispatch={dispatch} copy={copy} />
    </>
  );
}
