/**
 * One solve, one worker, and the only thing that can stop it.
 *
 * **The mechanism, and why it is this one.** A running solve cannot be *asked*
 * to stop: it is a single synchronous call inside wasm, so a comlink message
 * would sit unread in the queue behind the very solve it is meant to interrupt.
 * The fold path solves the same problem with a `SharedArrayBuffer` flag the
 * kernel reads at every checkpoint, and that shape was measured here before it
 * was rejected (`implementation-plans/staged-recognize-and-solve.md`, Phase C):
 * the worst gap between two of the solver's checkpoints is one
 * `solve_lm_step`, of which **94-97% is a single `nalgebra-sparse` Cholesky
 * factorization** that performs no fill-reducing ordering and is therefore
 * ~75-85% dense. Measured, in the browser, that gap crosses the fold plan's
 * ~100 ms responsiveness bar at about 900-1,000 solver parameters — inside the
 * product's own range — and reaches **~10 s** at the hard bucket's maximum. A
 * flag responding in microseconds on a 0.4 s easy solve and ten seconds later on
 * the 25 s hard solve fails on exactly the runs a Stop button exists for.
 *
 * `Worker.terminate()` has no such bound. It is immediate at every size, and it
 * needs no cross-origin isolation — so unlike the flag it is also available on
 * the deployed origin and inside the packaged desktop shell, where there is no
 * COOP/COEP and `SharedArrayBuffer` does not exist.
 *
 * **Settle first, then terminate.** `terminate()` fires no event and rejects
 * nothing, so a comlink call in flight when the worker dies is *orphaned*, not
 * failed — reproduced in this codebase at `bp-optimizer-cancellation.md:29-38`,
 * where a promise was still pending ten seconds after a 2.6 s run was killed.
 * {@link CpExactSolveSession.stop} therefore rejects every in-flight call
 * **before** touching the worker, which is what makes a cancel an ordinary
 * rejection the caller's `finally` unwinds rather than a spinner that never ends.
 * The same path serves a worker that dies on its own: `attachWorkerDiagnostics`
 * turns an `error` event into the same rejection.
 *
 * **The cost of one worker per solve** is a wasm instantiation of the CP-detect
 * bridge and nothing else — see `cpExactSolveWorker.ts` for why nothing else is
 * in there. It also buys isolation the registry needs: two regions can have live
 * solves at once, and stopping one must not be able to kill the other.
 */
import { wrap } from 'comlink';
import { attachWorkerDiagnostics, type WorkerFailure } from '../lib/workerDiagnostics';
import type { CpExactSolveWorkerApi } from '../workers/cpExactSolveWorker';
import type {
  CpExactSolveFoldResult,
  CpExactSolveInputFromFold,
  CpExactSolvedGraph,
} from './cpExactSolveTypes';

/**
 * The bridge calls a solve needs. An interface rather than the worker client
 * itself so the staging logic is testable without comlink, a worker, or a wasm
 * build.
 *
 * `exactSolveInputFromFold` is optional because an injected test solver has no
 * reason to implement a rebuild it is not exercising, and because
 * {@link runCpExactSolve} only reaches for it when it was handed a FOLD.
 */
export interface CpExactSolver {
  solveExact(inputJson: string, optionsJson?: string): Promise<CpExactSolvedGraph>;
  solveExactToFold(inputJson: string, optionsJson?: string): Promise<CpExactSolveFoldResult>;
  exactSolveInputFromFold?(foldJson: string): Promise<CpExactSolveInputFromFold>;
}

/**
 * The solve was stopped on purpose. **Not** one of the solver's endings.
 *
 * Kept out of `CpExactSolveOutcome` deliberately: that union is the four verdicts
 * the solver can reach, and a cancelled run reached none of them. A surface that
 * folded this in would be reporting "the user pressed Stop" in the same place it
 * reports "the movement budget was exceeded", which is a refusal the user could
 * act on.
 */
export class CpExactSolveCancelledError extends Error {
  readonly code = 'cp_exact_solve_cancelled';

  constructor() {
    super('The exact solve was stopped.');
    this.name = 'CpExactSolveCancelledError';
  }
}

export function isCpExactSolveCancelledError(
  error: unknown
): error is CpExactSolveCancelledError {
  return error instanceof CpExactSolveCancelledError;
}

/** A solve's transport, for exactly as long as that solve. */
export interface CpExactSolveSession {
  /** The bridge. A promise so an injected solver and a worker look the same. */
  readonly solver: Promise<CpExactSolver>;
  /**
   * Stop the solve now: reject what is in flight, then kill the worker.
   *
   * **Null when this transport cannot be stopped**, which is the honest answer
   * for a solver the caller injected — it belongs to someone else and there is
   * nothing here to terminate. A surface reads it (through the run registry's
   * `cancellable`) to decide whether to offer Stop at all, because a button that
   * does nothing is worse than an absent one.
   */
  readonly stop: (() => void) | null;
  /** Release the transport. Idempotent, and safe to call after {@link stop}. */
  dispose(): void;
}

/**
 * Whether a solve started now could be stopped.
 *
 * A property of the transport, not of the page: this needs no shared memory and
 * no cross-origin isolation, so unlike folds there is no browser where the
 * engine boots and cancellation does not. The one environment that answers
 * `false` is one with no `Worker` at all — jsdom under vitest — where the solve
 * could not have run in the first place.
 */
export function cpExactSolveCancellationAvailable(): boolean {
  return typeof Worker === 'function';
}

/** A session over a solver the caller supplied. Unstoppable, and says so. */
export function injectedCpExactSolveSession(
  solver: () => Promise<CpExactSolver>
): CpExactSolveSession {
  return { solver: solver(), stop: null, dispose: () => {} };
}

/**
 * Spawn a worker for one solve.
 *
 * Synchronous on purpose. `wrap` hands back a usable proxy immediately and
 * comlink queues calls until the worker's module has loaded, so a session can be
 * opened and bound to a run inside a single turn — which is what stops a run
 * from being published as `cancellable` a tick before anything could stop it.
 */
export function openCpExactSolveSession(): CpExactSolveSession {
  const worker = new Worker(new URL('../workers/cpExactSolveWorker.ts', import.meta.url), {
    type: 'module',
  });
  const client = wrap<CpExactSolveWorkerApi>(worker);

  let ended: unknown = null;
  const waiting = new Set<(failure: unknown) => void>();
  const detachDiagnostics = attachWorkerDiagnostics(worker, 'cp-exact-solve', (failure) =>
    end(workerFailure(failure))
  );

  /**
   * End the session with `failure`, once.
   *
   * The ordering is the whole point: everything waiting is rejected **first**,
   * and only then is the worker terminated. Reversing those two re-creates the
   * orphaned-promise bug in a narrower window.
   */
  function end(failure: unknown): void {
    if (ended) return;
    ended = failure;
    for (const waiter of [...waiting]) waiter(failure);
    waiting.clear();
    detachDiagnostics();
    worker.terminate();
  }

  /**
   * Settle with `pending`, or reject the moment the session ends.
   *
   * Both branches of the race have handlers attached by `Promise.race` itself,
   * so a `pending` that rejects after the session has already ended does not
   * surface as an unhandled rejection.
   */
  function guarded<T>(pending: Promise<T>): Promise<T> {
    if (ended) return Promise.reject(ended);
    let release = () => {};
    const failed = new Promise<never>((_resolve, reject) => {
      const waiter = (failure: unknown) => reject(failure);
      waiting.add(waiter);
      release = () => waiting.delete(waiter);
    });
    return Promise.race([pending, failed]).finally(release);
  }

  const solver: CpExactSolver = {
    solveExact: (inputJson, optionsJson) => guarded(client.solveExact(inputJson, optionsJson)),
    solveExactToFold: (inputJson, optionsJson) =>
      guarded(client.solveExactToFold(inputJson, optionsJson)),
    exactSolveInputFromFold: (foldJson) => guarded(client.exactSolveInputFromFold(foldJson)),
  };

  return {
    solver: Promise.resolve(solver),
    stop: () => end(new CpExactSolveCancelledError()),
    // Reached in a `finally` after the solve has settled, so there is normally
    // nothing left waiting. It still ends rather than merely terminating, so
    // that a future caller who disposes with a call outstanding gets a rejection
    // instead of the pending-forever promise this module exists to prevent.
    dispose: () => end(disposed()),
  };
}

function workerFailure(failure: WorkerFailure): { code: string; message: string } {
  return { code: 'cp_exact_solve', message: failure.message };
}

function disposed(): { code: string; message: string } {
  return {
    code: 'cp_exact_solve',
    message: 'The exact solve worker was released before the solve finished.',
  };
}
