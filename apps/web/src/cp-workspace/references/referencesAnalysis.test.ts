import { describe, expect, it, vi } from 'vitest';
import lineApproximate from './referenceFinder/__fixtures__/line-approximate.json';
import lineExact from './referenceFinder/__fixtures__/line-exact.json';
import {
  createReplayReferenceFinderClient,
  type ReferenceFinderReplayFixture,
} from './referenceFinder/replayClient';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import { analyzeReferences, summarize, type ReferencesAnalysisLine } from './referencesAnalysis';
import type { PrecreasePlannerHandle } from './precreasePlan';
import type { PrecreasePlanLine, PrecreaseSequence } from './precreaseSequence';

/**
 * A planner that has already closed: `remaining` is whatever the test says the
 * closure could not reach, and `sequence` is the fixture plan (whose CP steps
 * are the lines the closure *did* reach). What is under test is the ordering —
 * closure first, ReferenceFinder only for the remainder — and the verdicts.
 */
function fakePlanner(options: {
  remaining: { line: PrecreasePlanLine; segment: [[number, number], [number, number]] }[];
  sequence?: PrecreaseSequence;
  refused?: boolean;
}): PrecreasePlannerHandle & { closes: number } {
  const sequence = options.sequence ?? plannerSequenceFixture();
  let closes = 0;
  return {
    get closes() {
      return closes;
    },
    // Never reached: nothing here runs the planning loop.
    async nextAction() {
      return { kind: 'stop' as const, reason: 'unsolved' as const };
    },
    async info() {
      return {
        component: 2,
        status: 'partial_unsolved' as const,
        sheet: { width: 1, height: 1 },
        exactness: null,
        refused: options.refused ?? false,
        off_lattice: false,
        targets: sequence.steps.length + options.remaining.length,
        free_targets: 0,
        remaining: options.remaining.length,
        point_cap: 600_000,
      };
    },
    async close() {
      closes += 1;
      return {
        folded: closes === 1 ? sequence.steps.length : 0,
        remaining: options.remaining.length,
        exhausted: true,
        fixpoint: true,
        budget_hit: false,
      };
    },
    async remaining() {
      return Float64Array.from(
        options.remaining.flatMap((entry) => [
          entry.line.n[0],
          entry.line.n[1],
          entry.line.d,
          entry.segment[0][0],
          entry.segment[0][1],
          entry.segment[1][0],
          entry.segment[1][1],
        ])
      );
    },
    async lineKeys() {
      return options.remaining.map((_, index) => `k${index}`);
    },
    async stuckSearch() {
      throw new Error('the analysis never searches');
    },
    async score() {
      throw new Error('the analysis never scores');
    },
    async fold() {
      throw new Error('the analysis folds nothing');
    },
    async sequence() {
      return sequence;
    },
    async explain() {
      throw new Error('not used');
    },
    async toRf() {
      return new Float64Array();
    },
    async fromRf() {
      return new Float64Array();
    },
  };
}

const EXACT_TARGET = {
  line: { n: [0, 1] as [number, number], d: 0.25 },
  segment: [
    [0, 0.25],
    [1, 0.25],
  ] as [[number, number], [number, number]],
};

const APPROXIMATE_TARGET = {
  line: { n: [0.83, -0.55] as [number, number], d: 0.1 },
  segment: [
    [0.123, 0],
    [0.789, 1],
  ] as [[number, number], [number, number]],
};

describe('analyzeReferences', () => {
  it('queries only what the closure could not reach', async () => {
    const planner = fakePlanner({ remaining: [EXACT_TARGET] });
    const client = createReplayReferenceFinderClient([
      lineExact as unknown as ReferenceFinderReplayFixture,
    ]);
    const analysis = await analyzeReferences(planner, {
      computedAtRevision: 'r1',
      client,
    });
    // The fixture plan folds four CP lines; one line was left, so exactly one
    // query — the whole cost argument for closure-first.
    expect(client.transport.calls).toHaveLength(1);
    expect(analysis.summary.closure).toBe(4);
    expect(analysis.summary.lines).toBe(5);
  });

  it('calls an exact construction exact, with its rank', async () => {
    const planner = fakePlanner({ remaining: [EXACT_TARGET] });
    const analysis = await analyzeReferences(planner, {
      computedAtRevision: 'r1',
      client: createReplayReferenceFinderClient([
        lineExact as unknown as ReferenceFinderReplayFixture,
      ]),
    });
    const verdict = analysis.lines.at(-1)?.verdict;
    expect(verdict?.kind).toBe('exact');
    if (verdict?.kind === 'exact') expect(verdict.rank).toBeGreaterThan(0);
    expect(analysis.summary.exact).toBe(1);
  });

  it('calls a construction that only lands near the target approximate, with its error', async () => {
    const planner = fakePlanner({ remaining: [APPROXIMATE_TARGET] });
    const analysis = await analyzeReferences(planner, {
      computedAtRevision: 'r1',
      client: createReplayReferenceFinderClient([
        lineApproximate as unknown as ReferenceFinderReplayFixture,
      ]),
    });
    const verdict = analysis.lines.at(-1)?.verdict;
    expect(verdict?.kind).toBe('approximate');
    if (verdict?.kind === 'approximate') expect(verdict.err).toBeGreaterThan(1e-9);
    expect(analysis.summary.approximate).toBe(1);
  });

  it('records the closure’s own axiom for the lines it reached', async () => {
    const planner = fakePlanner({ remaining: [] });
    const analysis = await analyzeReferences(planner, {
      computedAtRevision: 'r1',
      client: createReplayReferenceFinderClient([
        lineExact as unknown as ReferenceFinderReplayFixture,
      ]),
    });
    expect(analysis.lines.every((line) => line.verdict.kind === 'closure')).toBe(true);
    expect(analysis.lines[0].verdict).toMatchObject({ kind: 'closure', stepId: 2, axiom: 2 });
  });

  it('keeps the partial findings when a Stop lands', async () => {
    const controller = new AbortController();
    controller.abort();
    const planner = fakePlanner({ remaining: [EXACT_TARGET] });
    const analysis = await analyzeReferences(planner, {
      computedAtRevision: 'r1',
      client: createReplayReferenceFinderClient([
        lineExact as unknown as ReferenceFinderReplayFixture,
      ]),
      signal: controller.signal,
    });
    expect(analysis.partial).toBe(true);
    expect(analysis.lines.length).toBeGreaterThan(0);
  });

  it('answers a refused sheet with nothing rather than an error', async () => {
    const planner = fakePlanner({ remaining: [], refused: true });
    const analysis = await analyzeReferences(planner, {
      computedAtRevision: 'r1',
      client: createReplayReferenceFinderClient([
        lineExact as unknown as ReferenceFinderReplayFixture,
      ]),
    });
    expect(analysis.lines).toEqual([]);
    expect(analysis.partial).toBe(true);
  });

  it('reports progress through both phases', async () => {
    const onProgress = vi.fn();
    const planner = fakePlanner({ remaining: [EXACT_TARGET] });
    await analyzeReferences(planner, {
      computedAtRevision: 'r1',
      client: createReplayReferenceFinderClient([
        lineExact as unknown as ReferenceFinderReplayFixture,
      ]),
      onProgress,
    });
    const phases = onProgress.mock.calls.map(([progress]) => progress.phase);
    expect(phases).toContain('closing');
    expect(phases).toContain('querying');
    expect(phases.at(-1)).toBe('done');
  });
});

describe('summarize', () => {
  it('counts each verdict once and carries the free lines through', () => {
    const lines: ReferencesAnalysisLine[] = [
      { cpLineIds: [], line: { n: [0, 1], d: 0 }, verdict: { kind: 'closure', stepId: 1, axiom: 2 } },
      { cpLineIds: [], line: { n: [0, 1], d: 1 }, verdict: { kind: 'exact', rank: 2, foldCount: 3 } },
      {
        cpLineIds: [],
        line: { n: [1, 0], d: 1 },
        verdict: { kind: 'approximate', rank: 4, foldCount: 5, err: 1e-4 },
      },
      { cpLineIds: [], line: { n: [1, 0], d: 2 }, verdict: { kind: 'unsolved' } },
      { cpLineIds: [], line: { n: [1, 0], d: 3 }, verdict: { kind: 'error', message: 'boom' } },
    ];
    expect(summarize(lines, 2)).toEqual({
      lines: 5,
      closure: 1,
      exact: 1,
      approximate: 1,
      // An error is not a verdict about the geometry, so it counts with the
      // ones we could not answer rather than being quietly dropped.
      unsolved: 2,
      free: 2,
    });
  });
});
