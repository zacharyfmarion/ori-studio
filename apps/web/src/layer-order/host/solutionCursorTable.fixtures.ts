/**
 * Stand-ins for the host engine's solutions cursor (`layerOrderSolutionCursor.ts`),
 * for the tests of what the hosts build on it (`solutionCursorTable.ts` and
 * its bindings, Edit's and the Diagram's): a cursor that answers the steps a
 * test scripts, and a place in the stepper's fixed order.
 *
 * A test mocks the gateway's `openLayerOrderSolutionCursor` and hands it
 * {@link scriptedSolutionCursor}s.
 */
import type { LayerPosition, LayerStepBy } from '../engine/layerOrderEngine';
import type {
  LayerOrderSolutionCursor,
  LayerOrderSolutionPlace,
  LayerOrderSolutionStep,
  LayerOrderSolutionStepOptions,
} from './hostEngineGateway';

/** A cursor that answers `steps` in turn, and `place` from `places` (or null), with a log of what it was asked. */
export interface ScriptedSolutionCursor extends LayerOrderSolutionCursor {
  readonly asked: { direction: 'next' | 'previous'; by: LayerStepBy }[];
  /** Each step's `tries`: how many times the user had asked to keep trying. */
  readonly triesAsked: number[];
  readonly placesAsked: LayerStepBy[];
  closed: boolean;
}

/** One scripted answer: as it is, or made when the step is asked, from its Stop signal. */
export type ScriptedSolutionStep =
  | LayerOrderSolutionStep
  | ((options: LayerOrderSolutionStepOptions) => Promise<LayerOrderSolutionStep>);

export function scriptedSolutionCursor(
  steps: readonly ScriptedSolutionStep[],
  places: readonly (LayerOrderSolutionPlace | null)[] = []
): ScriptedSolutionCursor {
  const queue = [...steps];
  const placeQueue = [...places];
  const cursor: ScriptedSolutionCursor = {
    asked: [],
    triesAsked: [],
    placesAsked: [],
    closed: false,
    async step(direction, by, options = {}) {
      cursor.asked.push({ direction, by });
      cursor.triesAsked.push(options.tries ?? 0);
      const answer = queue.shift();
      if (!answer) throw new Error('the script has no more steps');
      return typeof answer === 'function' ? answer(options) : answer;
    },
    async place(by) {
      cursor.placesAsked.push(by);
      return placeQueue.shift() ?? null;
    },
    alive: () => !cursor.closed,
    close() {
      cursor.closed = true;
    },
  };
  return cursor;
}

/** A position in the stepper's fixed order: `index` of `n`, final when `exact`. */
export function solutionPosition(index: number, n: number, exact = true): LayerPosition {
  return { index, total: { n, exact } };
}
