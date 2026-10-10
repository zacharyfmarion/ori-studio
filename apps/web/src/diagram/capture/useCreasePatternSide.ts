import { useMemo } from 'react';
import {
  creasePatternSide,
  isLockedStep,
  type DiagramCreasePatternRender,
  type DiagramStep,
} from '../document/diagramDocument';
import { showCreasePatternSide } from './creasePatternSide';

/** The side whose colour a crease pattern's paper is drawn in, and the way to choose the other. */
export interface CreasePatternSideField {
  side: 'front' | 'back';
  /** Draw its paper in `side`'s colour, as one undo step, nothing else changed; nothing for the side it is on. */
  choose: (side: 'front' | 'back') => void;
}

/**
 * The side of the paper whose colour a step shown as its crease pattern is
 * drawn in, for the Step pane's Front | Back: a field, beside Show as, never
 * one of Pose's verbs. Null for any other step — one shown folded or
 * simulated, one not linked, a newer build's.
 */
export function useCreasePatternSide(step: DiagramStep | null): CreasePatternSideField | null {
  const render: DiagramCreasePatternRender | null =
    step && !isLockedStep(step) && step.source?.kind === 'cp' && step.source.render.mode === 'crease-pattern'
      ? step.source.render
      : null;
  const stepId = step?.id ?? null;
  return useMemo(
    () =>
      render && stepId !== null
        ? {
            side: creasePatternSide(render),
            choose: (side: 'front' | 'back') => void showCreasePatternSide(stepId, side),
          }
        : null,
    [render, stepId]
  );
}
