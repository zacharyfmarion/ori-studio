import { useMemo } from 'react';
import {
  creasePatternSide,
  isLockedStep,
  type DiagramCreasePatternRender,
  type DiagramStep,
} from '../document/diagramDocument';
import { showCreasePatternSide } from './creasePatternSide';

/** The side a crease pattern is seen from, and the way to choose the other. */
export interface CreasePatternSideField {
  side: 'front' | 'back';
  /** Show it from `side`: turned over where it lies, as one undo step; nothing for the side it shows. */
  choose: (side: 'front' | 'back') => void;
}

/**
 * The side of the paper a step shown as its crease pattern is seen from, for
 * the Step pane's Front | Back: a field, beside Show as, never one of Pose's
 * verbs. Null for any other step — one shown folded or simulated, one not
 * linked, a newer build's.
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
