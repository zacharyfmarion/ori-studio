/**
 * Run identity for exact solves: which are live, what each is solving, and how
 * far it has got.
 *
 * **Why this exists.** Solves execute in the CP-detect worker, which is one
 * thread behind one comlink queue. A second solve dispatched while the first is
 * running does not fail and does not run — it sits in the queue, silently, for
 * up to the whole of the first solve's budget. Two solvable regions is not an
 * exotic case (an `import_add` leaves the user's own pattern beside the detected
 * one, and each detection adds a region), so without identity the second chip
 * shows "Solving geometry…" for twenty seconds having not started, which is
 * indistinguishable from hung.
 *
 * **The shape is the fold path's, deliberately.** `oristudioCpFoldRuns`
 * (`store/workspaceStore/types.ts`) already models "searches the user can point
 * at" as `runId / kind / startedAt / cancellable / stopping`, and
 * `withFoldInFlight` already models the lifetime as *mint an id, register, clear
 * in a `finally` on every exit*. Both are copied rather than re-invented. Two
 * fields differ, and only where solves genuinely differ from folds:
 *
 * - **`targetId`** — there is one document to fold and many regions to solve, so
 *   a run has to name what it is solving for a chip to bind to it.
 * - **`stage`** — the solver has exactly two stages and `runCpExactSolve` knows
 *   which one is running, so the registry can be the single readout rather than
 *   every caller keeping its own copy alongside.
 *
 * `cancellable` is asked once, at dispatch, because that is when the binding is
 * made — and the affordance must be *absent* rather than dead when a run cannot
 * be stopped, the same rule folds follow in a browser without shared memory. The
 * transport is a worker this run owns and {@link requestCpExactSolveStop}
 * terminates (`cpExactSolveSession.ts` records why that rather than the fold
 * path's cooperative flag), and it is held in {@link stopHandles} rather than on
 * the run record so that published run data stays data.
 *
 * A module-level registry rather than a store slice: this layer has no React and
 * no store dependency by design (`cpExactSolve.ts` is testable without comlink, a
 * worker, or a 43 MiB model directory), and {@link subscribeCpExactSolveRuns}
 * plus {@link cpExactSolveRunsSnapshot} are `useSyncExternalStore`-shaped, so a
 * hook binds to it in two lines.
 */
import type { CpExactSolveStage } from './cpExactSolveTypes';

/**
 * Which surface started a solve. One value per entry point, so the indicator and
 * the analytics can tell them apart without carrying anything about the document.
 */
export type CpExactSolveRunKind =
  /** The Solve button on a region chip. */
  | 'region'
  /** The detect modal's automatic solve, straight after recognition. */
  | 'detect-import'
  /** `Crease Pattern ▸ Repair ▸ Exact Solve…`. */
  | 'command';

/** One exact solve the user can point at. */
export interface CpExactSolveRun {
  /** Minted here, never by the caller: a run is live exactly while it is registered. */
  runId: number;
  kind: CpExactSolveRunKind;
  /**
   * What is being solved — a region id, or any stable key the caller owns.
   *
   * The registry's uniqueness key: two runs may be live at once (they queue), but
   * never two for the same target, because the second would be solving an input
   * the first is about to replace.
   */
  targetId: string;
  /** `Date.now()` at dispatch — what an elapsed-time readout is measured from. */
  startedAt: number;
  /**
   * Whether this run could actually be stopped, decided at dispatch because that
   * is when the binding is made — a run dispatched onto a transport that cannot
   * be terminated stays un-stoppable for its whole life.
   */
  cancellable: boolean;
  /**
   * A stop has been requested for this run.
   *
   * True only between the request and the run's own `finally`, which with a
   * terminated worker is a microtask or two — the rejection is delivered by
   * {@link requestCpExactSolveStop} itself rather than at some later checkpoint.
   * It exists so a surface that renders in that window says "Stopping…" instead
   * of offering Stop a second time.
   */
  stopping: boolean;
  /** Which half of the solve is running; null before the first stage begins. */
  stage: CpExactSolveStage | null;
}

/** Thrown when a solve is dispatched for a target that already has one live. */
export class CpExactSolveBusyError extends Error {
  readonly code = 'cp_exact_solve_busy';
  readonly targetId: string;
  /** The run already holding the target. */
  readonly runId: number;

  constructor(run: CpExactSolveRun) {
    super(`An exact solve is already running for "${run.targetId}" (run ${run.runId}).`);
    this.name = 'CpExactSolveBusyError';
    this.targetId = run.targetId;
    this.runId = run.runId;
  }
}

export function isCpExactSolveBusyError(error: unknown): error is CpExactSolveBusyError {
  return error instanceof CpExactSolveBusyError;
}

const EMPTY: readonly CpExactSolveRun[] = [];

let nextRunId = 1;
let runs: readonly CpExactSolveRun[] = EMPTY;
const listeners = new Set<() => void>();

/**
 * How to stop each live run, keyed by run id — the transport table.
 *
 * Separate from the run records for the reason `foldCancellation.ts` is separate
 * from `oristudioCpFoldRuns`: the records are what surfaces read and re-render
 * on, and a callable on them invites a caller to reach past
 * {@link requestCpExactSolveStop} and stop a run without the state that says so.
 * Cleared with the run.
 */
const stopHandles = new Map<number, () => void>();

/**
 * Live runs, **oldest first** — which is execution order.
 *
 * One worker and one comlink queue, so solves run strictly serially in the order
 * they were dispatched, and ids are minted at dispatch. A caller wanting "is
 * anything ahead of me" can read the position of its own run in this array.
 *
 * Stable by reference between mutations, so it is a valid `useSyncExternalStore`
 * snapshot.
 */
export function cpExactSolveRunsSnapshot(): readonly CpExactSolveRun[] {
  return runs;
}

/** Subscribe to the run list. Returns the unsubscribe. */
export function subscribeCpExactSolveRuns(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The live run for a target, if any — what a chip binds its "solving" state to. */
export function cpExactSolveRunFor(targetId: string): CpExactSolveRun | undefined {
  return runs.find((run) => run.targetId === targetId);
}

function publish(next: readonly CpExactSolveRun[]): void {
  runs = next;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.error('[ori-studio] cp exact solve run listener failed', error);
    }
  }
}

function replace(runId: number, patch: Partial<CpExactSolveRun>): void {
  const index = runs.findIndex((run) => run.runId === runId);
  if (index < 0) return;
  const next = [...runs];
  next[index] = { ...next[index], ...patch };
  publish(next);
}

/** Record which stage a live run has reached. A no-op once it has ended. */
export function setCpExactSolveRunStage(runId: number, stage: CpExactSolveStage): void {
  replace(runId, { stage });
}

/**
 * Bind a live run to the thing that can stop it.
 *
 * Called by `runCpExactSolve` in the **same turn** the run is published, before
 * its first `await`, so a run is never advertised as `cancellable` while nothing
 * could yet act on a Stop. A run whose transport has no stop is simply never
 * bound, and {@link requestCpExactSolveStop} refuses it.
 */
export function bindCpExactSolveRunStop(runId: number, stop: () => void): void {
  if (runs.some((run) => run.runId === runId)) stopHandles.set(runId, stop);
}

/**
 * Stop a live run, and record that it was asked for. Answers whether anything
 * was actually reached.
 *
 * Both halves matter and they happen in this order. The flag is written first so
 * that a surface re-rendering between the two shows "Stopping…" rather than an
 * enabled Stop; the transport is then invoked, which rejects the in-flight bridge
 * call and terminates the worker, so the run's own `finally` clears it. There is
 * no third state where the request has been made and the run keeps going.
 *
 * `false` for a run that is not live, or one dispatched onto a transport that
 * cannot be terminated. Surfaces should be asking `cancellable` before offering
 * Stop — this is the backstop, and it must do nothing rather than lie.
 */
export function requestCpExactSolveStop(runId: number): boolean {
  const run = runs.find((candidate) => candidate.runId === runId);
  if (!run?.cancellable) return false;
  const stop = stopHandles.get(runId);
  if (!stop) return false;
  if (!run.stopping) replace(runId, { stopping: true });
  stop();
  return true;
}

/**
 * Register a solve for as long as `run` takes, under an id the UI can name.
 *
 * The id is minted here rather than by the caller, for the same reason
 * `withFoldInFlight` mints it: a run is live exactly while it is in the list, and
 * the two must not be able to disagree. The `finally` clears it on **every**
 * exit, including a rejection.
 *
 * Refuses a second run for the same target rather than queueing it. Callers
 * should not reach that: {@link cpExactSolveRunFor} is what a surface reads to
 * decide whether to offer Solve at all, and offering a button whose press is
 * refused is worse than not offering it. The throw is the backstop for a race
 * between two presses, and it happens *before* the worker is touched, so the
 * refused press costs nothing.
 */
export async function withCpExactSolveRun<T>(
  descriptor: { kind: CpExactSolveRunKind; targetId: string; cancellable: boolean },
  run: (live: CpExactSolveRun) => Promise<T>
): Promise<T> {
  const existing = cpExactSolveRunFor(descriptor.targetId);
  if (existing) throw new CpExactSolveBusyError(existing);

  const live: CpExactSolveRun = {
    runId: nextRunId++,
    kind: descriptor.kind,
    targetId: descriptor.targetId,
    startedAt: Date.now(),
    // Asked once, at dispatch, because that is when the binding is made.
    cancellable: descriptor.cancellable,
    stopping: false,
    stage: null,
  };
  publish([...runs, live]);
  try {
    return await run(live);
  } finally {
    stopHandles.delete(live.runId);
    publish(runs.filter((candidate) => candidate.runId !== live.runId));
  }
}

/**
 * Forget every run. Tests only — production code has no reason to, because the
 * `finally` above already clears each run on its own exit.
 */
export function resetCpExactSolveRuns(): void {
  runs = EMPTY;
  stopHandles.clear();
  nextRunId = 1;
}
