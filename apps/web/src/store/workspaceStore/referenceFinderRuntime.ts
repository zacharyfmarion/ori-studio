/**
 * The ReferenceFinder workers' clients, and their lifetimes.
 *
 * The shape is `cpDetectRuntime.ts` — a memoized comlink client whose worker is
 * dropped and announced when it dies, so a call in flight becomes a rejection
 * instead of a spinner — with three differences forced by the core:
 *
 * - **A worker holds exactly one database.** `readDbSettings()` runs once at
 *   startup, so a different sheet size or rank is a different worker. Clients
 *   are therefore keyed by `(instance, databaseKey)`; each instance keeps at
 *   most {@link REFERENCE_FINDER_DATABASES_PER_INSTANCE} of them (a rank-6
 *   database is ~200 MB), evicting the least recently used idle one, and tears a
 *   client down after {@link REFERENCE_FINDER_IDLE_TEARDOWN_MS} without a call.
 * - **Two instances never share a worker.** `'window'` answers the References
 *   workspace's per-target questions at whatever settings the user chose;
 *   `'planner'` serves the precrease planner's cache, whose answers must never
 *   change under it because a popover setting moved.
 * - **A query cannot be cancelled, only killed.** The core is synchronous C++
 *   between inputs and polls `checkCancel` only during statistics runs, so a
 *   query that has not answered in {@link REFERENCE_FINDER_QUERY_TIMEOUT_MS}
 *   is handled the way `engine/cpExactSolveSession.ts` handles Stop: settle
 *   every in-flight promise first (a `terminate()` rejects nothing, it orphans),
 *   then terminate, then drop the client so the next call spawns a fresh worker
 *   and rebuilds. The timeout is measured from dispatch, not from enqueue — the
 *   worker is a strict one-command FIFO, and a batch of a hundred 100 ms line
 *   queries must not time out its hundredth.
 */
import { wrap, type Remote } from 'comlink';
import type { WasmErrorEnvelope } from '../../engine/types';
import type {
  ReferenceFinderDatabaseInfo,
  ReferenceFinderWorkerApi,
} from '../../workers/referenceFinderWorker';
import { attachWorkerDiagnostics, type WorkerFailure } from '../../lib/workerDiagnostics';
import {
  DEFAULT_DATABASE_SETTINGS,
  databaseKey,
  type ReferenceFinderDatabaseSettings,
  type ReferenceFinderQuerySettings,
} from '../../cp-workspace/references/referenceFinder/protocol';
import type { RawSolution } from '../../cp-workspace/references/referenceFinder/solution';

export type ReferenceFinderInstance = 'window' | 'planner';

/** Covers a lazy 2–6 s build on the first query plus the query itself. */
export const REFERENCE_FINDER_QUERY_TIMEOUT_MS = 10_000;
export const REFERENCE_FINDER_IDLE_TEARDOWN_MS = 60_000;
export const REFERENCE_FINDER_DATABASES_PER_INSTANCE = 2;

export type { ReferenceFinderDatabaseInfo };

/**
 * A worker-backed database, guarded: every call is serialised, times out, and
 * rejects when the worker behind it goes away. Returns the core's raw solution
 * JSON; `cp-workspace/references/referenceFinder/client.ts` extracts and caches.
 */
export interface ReferenceFinderWorkerClient {
  readonly instance: ReferenceFinderInstance;
  readonly key: string;
  readonly settings: ReferenceFinderDatabaseSettings;
  /** Build the database now rather than on the first query. */
  ready(): Promise<ReferenceFinderDatabaseInfo>;
  solvePoint(x: number, y: number, query: ReferenceFinderQuerySettings): Promise<RawSolution[]>;
  solveLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    query: ReferenceFinderQuerySettings
  ): Promise<RawSolution[]>;
}

export type ReferenceFinderLossReason = 'crashed' | 'timeout' | 'released' | 'evicted' | 'idle';

export interface ReferenceFinderClientLoss {
  instance: ReferenceFinderInstance;
  key: string;
  reason: ReferenceFinderLossReason;
  /** Present when the worker itself failed (`error` / `messageerror`). */
  failure?: WorkerFailure;
}

type LossListener = (loss: ReferenceFinderClientLoss) => void;

interface LiveClient {
  instance: ReferenceFinderInstance;
  key: string;
  settings: ReferenceFinderDatabaseSettings;
  worker: Worker;
  remote: Remote<ReferenceFinderWorkerApi>;
  detachDiagnostics: () => void;
  client: ReferenceFinderWorkerClient;
  /** Rejecters of the calls the worker is currently answering. */
  inFlight: Set<(error: WasmErrorEnvelope) => void>;
  /** Calls accepted and not yet settled, dispatched or queued. */
  pending: number;
  queue: Promise<unknown>;
  ready: Promise<ReferenceFinderDatabaseInfo> | null;
  lastUsed: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  dead: boolean;
}

const registry = new Map<ReferenceFinderInstance, Map<string, LiveClient>>();
const lossListeners = new Set<LossListener>();

function clientsOf(instance: ReferenceFinderInstance): Map<string, LiveClient> {
  let clients = registry.get(instance);
  if (!clients) {
    clients = new Map();
    registry.set(instance, clients);
  }
  return clients;
}

/**
 * Observe a ReferenceFinder client going away — crashed, timed out, evicted,
 * idle, or released. Listeners must not throw; one that does is isolated.
 */
export function onReferenceFinderClientLost(listener: LossListener): () => void {
  lossListeners.add(listener);
  return () => {
    lossListeners.delete(listener);
  };
}

function announceLoss(loss: ReferenceFinderClientLoss): void {
  for (const listener of [...lossListeners]) {
    try {
      listener(loss);
    } catch (error) {
      console.error('[ori-studio] reference-finder loss listener failed', error);
    }
  }
}

export function referenceFinderError(error: unknown): WasmErrorEnvelope {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return error as WasmErrorEnvelope;
  }
  return {
    code: 'reference_finder',
    message: error instanceof Error ? error.message : String(error),
  };
}

function lostError(loss: ReferenceFinderClientLoss): WasmErrorEnvelope {
  if (loss.reason === 'timeout') {
    return {
      code: 'reference_finder_timeout',
      message: `The reference finder did not answer within ${REFERENCE_FINDER_QUERY_TIMEOUT_MS / 1000} s and was restarted.`,
    };
  }
  return {
    code: 'reference_finder_client_lost',
    message:
      loss.failure?.message ??
      (loss.reason === 'crashed'
        ? 'The reference finder stopped while it was running.'
        : 'The reference finder was released while it was running.'),
  };
}

/**
 * Settle with `pending`, or reject as soon as any client of `instance` goes away.
 *
 * The runtime already rejects the calls it dispatched itself; this is for a
 * caller holding a longer promise over several of them (a batch), which
 * otherwise has no way to hear that its transport is gone.
 */
export function whileReferenceFinderClientAlive<T>(
  instance: ReferenceFinderInstance,
  pending: Promise<T>
): Promise<T> {
  let unsubscribe: (() => void) | null = null;
  const lost = new Promise<never>((_resolve, reject) => {
    unsubscribe = onReferenceFinderClientLost((loss) => {
      if (loss.instance === instance) reject(lostError(loss));
    });
  });
  return Promise.race([pending, lost]).finally(() => unsubscribe?.());
}

/**
 * The one place a client goes away. Order matters: reject what is in flight
 * (so a `terminate()` orphans nothing), then terminate, then announce.
 */
function loseClient(live: LiveClient, reason: ReferenceFinderLossReason, failure?: WorkerFailure): void {
  if (live.dead) return;
  live.dead = true;
  clientsOf(live.instance).delete(live.key);
  if (live.idleTimer) {
    clearTimeout(live.idleTimer);
    live.idleTimer = null;
  }
  const loss: ReferenceFinderClientLoss = failure
    ? { instance: live.instance, key: live.key, reason, failure }
    : { instance: live.instance, key: live.key, reason };
  const error = lostError(loss);
  for (const reject of [...live.inFlight]) reject(error);
  live.inFlight.clear();
  live.detachDiagnostics();
  live.worker.terminate();
  announceLoss(loss);
}

function touch(live: LiveClient): void {
  live.lastUsed = Date.now();
  if (live.idleTimer) {
    clearTimeout(live.idleTimer);
    live.idleTimer = null;
  }
}

function scheduleIdleTeardown(live: LiveClient): void {
  if (live.dead || live.pending > 0) return;
  if (live.idleTimer) clearTimeout(live.idleTimer);
  live.idleTimer = setTimeout(() => {
    live.idleTimer = null;
    if (live.pending === 0) loseClient(live, 'idle');
  }, REFERENCE_FINDER_IDLE_TEARDOWN_MS);
}

/** Run `fn` against the worker with a timeout that starts now, tracking it for loss. */
function dispatch<T>(live: LiveClient, fn: (remote: Remote<ReferenceFinderWorkerApi>) => Promise<T>): Promise<T> {
  if (live.dead) {
    return Promise.reject(
      lostError({ instance: live.instance, key: live.key, reason: 'released' })
    );
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      loseClient(live, 'timeout');
    }, REFERENCE_FINDER_QUERY_TIMEOUT_MS);
    const settle = () => {
      settled = true;
      clearTimeout(timer);
      live.inFlight.delete(rejectInFlight);
    };
    const rejectInFlight = (error: WasmErrorEnvelope) => {
      if (settled) return;
      settle();
      reject(error);
    };
    live.inFlight.add(rejectInFlight);
    fn(live.remote).then(
      (value) => {
        if (settled) return;
        settle();
        resolve(value);
      },
      (error: unknown) => rejectInFlight(referenceFinderError(error))
    );
  });
}

/** Serialise `fn` behind every earlier call on this client; the timeout starts at dispatch. */
function call<T>(live: LiveClient, fn: (remote: Remote<ReferenceFinderWorkerApi>) => Promise<T>): Promise<T> {
  touch(live);
  live.pending += 1;
  const run = live.queue.then(() => dispatch(live, fn));
  live.queue = run.then(
    () => undefined,
    () => undefined
  );
  return run.finally(() => {
    live.pending -= 1;
    scheduleIdleTeardown(live);
  });
}

/**
 * The database build, memoized on the client and awaited inside the same
 * dispatch as the query that needs it, so the 10 s window covers both. A build
 * that fails kills the client: the worker is in an unknown state.
 */
function ensureReady(live: LiveClient): Promise<ReferenceFinderDatabaseInfo> {
  live.ready ??= live.remote.ensureDatabase(live.settings).catch((error: unknown) => {
    const envelope = referenceFinderError(error);
    if (!live.dead) {
      loseClient(live, 'crashed', {
        worker: 'reference-finder',
        kind: 'error',
        message: envelope.message,
      });
    }
    throw envelope;
  });
  return live.ready;
}

function spawn(instance: ReferenceFinderInstance, settings: ReferenceFinderDatabaseSettings, key: string): LiveClient {
  const worker = new Worker(new URL('../../workers/referenceFinderWorker.ts', import.meta.url), {
    type: 'module',
  });
  const live: LiveClient = {
    instance,
    key,
    settings,
    worker,
    remote: wrap<ReferenceFinderWorkerApi>(worker),
    detachDiagnostics: () => undefined,
    client: undefined as unknown as ReferenceFinderWorkerClient,
    inFlight: new Set(),
    pending: 0,
    queue: Promise.resolve(),
    ready: null,
    lastUsed: Date.now(),
    idleTimer: null,
    dead: false,
  };
  live.detachDiagnostics = attachWorkerDiagnostics(worker, 'reference-finder', (failure) => {
    // Guarded on identity: a late event from a worker already replaced must
    // not drop the replacement.
    if (clientsOf(instance).get(key) !== live) return;
    loseClient(live, 'crashed', failure);
  });
  live.client = {
    instance,
    key,
    settings,
    ready: () => call(live, () => ensureReady(live)),
    solvePoint: (x, y, query) =>
      call(live, async (remote) => {
        await ensureReady(live);
        return remote.solvePoint(x, y, query);
      }),
    solveLine: (x1, y1, x2, y2, query) =>
      call(live, async (remote) => {
        await ensureReady(live);
        return remote.solveLine(x1, y1, x2, y2, query);
      }),
  };
  return live;
}

/** Drop the least recently used idle client when an instance is at its cap. */
function makeRoom(instance: ReferenceFinderInstance): void {
  const clients = clientsOf(instance);
  if (clients.size < REFERENCE_FINDER_DATABASES_PER_INSTANCE) return;
  let victim: LiveClient | null = null;
  for (const live of clients.values()) {
    if (live.pending > 0) continue;
    if (!victim || live.lastUsed < victim.lastUsed) victim = live;
  }
  // Every client is busy: exceed the cap for now rather than kill a query the
  // user is waiting on; the idle teardown reclaims the extra one.
  if (victim) loseClient(victim, 'evicted');
}

/**
 * The client for `instance`'s database at `settings`, spawning its worker if
 * needed. Cheap to call repeatedly: the same settings return the same client
 * and refresh its idle timer.
 */
export function getReferenceFinderClient(
  instance: ReferenceFinderInstance,
  settings: ReferenceFinderDatabaseSettings = DEFAULT_DATABASE_SETTINGS
): ReferenceFinderWorkerClient {
  const key = databaseKey(settings);
  const clients = clientsOf(instance);
  let live = clients.get(key);
  if (!live) {
    makeRoom(instance);
    live = spawn(instance, settings, key);
    clients.set(key, live);
  }
  touch(live);
  scheduleIdleTeardown(live);
  return live.client;
}

/**
 * Terminate every worker of `instance` (or of both instances) and announce the
 * loss, exactly as a crash would. Leaving the References workspace releases
 * `'window'`; the planner releases `'planner'` when its run ends.
 */
export function releaseReferenceFinderClient(instance?: ReferenceFinderInstance): void {
  const instances = instance ? [instance] : [...registry.keys()];
  for (const name of instances) {
    for (const live of [...clientsOf(name).values()]) loseClient(live, 'released');
  }
}

/** Whether `instance` has any live client. Diagnostics and tests. */
export function isReferenceFinderClientConnected(instance: ReferenceFinderInstance): boolean {
  return clientsOf(instance).size > 0;
}

/** Live client keys for `instance`, most recently used last. Diagnostics and tests. */
export function referenceFinderClientKeys(instance: ReferenceFinderInstance): string[] {
  return [...clientsOf(instance).values()]
    .sort((a, b) => a.lastUsed - b.lastUsed)
    .map((live) => live.key);
}
