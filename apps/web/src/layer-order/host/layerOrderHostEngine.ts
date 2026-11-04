/**
 * The host engine (`implementation-plans/layer-order-dialog.md`, row H2 and
 * approach 5): a saved record restored onto a host's creases with no dialog
 * open, on a short-lived worker of its own. Reached only through
 * `hostEngineGateway.ts`, which loads this module the first time a host asks,
 * so neither it nor the worker it spawns loads with the page.
 *
 * - **A worker per job.** A batch ({@link createLayerOrderResolveBatch}) holds
 *   one runtime of the `host` role (`engine/layerOrderRuntime.ts`) over the
 *   dialog's own worker file and its real Fold-bridge backend. Creating it
 *   spawns nothing; its first restore does, and closing it terminates the
 *   worker. A single resolve is a batch of one; a Refresh All shares one
 *   batch, and so one worker, across its steps. Resolves in a batch run one
 *   after another, since each holds the worker's one session.
 * - **One resolve** restores the record (E5's `restore`, D10). When it runs
 *   out of time and the caller gave later limits, it is asked again on the
 *   same worker: `restoreRecord` on the session already open, or `restore`
 *   when the open itself ran out. When it applied, the worker answers the
 *   full relations of the order it shows (Oriedita's, to seed
 *   `fold_with_order`) and saves the record of that order.
 * - **A Stop terminates.** The wasm has no cancel channel, so aborting a
 *   resolve's signal (a fold run's, `store/workspaceStore/foldRuns.ts`)
 *   terminates its worker, and the resolve answers `cancelled`. The next
 *   resolve in the batch spawns a fresh worker.
 * - **Loss is an answer.** A worker that dies or an engine that traps is
 *   reported once by the runtime (`layer-order:engine`); an engine that did
 *   not start for a defect, or a call failing for one, is reported once here
 *   (`layer-order:host`). The browser failing to load the worker or the Fold
 *   wasm (offline) is reported to no one, by the dialog's rule
 *   (`engine/layerOrderLoadFailure.ts`). Each answers `lost`; nothing rejects.
 *
 * Store-free and host-free (`layerOrderBoundary.test.ts`).
 */
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
import { reportError } from '../../monitoring';
import {
  LAYER_ORDER_LIMITS,
  type LayerOrderLimits,
  type LayerOrderRestoreOutcome,
  type LayerOrderRestored,
} from '../engine/layerOrderEngine';
import { createLayerOrderRuntime, type LayerOrderRuntime } from '../engine/layerOrderRuntime';
import { layerOrderLossOf } from './layerOrderLoss';
import {
  LAYER_ORDER_CANCELLED,
  keptLayerOrder,
  lostLayerOrder,
  withLayerOrderAttention,
  layerOrderAttentionOf,
  type LayerOrderFound,
  type LayerOrderResolution,
} from './layerOrderResolution';

// A host's cursor through the solutions that fit (H6), loaded with the rest of the host engine.
export {
  createLayerOrderSolutionCursor,
  type LayerOrderSolutionCursor,
  type LayerOrderSolutionCursorOptions,
  type LayerOrderSolutionPlace,
  type LayerOrderSolutionStep,
  type LayerOrderSolutionStepOptions,
  type LayerOrderSolutionsUnrestored,
} from './layerOrderSolutionCursor';

/** What one resolve may do beyond its limits. */
export interface LayerOrderResolveOptions {
  /**
   * Later limits to ask again with, in turn, while the restore runs out of
   * time: `[keepTrying(limits)]` for one more try. Each runs on the same
   * worker. None by default: a host flags a timeout and lets the user retry.
   */
  readonly retries?: readonly LayerOrderLimits[];
  /** A Stop: aborting it terminates the worker the resolve runs on, and it answers `cancelled`. */
  readonly signal?: AbortSignal;
}

export interface LayerOrderResolveBatchOptions {
  /** A Stop of the whole batch: what is running or waiting answers `cancelled`, and the batch closes. */
  readonly signal?: AbortSignal;
  /** Starts a worker. The default spawns `workers/layerOrderWorker.ts`; tests pass a fake. */
  readonly spawn?: () => Worker;
}

/** One worker for many resolves: a Refresh All's. */
export interface LayerOrderResolveBatch {
  /**
   * Restore `record` (its points in the crease pattern's coordinates) onto
   * `source` within `limits` (`LAYER_ORDER_LIMITS.restore` when left out).
   * Never rejects.
   */
  resolve(
    source: LayerOrderSource,
    record: LayerOrderRecord,
    limits?: LayerOrderLimits,
    options?: LayerOrderResolveOptions
  ): Promise<LayerOrderResolution>;
  /** Terminate the worker. What is running or waiting answers `cancelled`, as does every later resolve. Idempotent. */
  close(): void;
}

/** Thrown between calls once a resolve is stopped, so nothing more is asked of a worker that is gone. */
const STOPPED = Symbol('layer order resolve stopped');

/** A restore's parts, as a host keeps them. */
function foundOf(restored: LayerOrderRestored): LayerOrderFound {
  return { saved_constraints: restored.saved_constraints, carried: restored.carried, opened_on: restored.opened_on };
}

/** Whether a restore ran out of time, and how it can be asked again: on its session, or from the open. */
function timedOut(restored: LayerOrderRestoreOutcome): 'record' | 'open' | null {
  if (restored.status === 'refused') return restored.refusal.code === 'session_timed_out' ? 'open' : null;
  return restored.outcome.kind === 'timed_out' ? 'record' : null;
}

/** One resolve on `runtime`'s worker; `halted` says whether it was stopped since its last call. */
async function resolveOn(
  runtime: LayerOrderRuntime,
  source: LayerOrderSource,
  record: LayerOrderRecord,
  limits: LayerOrderLimits,
  retries: readonly LayerOrderLimits[],
  halted: () => boolean
): Promise<LayerOrderResolution> {
  const { engine } = runtime;
  // Nothing is asked after a Stop: the next call would spawn a fresh worker for nothing.
  const ask = <T>(call: () => Promise<T>): Promise<T> => (halted() ? Promise.reject(STOPPED) : call());

  let restored = await ask(() => engine.restore(source, record, limits));
  for (const later of retries) {
    const again = timedOut(restored);
    if (!again) break;
    restored = await ask(() =>
      again === 'record' ? engine.restoreRecord(record, later) : engine.restore(source, record, later)
    );
  }

  if (restored.status === 'refused') {
    const { refusal } = restored;
    if (refusal.code === 'session_timed_out') {
      return {
        outcome: 'timed_out',
        limit: refusal.limit,
        nodes: refusal.nodes,
        found: null,
        ...keptLayerOrder({ outcome: 'timed_out' }, record),
      };
    }
    return { outcome: 'refused', refusal, ...keptLayerOrder({ outcome: 'refused' }, record) };
  }

  const found = foundOf(restored);
  const { outcome } = restored;
  switch (outcome.kind) {
    case 'clash':
      return { outcome: 'clash', clashing: outcome.constraints, found, ...keptLayerOrder({ outcome: 'clash', found }, record) };
    case 'timed_out':
      return {
        outcome: 'timed_out',
        limit: outcome.limit,
        nodes: outcome.nodes,
        found,
        ...keptLayerOrder({ outcome: 'timed_out' }, record),
      };
    case 'applied': {
      const relations = await ask(() => engine.relations());
      const saved = await ask(() => engine.save());
      // A record of the order now shown that can't be saved (past the budget) can't be kept: nothing is committed.
      if (saved.status !== 'ok') {
        return { outcome: 'refused', refusal: saved.refusal, ...keptLayerOrder({ outcome: 'refused' }, record) };
      }
      const attention = layerOrderAttentionOf({ outcome: 'applied', found }, record);
      const kept = withLayerOrderAttention(saved.record, attention);
      return { outcome: 'applied', applied: { record: kept, relations, source }, found, record: kept, attention };
    }
  }
}

/** A batch: one `host` runtime, and so at most one worker at a time, for many resolves (see the module docs). */
export function createLayerOrderResolveBatch(options: LayerOrderResolveBatchOptions = {}): LayerOrderResolveBatch {
  const runtime = createLayerOrderRuntime({ role: 'host', ...(options.spawn ? { spawn: options.spawn } : {}) });
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();

  const close = () => {
    if (closed) return;
    closed = true;
    options.signal?.removeEventListener('abort', close);
    runtime.dispose();
  };
  if (options.signal?.aborted) close();
  else options.signal?.addEventListener('abort', close, { once: true });

  const run = async (
    source: LayerOrderSource,
    record: LayerOrderRecord,
    limits: LayerOrderLimits,
    { retries = [], signal }: LayerOrderResolveOptions
  ): Promise<LayerOrderResolution> => {
    if (closed || signal?.aborted) return LAYER_ORDER_CANCELLED;
    let stopped = false;
    const stop = () => {
      stopped = true;
      runtime.cancel();
    };
    signal?.addEventListener('abort', stop, { once: true });
    try {
      const answer = await resolveOn(runtime, source, record, limits, retries, () => stopped || closed);
      return stopped || closed ? LAYER_ORDER_CANCELLED : answer;
    } catch (error) {
      if (stopped || closed || error === STOPPED) return LAYER_ORDER_CANCELLED;
      const { cause, report } = layerOrderLossOf(error);
      if (report) reportError(error, { surface: 'layer-order:host', tags: { cause } });
      return lostLayerOrder(cause, record);
    } finally {
      signal?.removeEventListener('abort', stop);
    }
  };

  return {
    resolve: (source, record, limits = LAYER_ORDER_LIMITS.restore, more = {}) => {
      const turn = queue.then(() => run(source, record, limits, more));
      queue = turn;
      return turn;
    },
    close,
  };
}
