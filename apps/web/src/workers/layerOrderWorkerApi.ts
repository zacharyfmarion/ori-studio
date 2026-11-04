/**
 * What `layerOrderWorker.ts` exposes: the Layer order engine's contract
 * (`layer-order/engine/layerOrderEngine.ts`) over a backend that holds the
 * session, kept apart from the worker so tests run it over a fake backend, or
 * over the real one in Node, through comlink.
 *
 * The backend is the only part that knows the bridge: the worker's is
 * `layerOrderBridgeBackend.ts`, over the Fold bridge's `layer_*` bindings
 * (E7). This directory is the only one that may import the Fold wasm glue.
 *
 * What this adds to any backend, in the shape of `foldSequenceWorker.ts`:
 *
 * - **A lazy start.** The backend is loaded on the first call. A start that
 *   failed (a `.wasm` that did not arrive, a compile that ran out of memory)
 *   is forgotten, so the next call starts it again.
 * - **Envelopes.** Every rejection is a `{ code, message }` envelope.
 * - **A trap ends the engine.** A failure that is not an envelope left the
 *   call halfway (`fold/engine/foldEngineTrap.ts` says why, for this same
 *   bridge), so this call and every one after it answer
 *   `layer_order_engine_trapped`, without touching the backend again; the
 *   runtime replaces the worker on the first such answer.
 */
import type { WasmErrorEnvelope } from '../engine/types';
import { foldEngineTrapOf } from '../fold/engine/foldEngineTrap';
import {
  LAYER_ORDER_CALL_FAILURES,
  isLayerOrderEngineTrapped,
  type LayerOrderEngine,
  type LayerOrderEngineTrapped,
} from '../layer-order/engine/layerOrderEngine';

/** A call as a backend may answer it: at once, as the bridge's calls do, or later. */
type Answering<Calls> = {
  [K in keyof Calls]: Calls[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => R | Promise<R> : never;
};

/** What hosts the session: every call of the contract. Its rejections are envelopes; a refusal is a value it returns. */
export type LayerOrderBackend = Answering<LayerOrderEngine>;

/** Loads the backend, once per worker. */
export type LayerOrderBackendLoader = () => LayerOrderBackend | Promise<LayerOrderBackend>;

function isEnvelope(error: unknown): error is WasmErrorEnvelope {
  return (
    !!error &&
    typeof error === 'object' &&
    typeof (error as { code?: unknown }).code === 'string' &&
    'message' in error
  );
}

function startFailure(error: unknown): WasmErrorEnvelope {
  if (isEnvelope(error)) return error;
  return {
    code: LAYER_ORDER_CALL_FAILURES.unavailable,
    message: error instanceof Error ? error.message : String(error),
  };
}

function trappedOf(error: unknown): LayerOrderEngineTrapped | null {
  if (isLayerOrderEngineTrapped(error)) return error;
  const trap = foldEngineTrapOf(error);
  if (!trap) return null;
  return {
    code: LAYER_ORDER_CALL_FAILURES.trapped,
    trap: trap.trap,
    message: trap.message,
    ...(trap.stack ? { stack: trap.stack } : {}),
  };
}

/** The contract over `load`'s backend (see the module docs). */
export function createLayerOrderWorkerApi(load: LayerOrderBackendLoader): LayerOrderEngine {
  let ready: Promise<LayerOrderBackend> | null = null;
  let trapped: LayerOrderEngineTrapped | null = null;

  const ensureReady = (): Promise<LayerOrderBackend> => {
    if (ready) return ready;
    const starting = Promise.resolve().then(load);
    ready = starting;
    starting.catch(() => {
      if (ready === starting) ready = null;
    });
    return starting;
  };

  const call = async <T>(answer: (backend: LayerOrderBackend) => T | Promise<T>): Promise<T> => {
    if (trapped) throw trapped;
    let backend: LayerOrderBackend;
    try {
      backend = await ensureReady();
    } catch (error) {
      // A start that failed: nothing ran, and the next call starts again.
      throw startFailure(error);
    }
    if (trapped) throw trapped;
    try {
      return await answer(backend);
    } catch (error) {
      const trap = trappedOf(error);
      if (!trap) throw error;
      trapped = trap;
      console.error('[ori-studio] the layer order engine failed mid-call; this worker answers nothing more', error);
      throw trap;
    }
  };

  return {
    open: (source, limits) => call((backend) => backend.open(source, limits)),
    openShowing: (source, relations, limits) => call((backend) => backend.openShowing(source, relations, limits)),
    restore: (source, record, limits) => call((backend) => backend.restore(source, record, limits)),
    restoreRecord: (record, limits) => call((backend) => backend.restoreRecord(record, limits)),
    openedOn: () => call((backend) => backend.openedOn()),
    openPairs: () => call((backend) => backend.openPairs()),
    constraints: () => call((backend) => backend.constraints()),
    preview: (candidate, limits) => call((backend) => backend.preview(candidate, limits)),
    previewList: (constraints, limits) => call((backend) => backend.previewList(constraints, limits)),
    commit: (constraints, limits) => call((backend) => backend.commit(constraints, limits)),
    order: () => call((backend) => backend.order()),
    show: (constraints, order, limits) => call((backend) => backend.show(constraints, order, limits)),
    commitPreview: (token, constraints, limits) => call((backend) => backend.commitPreview(token, constraints, limits)),
    carried: () => call((backend) => backend.carried()),
    removeCarried: (index) => call((backend) => backend.removeCarried(index)),
    clearCarried: () => call((backend) => backend.clearCarried()),
    stacks: (side) => call((backend) => backend.stacks(side)),
    scene: (side) => call((backend) => backend.scene(side)),
    save: (keepCarried) => call((backend) => backend.save(keepCarried)),
    relations: () => call((backend) => backend.relations()),
    close: () => call((backend) => backend.close()),
    explain: (candidate, limits) => call((backend) => backend.explain(candidate, limits)),
    explainList: (constraints, limits) => call((backend) => backend.explainList(constraints, limits)),
    countSlice: (limits) => call((backend) => backend.countSlice(limits)),
    position: (by) => call((backend) => backend.position(by)),
    step: (by, direction, limits) => call((backend) => backend.step(by, direction, limits)),
  };
}
