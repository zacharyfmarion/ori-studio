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
   * Wall-clock budget handed to **each** stage, in seconds. Omitted, both
   * inherit the solver's own default (25 s).
   */
  timeoutSeconds?: number;
  /** Fires as each stage begins, for the progress line. */
  onStage?: (stage: CpExactSolveStage) => void;
  /** Overridden in tests; defaults to the CP-detect worker. */
  solver?: () => Promise<CpExactSolver>;
}

export interface CpExactSolveRun {
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
 * options is deterministic), so a successful solve pays 1.04–1.21× the wall. A
 * failed one pays nothing extra, which is the case the wait is least tolerable
 * in.
 */
export async function runCpExactSolve(
  input: unknown,
  options: CpExactSolveRunOptions = {}
): Promise<CpExactSolveRun> {
  const inputJson = typeof input === 'string' ? input : JSON.stringify(input);
  const startedAt = Date.now();
  const solver = await (options.solver ?? defaultSolver)();

  try {
    options.onStage?.('geometry');
    const geometry = await solver.solveExact(
      inputJson,
      stageOptionsJson(options.timeoutSeconds, false)
    );
    const geometryOutcome = classifyCpExactSolve(geometry, 'geometry');
    if (geometryOutcome.kind !== 'solved') {
      return complete({ outcome: geometryOutcome, fold: null, durationMs: elapsed(startedAt) });
    }

    options.onStage?.('refinement');
    const refined = await solver.solveExactToFold(
      inputJson,
      stageOptionsJson(options.timeoutSeconds, true)
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
 * The completion event, fired here because this is the only place every solve
 * passes through and the only place that has all of its properties.
 *
 * `command invoked` already counts the *intent* at the menu chokepoint; this
 * counts the outcome, and the ratio between them is the feature's success rate.
 * Nothing user-authored is sent: a verdict, a stage, a fixed solver token, and
 * two buckets.
 */
function complete(run: CpExactSolveRun): CpExactSolveRun {
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
 * no-op — so this deliberately spells only the two knobs staging depends on.
 *
 * Notably absent: `exempt_vertex_ids`. `solve_exact_with_exemptions` exists in
 * the compiler, but `cp_detect_solve_exact` parses plain `ExactSolveOptions`, so
 * passing the set would be rejected as an unknown option. See the report.
 */
function stageOptionsJson(timeoutSeconds: number | undefined, polish: boolean): string {
  const overrides: Record<string, unknown> = { polish };
  if (timeoutSeconds !== undefined) overrides.timeout_seconds = timeoutSeconds;
  return JSON.stringify(overrides);
}

async function defaultSolver(): Promise<CpExactSolver> {
  const { getCpDetectClient } = await import('../store/workspaceStore/cpDetectRuntime');
  return getCpDetectClient();
}
