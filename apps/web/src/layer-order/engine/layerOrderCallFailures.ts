/**
 * The Layer order engine's own reasons a call rejects: the codes and the trap
 * envelope, apart from the rest of the contract (`layerOrderEngine.ts`, which
 * re-exports them). A leaf, with type imports only, so the dialog's gateway
 * can tell a load failure from an engine's (`layerOrderLoadFailure.ts`)
 * without loading the contract, the wire or anything of the engine with the
 * page.
 */
import type { WasmErrorEnvelope } from '../../engine/types';

/**
 * The worker's own reasons a call rejects, beside the bridge's
 * `LayerCallErrorCode`s and the runtime's loss. Each is a `{ code, message }`
 * envelope; none is the user's doing.
 */
export const LAYER_ORDER_CALL_FAILURES = {
  /** A call that needs a session, before one is open or after close. */
  sessionNotOpen: 'layer_order_session_not_open',
  /** The worker has no engine to ask: the Fold wasm would not load or start. */
  unavailable: 'layer_order_engine_unavailable',
  /** The engine failed halfway through a call and answers nothing more; the runtime replaces its worker. */
  trapped: 'layer_order_engine_trapped',
} as const;

/** How a call killed the engine, as `fold/engine/foldEngineTrap.ts` classifies the Fold bridge's failures. */
export type LayerOrderTrapKind = 'wasm_trap' | 'engine_poisoned' | 'unexpected_error';

/** What the worker throws for a trap, and for every call after it. */
export interface LayerOrderEngineTrapped extends WasmErrorEnvelope {
  readonly code: typeof LAYER_ORDER_CALL_FAILURES.trapped;
  readonly trap: LayerOrderTrapKind;
  /** The failure's own stack, from the worker: frames of our code and the module, nothing of the user's. */
  readonly stack?: string;
}

export function isLayerOrderEngineTrapped(error: unknown): error is LayerOrderEngineTrapped {
  return (
    !!error && typeof error === 'object' && (error as { code?: unknown }).code === LAYER_ORDER_CALL_FAILURES.trapped
  );
}
