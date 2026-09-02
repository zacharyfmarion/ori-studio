/**
 * Reading the solver's four endings apart.
 *
 * Every fixture below is the literal shape `exact_solve.rs` emits, not a
 * convenient simplification — the whole point of `classifyCpExactSolve` is that
 * two of those shapes are missing the field a naive reader would consult, and a
 * fixture that filled them in would test nothing.
 */
import { describe, expect, it } from 'vitest';
import {
  CP_EXACT_SOLVE_GATE_REASONS,
  CP_EXACT_SOLVE_PREFLIGHT_REASONS,
  CP_EXACT_SOLVE_REASONS,
  classifyCpExactSolve,
  cpExactSolveAngleFamily,
  cpExactSolveResiduals,
  isCpExactSolveAccepted,
  isCpExactSolveReason,
  primaryCpExactSolveReason,
  type CpExactSolveMovementReport,
  type CpExactSolveStatus,
  type CpExactSolveTheoremReport,
  type CpExactSolvedGraph,
} from './cpExactSolveTypes';

function graph(
  movement_report: CpExactSolveMovementReport,
  status: CpExactSolveStatus = 'failed',
  theorem_residual_report: CpExactSolveTheoremReport = {}
): CpExactSolvedGraph {
  return {
    schema: 'oristudio/cp-compiler/exact-solved-graph-v1',
    vertices_exact: [{ x: 0, y: 0 }],
    edges_exact: [],
    movement_report,
    theorem_residual_report,
    status,
  };
}

/**
 * `theorem_residual_report` as measured on `mid-solve_2.osf` — the file whose
 * "Solved" verdict sat over 71 unchanged foldability errors. 14.367° down to
 * 0.00747° is a 1,900x improvement and still ~7,500x above the 1e-6° the
 * checker wants, and the three odd-degree vertices went in and came back out.
 */
const MID_SOLVE_RESIDUALS: CpExactSolveTheoremReport = {
  schema: 'oristudio/cp-compiler/exact-solve-theorem-report-v1',
  before: { max_kawasaki_residual_degrees: 14.367, odd_degree_vertices: [11, 42, 87] },
  after: { max_kawasaki_residual_degrees: 0.00747, odd_degree_vertices: [11, 42, 87] },
};

const MOVED = [
  { vertex_id: 3, before: { x: 0, y: 0 }, after: { x: 0.01, y: 0 }, movement: 0.01 },
  { vertex_id: 7, before: { x: 1, y: 1 }, after: { x: 1, y: 1.02 }, movement: 0.02 },
];

describe('classifyCpExactSolve', () => {
  it('reads an exactly solved run, with what moved and how far', () => {
    const outcome = classifyCpExactSolve(
      graph(
        {
          timed_out: false,
          accepted: true,
          rejection_reasons: [],
          termination: 'sparse_ftol+polish(rounds=3)',
          elapsed_seconds: 3.5,
          max_vertex_movement: 0.02,
          moved_vertices: MOVED,
          attempted_moved_vertices: MOVED,
        },
        'solved'
      ),
      'refinement'
    );

    expect(outcome).toEqual({
      kind: 'solved',
      stage: 'refinement',
      movedVertices: MOVED,
      // The solved geometry rides along beside the report, because the report is
      // not a placement channel: it is filtered on the solver's own start and end
      // points, and some vertices are finished after that comparison is taken.
      verticesExact: [{ x: 0, y: 0 }],
      maxMovement: 0.02,
      elapsedSeconds: 3.5,
      residuals: null,
      angleFamily: null,
      polishAdopted: true,
    });
    expect(primaryCpExactSolveReason(outcome)).toBeNull();
  });

  it('does not call an accepted-but-ambiguous run solved', () => {
    // The bug this split exists for. `accepted` is the solver's verdict on
    // whether to KEEP the answer; `status` is its verdict on whether the answer
    // is exact. Reading only the first reported a run that landed ~7,500x above
    // the flat-fold epsilon as "Solved", over an editor showing seventy
    // untouched angle errors.
    const outcome = classifyCpExactSolve(
      graph({ timed_out: false, accepted: true, rejection_reasons: [] }, 'ambiguous'),
      'refinement'
    );

    expect(outcome.kind).toBe('ambiguous');
    expect(isCpExactSolveAccepted(outcome)).toBe(true);
  });

  it('explains an ambiguous run rather than leaving the caller with no reason', () => {
    // A null here is read by callers as "nothing to say" and falls through to
    // their own fallback — which in the region chip is the malformed-input
    // sentence, i.e. a different lie replacing the first one.
    const outcome = classifyCpExactSolve(
      graph({ timed_out: false, accepted: true, rejection_reasons: [] }, 'ambiguous'),
      'refinement'
    );

    expect(primaryCpExactSolveReason(outcome)).toBe('above_fold_precision');
  });

  it('reads an accepted-with-failed-status run as ambiguous, never as solved', () => {
    // Not a shape the solver emits today — `candidate_status_failed` rejects it
    // — so this pins the direction the `else` falls in if the gate ever widens.
    const outcome = classifyCpExactSolve(
      graph({ timed_out: false, accepted: true, rejection_reasons: [] }, 'failed'),
      'refinement'
    );

    expect(outcome.kind).toBe('ambiguous');
  });

  it('carries the before and after figures a completion sentence is built from', () => {
    const outcome = classifyCpExactSolve(
      graph(
        { timed_out: false, accepted: true, rejection_reasons: [], termination: 'sparse_ftol' },
        'ambiguous',
        MID_SOLVE_RESIDUALS
      ),
      'refinement'
    );

    expect(outcome.kind === 'ambiguous' && outcome.residuals).toEqual({
      maxKawasakiDegreesBefore: 14.367,
      maxKawasakiDegreesAfter: 0.00747,
      oddDegreeVerticesBefore: 3,
      oddDegreeVerticesAfter: 3,
      bigLittleBigViolationsBefore: null,
      bigLittleBigViolationsAfter: null,
    });
    // No `+polish(rounds=N)` suffix on an accepted solve: the polish loop ran
    // and every round it computed was refused by the acceptance gate.
    expect(outcome.kind === 'ambiguous' && outcome.polishAdopted).toBe(false);
  });

  it('takes the polish count from the report, not from the termination string', () => {
    // The two signals are one number rendered twice, so they only disagree when
    // the string is wrong — which is the case worth pinning, because the string
    // is the one that can silently break. `termination` already gets a prefix
    // from the LM and another from the timeout wrapper; a third that happened to
    // contain the suffix, or a suffix that stopped being appended, would flip
    // this to a lie about the solve. `polish.rounds_adopted` is the tally.
    const adopted = classifyCpExactSolve(
      graph(
        {
          timed_out: false,
          accepted: true,
          rejection_reasons: [],
          termination: 'sparse_ftol',
          polish: { stop_reason: 'max_rounds', rounds_attempted: 6, rounds_adopted: 6 },
        },
        'solved'
      ),
      'refinement'
    );
    expect(adopted.kind === 'solved' && adopted.polishAdopted).toBe(true);

    const refused = classifyCpExactSolve(
      graph(
        {
          timed_out: false,
          accepted: true,
          rejection_reasons: [],
          termination: 'sparse_ftol+polish(rounds=3)',
          polish: {
            stop_reason: 'round_refused',
            rounds_attempted: 1,
            rounds_adopted: 0,
            refused_round: {
              kawasaki_degrees: 8e-4,
              kawasaki_regressed: false,
              rejection_reasons: ['movement_budget_exceeded'],
            },
          },
        },
        'ambiguous'
      ),
      'refinement'
    );
    expect(refused.kind === 'ambiguous' && refused.polishAdopted).toBe(false);
  });

  it('still reads the termination suffix when there is no polish object', () => {
    // A report that predates `movement_report.polish` — the fallback exists so
    // one does not read as "polish never ran".
    const outcome = classifyCpExactSolve(
      graph(
        {
          timed_out: false,
          accepted: true,
          rejection_reasons: [],
          termination: 'sparse_ftol+polish(rounds=2)',
        },
        'solved'
      ),
      'refinement'
    );
    expect(outcome.kind === 'solved' && outcome.polishAdopted).toBe(true);
  });

  it('reports missing residuals as null rather than as zeroes', () => {
    // `0` is what a perfect solve measures, so a filled-in zero reads as
    // "already exact" — the most wrong sentence available.
    const outcome = classifyCpExactSolve(
      graph({ timed_out: false, accepted: true, rejection_reasons: [] }, 'ambiguous'),
      'refinement'
    );

    expect(outcome.kind === 'ambiguous' && outcome.residuals).toBeNull();
  });

  it('tells the two accepted kinds apart while agreeing they were accepted', () => {
    const solved = classifyCpExactSolve(
      graph({ accepted: true, rejection_reasons: [] }, 'solved'),
      'refinement'
    );
    const rejected = classifyCpExactSolve(
      graph({ accepted: false, rejection_reasons: ['objective_not_improved'] }),
      'geometry'
    );

    expect(isCpExactSolveAccepted(solved)).toBe(true);
    expect(isCpExactSolveAccepted(rejected)).toBe(false);
  });

  it('reports a rejection by its tokens', () => {
    const outcome = classifyCpExactSolve(
      graph({
        timed_out: false,
        accepted: false,
        rejection_reasons: ['movement_budget_exceeded', 'objective_not_improved'],
        elapsed_seconds: 0.4,
      }),
      'geometry'
    );

    expect(outcome).toMatchObject({
      kind: 'rejected',
      stage: 'geometry',
      reasons: ['movement_budget_exceeded', 'objective_not_improved'],
    });
    expect(primaryCpExactSolveReason(outcome)).toBe('movement_budget_exceeded');
  });

  it('drops a token it has no sentence for rather than surfacing it raw', () => {
    const outcome = classifyCpExactSolve(
      graph({
        timed_out: false,
        accepted: false,
        rejection_reasons: ['some_future_gate', 'degenerate_edges_worsened'],
      }),
      'geometry'
    );

    expect(outcome.kind === 'rejected' && outcome.reasons).toEqual(['degenerate_edges_worsened']);
  });

  it('calls a timeout a timeout on the boolean, never on the reason string', () => {
    // The trap this exists for: a timed-out run also carries a
    // `rejection_reasons` entry, and it is a formatted sentence with a number in
    // it. Matched as a token it is unrecognised; matched by substring it is a
    // parser of prose. `timed_out` is the field that means it.
    const outcome = classifyCpExactSolve(
      graph({
        timed_out: true,
        accepted: false,
        rejection_reasons: ['exact solve timed out after 25.000s'],
        timeout_seconds: 25,
        elapsed_seconds: 25.03,
        moved_vertices: [],
        attempted_moved_vertices: MOVED,
        attempted_max_vertex_movement: 0.02,
      }),
      'refinement'
    );

    expect(outcome).toEqual({
      kind: 'timeout',
      stage: 'refinement',
      partialMovedVertices: MOVED,
      partialMaxMovement: 0.02,
      timeoutSeconds: 25,
      elapsedSeconds: 25.03,
    });
    expect(primaryCpExactSolveReason(outcome)).toBe('timeout');
  });

  it('offers the partial from attempted_moved_vertices, not from moved_vertices', () => {
    // On a timeout `moved_vertices` is empty — the solver returned the input
    // coordinates — so a UI reading it would say "0 vertices moved" over a run
    // that did real work and has a partial worth taking.
    const outcome = classifyCpExactSolve(
      graph({ timed_out: true, moved_vertices: [], attempted_moved_vertices: MOVED }),
      'refinement'
    );

    expect(outcome.kind === 'timeout' && outcome.partialMovedVertices).toHaveLength(2);
  });

  it('recognises the malformed shape, which carries no rejection_reasons at all', () => {
    // `{status: "not_run", blockers: [...]}`. A surface reading only
    // `rejection_reasons` shows "no reason" here, which is the specific failure
    // this branch exists to prevent.
    const outcome = classifyCpExactSolve(
      graph({
        status: 'not_run',
        blockers: [
          'boundary references missing corner vertex 400',
          'selected span 12 references missing vertex 300',
        ],
      }),
      'geometry'
    );

    expect(outcome).toEqual({ kind: 'malformed', stage: 'geometry', blockerCount: 2 });
    expect(primaryCpExactSolveReason(outcome)).toBe('malformed_input');
  });

  it('does not mistake a malformed run for an untimed rejection', () => {
    // Both `timed_out` and `accepted` are absent from the not_run shape, so
    // testing them first reads "not timed out, not accepted" and reports a
    // rejection with an empty reason list. Malformed has to be checked first.
    const outcome = classifyCpExactSolve(graph({ status: 'not_run', blockers: ['x'] }), 'geometry');
    expect(outcome.kind).not.toBe('rejected');
  });

  it('treats a blockers-only report as malformed even without the status field', () => {
    const outcome = classifyCpExactSolve(graph({ blockers: ['x', 'y', 'z'] }), 'geometry');
    expect(outcome).toMatchObject({ kind: 'malformed', blockerCount: 3 });
  });

  it('survives a report with none of the numeric fields', () => {
    const outcome = classifyCpExactSolve(
      graph({ accepted: true, rejection_reasons: [] }, 'solved'),
      'geometry'
    );
    expect(outcome).toMatchObject({ kind: 'solved', maxMovement: 0, elapsedSeconds: 0 });
    expect(outcome.kind === 'solved' && outcome.movedVertices).toEqual([]);
  });
});

describe('cpExactSolveResiduals', () => {
  function report(theorem: CpExactSolveTheoremReport) {
    return cpExactSolveResiduals(graph({ accepted: true }, 'ambiguous', theorem));
  }

  it('round-trips both sides of the theorem report', () => {
    expect(report(MID_SOLVE_RESIDUALS)).toEqual({
      maxKawasakiDegreesBefore: 14.367,
      maxKawasakiDegreesAfter: 0.00747,
      oddDegreeVerticesBefore: 3,
      oddDegreeVerticesAfter: 3,
      bigLittleBigViolationsBefore: null,
      bigLittleBigViolationsAfter: null,
    });
  });

  it('keeps a genuine zero, which is what an exact solve measures', () => {
    expect(
      report({
        before: { max_kawasaki_residual_degrees: 0.4, odd_degree_vertices: [] },
        after: { max_kawasaki_residual_degrees: 0, odd_degree_vertices: [] },
      })
    ).toMatchObject({ maxKawasakiDegreesAfter: 0, oddDegreeVerticesAfter: 0 });
  });

  it('refuses a half-written side rather than inventing the other half', () => {
    // `analysis_json` writes both fields together, so one without the other
    // means the payload is not the report we think it is.
    expect(report({ before: MID_SOLVE_RESIDUALS.before, after: { odd_degree_vertices: [] } })).toBeNull();
    expect(report({ before: MID_SOLVE_RESIDUALS.before })).toBeNull();
    expect(report({})).toBeNull();
  });
});

describe('the reason vocabulary', () => {
  it('is the nine solver tokens plus the three endings it writes no token for', () => {
    expect(CP_EXACT_SOLVE_PREFLIGHT_REASONS).toHaveLength(2);
    expect(CP_EXACT_SOLVE_GATE_REASONS).toHaveLength(7);
    expect(CP_EXACT_SOLVE_REASONS).toHaveLength(12);
    expect(CP_EXACT_SOLVE_REASONS).toContain('timeout');
    expect(CP_EXACT_SOLVE_REASONS).toContain('malformed_input');
    expect(CP_EXACT_SOLVE_REASONS).toContain('above_fold_precision');
  });

  it('recognises every token it lists and nothing else', () => {
    for (const reason of CP_EXACT_SOLVE_REASONS) expect(isCpExactSolveReason(reason)).toBe(true);
    expect(isCpExactSolveReason('preflight_degenerate_edge')).toBe(false);
    expect(isCpExactSolveReason('')).toBe(false);
  });
});

describe('cpExactSolveAngleFamily', () => {
  const solvedWith = (movement_report: CpExactSolveMovementReport): CpExactSolvedGraph =>
    ({
      schema: 'test',
      vertices_exact: [],
      edges_exact: [],
      movement_report,
      theorem_residual_report: {},
      status: 'ambiguous',
    }) as CpExactSolvedGraph;

  it('is null when the report has no grid block', () => {
    expect(cpExactSolveAngleFamily(solvedWith({}))).toBeNull();
    expect(cpExactSolveAngleFamily(solvedWith({ polish: { pinned_family: null } }))).toBeNull();
    expect(cpExactSolveAngleFamily(solvedWith({ polish: { pinned_family: {} } }))).toBeNull();
  });

  it('reads the last attempt, which is the one that was judged', () => {
    const family = cpExactSolveAngleFamily(
      solvedWith({
        polish: {
          pinned_family: {
            step_degrees: 22.5,
            carriers: 328,
            adopted: false,
            stop_reason: 'refused',
            attempts: [
              { tolerance_degrees: 1.5, refusals: ['candidate_status_failed'], kawasaki_over_bar: 165 },
              { tolerance_degrees: 0.75, refusals: ['pinned_kawasaki_regressed'], kawasaki_over_bar: 33 },
            ],
          },
        },
      })
    );
    expect(family).toEqual({
      stepDegrees: 22.5,
      adopted: false,
      stopReason: 'refused',
      refusals: ['pinned_kawasaki_regressed'],
      verticesOverBar: 33,
    });
  });

  it('reads an adopted snap', () => {
    const family = cpExactSolveAngleFamily(
      solvedWith({
        polish: {
          pinned_family: {
            step_degrees: 22.5,
            adopted: true,
            stop_reason: 'adopted',
            attempts: [{ tolerance_degrees: 1.5, refusals: [], kawasaki_over_bar: 0 }],
          },
        },
      })
    );
    expect(family?.adopted).toBe(true);
    expect(family?.stopReason).toBe('adopted');
    expect(family?.refusals).toEqual([]);
  });
});
