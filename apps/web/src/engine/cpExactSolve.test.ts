/**
 * The two-stage run: which calls happen, in which order, with which options, and
 * what stops the second one from happening.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCpExactSolve, type CpExactSolver } from './cpExactSolve';
import type {
  CpExactSolveFoldResult,
  CpExactSolveMovementReport,
  CpExactSolvedGraph,
} from './cpExactSolveTypes';

const track = vi.hoisted(() => vi.fn());
vi.mock('../analytics', () => ({ track }));

function graph(movement_report: CpExactSolveMovementReport): CpExactSolvedGraph {
  return {
    schema: 'oristudio/cp-compiler/exact-solved-graph-v1',
    vertices_exact: [],
    edges_exact: [],
    movement_report,
    theorem_residual_report: {},
    status: movement_report.accepted ? 'solved' : 'failed',
  };
}

const ACCEPTED: CpExactSolveMovementReport = {
  timed_out: false,
  accepted: true,
  rejection_reasons: [],
  elapsed_seconds: 0.4,
  max_vertex_movement: 0.003,
  moved_vertices: [
    { vertex_id: 1, before: { x: 0, y: 0 }, after: { x: 0.003, y: 0 }, movement: 0.003 },
  ],
};

const REJECTED: CpExactSolveMovementReport = {
  timed_out: false,
  accepted: false,
  rejection_reasons: ['movement_budget_exceeded'],
  elapsed_seconds: 0.3,
};

const FOLD = { vertices_coords: [[0, 0]], edges_vertices: [] };

function solver(
  stage1: CpExactSolveMovementReport,
  stage2: CpExactSolveMovementReport = stage1
): CpExactSolver & {
  solveExact: ReturnType<typeof vi.fn>;
  solveExactToFold: ReturnType<typeof vi.fn>;
} {
  return {
    solveExact: vi.fn(async () => graph(stage1)),
    solveExactToFold: vi.fn(
      async (): Promise<CpExactSolveFoldResult> => ({
        schema: 'oristudio/cp-detect/solve-exact-fold-v1',
        solved: graph(stage2),
        fold: FOLD,
      })
    ),
  };
}

beforeEach(() => {
  track.mockClear();
});

describe('runCpExactSolve', () => {
  it('names both stages, in order, on a solve that gets there', async () => {
    const stages: string[] = [];
    const fake = solver(ACCEPTED);

    const run = await runCpExactSolve(
      { vertices: [] },
      { solver: async () => fake, onStage: (stage) => stages.push(stage) }
    );

    expect(stages).toEqual(['geometry', 'refinement']);
    expect(run.outcome.kind).toBe('solved');
    expect(run.fold).toBe(FOLD);
  });

  it('never enters refinement when geometry is refused', async () => {
    // The saving that makes the split affordable: the second call redoes the
    // first, so it must not happen on the path where the first already answered.
    const stages: string[] = [];
    const fake = solver(REJECTED);

    const run = await runCpExactSolve(
      { vertices: [] },
      { solver: async () => fake, onStage: (stage) => stages.push(stage) }
    );

    expect(stages).toEqual(['geometry']);
    expect(fake.solveExactToFold).not.toHaveBeenCalled();
    expect(run.outcome).toMatchObject({ kind: 'rejected', stage: 'geometry' });
  });

  it('runs geometry with polish off and refinement with it on', async () => {
    // Stage 1 exists to answer "would this be accepted", which is exactly the
    // question `polish: false` asks. Leaving polish on would make it the whole
    // solve and the split pointless.
    const fake = solver(ACCEPTED);
    await runCpExactSolve({ vertices: [] }, { solver: async () => fake, timeoutSeconds: 12 });

    expect(JSON.parse(fake.solveExact.mock.calls[0][1] as string)).toEqual({
      polish: false,
      timeout_seconds: 12,
    });
    expect(JSON.parse(fake.solveExactToFold.mock.calls[0][1] as string)).toEqual({
      polish: true,
      timeout_seconds: 12,
    });
  });

  it('omits timeout_seconds entirely when the caller has no opinion', async () => {
    // An omitted field inherits the Rust default; sending a guessed number here
    // would be this file quietly owning the solver's budget.
    const fake = solver(ACCEPTED);
    await runCpExactSolve({ vertices: [] }, { solver: async () => fake });

    expect(JSON.parse(fake.solveExact.mock.calls[0][1] as string)).toEqual({ polish: false });
  });

  it('sends the same input JSON to both stages', async () => {
    const fake = solver(ACCEPTED);
    await runCpExactSolve({ vertices: [{ id: 0 }] }, { solver: async () => fake });

    expect(fake.solveExact.mock.calls[0][0]).toBe('{"vertices":[{"id":0}]}');
    expect(fake.solveExactToFold.mock.calls[0][0]).toBe(fake.solveExact.mock.calls[0][0]);
  });

  it('passes a pre-serialized input through untouched', async () => {
    const fake = solver(ACCEPTED);
    await runCpExactSolve('{"already":"json"}', { solver: async () => fake });

    expect(fake.solveExact.mock.calls[0][0]).toBe('{"already":"json"}');
  });

  it('reports a refinement timeout at that stage, with no fold to apply', async () => {
    const fake = solver(ACCEPTED, {
      timed_out: true,
      accepted: false,
      rejection_reasons: ['exact solve timed out after 25.000s'],
      timeout_seconds: 25,
      attempted_moved_vertices: [
        { vertex_id: 4, before: { x: 0, y: 0 }, after: { x: 0.1, y: 0 }, movement: 0.1 },
      ],
    });

    const run = await runCpExactSolve({ vertices: [] }, { solver: async () => fake });

    expect(run.outcome).toMatchObject({ kind: 'timeout', stage: 'refinement' });
    // The solver returns the input coordinates on every non-acceptance, so the
    // FOLD from that call is the document the user already has. Handing it back
    // would apply "the result" and change nothing, silently.
    expect(run.fold).toBeNull();
  });

  it('rethrows a bridge failure instead of dressing it as a rejection', async () => {
    const fake = solver(ACCEPTED);
    fake.solveExact.mockRejectedValueOnce({ code: 'cp_detect', message: 'worker died' });

    await expect(runCpExactSolve({}, { solver: async () => fake })).rejects.toMatchObject({
      code: 'cp_detect',
    });
  });
});

describe('runCpExactSolve analytics', () => {
  it('reports the outcome once, with buckets and no geometry', async () => {
    await runCpExactSolve({ vertices: [] }, { solver: async () => solver(ACCEPTED) });

    expect(track).toHaveBeenCalledTimes(1);
    const [name, properties] = track.mock.calls[0];
    expect(name).toBe('cp exact solve completed');
    expect(properties).toMatchObject({
      verdict: 'solved',
      stage: 'refinement',
      reason: undefined,
      moved_vertices_bucket: '<=1',
    });
    expect(String(properties.duration_ms_bucket)).toMatch(/^(<=|>)\d+$/u);
  });

  it('carries the rejection token as an enum, never the solver prose', async () => {
    await runCpExactSolve({ vertices: [] }, { solver: async () => solver(REJECTED) });

    expect(track.mock.calls[0][1]).toMatchObject({
      verdict: 'rejected',
      stage: 'geometry',
      reason: 'movement_budget_exceeded',
    });
  });

  it('sends no blocker text on a malformed input, only the verdict', async () => {
    // The blockers name span and vertex indices — the user's geometry — so the
    // count stays on the outcome for the UI and never reaches an event.
    await runCpExactSolve(
      { vertices: [] },
      {
        solver: async () =>
          solver({ status: 'not_run', blockers: ['selected span 12 references missing vertex 300'] }),
      }
    );

    const properties = track.mock.calls[0][1] as Record<string, unknown>;
    expect(properties).toMatchObject({ verdict: 'malformed', reason: 'malformed_input' });
    expect(JSON.stringify(properties)).not.toContain('span');
  });

  it('reports a bridge failure as its own verdict', async () => {
    const fake = solver(ACCEPTED);
    fake.solveExact.mockRejectedValueOnce(new Error('boom'));

    await expect(runCpExactSolve({}, { solver: async () => fake })).rejects.toThrow('boom');
    expect(track.mock.calls[0][1]).toMatchObject({ verdict: 'error' });
  });
});
