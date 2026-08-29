/**
 * Running the exact solver from the browser, in the two stages it actually has.
 *
 * `solve_exact` is a pure function of an `ExactSolveInput` — no dense heads, no
 * source image, no selection state — so the whole of this module is: hand the
 * attached input back over the bridge, say which stage is running, and read the
 * answer. What it is *not* is a second copy of the solver's policy; every
 * judgement about what the result means lives in
 * {@link classifyCpExactSolve}.
 */
import { track } from '../analytics';
import {
  ANALYTICS_EVENTS,
  COUNT_BUCKETS,
  CP_EXACT_SOLVE_MS_BUCKETS,
  bucketCount,
  type CpExactSolveRejectionReason,
  type CpExactSolveVerdict,
} from '../analytics/events';
import {
  setCpExactSolveRunStage,
  withCpExactSolveRun,
  type CpExactSolveRunKind,
} from './cpExactSolveRuns';
import {
  classifyCpExactSolve,
  primaryCpExactSolveReason,
  type CpExactSolveFoldResult,
  type CpExactSolveOutcome,
  type CpExactSolveStage,
  type CpExactSolvedGraph,
} from './cpExactSolveTypes';

/**
 * The two bridge calls a solve needs. An interface rather than the worker client
 * itself so the staging logic is testable without comlink, a worker, or a
 * 43 MiB model directory.
 */
export interface CpExactSolver {
  solveExact(inputJson: string, optionsJson?: string): Promise<CpExactSolvedGraph>;
  solveExactToFold(inputJson: string, optionsJson?: string): Promise<CpExactSolveFoldResult>;
}

export interface CpExactSolveRunOptions {
  /**
   * The wall-clock budget for **the whole solve**, in seconds — not per stage.
   *
   * Pass the number the recognize path published as
   * `compiler_report.solve.budget.total_seconds`. It is spent across both bridge
   * calls: stage 1 gets all of it, stage 2 gets what stage 1 left. Rust cannot
   * do this itself — `solve_exact` builds its deadline from the `timeout_seconds`
   * of the call it is in, so two calls are two independent deadlines — which is
   * why it publishes the number and the caller owes the arithmetic.
   *
   * A **negative** value disables the timeout, and is passed through to both
   * stages unchanged rather than reduced. Clamping it would turn "no limit" into
   * `0`, which means "time out immediately".
   *
   * Omitted, each stage inherits the solver's own default (25 s) and the total is
   * therefore up to 2x it. That is the honest reading of "the caller has no
   * opinion" — this module will not guess a budget it was not given — but it is
   * not what a product surface should do. Pass the published total.
   */
  timeoutSeconds?: number;
  /**
   * Vertices the user moved by hand, excluded from `max_vertex_movement`.
   *
   * Without this a repaired vertex reads as one large drift and the budget
   * rejects the **whole** solve — the solver then returns the input coordinates
   * with `status: Failed`, so the user silently gets their unsolved edit back.
   * That is the mechanism verb 8 of the repair flow rests on
   * (`implementation-plans/crease-topology-repair.md`).
   *
   * These are `CandidateVertex.id`s, **not indices into `vertices`**. The bridge
   * rejects an id naming no vertex in the input with `unknown_exempt_vertex_id`
   * rather than dropping it, because a silently-lost exemption comes back as
   * `movement_budget_exceeded` with nothing pointing at the cause.
   */
  exemptVertexIds?: readonly number[];
  /**
   * Register this solve under a run id, so a second one for the same target is
   * refused rather than queued invisibly behind it.
   *
   * Omitted, the solve runs unregistered — which is right for a test or a
   * one-shot script, and wrong for any surface a user can press twice. See
   * `cpExactSolveRuns.ts`.
   */
  run?: { kind: CpExactSolveRunKind; targetId: string };
  /** Fires as each stage begins, for the progress line. */
  onStage?: (stage: CpExactSolveStage) => void;
  /** Overridden in tests; defaults to the CP-detect worker. */
  solver?: () => Promise<CpExactSolver>;
}

export interface CpExactSolveResult {
  outcome: CpExactSolveOutcome;
  /**
   * The FOLD document at the solved coordinates, or null when there is nothing
   * to apply.
   *
   * Null on every non-acceptance, and that is not a gap: the solver returns the
   * *input* coordinates whenever it does not accept, so a FOLD from a rejected
   * run would be the document the user already has, dressed up as a result.
   */
  fold: Record<string, unknown> | null;
  /** Wall time across both stages, measured here rather than in the solver. */
  durationMs: number;
}

/**
 * Why this runs the solver twice.
 *
 * The solver has two stages that behave nothing alike. Stage 1 equilibrates the
 * geometry and is 4–21% of the wall; stage 2 re-anchors and polishes toward
 * 1e-6 degrees Kawasaki and is the other 79–96%. Stage 2 runs **only if stage 1
 * would be accepted** — so on a failure the second call never happens and costs
 * nothing.
 *
 * There is no progress callback out of wasm: one call is opaque from the moment
 * it starts until it returns. So a single call cannot say which stage is
 * running, and a UI that claimed to know would be guessing — on a medium solve
 * it would sit on "Solving geometry" for twelve seconds having finished that in
 * under one.
 *
 * The cost of the split is that stage 2 redoes stage 1 (identically — `polish`
 * gates only the block after it, and LM from the same params under the same
 * options is deterministic), so a successful solve pays 1.04–1.21x the wall. A
 * failed one pays nothing extra, which is the case the wait is least tolerable
 * in.
 *
 * What the split must **not** cost is the budget. Two calls are two deadlines,
 * so handing each `timeoutSeconds` would give the staged flow up to twice the
 * fused path's cap and let it succeed where a plain detection failed — a
 * user-visible divergence in the good direction, but a divergence, and one that
 * silently invalidates the 25 s figure every measurement in
 * `crease-topology-repair.md` was taken against. {@link remainingSolveBudget}
 * is how the total is kept whole.
 */
export async function runCpExactSolve(
  input: unknown,
  options: CpExactSolveRunOptions = {}
): Promise<CpExactSolveResult> {
  const descriptor = options.run;
  if (!descriptor) return solveStaged(input, options, null);
  return withCpExactSolveRun(descriptor, (live) => solveStaged(input, options, live.runId));
}

async function solveStaged(
  input: unknown,
  options: CpExactSolveRunOptions,
  runId: number | null
): Promise<CpExactSolveResult> {
  const inputJson = typeof input === 'string' ? input : JSON.stringify(input);
  const startedAt = Date.now();
  const solver = await (options.solver ?? defaultSolver)();
  const enterStage = (stage: CpExactSolveStage) => {
    if (runId !== null) setCpExactSolveRunStage(runId, stage);
    options.onStage?.(stage);
  };

  try {
    enterStage('geometry');
    const geometryStartedAt = Date.now();
    const geometry = await solver.solveExact(
      inputJson,
      stageOptionsJson(options, options.timeoutSeconds, false)
    );
    const geometryOutcome = classifyCpExactSolve(geometry, 'geometry');
    if (geometryOutcome.kind !== 'solved') {
      return complete({ outcome: geometryOutcome, fold: null, durationMs: elapsed(startedAt) });
    }

    enterStage('refinement');
    const refined = await solver.solveExactToFold(
      inputJson,
      stageOptionsJson(
        options,
        remainingSolveBudget(options.timeoutSeconds, stageSeconds(geometry, geometryStartedAt)),
        true
      )
    );
    const outcome = classifyCpExactSolve(refined.solved, 'refinement');
    return complete({
      outcome,
      fold: outcome.kind === 'solved' ? refined.fold : null,
      durationMs: elapsed(startedAt),
    });
  } catch (error) {
    // A bridge failure is not one of the solver's endings — the solve did not
    // reach a verdict — so it is reported and rethrown rather than folded into
    // the outcome union, which would make "the worker died" look like a
    // rejection the user could fix by editing.
    track(ANALYTICS_EVENTS.cpExactSolveCompleted, {
      verdict: 'error' satisfies CpExactSolveVerdict,
      duration_ms_bucket: bucketCount(elapsed(startedAt), CP_EXACT_SOLVE_MS_BUCKETS),
    });
    throw error;
  }
}

/**
 * What is left of the total budget for the next stage.
 *
 * Three cases, and the middle one is the trap:
 *
 * - **No total** — the caller has no opinion, so neither stage names a timeout
 *   and each inherits the solver's default. Not a budget this module invented.
 * - **Negative total** — the timeout is *disabled*. Passed through unchanged.
 *   Subtracting from it, or clamping it to zero, would turn "run to completion"
 *   into "time out immediately", which is what `0.0` means.
 * - **Non-negative total** — spend what stage 1 used, floored at zero. Zero is a
 *   legitimate value to send: the budget really is gone, and immediate timeout is
 *   the honest answer rather than a fresh 25 s.
 */
export function remainingSolveBudget(
  totalSeconds: number | undefined,
  spentSeconds: number
): number | undefined {
  if (totalSeconds === undefined) return undefined;
  if (totalSeconds < 0) return totalSeconds;
  return Math.max(0, totalSeconds - spentSeconds);
}

/**
 * How much of the budget a stage consumed.
 *
 * The larger of what the solver reports and what actually elapsed here.
 * `movement_report.elapsed_seconds` is measured on the deadline clock and works
 * under wasm (unlike `StageTimer`, which reports 0.0 there), so it is the right
 * primary source — but it counts only time *inside* the solver. Serializing a
 * quarter-megabyte input, the comlink round trip and the JSON parse on the way
 * back are real wall-clock spend against a wall-clock budget, and taking the
 * maximum is what stops them accumulating into an overrun across stages.
 */
function stageSeconds(solved: CpExactSolvedGraph, stageStartedAt: number): number {
  const reported = solved.movement_report?.elapsed_seconds;
  const solverSeconds = typeof reported === 'number' && Number.isFinite(reported) ? reported : 0;
  return Math.max(solverSeconds, (Date.now() - stageStartedAt) / 1000);
}

/**
 * The completion event, fired here because this is the only place every solve
 * passes through and the only place that has all of its properties.
 *
 * `command invoked` already counts the *intent* at the menu chokepoint; this
 * counts the outcome, and the ratio between them is the feature's success rate.
 * Nothing user-authored is sent: a verdict, a stage, a fixed solver token, and
 * two buckets.
 */
function complete(run: CpExactSolveResult): CpExactSolveResult {
  const reason = primaryCpExactSolveReason(run.outcome);
  track(ANALYTICS_EVENTS.cpExactSolveCompleted, {
    verdict: verdictOf(run.outcome),
    stage: run.outcome.stage,
    reason: reason ? (reason satisfies CpExactSolveRejectionReason) : undefined,
    duration_ms_bucket: bucketCount(run.durationMs, CP_EXACT_SOLVE_MS_BUCKETS),
    moved_vertices_bucket: bucketCount(movedVertexCount(run.outcome), COUNT_BUCKETS),
  });
  return run;
}

function verdictOf(outcome: CpExactSolveOutcome): CpExactSolveVerdict {
  return outcome.kind === 'malformed' ? 'malformed' : outcome.kind;
}

/**
 * How many vertices the run moved, bucketed by the caller.
 *
 * A timeout reports its *attempted* count, which is the honest answer to "how
 * much work happened" and the number the partial offer is made from. A rejection
 * moved nothing that was kept.
 */
function movedVertexCount(outcome: CpExactSolveOutcome): number {
  if (outcome.kind === 'solved') return outcome.movedVertices.length;
  if (outcome.kind === 'timeout') return outcome.partialMovedVertices.length;
  return 0;
}

function elapsed(startedAt: number): number {
  return Date.now() - startedAt;
}

/**
 * A partial `ExactSolveOptions`. Every omitted field keeps its Rust default, and
 * an unrecognised name is a hard error on the other side rather than a silent
 * no-op — so this deliberately spells only the knobs the caller has an opinion
 * about.
 *
 * `exempt_vertex_ids` is omitted when empty rather than sent as `[]`: the two are
 * equivalent (`solve_exact_with_exemptions` with an empty set *is* `solve_exact`),
 * and omitting keeps an ordinary automatic solve's options byte-identical to what
 * they were before exemptions existed.
 */
function stageOptionsJson(
  options: CpExactSolveRunOptions,
  timeoutSeconds: number | undefined,
  polish: boolean
): string {
  const overrides: Record<string, unknown> = { polish };
  if (timeoutSeconds !== undefined) overrides.timeout_seconds = timeoutSeconds;
  const exempt = exemptVertexIds(options.exemptVertexIds);
  if (exempt.length > 0) overrides.exempt_vertex_ids = exempt;
  return JSON.stringify(overrides);
}

/**
 * The exemption set, deduplicated and ascending.
 *
 * Rust parses it into a `BTreeSet`, so duplicates and order never reach the
 * solver — normalising here is so that two calls asking for the same exemptions
 * produce the same options string, which is what makes an options diff readable
 * in a bug report.
 */
function exemptVertexIds(ids: readonly number[] | undefined): number[] {
  if (!ids || ids.length === 0) return [];
  return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * The worker client, wrapped so a dead worker rejects instead of hanging.
 *
 * comlink's proxy settles only when the worker answers, so a worker that traps
 * mid-solve leaves the promise pending forever and the chip on "Refining to fold
 * precision…" with nothing ever ending it. `onCpDetectClientLost` is the signal
 * the runtime now publishes for exactly this; racing it turns the pending promise
 * into a rejection the surface can report.
 *
 * Imported dynamically so constructing this module does not pull the worker
 * module — and through it the ONNX runtime chunk — into unrelated bundles.
 */
async function defaultSolver(): Promise<CpExactSolver> {
  const { getCpDetectClient, onCpDetectClientLost } = await import(
    '../store/workspaceStore/cpDetectRuntime'
  );
  const client = await getCpDetectClient();
  const alive = <T>(pending: Promise<T>): Promise<T> =>
    whileClientAlive(onCpDetectClientLost, pending);
  return {
    solveExact: (inputJson, optionsJson) => alive(client.solveExact(inputJson, optionsJson)),
    solveExactToFold: (inputJson, optionsJson) =>
      alive(client.solveExactToFold(inputJson, optionsJson)),
  };
}

/**
 * Settle with `pending`, or reject as soon as the worker behind it is lost.
 *
 * Exported for its test. Both branches of the race have handlers attached by
 * `Promise.race` itself, so a `pending` that rejects after the loss has already
 * won does not surface as an unhandled rejection.
 */
export function whileClientAlive<T>(
  subscribe: (listener: (loss: { failure?: { message: string } }) => void) => () => void,
  pending: Promise<T>
): Promise<T> {
  let unsubscribe: (() => void) | null = null;
  const lost = new Promise<never>((_resolve, reject) => {
    unsubscribe = subscribe((loss) => {
      reject({
        code: 'cp_detect',
        message:
          loss.failure?.message ??
          'The crease-pattern detection worker stopped while the solve was running.',
      });
    });
  });
  return Promise.race([pending, lost]).finally(() => unsubscribe?.());
}
