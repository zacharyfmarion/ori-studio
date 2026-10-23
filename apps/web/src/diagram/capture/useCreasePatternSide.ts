import { useMemo } from 'react';
import {
  creasePatternSide,
  isLockedStep,
  posedRenderOf,
  type DiagramCreasePatternRender,
  type DiagramStep,
} from '../document/diagramDocument';
import { flipFoldStepCreases, showFoldStepPaperSide } from '../fold/foldStepActions';
import { flipCreasePatternCreases, showCreasePatternSide } from './creasePatternSide';

/** The side whose colour a crease pattern's paper is drawn in, turned over or not, and the ways to change them. */
export interface CreasePatternSideField {
  side: 'front' | 'back';
  /** Draw its paper in `side`'s colour, as one undo step, nothing else changed; nothing for the side it is on. */
  choose: (side: 'front' | 'back') => void;
  /**
   * Whether Flip creases is on: on the back, its paper turned over side to
   * side, mirrored and its mountains and valleys swapped. Kept on the front,
   * where it draws nothing and the pane does not offer it.
   */
  flipCreases: boolean;
  /** Turn Flip creases on or off, as one undo step; nothing on the front. */
  setFlipCreases: (on: boolean) => void;
}

/**
 * The side of the paper whose colour a step shown as its crease pattern is
 * drawn in, and on the back whether it is turned over, for the Step
 * pane's Front | Back and Flip creases: fields, beside Show as, never Pose's
 * verbs. Null for any other step — one shown folded or simulated, one not
 * linked, a newer build's.
 */
export function useCreasePatternSide(step: DiagramStep | null): CreasePatternSideField | null {
  const posed = step && !isLockedStep(step) ? posedRenderOf(step.source) : null;
  const render: DiagramCreasePatternRender | null = posed?.mode === 'crease-pattern' ? posed : null;
  // A Fold step's crease pattern is captured again from its state; a linked pattern's through its pose controller.
  const fold = step?.source?.kind === 'fold-step';
  const stepId = step?.id ?? null;
  return useMemo(
    () =>
      render && stepId !== null
        ? {
            side: creasePatternSide(render),
            choose: (side: 'front' | 'back') =>
              void (fold ? showFoldStepPaperSide(stepId, side) : showCreasePatternSide(stepId, side)),
            flipCreases: render.flipCreases === true,
            setFlipCreases: (on: boolean) =>
              void (fold ? flipFoldStepCreases(stepId, on) : flipCreasePatternCreases(stepId, on)),
          }
        : null,
    [render, stepId, fold]
  );
}
