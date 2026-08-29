/**
 * The two-stage run: which calls happen, in which order, with which options, and
 * what stops the second one from happening.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { remainingSolveBudget, runCpExactSolve, type CpExactSolver } from './cpExactSolve';
import {
  cpExactSolveRunFor,
  isCpExactSolveBusyError,
  requestCpExactSolveStop,
  resetCpExactSolveRuns,
} from './cpExactSolveRuns';
import {
  CpExactSolveCancelledError,
  isCpExactSolveCancelledError,
} from './cpExactSolveSession';
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
  resetCpExactSolveRuns();
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

    expect(JSON.parse(fake.solveExact.mock.calls[0][1] as string)).toMatchObject({
      polish: false,
    });
    expect(JSON.parse(fake.solveExactToFold.mock.calls[0][1] as string)).toMatchObject({
      polish: true,
    });
  });

  it('omits timeout_seconds entirely when the caller has no opinion', async () => {
    // An omitted field inherits the Rust default; sending a guessed number here
    // would be this file quietly owning the solver's budget.
    const fake = solver(ACCEPTED);
    await runCpExactSolve({ vertices: [] }, { solver: async () => fake });

    expect(JSON.parse(fake.solveExact.mock.calls[0][1] as string)).toEqual({ polish: false });
    expect(JSON.parse(fake.solveExactToFold.mock.calls[0][1] as string)).toEqual({ polish: true });
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

describe('the shared budget across the two stages', () => {
  function stageTimeouts(fake: ReturnType<typeof solver>): [unknown, unknown] {
    const parse = (json: unknown) => (JSON.parse(json as string) as Record<string, unknown>)
      .timeout_seconds;
    return [parse(fake.solveExact.mock.calls[0][1]), parse(fake.solveExactToFold.mock.calls[0][1])];
  }

  it('gives stage 2 what stage 1 left, not another full budget', async () => {
    // The divergence this exists to close: two bridge calls are two independent
    // deadlines, so handing each `timeoutSeconds` would let the staged flow run
    // for 2x the cap every measurement was taken against.
    const fake = solver({ ...ACCEPTED, elapsed_seconds: 4 });
    await runCpExactSolve({ vertices: [] }, { solver: async () => fake, timeoutSeconds: 25 });

    expect(stageTimeouts(fake)).toEqual([25, 21]);
  });

  it('floors the remainder at zero rather than going negative', async () => {
    // Negative means "no timeout", so an overrun must not be allowed to turn
    // into an unbounded second stage.
    const fake = solver({ ...ACCEPTED, elapsed_seconds: 30 });
    await runCpExactSolve({ vertices: [] }, { solver: async () => fake, timeoutSeconds: 25 });

    expect(stageTimeouts(fake)).toEqual([25, 0]);
  });

  it('passes a negative total through to both stages unchanged', async () => {
    // `-1` disables the deadline. Subtracting from it, or clamping it to 0,
    // would silently mean "time out immediately".
    const fake = solver({ ...ACCEPTED, elapsed_seconds: 4 });
    await runCpExactSolve({ vertices: [] }, { solver: async () => fake, timeoutSeconds: -1 });

    expect(stageTimeouts(fake)).toEqual([-1, -1]);
  });

  it('bills stage 1 on the solver clock, which works under wasm', () => {
    expect(remainingSolveBudget(25, 4)).toBe(21);
    expect(remainingSolveBudget(25, 25)).toBe(0);
    expect(remainingSolveBudget(undefined, 4)).toBeUndefined();
    expect(remainingSolveBudget(-1, 4)).toBe(-1);
    expect(remainingSolveBudget(0, 0)).toBe(0);
  });
});

describe('exempt_vertex_ids', () => {
  it('reaches both stages, deduplicated and ascending', async () => {
    const fake = solver(ACCEPTED);
    await runCpExactSolve(
      { vertices: [] },
      { solver: async () => fake, exemptVertexIds: [11, 3, 3] }
    );

    expect(JSON.parse(fake.solveExact.mock.calls[0][1] as string)).toMatchObject({
      exempt_vertex_ids: [3, 11],
    });
    expect(JSON.parse(fake.solveExactToFold.mock.calls[0][1] as string)).toMatchObject({
      exempt_vertex_ids: [3, 11],
    });
  });

  it('sends no key at all when there is nothing to exempt', async () => {
    // An empty set is exactly `solve_exact`, so an automatic solve's options stay
    // byte-identical to what they were before exemptions existed.
    const fake = solver(ACCEPTED);
    await runCpExactSolve({ vertices: [] }, { solver: async () => fake, exemptVertexIds: [] });

    expect(JSON.parse(fake.solveExact.mock.calls[0][1] as string)).toEqual({ polish: false });
  });
});

describe('run identity', () => {
  it('registers the run for its duration and reports the stage it is on', async () => {
    const seen: (string | null)[] = [];
    const fake = solver(ACCEPTED);
    fake.solveExact.mockImplementation(async () => {
      seen.push(cpExactSolveRunFor('region-1')?.stage ?? null);
      return graph(ACCEPTED);
    });

    const run = runCpExactSolve(
      { vertices: [] },
      { solver: async () => fake, run: { kind: 'region', targetId: 'region-1' } }
    );
    await run;

    expect(seen).toEqual(['geometry']);
    expect(cpExactSolveRunFor('region-1')).toBeUndefined();
  });

  it('refuses a second solve for the same target instead of queueing it silently', async () => {
    // One worker, one comlink queue: the second call would sit behind the first
    // for the whole of its budget, showing "Solving…" having not started.
    let releaseFirst = () => {};
    const fake = solver(ACCEPTED);
    fake.solveExact.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve(graph(ACCEPTED));
        })
    );

    const first = runCpExactSolve(
      { vertices: [] },
      { solver: async () => fake, run: { kind: 'region', targetId: 'region-1' } }
    );
    await vi.waitFor(() => expect(cpExactSolveRunFor('region-1')).toBeDefined());

    const second = runCpExactSolve(
      { vertices: [] },
      { solver: async () => fake, run: { kind: 'region', targetId: 'region-1' } }
    ).catch((error) => error);

    expect(isCpExactSolveBusyError(await second)).toBe(true);
    releaseFirst();
    await first;
  });

  it('clears the run when the solve throws', async () => {
    const fake = solver(ACCEPTED);
    fake.solveExact.mockRejectedValueOnce(new Error('boom'));

    await expect(
      runCpExactSolve(
        { vertices: [] },
        { solver: async () => fake, run: { kind: 'command', targetId: 'region-2' } }
      )
    ).rejects.toThrow('boom');
    expect(cpExactSolveRunFor('region-2')).toBeUndefined();
  });

  it('runs unregistered when no run descriptor is given', async () => {
    const fake = solver(ACCEPTED);
    await runCpExactSolve({ vertices: [] }, { solver: async () => fake });

    expect(cpExactSolveRunFor('region-1')).toBeUndefined();
  });
});

describe('cancellability, as published to the surface that offers Stop', () => {
  it('marks an injected-solver run un-cancellable, because there is nothing here to stop', async () => {
    // The degradation rule: a surface reads `cancellable` to decide whether to
    // render Stop at all, and this transport belongs to the caller. Saying yes
    // would be a button that does nothing.
    const fake = solver(ACCEPTED);
    let seen: boolean | null = null;
    fake.solveExact.mockImplementation(async () => {
      seen = cpExactSolveRunFor('region-1')?.cancellable ?? null;
      return graph(ACCEPTED);
    });

    await runCpExactSolve(
      { vertices: [] },
      { solver: async () => fake, run: { kind: 'region', targetId: 'region-1' } }
    );

    expect(seen).toBe(false);
  });

  it('refuses a stop against a run whose transport cannot be reached', async () => {
    let releaseFirst = () => {};
    const fake = solver(ACCEPTED);
    fake.solveExact.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve(graph(ACCEPTED));
        })
    );

    const running = runCpExactSolve(
      { vertices: [] },
      { solver: async () => fake, run: { kind: 'region', targetId: 'region-1' } }
    );
    await vi.waitFor(() => expect(cpExactSolveRunFor('region-1')).toBeDefined());

    const live = cpExactSolveRunFor('region-1');
    expect(live).toBeDefined();
    expect(requestCpExactSolveStop(live?.runId ?? 0)).toBe(false);
    // Refused, and refused *silently in the state too* — a run reported as
    // stopping that then finishes normally is the lie this guards against.
    expect(cpExactSolveRunFor('region-1')?.stopping).toBe(false);

    releaseFirst();
    await running;
  });
});

describe('a stopped solve', () => {
  /** A session whose `stop` rejects the in-flight call, as terminate does. */
  function stoppableSolver() {
    let reject: (error: unknown) => void = () => {};
    const fake: CpExactSolver = {
      solveExact: () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
      solveExactToFold: () => new Promise(() => {}),
    };
    return { fake, stop: () => reject(new CpExactSolveCancelledError()) };
  }

  it('rejects with the cancellation, clears the run, and applies nothing', async () => {
    const { fake, stop } = stoppableSolver();
    const running = runCpExactSolve(
      { vertices: [] },
      { solver: async () => fake, run: { kind: 'region', targetId: 'region-1' } }
    ).catch((error: unknown) => error);
    await vi.waitFor(() => expect(cpExactSolveRunFor('region-1')).toBeDefined());

    stop();
    const settled = await running;

    expect(isCpExactSolveCancelledError(settled)).toBe(true);
    expect(cpExactSolveRunFor('region-1')).toBeUndefined();
  });

  it('reports the cancel as a cancel, never as a solver verdict', async () => {
    // `cp exact solve completed` counts the four endings the solver reaches, and
    // a stopped run reached none of them. Counting it there would put "the user
    // pressed Stop" in the feature's failure rate.
    const { fake, stop } = stoppableSolver();
    const running = runCpExactSolve(
      { vertices: [] },
      { solver: async () => fake, run: { kind: 'detect-import', targetId: 'detect-1' } }
    ).catch(() => undefined);
    await vi.waitFor(() => expect(cpExactSolveRunFor('detect-1')).toBeDefined());

    stop();
    await running;

    expect(track).toHaveBeenCalledTimes(1);
    const [name, properties] = track.mock.calls[0];
    expect(name).toBe('cp detect cancelled');
    expect(properties).toMatchObject({ kind: 'detect-import', stage: 'geometry' });
    expect(String(properties.duration_ms_bucket)).toMatch(/^(<=|>)\d+$/u);
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
