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
  isCpExactSolveReason,
  primaryCpExactSolveReason,
  type CpExactSolveMovementReport,
  type CpExactSolveStatus,
  type CpExactSolvedGraph,
} from './cpExactSolveTypes';

function graph(
  movement_report: CpExactSolveMovementReport,
  status: CpExactSolveStatus = 'failed'
): CpExactSolvedGraph {
  return {
    schema: 'oristudio/cp-compiler/exact-solved-graph-v1',
    vertices_exact: [{ x: 0, y: 0 }],
    edges_exact: [],
    movement_report,
    theorem_residual_report: {},
    status,
  };
}

const MOVED = [
  { vertex_id: 3, before: { x: 0, y: 0 }, after: { x: 0.01, y: 0 }, movement: 0.01 },
  { vertex_id: 7, before: { x: 1, y: 1 }, after: { x: 1, y: 1.02 }, movement: 0.02 },
];

describe('classifyCpExactSolve', () => {
  it('reads an accepted solve, with what moved and how far', () => {
    const outcome = classifyCpExactSolve(
      graph(
        {
          timed_out: false,
          accepted: true,
          rejection_reasons: [],
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
      status: 'solved',
      movedVertices: MOVED,
      maxMovement: 0.02,
      elapsedSeconds: 3.5,
    });
    expect(primaryCpExactSolveReason(outcome)).toBeNull();
  });

  it('accepts an ambiguous status the solver itself accepted', () => {
    // `accepted` is the solver's verdict and already accounts for status:
    // an `ambiguous` candidate that improved the objective passes the gate.
    // Reading `status === 'solved'` instead would reject a run the compiler kept.
    const outcome = classifyCpExactSolve(
      graph({ timed_out: false, accepted: true, rejection_reasons: [] }, 'ambiguous'),
      'refinement'
    );

    expect(outcome.kind).toBe('solved');
    expect(outcome.kind === 'solved' && outcome.status).toBe('ambiguous');
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
    const outcome = classifyCpExactSolve(graph({ accepted: true, rejection_reasons: [] }), 'geometry');
    expect(outcome).toMatchObject({ kind: 'solved', maxMovement: 0, elapsedSeconds: 0 });
    expect(outcome.kind === 'solved' && outcome.movedVertices).toEqual([]);
  });
});

describe('the reason vocabulary', () => {
  it('is the nine solver tokens plus the two endings it writes no token for', () => {
    expect(CP_EXACT_SOLVE_PREFLIGHT_REASONS).toHaveLength(2);
    expect(CP_EXACT_SOLVE_GATE_REASONS).toHaveLength(7);
    expect(CP_EXACT_SOLVE_REASONS).toHaveLength(11);
    expect(CP_EXACT_SOLVE_REASONS).toContain('timeout');
    expect(CP_EXACT_SOLVE_REASONS).toContain('malformed_input');
  });

  it('recognises every token it lists and nothing else', () => {
    for (const reason of CP_EXACT_SOLVE_REASONS) expect(isCpExactSolveReason(reason)).toBe(true);
    expect(isCpExactSolveReason('preflight_degenerate_edge')).toBe(false);
    expect(isCpExactSolveReason('')).toBe(false);
  });
});
