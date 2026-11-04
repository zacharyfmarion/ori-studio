/**
 * Why a host engine call that is not a Stop left it with no answer, and
 * whether the host engine reports it: the dialog's rule
 * (`engine/layerOrderLoadFailure.ts`), shared by a resolve
 * (`layerOrderHostEngine.ts`) and a solutions cursor
 * (`layerOrderSolutionCursor.ts`).
 *
 * The browser failing to load the worker or the Fold wasm (offline) is `load`
 * and reported to no one; a crash the runtime has reported; an engine that did
 * not start for another reason (`unavailable`), or any other failure, is
 * reported by the caller.
 */
import { LAYER_ORDER_CALL_FAILURES } from '../engine/layerOrderCallFailures';
import { isLayerOrderLoadFailure } from '../engine/layerOrderLoadFailure';
import { isLayerOrderEngineLost } from '../engine/layerOrderRuntime';
import type { LayerOrderLossCause } from './layerOrderResolution';

export function layerOrderLossOf(error: unknown): { cause: LayerOrderLossCause; report: boolean } {
  if (isLayerOrderLoadFailure(error)) return { cause: 'load', report: false };
  if (isLayerOrderEngineLost(error)) return { cause: 'crashed', report: false };
  const code = (error as { code?: unknown } | null)?.code;
  return { cause: code === LAYER_ORDER_CALL_FAILURES.unavailable ? 'unavailable' : 'failed', report: true };
}
