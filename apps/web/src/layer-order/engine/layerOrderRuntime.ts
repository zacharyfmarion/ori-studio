/**
 * One Layer order engine worker's lifetime: spawned on demand, stamped with a
 * generation, terminated to stop it, and for the dialog, the solution count
 * run between its calls (`implementation-plans/layer-order-dialog.md`,
 * approach 5).
 *
 * Each role gets a runtime of its own (the dialog's session, a host's
 * engine), and each runtime at most one worker
 * (`workers/layerOrderWorker.ts`). Nothing is shared with the Fold
 * workspace's worker, so stopping one costs Fold nothing.
 *
 * - **Spawned on demand.** Creating a runtime spawns nothing; the first call
 *   does. The Fold engine never loads with the page (approach 5), and this
 *   keeps it so.
 * - **Stopping is terminating.** The wasm has no cancel channel and a call
 *   cannot be interrupted, so the dialog's Cancel and a host's Stop are
 *   {@link LayerOrderRuntime.cancel}, and closing the dialog is
 *   {@link LayerOrderRuntime.dispose}. Every call in flight rejects first,
 *   then the worker goes (`engine/cpExactSolveSession.ts`: `terminate()`
 *   settles nothing, so a call left to it would never settle). The next call
 *   after a cancel spawns a fresh worker, with no session open.
 * - **A generation.** It moves when a worker goes away, and when its owner
 *   says the questions already asked no longer matter
 *   ({@link LayerOrderRuntime.invalidate}). An answer asked through
 *   {@link LayerOrderRuntime.askCurrent} that comes back under a later
 *   generation is dropped as `stale`.
 * - **Engine loss is a typed failure.** A worker that dies (its `error`
 *   event) or an engine that trapped (`layer_order_engine_trapped`) drops the
 *   worker: every call on it rejects as {@link LayerOrderEngineLost} with
 *   `reason: 'crashed'`, and the crash is reported to Sentry once, under
 *   `layer-order:engine`. A worker that never ran (its script or an import
 *   did not load: offline, say) is dropped the same way as `unloaded`, and
 *   reported to no one: that is the browser failing to load it, not the
 *   engine failing (`layerOrderLoadFailure.ts`).
 * - **Previews are latest-wins** ({@link LayerOrderRuntime.channel},
 *   `lib/latestWinsChannel.ts`): a preview already in the worker can't be
 *   dropped, only superseded when it returns.
 * - **The count runs between calls** once its owner turns it on
 *   ({@link LayerOrderRuntime.setCounting}; never by default). The dialog
 *   follows its model's decision, which may change with every commit
 *   (`layerOrderCountStarts`, D7), and nothing is counted while it is off.
 *   The session's one solutions cursor
 *   lives in the same worker, so the count, the stepper and its "3 of 12"
 *   read one cursor and the wasm is loaded once. After each answer the
 *   runtime asks for one slice ({@link LayerOrderEngine.countSlice}), and
 *   while the worker has nothing else to do it asks for the next, until the
 *   count is done. **At most one slice is ever outstanding,** and the worker
 *   answers in the order it is asked, so a call waits behind one slice at
 *   most, never behind the count; and since every answer earns a slice, a
 *   stream of previews never starves the count. The slice is asked a task
 *   after the answer, so a caller that asks again at once goes first. Each
 *   slice is published ({@link LayerOrderRuntime.count}); an open, a
 *   restore, a commit that committed and a close publish null at once, and
 *   the worker starts counting again (a new `epoch`). A step keeps the
 *   count.
 *
 * Store-free: its owner (the dialog's hook, the host engine) holds it.
 */
import { wrap } from 'comlink';
import type { WasmErrorEnvelope } from '../../engine/types';
import { createLatestWinsChannel, type LatestWinsChannel } from '../../lib/latestWinsChannel';
import { attachWorkerDiagnostics } from '../../lib/workerDiagnostics';
import { reportError } from '../../monitoring';
import { LAYER_ORDER_COUNT_SLICE } from '../layerOrderBudgets';
import { isLayerOrderLoadFailure } from './layerOrderLoadFailure';
import {
  LAYER_ORDER_CALL_FAILURES,
  isLayerOrderEngineTrapped,
  type LayerOrderCountSlice,
  type LayerOrderEngine,
  type LayerOrderLimits,
  type LayerOrderTrapKind,
  type LayerSolutionCount,
} from './layerOrderEngine';

/** What a worker is for; it tags a crash report. */
export type LayerOrderEngineRole = 'dialog' | 'host';

/**
 * The worker, as the runtime asks it: comlink's proxy, typed as the contract
 * the worker exposes. Every call already answers a promise of plain data, so
 * the proxy is the contract; comlink's own `Remote` type would split each
 * union answer into a union of promises, from which a caller's inference
 * keeps only the first.
 */
export type LayerOrderClient = LayerOrderEngine;

/**
 * Why a worker went away: it crashed (a trap or its `error` event), it never
 * ran (`unloaded`: its script or an import did not load), its owner cancelled
 * the work in it, or its owner closed the runtime.
 */
export type LayerOrderLossReason = 'crashed' | 'unloaded' | 'cancelled' | 'closed';

export const LAYER_ORDER_ENGINE_LOST = 'layer_order_engine_lost';

/** What every call in flight on a worker rejects with when the worker goes away. */
export interface LayerOrderEngineLost extends WasmErrorEnvelope {
  readonly code: typeof LAYER_ORDER_ENGINE_LOST;
  readonly reason: LayerOrderLossReason;
  /** Set for `unloaded`: the browser failed to load the worker (`isLayerOrderLoadFailure`). */
  readonly loadFailed?: true;
}

export function isLayerOrderEngineLost(error: unknown): error is LayerOrderEngineLost {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === LAYER_ORDER_ENGINE_LOST;
}

function lost(reason: LayerOrderLossReason): LayerOrderEngineLost {
  const message = {
    crashed: 'The layer order engine stopped while it was running.',
    unloaded: 'The layer order engine did not load.',
    cancelled: 'The layer order engine was stopped while it was running.',
    closed: 'The layer order engine was closed while it was running.',
  }[reason];
  return { code: LAYER_ORDER_ENGINE_LOST, reason, message, ...(reason === 'unloaded' ? { loadFailed: true } : {}) };
}

/** Why a worker crashed: how its engine trapped, or the worker dying (`error`). */
export type LayerOrderCrashCause = LayerOrderTrapKind | 'worker_error';

/** Hears a worker go away: why, and for a crash, what crashed it. */
export type LayerOrderLossListener = (reason: LayerOrderLossReason, cause?: LayerOrderCrashCause) => void;

/** Hears the count move: each slice's count so far, or null when there is nothing counted. */
export type LayerOrderCountListener = (count: LayerSolutionCount | null) => void;

interface CrashReport {
  readonly cause: LayerOrderCrashCause;
  readonly message: string;
  readonly stack?: string;
}

/**
 * A crash as Sentry sees it, as `FoldEngineCrash` is for the Fold workspace's
 * worker: named for this engine, so the two group apart, and carrying the
 * worker's own stack where there is one, so the frames point at the module
 * and not at the runtime that noticed.
 */
export class LayerOrderEngineCrash extends Error {
  readonly reason: LayerOrderCrashCause;

  constructor({ cause, message, stack }: CrashReport) {
    super(`${cause}: ${message}`);
    this.name = 'LayerOrderEngineCrash';
    this.reason = cause;
    if (stack) this.stack = stack;
  }
}

/** An answer asked for the current generation, or word that the generation moved while it ran. */
export type LayerOrderCurrent<T> = { status: 'answered'; value: T } | { status: 'stale' };

export interface LayerOrderRuntime {
  /**
   * The engine, every call guarded: it spawns the worker on the first call.
   * Its opens, restores, commits and close also restart the published count.
   */
  readonly engine: LayerOrderEngine;
  /**
   * Ask the worker, spawning it if none is running. Rejects as {@link LayerOrderEngineLost}
   * if the worker goes away first. A call asked here earns a count slice like any
   * other, but the count is published again only by the slice's own `epoch`.
   */
  ask<T>(run: (client: LayerOrderClient) => Promise<T>): Promise<T>;
  /** {@link ask}, with the answer dropped as `stale` if the generation moved while it ran. */
  askCurrent<T>(run: (client: LayerOrderClient) => Promise<T>): Promise<LayerOrderCurrent<T>>;
  /** A latest-wins stream to the worker, one per preview stream. */
  channel(): LatestWinsChannel<LayerOrderClient>;
  /** Which questions still count; moves when a worker goes away and on {@link invalidate}. */
  generation(): number;
  /** Move the generation: answers asked through {@link askCurrent} before now come back stale. */
  invalidate(): void;
  /**
   * Stop the work now: reject every call in flight as `cancelled`, then
   * terminate the worker. The next call spawns a fresh one, with no session
   * open. Whether a worker was running.
   */
  cancel(): boolean;
  /** Close for good: as {@link cancel}, as `closed`, and every later call rejects as `closed`. Idempotent. */
  dispose(): void;
  /** Whether a worker is running. */
  running(): boolean;
  /** Called when a worker goes away, after the calls on it are rejected. */
  onLost(listener: LayerOrderLossListener): () => void;
  /**
   * Count the session's solutions between calls, or stop. Off when the
   * runtime is made, and only its owner turns it on: the dialog, once an open
   * or a commit leaves few enough open pairs (`layerOrderCountStarts`). On,
   * the count resumes from where the worker's cursor is, a slice at a time;
   * off, no slice is asked again, one already in the worker is not published,
   * and the count reads null. An open, a restore, a commit and a close keep
   * it on or off as it was.
   */
  setCounting(on: boolean): void;
  /** Whether {@link setCounting} has the count on. */
  counting(): boolean;
  /**
   * The solution count of the session open, as far as it has gone (`done`
   * once it is final); null with no session, before its first slice, from a
   * restart until the next, and while counting is off.
   */
  count(): LayerSolutionCount | null;
  /** Called when {@link count} changes. */
  onCount(listener: LayerOrderCountListener): () => void;
}

export interface LayerOrderRuntimeOptions {
  readonly role: LayerOrderEngineRole;
  /** Starts a worker. The default spawns `workers/layerOrderWorker.ts`, named for `role`; tests pass a fake. */
  readonly spawn?: () => Worker;
  /**
   * What one slice of the count may spend, while counting is on
   * ({@link LayerOrderRuntime.setCounting}): `LAYER_ORDER_COUNT_SLICE` when
   * left out. Giving it does not turn the count on.
   */
  readonly count?: LayerOrderLimits;
}

/**
 * The worker for `role`, named for it (`LAYER_ORDER_WORKER_NAMES`), which is
 * how it knows whether a step also counts on (E9). Written out per role: the
 * bundler reads a worker's options only as literals (`engines/engineHost.ts`),
 * and bundles the one file once for both.
 */
function spawnLayerOrderWorker(role: LayerOrderEngineRole): Worker {
  return role === 'dialog'
    ? new Worker(new URL('../../workers/layerOrderWorker.ts', import.meta.url), {
        type: 'module',
        name: 'layer-order-dialog',
      })
    : new Worker(new URL('../../workers/layerOrderWorker.ts', import.meta.url), {
        type: 'module',
        name: 'layer-order-host',
      });
}

interface Live {
  readonly worker: Worker;
  readonly client: LayerOrderClient;
  readonly detach: () => void;
  /** Rejects one call in flight. */
  readonly waiting: Set<(failure: LayerOrderEngineLost) => void>;
}

function sameCount(a: LayerSolutionCount, b: LayerSolutionCount): boolean {
  const same = (x: LayerSolutionCount['front'], y: LayerSolutionCount['front']) => x.n === y.n && x.exact === y.exact;
  return a.done === b.done && same(a.front, b.front) && same(a.back, b.back) && same(a.orders, b.orders);
}

/** A slice that found no session to count: nothing to report. */
const NOTHING_TO_COUNT: ReadonlySet<string> = new Set([LAYER_ORDER_CALL_FAILURES.sessionNotOpen, 'unknown_layer_session']);

export function createLayerOrderRuntime(options: LayerOrderRuntimeOptions): LayerOrderRuntime {
  const spawn = options.spawn ?? (() => spawnLayerOrderWorker(options.role));
  const sliceLimits = options.count ?? LAYER_ORDER_COUNT_SLICE;
  /** A slice's limits while the count is on; null while it is off, which is how every runtime starts. */
  let slice: LayerOrderLimits | null = null;
  let live: Live | null = null;
  let generation = 0;
  let closed = false;
  const listeners = new Set<LayerOrderLossListener>();

  // The count: what is published, and the pump's state.
  const countListeners = new Set<LayerOrderCountListener>();
  let counted: LayerOrderCountSlice | null = null;
  /** The newest cursor a slice of this worker has come from: an older one's slice is never published over it. */
  let epochSeen = 0;
  /** Calls asked and not yet settled, slices aside. */
  let asking = 0;
  /** Whether a slice is in the worker. Never more than one. */
  let slicing = false;
  /** Whether an answer came since the last slice was asked: it earns one. */
  let owed = false;
  /** Whether the last slice left more to count. */
  let more = false;
  /** Whether a slice failed for a defect: no slice is asked again until the count restarts. */
  let broken = false;
  let pumpTimer: ReturnType<typeof setTimeout> | null = null;

  const publish = (next: LayerOrderCountSlice | null) => {
    if (next) {
      if (next.epoch < epochSeen) return;
      epochSeen = next.epoch;
      // A done count read again is no news.
      if (counted && counted.epoch === next.epoch && sameCount(counted.count, next.count)) return;
    } else if (!counted) {
      return;
    }
    counted = next;
    for (const listener of [...countListeners]) listener(next ? next.count : null);
  };

  const start = (): Live => {
    const worker = spawn();
    const started: Live = {
      worker,
      client: wrap<LayerOrderEngine>(worker),
      // Guarded on identity, so a late event from a worker already replaced cannot drop its replacement.
      detach: attachWorkerDiagnostics(worker, 'layer-order', (failure) => {
        // A worker that never ran is the browser failing to load it: dropped, never reported, and
        // said by its owner (the dialog's lost state, a host's toast), not by the app's error toast.
        const unloaded = isLayerOrderLoadFailure(failure);
        if (live === started) {
          if (unloaded) drop('unloaded');
          else drop('crashed', { cause: 'worker_error', message: failure.message });
        }
        return unloaded ? 'handled' : undefined;
      }),
      waiting: new Set(),
    };
    live = started;
    return started;
  };

  /**
   * The one place a worker goes away. Every call in flight is rejected first,
   * and only then is the worker terminated and the generation moved, so a
   * listener that asks again gets a fresh worker in a fresh generation. The
   * session, and with it the count, goes with the worker.
   */
  const drop = (reason: LayerOrderLossReason, crash?: CrashReport): boolean => {
    const gone = live;
    if (!gone) return false;
    live = null;
    const failure = lost(reason);
    for (const reject of [...gone.waiting]) reject(failure);
    gone.waiting.clear();
    gone.detach();
    gone.worker.terminate();
    generation += 1;
    owed = false;
    more = false;
    broken = false;
    publish(null);
    // A fresh worker numbers its cursors from the start again.
    epochSeen = 0;
    if (crash) {
      reportError(new LayerOrderEngineCrash(crash), {
        surface: 'layer-order:engine',
        tags: { reason: crash.cause, role: options.role },
      });
    }
    for (const listener of [...listeners]) listener(reason, crash?.cause);
    return true;
  };

  /** Settle with `pending`, or reject the moment `target` goes away. */
  const guarded = <T>(target: Live, pending: Promise<T>): Promise<T> => {
    let release = () => {};
    const gone = new Promise<never>((_resolve, reject) => {
      target.waiting.add(reject);
      release = () => target.waiting.delete(reject);
    });
    return Promise.race([pending, gone]).finally(release);
  };

  /** Ask `target`; a trapped engine drops its worker, and the call rejects as its loss. */
  const send = <T>(target: Live, run: (client: LayerOrderClient) => Promise<T>): Promise<T> => {
    let pending: Promise<T>;
    try {
      pending = run(target.client);
    } catch (error) {
      pending = Promise.reject(error);
    }
    return guarded(
      target,
      pending.catch((error: unknown) => {
        if (!isLayerOrderEngineTrapped(error)) throw error;
        // Only the first answer from a dead engine drops its worker; a later one is from a corpse.
        if (live === target) drop('crashed', { cause: error.trap, message: error.message, stack: error.stack });
        throw lost('crashed');
      })
    );
  };

  /** Whether a slice is due: one is owed, or the count has more and nothing else is waiting. */
  const sliceDue = () =>
    !!slice && !closed && !broken && !slicing && live !== null && (owed || (more && asking === 0));

  /** Ask for the next slice a task from now, so a caller that asks again at once goes first. */
  const schedule = () => {
    if (pumpTimer !== null || !sliceDue()) return;
    pumpTimer = setTimeout(pump, 0);
  };

  const pump = () => {
    pumpTimer = null;
    const target = live;
    const limits = slice;
    if (!limits || !target || !sliceDue()) return;
    owed = false;
    slicing = true;
    send(target, (client) => client.countSlice(limits))
      .then(
        (answered) => {
          // A worker replaced since is another count: its epochs start again. Counting off since: not news.
          if (live !== target || !slice) return;
          publish(answered);
          more = !answered.count.done;
        },
        (error: unknown) => {
          // A loss has already published its null; no session is nothing to count.
          if (live !== target || !slice || isLayerOrderEngineLost(error)) return;
          more = false;
          publish(null);
          const code = (error as { code?: unknown } | null)?.code;
          if (typeof code === 'string' && NOTHING_TO_COUNT.has(code)) return;
          // A defect: reported once, and the count waits for its next restart rather than failing on every answer.
          broken = true;
          reportError(error, { surface: 'layer-order:count', tags: { role: options.role } });
        }
      )
      .finally(() => {
        slicing = false;
        schedule();
      });
  };

  const ask = <T>(run: (client: LayerOrderClient) => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(lost('closed'));
    const target = live ?? start();
    asking += 1;
    const answered = send(target, run);
    answered
      .then(
        () => {
          owed = true;
        },
        () => {}
      )
      .finally(() => {
        asking -= 1;
        schedule();
      });
    return answered;
  };

  const askCurrent = async <T>(run: (client: LayerOrderClient) => Promise<T>): Promise<LayerOrderCurrent<T>> => {
    const asked = generation;
    const value = await ask(run);
    return generation === asked ? { status: 'answered', value } : { status: 'stale' };
  };

  /** Ask, and publish null once `restarts` says the answer changed what the count counts. */
  const restarting = <T>(run: (client: LayerOrderClient) => Promise<T>, restarts: (answer: T) => boolean) =>
    ask(run).then((answer) => {
      if (restarts(answer)) {
        broken = false;
        publish(null);
      }
      return answer;
    });

  const always = () => true;
  const restored = (answer: { status: string }) => answer.status === 'ok';
  const committed = (answer: { verdict: string }) => answer.verdict === 'committed';
  const shown = (answer: { verdict: string }) => answer.verdict === 'shown';

  const engine: LayerOrderEngine = {
    open: (source, limits) => restarting((client) => client.open(source, limits), always),
    openShowing: (source, relations, limits) =>
      restarting((client) => client.openShowing(source, relations, limits), always),
    restore: (source, record, limits) => restarting((client) => client.restore(source, record, limits), always),
    restoreRecord: (record, limits) => restarting((client) => client.restoreRecord(record, limits), restored),
    openedOn: () => ask((client) => client.openedOn()),
    openPairs: () => ask((client) => client.openPairs()),
    constraints: () => ask((client) => client.constraints()),
    preview: (candidate, limits) => ask((client) => client.preview(candidate, limits)),
    previewList: (constraints, limits) => ask((client) => client.previewList(constraints, limits)),
    commit: (constraints, limits) => restarting((client) => client.commit(constraints, limits), committed),
    commitPreview: (token, constraints, limits) =>
      restarting((client) => client.commitPreview(token, constraints, limits), committed),
    order: () => ask((client) => client.order()),
    // A show to other constraints counts them afresh; to the same ones the worker keeps its cursor, and the
    // next slice goes on from it.
    show: (constraints, order, limits) => restarting((client) => client.show(constraints, order, limits), shown),
    carried: () => ask((client) => client.carried()),
    removeCarried: (index) => ask((client) => client.removeCarried(index)),
    clearCarried: () => ask((client) => client.clearCarried()),
    stacks: (side) => ask((client) => client.stacks(side)),
    scene: (side) => ask((client) => client.scene(side)),
    save: (keepCarried) => ask((client) => client.save(keepCarried)),
    relations: () => ask((client) => client.relations()),
    close: () => restarting((client) => client.close(), always),
    explain: (candidate, limits) => ask((client) => client.explain(candidate, limits)),
    explainList: (constraints, limits) => ask((client) => client.explainList(constraints, limits)),
    countSlice: (limits) =>
      ask((client) => client.countSlice(limits)).then((answered) => {
        publish(answered);
        return answered;
      }),
    position: (by) => ask((client) => client.position(by)),
    step: (by, direction, limits) => ask((client) => client.step(by, direction, limits)),
  };

  return {
    engine,
    ask,
    askCurrent,
    channel: () => createLatestWinsChannel<LayerOrderClient>(ask),
    generation: () => generation,
    invalidate: () => {
      generation += 1;
    },
    cancel: () => drop('cancelled'),
    dispose: () => {
      closed = true;
      if (pumpTimer !== null) clearTimeout(pumpTimer);
      pumpTimer = null;
      drop('closed');
    },
    running: () => live !== null,
    setCounting: (on) => {
      if (on === (slice !== null)) return;
      if (on) {
        slice = sliceLimits;
        broken = false;
        // Start, or go on from where the worker's cursor is: a slice is due now.
        owed = true;
        schedule();
        return;
      }
      slice = null;
      owed = false;
      more = false;
      if (pumpTimer !== null) clearTimeout(pumpTimer);
      pumpTimer = null;
      publish(null);
    },
    counting: () => slice !== null,
    onLost: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    count: () => counted?.count ?? null,
    onCount: (listener) => {
      countListeners.add(listener);
      return () => {
        countListeners.delete(listener);
      };
    },
  };
}
