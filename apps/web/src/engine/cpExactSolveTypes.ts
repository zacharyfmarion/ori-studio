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
 * The accepted row then splits again, on a field outside `movement_report`
 * entirely: `ExactSolvedGraph.status`. `accepted` says the solver kept its
 * answer; `status` says whether that answer is *exact*. An accepted run at
 * `Ambiguous` is a real improvement that still fails every foldability check
 * the input failed, so the two are separate outcomes here rather than one.
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
  polish?: CpExactSolvePolishReport;
  [key: string]: unknown;
}

/**
 * `movement_report.polish` — what the refinement stage's polish loop did.
 *
 * Emitted on every solve, including the ones where polish never started, which
 * is why `stop_reason` distinguishes `disabled` and `preflight_blocked` from
 * `round_refused`. The loop re-anchors the theorem priors to the accepted
 * stage-1 answer and re-solves with tightened sigmas, so its rounds are the
 * difference between "equilibrated against noisy detected positions" and "as
 * exact as this topology allows".
 *
 * The field that matters to a surface is {@link refused_round}: a round that was
 * computed, judged, and thrown away. It is normally *better* on angle than the
 * answer that was kept — which is exactly why a refusal needs explaining rather
 * than hiding.
 */
export interface CpExactSolvePolishReport {
  /** `options.polish` — whether the caller asked for polish at all. */
  enabled?: boolean;
  /** Whether at least one round was actually computed. */
  ran?: boolean;
  /**
   * Why polishing stopped, or why it never started: `not_run` | `disabled` |
   * `preflight_blocked` | `no_parameters` | `timed_out` | `stage1_rejected` |
   * `target_reached` | `round_refused` | `max_rounds`.
   */
  stop_reason?: string;
  rounds_attempted?: number;
  rounds_adopted?: number;
  max_rounds?: number;
  target_kawasaki_degrees?: number;
  /** Max Kawasaki residual the polish started from, in degrees. */
  kawasaki_before_degrees?: number | null;
  /** Max Kawasaki residual after the adopted rounds; equal to `before` when none were. */
  kawasaki_after_degrees?: number | null;
  refused_round?: CpExactSolvePolishRefusal | null;
  [key: string]: unknown;
}

/** The first polish round that was computed and then refused, if any. */
export interface CpExactSolvePolishRefusal {
  /** What this round *would* have reached, in degrees. */
  kawasaki_degrees?: number;
  /**
   * True when the round was refused **only** for making Kawasaki worse, in which
   * case `rejection_reasons` is empty. Without this flag "refused with no
   * reasons" is indistinguishable from "not refused".
   */
  kawasaki_regressed?: boolean;
  /** Acceptance-gate tokens, verbatim — the same vocabulary as a rejected solve. */
  rejection_reasons?: string[];
}

/**
 * One `analysis_json` block, in the two fields a completion sentence needs.
 *
 * `odd_degree_vertices` counts **interior fold vertices only** — `analyze_graph`
 * skips corners, boundary contacts and anything on a boundary span — so an entry
 * here is a vertex that can never be flat-foldable, not a paper edge that happens
 * to have three creases at it.
 */
export interface CpExactSolveAnalysis {
  max_kawasaki_residual_degrees?: number;
  odd_degree_vertices?: number[];
  [key: string]: unknown;
}

/**
 * `theorem_residual_report`.
 *
 * `before` is the input as handed in, `after` is the geometry the solver
 * returned, and `candidate_after` is the answer it computed whether or not it
 * kept it. On a rejection `after` **is** `before` — the solver returns the
 * coordinates it was given — so only `candidate_after` says anything there, and
 * only the accepted outcomes read this at all.
 */
export interface CpExactSolveTheoremReport {
  schema?: string;
  termination?: string;
  accepted?: boolean;
  rejection_reasons?: string[];
  before?: CpExactSolveAnalysis;
  after?: CpExactSolveAnalysis;
  candidate_after?: CpExactSolveAnalysis;
  [key: string]: unknown;
}

/** `ExactSolvedGraph`, as JSON. */
export interface CpExactSolvedGraph {
  schema: string;
  vertices_exact: { x: number; y: number }[];
  edges_exact: [number, number][];
  movement_report: CpExactSolveMovementReport;
  theorem_residual_report: CpExactSolveTheoremReport;
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
 * three endings that carry no token at all.
 *
 * `timeout`, `malformed_input` and `above_fold_precision` are **synthesised** by
 * {@link classifyCpExactSolve} — the solver writes none of them. They are in the
 * same union because the surface has to say something in all twelve cases, and a
 * union that covers only what the solver spells makes the three it does not
 * spell unrepresentable, which is exactly how "no reason" gets shown.
 *
 * `above_fold_precision` is the one that is **not** a failure: the solve was
 * accepted and the pattern got better, it simply did not get exact. It is in
 * this vocabulary anyway because every surface that ends a solve asks this
 * function what to say, and the alternative — `null` — is read by callers as
 * "no reason available" and falls through to whatever their fallback is.
 */
export const CP_EXACT_SOLVE_REASONS = [
  ...CP_EXACT_SOLVE_PREFLIGHT_REASONS,
  ...CP_EXACT_SOLVE_GATE_REASONS,
  'timeout',
  'malformed_input',
  'above_fold_precision',
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
 * How far a run moved the pattern toward foldable, in the numbers the solver
 * already measured.
 *
 * These exist so a surface can say something *true* about an accepted solve
 * rather than "Solved". On the file this split came from, `before` was 14.367°
 * and `after` was 0.00747° — a 1,900x improvement, and still ~7,500x above
 * CAMV's `Epsilon::FLAT` of 1e-6°, so every one of the 70 foldability markers
 * survived it and the editor looked untouched.
 *
 * The odd-degree counts are the other half of that sentence: three went in and
 * three came out. A vertex with an odd number of creases is structurally
 * unfoldable, so no amount of solving clears it — it is repair work, which is
 * what makes "N vertices still fail the check" the actionable part.
 */
export interface CpExactSolveResiduals {
  /** Worst Kawasaki angle residual over all interior vertices, in degrees. */
  maxKawasakiDegreesBefore: number;
  maxKawasakiDegreesAfter: number;
  /** Interior vertices with an odd crease count — never solvable, only repairable. */
  oddDegreeVerticesBefore: number;
  oddDegreeVerticesAfter: number;
}

/** The two endings the solver accepted, which differ only in whether it is exact. */
interface CpExactSolveAcceptedFields {
  stage: CpExactSolveStage;
  /** Vertices whose position changed, for the "45 vertices moved" line. */
  movedVertices: readonly CpExactSolveMovedVertex[];
  /** The largest single displacement, in model units. */
  maxMovement: number;
  elapsedSeconds: number;
  /**
   * What the solve actually changed, or null when the report did not carry it.
   *
   * Null rather than zeroes on purpose: `0` is a legitimate residual — it is
   * what a perfect solve reports — so a missing report filled in with zeroes
   * reads as "already exact", the most wrong sentence available.
   */
  residuals: CpExactSolveResiduals | null;
  /**
   * Whether the refinement stage's polish loop kept any of its rounds.
   *
   * Read from `movement_report.polish.rounds_adopted`, which the solver reports
   * structurally. It also renders as a `+polish(rounds=N)` suffix on
   * `termination`, and {@link polishWasAdopted} falls back to parsing that when
   * the `polish` object is absent — but the count is the authority, because the
   * suffix is a rendering of it and only exists when N > 0.
   *
   * **Why a round was refused is in `polish.refused_round`**, including the
   * acceptance-gate tokens verbatim and the residual the round would have
   * reached. That refusal is usually the *better* answer on angle alone; it was
   * thrown away because it broke a geometric invariant, so it is a thing to
   * explain rather than a thing to adopt.
   */
  polishAdopted: boolean;
}

/**
 * What happened, in the five kinds the user has to be told apart.
 *
 * `solved`, `ambiguous` and `timeout` all leave geometry on the table;
 * `rejected` and `malformed` leave none, because on every non-acceptance the
 * solver returns the *input* coordinates — the document is unchanged and there
 * is nothing to revert.
 */
export type CpExactSolveOutcome =
  | ({
      /**
       * Exact: `ExactSolvedGraphStatus::Solved`. No odd-degree vertices left and
       * the worst residual is inside `solved_kawasaki_epsilon_degrees`.
       */
      kind: 'solved';
    } & CpExactSolveAcceptedFields)
  | ({
      /**
       * `ExactSolvedGraphStatus::Ambiguous` — **accepted and better, but not at
       * foldable precision**.
       *
       * This is not a lesser flavour of success and must never be reported as
       * one. The solver declined to call it solved, and the foldability checker
       * that runs afterwards agrees: a pattern landing three orders of magnitude
       * above the flat-fold epsilon still fails every angle check it failed
       * before, so a UI saying "Solved" over an editor full of unchanged markers
       * is telling the user the checker is broken.
       *
       * The usual cause is topology the solve cannot fix — an odd-degree vertex
       * survives any amount of angle-fitting — which is what the repair flow is
       * for. {@link CpExactSolveAcceptedFields.residuals} carries both counts so
       * a surface can say so.
       */
      kind: 'ambiguous';
    } & CpExactSolveAcceptedFields)
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

/** An accepted solve, of either exactness. */
export type CpExactSolveAcceptedOutcome = Extract<
  CpExactSolveOutcome,
  { kind: 'solved' | 'ambiguous' }
>;

/**
 * Whether the solver kept its answer — which is **not** "is it foldable".
 *
 * Both accepted kinds return true, so this deliberately puts back together what
 * {@link classifyCpExactSolve} split. Use it only where the question really is
 * acceptance: the staged runner's decision to spend the refinement stage, and
 * reading the moved-vertex fields the two kinds share. Anything the user reads
 * must branch on `kind`, because "we improved it" and "it is exact now" are
 * different sentences and only one of them is "Solved".
 */
export function isCpExactSolveAccepted(
  outcome: CpExactSolveOutcome
): outcome is CpExactSolveAcceptedOutcome {
  return outcome.kind === 'solved' || outcome.kind === 'ambiguous';
}

/** The single reason to show first, or null when there is nothing to explain. */
export function primaryCpExactSolveReason(
  outcome: CpExactSolveOutcome
): CpExactSolveReason | null {
  switch (outcome.kind) {
    case 'solved':
      return null;
    case 'ambiguous':
      // Not null. A caller reading null as "nothing went wrong" would print
      // nothing over a pattern that still fails every check it failed before;
      // one reading it as "no reason available" falls through to its own
      // fallback, which is how an ambiguous solve gets explained as malformed
      // input. The sentence for this token says what actually happened.
      return 'above_fold_precision';
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
 * One side of the theorem report, or null if it is not the shape we think.
 *
 * Both fields are required together because `analysis_json` writes them
 * together: half of the pair present means the payload is not the report, and
 * inventing the other half is how a made-up number reaches a sentence.
 */
function readAnalysis(analysis: CpExactSolveAnalysis | undefined) {
  if (!analysis || typeof analysis !== 'object') return null;
  const kawasaki = analysis.max_kawasaki_residual_degrees;
  const oddDegree = analysis.odd_degree_vertices;
  if (typeof kawasaki !== 'number' || !Number.isFinite(kawasaki)) return null;
  if (!Array.isArray(oddDegree)) return null;
  return { kawasaki, oddDegree: oddDegree.length };
}

/**
 * The before/after figures a completion sentence is built from, or null.
 *
 * Read off `theorem_residual_report` rather than recomputed: these are the
 * solver's own measurements, taken on the geometry it actually returned, and a
 * second implementation over `vertices_exact` would be a different number under
 * the same name.
 */
export function cpExactSolveResiduals(
  solved: CpExactSolvedGraph
): CpExactSolveResiduals | null {
  const report = solved.theorem_residual_report;
  const before = readAnalysis(report?.before);
  const after = readAnalysis(report?.after);
  if (!before || !after) return null;
  return {
    maxKawasakiDegreesBefore: before.kawasaki,
    maxKawasakiDegreesAfter: after.kawasaki,
    oddDegreeVerticesBefore: before.oddDegree,
    oddDegreeVerticesAfter: after.oddDegree,
  };
}

/**
 * `sparse_ftol+polish(rounds=3)` — the suffix is written only for rounds that
 * were kept, so no suffix means the polish ran and was thrown away, not that it
 * never ran. Parsed rather than matched on the whole string because the prefix
 * is the LM termination and the timeout wrapper nests the lot.
 */
const POLISH_ROUNDS_PATTERN = /\+polish\(rounds=(\d+)\)/;

/**
 * Whether any polish round survived, from the count first and the string second.
 *
 * `polish.rounds_adopted` is the solver's own tally and is emitted on every run;
 * the `termination` suffix is a rendering of that same number which exists only
 * when it is non-zero. Preferring the count means a report that grows a new
 * termination prefix — the timeout wrapper already nests one — cannot silently
 * turn an adopted polish into "not adopted". The suffix stays as a fallback so a
 * report predating the `polish` object still reads correctly.
 */
function polishWasAdopted(report: CpExactSolveMovementReport): boolean {
  const adopted = report.polish?.rounds_adopted;
  if (typeof adopted === 'number' && Number.isFinite(adopted)) return adopted > 0;
  const termination = report.termination;
  if (typeof termination !== 'string') return false;
  const match = POLISH_ROUNDS_PATTERN.exec(termination);
  return match !== null && Number(match[1]) > 0;
}

/**
 * Read an `ExactSolvedGraph` into the five endings above.
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
 * 3. **`accepted`**, which is the solver's own verdict on whether to keep the
 *    answer — and then, *within* it, `status`, which is its verdict on whether
 *    the answer is exact. Those are two different questions and the struct
 *    answers both; reading only the first is how a run that landed ~7,500x
 *    above the flat-fold epsilon was reported as "Solved" while the editor
 *    showed 70 unchanged foldability errors.
 *
 * `accepted` implies `status` is `solved` or `ambiguous` — a `failed` candidate
 * is rejected with `candidate_status_failed` — so the `else` reads as ambiguous.
 * That is the safe direction if the solver ever widens the gate: it under-claims.
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
      kind: solved.status === 'solved' ? 'solved' : 'ambiguous',
      stage,
      movedVertices: movedVertices(report, 'moved_vertices'),
      maxMovement: finiteNumber(report.max_vertex_movement),
      elapsedSeconds,
      residuals: cpExactSolveResiduals(solved),
      polishAdopted: polishWasAdopted(report),
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
