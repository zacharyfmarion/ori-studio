/**
 * The exact solver's result, as it crosses the wasm bridge, and the one function
 * that decides what it means.
 *
 * `cp_detect_solve_exact` hands back an `ExactSolvedGraph` verbatim, and reading
 * it correctly is not obvious — the struct reports four materially different
 * endings through three fields that overlap, and two of those endings are
 * missing the field a naive reader would look at:
 *
 * | ending | `movement_report` shape |
 * | --- | --- |
 * | accepted | `accepted: true`, `rejection_reasons: []` |
 * | rejected | `accepted: false`, `rejection_reasons: [<token>, …]` |
 * | timed out | `timed_out: true`, and the reason is a **formatted string** |
 * | malformed | `{status: "not_run", blockers: […]}` — **no** `rejection_reasons` |
 *
 * So a UI reading only `rejection_reasons` shows "no reason" on a malformed
 * input and prints a sentence with a number in it as if it were a token on a
 * timeout. {@link classifyCpExactSolve} is the single place that reads the four
 * apart, which is why everything else here is data.
 *
 * The Rust side is `crates/oristudio-cp-compiler/src/exact_solve.rs`; the shapes
 * below are its `json!` literals, not a re-derivation.
 */

/** `ExactSolvedGraphStatus`, verbatim. */
export type CpExactSolveStatus = 'solved' | 'ambiguous' | 'failed';

/**
 * One vertex the solver moved.
 *
 * Only the fields the repair flow reads are typed. The report carries more per
 * vertex (`movement_policy`, `boundary_side`, `support`); leaving them off keeps
 * this from becoming a second, drifting copy of `CandidateVertex`.
 */
export interface CpExactSolveMovedVertex {
  vertex_id: number;
  before: { x: number; y: number };
  after: { x: number; y: number };
  movement: number;
}

/**
 * `movement_report`, in its accepted / rejected / timed-out shape.
 *
 * Every field is optional because the malformed shape is a different object
 * entirely — see the table above. Do not reach for these directly; go through
 * {@link classifyCpExactSolve}.
 */
export interface CpExactSolveMovementReport {
  schema?: string;
  status?: string;
  blockers?: string[];
  termination?: string;
  timed_out?: boolean;
  timeout_seconds?: number;
  elapsed_seconds?: number;
  accepted?: boolean;
  rejection_reasons?: string[];
  max_vertex_movement?: number;
  attempted_max_vertex_movement?: number;
  max_vertex_movement_budget?: number;
  moved_vertices?: CpExactSolveMovedVertex[];
  /**
   * The partial solution a timed-out run got to.
   *
   * Populated on every run — on an accepted one it is the same set as
   * `moved_vertices` — but it is only *interesting* on a timeout, where
   * `moved_vertices` is empty because the solver returned the input coordinates
   * and this is the only record of the work it did.
   */
  attempted_moved_vertices?: CpExactSolveMovedVertex[];
  [key: string]: unknown;
}

/** `ExactSolvedGraph`, as JSON. */
export interface CpExactSolvedGraph {
  schema: string;
  vertices_exact: { x: number; y: number }[];
  edges_exact: [number, number][];
  movement_report: CpExactSolveMovementReport;
  theorem_residual_report: Record<string, unknown>;
  status: CpExactSolveStatus;
}

/** `cp_detect_solve_exact_to_fold`'s payload: one solve, both products. */
export interface CpExactSolveFoldResult {
  schema: string;
  solved: CpExactSolvedGraph;
  fold: Record<string, unknown>;
}

/**
 * The solver's `rejection_reasons` vocabulary — nine tokens, in the two families
 * that produce them.
 *
 * Preflight reasons are refusals *before* any solve: the input itself is not
 * solvable and no amount of waiting changes that. Acceptance-gate reasons are a
 * solve that ran and whose answer was judged not worth keeping.
 *
 * Exported as a runtime array so the exhaustiveness of the sentence table can be
 * asserted rather than assumed.
 */
export const CP_EXACT_SOLVE_PREFLIGHT_REASONS = [
  'preflight_degenerate_edges',
  'preflight_boundary_failures',
] as const;

export const CP_EXACT_SOLVE_GATE_REASONS = [
  'candidate_status_failed',
  'movement_budget_exceeded',
  'odd_degree_vertices_worsened',
  'degenerate_edges_worsened',
  'unmodeled_crossings_worsened',
  'boundary_failures_worsened',
  'objective_not_improved',
] as const;

/**
 * Every reason the UI can be asked to explain: the nine real tokens, plus the
 * two endings that carry no token at all.
 *
 * `timeout` and `malformed_input` are **synthesised** by
 * {@link classifyCpExactSolve} — the solver writes neither. They are in the same
 * union because the surface has to say something in all eleven cases, and a
 * union that covers only what the solver spells makes the two it does not spell
 * unrepresentable, which is exactly how "no reason" gets shown.
 */
export const CP_EXACT_SOLVE_REASONS = [
  ...CP_EXACT_SOLVE_PREFLIGHT_REASONS,
  ...CP_EXACT_SOLVE_GATE_REASONS,
  'timeout',
  'malformed_input',
] as const;

export type CpExactSolveReason = (typeof CP_EXACT_SOLVE_REASONS)[number];

const KNOWN_REASONS = new Set<string>(CP_EXACT_SOLVE_REASONS);

/** Whether `value` is one of the tokens this app knows how to explain. */
export function isCpExactSolveReason(value: string): value is CpExactSolveReason {
  return KNOWN_REASONS.has(value);
}

/** Which of the solver's two stages a run reached. */
export type CpExactSolveStage = 'geometry' | 'refinement';

/**
 * What happened, in the four kinds the user has to be told apart.
 *
 * `solved` and `timeout` both leave geometry on the table; `rejected` and
 * `malformed` leave none, because on every non-acceptance the solver returns the
 * *input* coordinates — the document is unchanged and there is nothing to revert.
 */
export type CpExactSolveOutcome =
  | {
      kind: 'solved';
      stage: CpExactSolveStage;
      status: CpExactSolveStatus;
      /** Vertices whose position changed, for the "45 vertices moved" line. */
      movedVertices: readonly CpExactSolveMovedVertex[];
      /** The largest single displacement, in model units. */
      maxMovement: number;
      elapsedSeconds: number;
    }
  | {
      kind: 'timeout';
      stage: CpExactSolveStage;
      /**
       * How far the solver got. Non-empty in practice (median ~448 entries), and
       * the reason "accept partial" is an honest offer rather than a euphemism
       * for "give up": these are real coordinates from a real run, they simply
       * did not clear the acceptance gate before the clock did.
       */
      partialMovedVertices: readonly CpExactSolveMovedVertex[];
      partialMaxMovement: number;
      timeoutSeconds: number;
      elapsedSeconds: number;
    }
  | {
      kind: 'rejected';
      stage: CpExactSolveStage;
      status: CpExactSolveStatus;
      /** The tokens the solver wrote, in its own order, unknown ones dropped. */
      reasons: readonly CpExactSolveReason[];
      elapsedSeconds: number;
    }
  | {
      kind: 'malformed';
      stage: CpExactSolveStage;
      /**
       * How many blockers the solver listed — a count, never the messages. Each
       * one is prose naming span and vertex indices ("selected span 12
       * references missing vertex 300"), which is the user's geometry.
       */
      blockerCount: number;
    };

/** The single reason to show first, or null when there is nothing to explain. */
export function primaryCpExactSolveReason(
  outcome: CpExactSolveOutcome
): CpExactSolveReason | null {
  switch (outcome.kind) {
    case 'solved':
      return null;
    case 'timeout':
      return 'timeout';
    case 'malformed':
      return 'malformed_input';
    case 'rejected':
      // The solver sorts its reasons alphabetically, so "first" carries no
      // priority of its own; taking [0] is a presentation choice, and the whole
      // list stays on the outcome for a surface with room for it.
      return outcome.reasons[0] ?? null;
  }
}

function movedVertices(report: CpExactSolveMovementReport, key: 'moved_vertices' | 'attempted_moved_vertices') {
  const value = report[key];
  return Array.isArray(value) ? (value as CpExactSolveMovedVertex[]) : [];
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Read an `ExactSolvedGraph` into the four endings above.
 *
 * The order of the tests is the whole content of this function:
 *
 * 1. **Malformed first**, because that shape has neither `timed_out` nor
 *    `rejection_reasons` — both of the tests below would read `undefined` as
 *    "no", and the run would be reported as a plain rejection with an empty
 *    reason list.
 * 2. **Timeout before rejection**, on the `timed_out` *boolean*. A timed-out run
 *    also carries a `rejection_reasons` entry, but it is the sentence "exact
 *    solve timed out after 25.000s" — a formatted number, not a token. Matching
 *    on the string is the trap this ordering exists to make unnecessary.
 * 3. **`accepted`**, which is the solver's own verdict and already accounts for
 *    an `ambiguous` status that improved.
 */
export function classifyCpExactSolve(
  solved: CpExactSolvedGraph,
  stage: CpExactSolveStage
): CpExactSolveOutcome {
  const report = solved.movement_report ?? {};
  const elapsedSeconds = finiteNumber(report.elapsed_seconds);

  if (report.status === 'not_run' || (!report.rejection_reasons && report.blockers)) {
    return {
      kind: 'malformed',
      stage,
      blockerCount: Array.isArray(report.blockers) ? report.blockers.length : 0,
    };
  }

  if (report.timed_out === true) {
    const partial = movedVertices(report, 'attempted_moved_vertices');
    return {
      kind: 'timeout',
      stage,
      partialMovedVertices: partial,
      partialMaxMovement: finiteNumber(report.attempted_max_vertex_movement),
      timeoutSeconds: finiteNumber(report.timeout_seconds),
      elapsedSeconds,
    };
  }

  if (report.accepted === true) {
    return {
      kind: 'solved',
      stage,
      status: solved.status,
      movedVertices: movedVertices(report, 'moved_vertices'),
      maxMovement: finiteNumber(report.max_vertex_movement),
      elapsedSeconds,
    };
  }

  const reasons = (report.rejection_reasons ?? []).filter(isCpExactSolveReason);
  return {
    kind: 'rejected',
    stage,
    status: solved.status,
    reasons,
    elapsedSeconds,
  };
}
