/**
 * Stand-ins for the host engine's solutions cursor (`layer-order/host/`), for
 * the tests of what Edit builds on it (`foldedSolutionCursor.ts`): the hosts'
 * scripted cursor (`solutionCursorTable.fixtures.ts`), and a way to leave
 * Edit's table holding one at a given place, as a press that landed there or
 * found its end would.
 *
 * A test mocks the gateway's `openLayerOrderSolutionCursor` and hands it
 * {@link scriptedSolutionCursor}s.
 */
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import type { LayerOrderSolutionStep } from '../../layer-order/host/hostEngineGateway';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import { FAKE_LAYER_ORDER_SOURCE } from '../../layer-order/engine/layerOrderEngine.fixtures';
import { solutionPosition } from '../../layer-order/host/solutionCursorTable.fixtures';
import { beginFoldedSolutionStep, dropFoldedSolutionCursor } from './foldedSolutionCursor';

export {
  scriptedSolutionCursor,
  solutionPosition,
  type ScriptedSolutionCursor,
  type ScriptedSolutionStep,
} from '../../layer-order/host/solutionCursorTable.fixtures';

/**
 * A › that moved to `index` of `n`, as a scripted first answer for
 * {@link seatFoldedSolutionCursor}: the figure is then read as landed there,
 * with neither way proved to end.
 */
export function landedAt(
  record: LayerOrderRecord,
  index: number,
  n: number,
  { exact = true, counted = true }: { exact?: boolean; counted?: boolean } = {}
): LayerOrderSolutionStep {
  return {
    outcome: 'moved',
    applied: { record, relations: new Uint32Array(), source: FAKE_LAYER_ORDER_SOURCE },
    position: solutionPosition(index, n, exact),
    counted,
  };
}

/**
 * Leave Edit's table holding the next cursor the mocked gateway opens, for
 * `figure`, at whatever its first scripted step, a ›, says: one that moved
 * ({@link landedAt}) as a press that landed there leaves it, on the figure's
 * own fold and record; an `end` as a press that found › proved to end (E9)
 * leaves it. Any cursor kept before goes first.
 */
export async function seatFoldedSolutionCursor(
  figure: OristudioCpFoldedFigureEntry,
  record: LayerOrderRecord
): Promise<void> {
  dropFoldedSolutionCursor();
  const turn = beginFoldedSolutionStep(figure, null);
  const answer = await turn.step({ direction: 'next', source: async () => FAKE_LAYER_ORDER_SOURCE, record });
  if (answer.outcome === 'moved') {
    if (figure.handle === null || figure.layerOrder?.kind !== 'record') throw new Error('a landing needs a live constrained figure');
    turn.landed(figure.handle, figure.layerOrder.json);
  }
  turn.end([figure], null, figure.id);
}
