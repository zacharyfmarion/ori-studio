/**
 * Reading a decode report apart into "was the solve attempted" and "which
 * coordinates does this FOLD carry".
 *
 * The shapes below are the `json!` literals in
 * `crates/oristudio-cp-detect/src/decode.rs`, trimmed to the keys these readers
 * touch. What is being asserted is that neither question is ever answered by the
 * absence of a key.
 */
import { describe, expect, it } from 'vitest';
import {
  cpDetectCandidateSourceFromFold,
  cpDetectSolveInput,
  cpDetectSolveState,
  cpDetectTopologyDiagnostics,
  type CpDetectDecodeReport,
} from './cpDetectTypes';

function report(compilerReport: Record<string, unknown> | null): CpDetectDecodeReport {
  return {
    status: 'valid',
    decoder_backend: 'legacy_candidate_exact_solve_v1',
    image_size: 1024,
    threshold: 0.5,
    line_count: 0,
    carrier_count: 0,
    vertex_count: 0,
    edge_count: 0,
    border_edge_count: 0,
    interior_edge_count: 0,
    warnings: [],
    quality_report: compilerReport ? { compiler_report: compilerReport } : {},
  };
}

const RECOGNIZED = {
  exact_solve_input: { vertices: [{ id: 0 }] },
  topology_diagnostics: {
    schema: 'oristudio/cp-compiler/topology-diagnostics-v1',
    blockers: [],
    combinatorial: {
      odd_degree_vertices: [4, 9],
      degree_two_vertices: [],
      maekawa_failures: [],
      degenerate_edges: [],
      unmodeled_crossings: [[2, 7]],
      boundary_failures: [],
    },
    angle_dependent: { max_kawasaki_residual_degrees: 4.25, max_carrier_residual: 0.002 },
    vertices: [],
  },
  solve: {
    attempted: false,
    reason: 'recognize_only',
    budget: {
      total_seconds: 25,
      spent_seconds: 0,
      policy: 'shared_total_across_staged_solve_calls',
    },
  },
};

describe('cpDetectSolveState', () => {
  it('reads "never attempted" from the report saying so, with the budget it owes', () => {
    expect(cpDetectSolveState(report(RECOGNIZED))).toEqual({
      attempted: false,
      reason: 'recognize_only',
      budget: {
        totalSeconds: 25,
        spentSeconds: 0,
        policy: 'shared_total_across_staged_solve_calls',
      },
    });
  });

  it('reads "attempted" from the fused path, which writes a whole solve block', () => {
    // The fused report has no `solve` key. The positive statement there is the
    // `exact_solve` result itself, not the absence of anything.
    expect(cpDetectSolveState(report({ exact_solve: { status: 'failed' } }))).toEqual({
      attempted: true,
    });
  });

  it('says nothing when the report says nothing, rather than guessing "not attempted"', () => {
    // A different decoder backend, an older build, or a stale wasm bridge. Every
    // one of those would read as "recognized, ready to repair" if absence meant
    // no, and the user would be handed solved geometry to hand-repair.
    expect(cpDetectSolveState(report({ backend: 'legacy_v2_decoder' }))).toBeNull();
    expect(cpDetectSolveState(report(null))).toBeNull();
    expect(cpDetectSolveState(null)).toBeNull();
  });

  it('survives a budget block with the wrong shapes', () => {
    const state = cpDetectSolveState(
      report({ solve: { attempted: false, budget: { total_seconds: 'soon' } } })
    );
    expect(state).toEqual({
      attempted: false,
      reason: 'unspecified',
      budget: { totalSeconds: 0, spentSeconds: 0, policy: '' },
    });
  });
});

describe('cpDetectSolveInput and cpDetectTopologyDiagnostics', () => {
  it('lift the seam and the worklist out of the compiler report', () => {
    expect(cpDetectSolveInput(report(RECOGNIZED))).toEqual({ vertices: [{ id: 0 }] });
    expect(cpDetectTopologyDiagnostics(report(RECOGNIZED))?.combinatorial.odd_degree_vertices)
      .toEqual([4, 9]);
  });

  it('are null on a report that carries neither', () => {
    expect(cpDetectSolveInput(report({}))).toBeNull();
    expect(cpDetectTopologyDiagnostics(report({}))).toBeNull();
  });
});

describe('cpDetectCandidateSourceFromFold', () => {
  it("reads the exporter's own statement of which coordinates it wrote", () => {
    expect(
      cpDetectCandidateSourceFromFold(JSON.stringify({ cp_detector: { source: 'exact_solve' } }))
    ).toBe('exact_solve');
    expect(
      cpDetectCandidateSourceFromFold(
        JSON.stringify({ cp_detector: { source: 'exact_solve_candidate' } })
      )
    ).toBe('exact_solve_candidate');
  });

  it('is null on anything it does not recognise, including unparseable text', () => {
    expect(cpDetectCandidateSourceFromFold('{')).toBeNull();
    expect(cpDetectCandidateSourceFromFold(JSON.stringify({ vertices_coords: [] }))).toBeNull();
    expect(
      cpDetectCandidateSourceFromFold(JSON.stringify({ cp_detector: { source: 'something' } }))
    ).toBeNull();
  });
});
