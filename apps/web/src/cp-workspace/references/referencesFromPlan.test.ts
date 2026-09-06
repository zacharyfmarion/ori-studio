import { describe, expect, it } from 'vitest';
import type { ExtractedSolution } from './referenceFinder/extractor';
import {
  candidateCosts,
  orderByCost,
  reorder,
  type PlanStateScorer,
} from './referencesFromPlan';
import type { PrecreaseExplanation } from './precreaseSequence';

/**
 * A scorer standing in for a planner sitting on a finished plan: the lines in
 * `folded` are already creased, the lines in `constructible` can be made in
 * one step from there, and everything else is neither.
 */
function scorer(options: {
  folded: string[];
  constructible: string[];
  explains?: number;
}): PlanStateScorer & { explains: number } {
  const state = { explains: 0 };
  const keyOf = (values: Float64Array, at: number) =>
    `${values[at]},${values[at + 1]},${values[at + 2]}`;
  return {
    get explains() {
      return state.explains;
    },
    // Two points → the "line" they name, kept as the raw quad so the tests can
    // spell out which line they mean without doing geometry.
    async fromRf(points: Float64Array) {
      const out: number[] = [];
      for (let i = 0; i + 4 <= points.length; i += 4) {
        out.push(points[i], points[i + 1], points[i + 2]);
      }
      return Float64Array.from(out);
    },
    async score(lines: Float64Array) {
      const out = new Uint32Array(lines.length / 3);
      for (let i = 0; i < out.length; i += 1) {
        out[i] = options.constructible.includes(keyOf(lines, i * 3)) ? 2 : 0;
      }
      return out;
    },
    async explain(line: Float64Array): Promise<PrecreaseExplanation> {
      state.explains += 1;
      return {
        line: { n: [line[0], line[1]], d: line[2] },
        folded: options.folded.includes(keyOf(line, 0)),
        line_id: null,
        tag: null,
        round: null,
        is_target: false,
        remaining: false,
        cp_line_ids: [],
        witnesses: [],
        chosen: null,
        facts: {
          points_on: 0,
          perpendiculars: 0,
          o2_pairs: 0,
          o3_pairs: 0,
          landers: 0,
          landers_computed: true,
        },
      };
    },
  };
}

/** A solution whose line steps run through the given `[x, y]` starts. */
function solution(starts: [number, number][]): ExtractedSolution {
  return {
    exact: true,
    err: 0,
    rank: 1,
    foldCount: starts.length,
    steps: starts.map((start, index) => ({
      axiom: 2,
      inputs: [],
      label: String.fromCharCode(65 + index),
      pinch: false,
      line: { a: start, b: [start[0] + 1, start[1]] as [number, number] },
      diagramIndex: index,
    })),
    freeDiagonals: [],
    target: { kind: 'line', line: { a: [0, 0], b: [1, 1] } },
  };
}

const A: [number, number] = [1, 2];
const B: [number, number] = [3, 4];
const C: [number, number] = [5, 6];

describe('candidateCosts', () => {
  it('charges nothing for a line the plan already folds', async () => {
    const costs = await candidateCosts(
      scorer({ folded: ['1,2,2'], constructible: [] }),
      [solution([A])]
    );
    expect(costs[0]).toEqual({ folds: 0, blocked: 0, reused: 1 });
  });

  it('charges one fold per line the plan does not make', async () => {
    const costs = await candidateCosts(
      scorer({ folded: ['1,2,2'], constructible: ['3,4,4'] }),
      [solution([A, B])]
    );
    expect(costs[0]).toEqual({ folds: 1, blocked: 0, reused: 1 });
  });

  it('flags a needed line the plan’s state cannot construct', async () => {
    const costs = await candidateCosts(
      scorer({ folded: [], constructible: [] }),
      [solution([A])]
    );
    expect(costs[0]).toEqual({ folds: 1, blocked: 1, reused: 0 });
  });

  it('asks about each distinct line once, however many candidates share it', async () => {
    const state = scorer({ folded: [], constructible: ['1,2,2'] });
    await candidateCosts(state, [solution([A, B]), solution([A, C]), solution([A])]);
    expect(state.explains).toBe(3);
  });

  it('costs a mark-only solution nothing', async () => {
    const marks: ExtractedSolution = { ...solution([]), steps: [] };
    const costs = await candidateCosts(scorer({ folded: [], constructible: [] }), [marks]);
    expect(costs[0]).toEqual({ folds: 0, blocked: 0, reused: 0 });
  });
});

describe('orderByCost', () => {
  it('puts the cheapest from the plan’s state first', () => {
    const order = orderByCost([
      { folds: 3, blocked: 0, reused: 0 },
      { folds: 1, blocked: 0, reused: 2 },
      { folds: 2, blocked: 0, reused: 1 },
    ]);
    expect(order).toEqual([1, 2, 0]);
  });

  it('prefers the one whose lines the state can actually make', () => {
    const order = orderByCost([
      { folds: 2, blocked: 2, reused: 0 },
      { folds: 2, blocked: 0, reused: 0 },
    ]);
    expect(order).toEqual([1, 0]);
  });

  it('leaves ReferenceFinder’s own ranking alone when the plan changes nothing', () => {
    const flat = [0, 1, 2, 3].map(() => ({ folds: 2, blocked: 0, reused: 0 }));
    expect(orderByCost(flat)).toEqual([0, 1, 2, 3]);
  });
});

describe('reorder', () => {
  it('applies an order to a parallel array', () => {
    expect(reorder(['a', 'b', 'c'], [2, 0, 1])).toEqual(['c', 'a', 'b']);
  });
});
