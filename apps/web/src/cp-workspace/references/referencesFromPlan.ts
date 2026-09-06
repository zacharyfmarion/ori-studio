/**
 * "Starting from: this sequence" — ranking a target's candidates by the folds
 * still needed *given the breakdown*, instead of from the bare sheet.
 *
 * ReferenceFinder is state-blind: it always answers as if the paper were
 * untouched, which is the right answer when you are about to fold one
 * reference and nothing else, and the wrong one when you have just been shown
 * a sequence that already creases half the sheet. A four-step construction
 * whose first three lines the plan folds anyway costs one fold, not four.
 *
 * Two questions per line, and the planner answers both: `explain` says whether
 * the plan's state already has it, and `score` says whether the state can
 * construct it at all. A line that is neither folded nor constructible is a
 * fold the candidate needs *and* cannot make next, which is worth knowing —
 * it is why a cost is a pair and not a number.
 *
 * React-free and worker-free: the scorer is an interface (the planner handle
 * satisfies it), so this is unit-tested against a fake.
 */
import type { ExtractedSolution } from './referenceFinder/extractor';
import type { RfPoint } from './referenceFinder/solution';
import type { PrecreaseExplanation } from './precreaseSequence';

/** What ranking needs from a live planner sitting on the plan's final state. */
export interface PlanStateScorer {
  explain(line: Float64Array): Promise<PrecreaseExplanation>;
  score(lines: Float64Array): Promise<Uint32Array>;
  fromRf(points: Float64Array): Promise<Float64Array>;
}

/** What one candidate costs from the plan's state. */
export interface CandidateCost {
  /** Line steps whose crease the plan does not already make. */
  folds: number;
  /** Of those, how many the state cannot construct in one step. */
  blocked: number;
  /** Line steps the plan already folds. */
  reused: number;
}

/**
 * The cost of every candidate, parallel to `solutions`.
 *
 * Distinct lines are asked about once: five candidates for one target overlap
 * heavily, and each `explain` is a worker round trip. Mark steps cost nothing
 * — they make no crease — and free diagonals are not folds either, so only
 * line steps are counted.
 */
export async function candidateCosts(
  scorer: PlanStateScorer,
  solutions: readonly ExtractedSolution[]
): Promise<CandidateCost[]> {
  const keys: string[] = [];
  const quads: number[] = [];
  const indexOfKey = new Map<string, number>();
  const perSolution: string[][] = [];

  for (const solution of solutions) {
    const own: string[] = [];
    for (const step of solution.steps) {
      if (!step.line) continue;
      const key = chordKey(step.line.a, step.line.b);
      own.push(key);
      if (indexOfKey.has(key)) continue;
      indexOfKey.set(key, keys.length);
      keys.push(key);
      quads.push(step.line.a[0], step.line.a[1], step.line.b[0], step.line.b[1]);
    }
    perSolution.push(own);
  }
  if (keys.length === 0) {
    return solutions.map(() => ({ folds: 0, blocked: 0, reused: 0 }));
  }

  const lines = await scorer.fromRf(Float64Array.from(quads));
  const scores = await scorer.score(lines);
  const folded: boolean[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const explanation = await scorer.explain(lines.slice(i * 3, i * 3 + 3));
    folded.push(explanation.folded);
  }

  return perSolution.map((own) => {
    const cost: CandidateCost = { folds: 0, blocked: 0, reused: 0 };
    const seen = new Set<string>();
    for (const key of own) {
      if (seen.has(key)) continue;
      seen.add(key);
      const at = indexOfKey.get(key);
      if (at === undefined) continue;
      if (folded[at]) {
        cost.reused += 1;
        continue;
      }
      cost.folds += 1;
      if ((scores[at] ?? 0) === 0) cost.blocked += 1;
    }
    return cost;
  });
}

/**
 * The order to show candidates in: cheapest from the plan's state first,
 * fewest blocked lines next, and the core's own ranking as the tie-break, so a
 * plan that changes nothing leaves the list exactly as ReferenceFinder sorted
 * it.
 */
export function orderByCost(costs: readonly CandidateCost[]): number[] {
  return costs
    .map((cost, index) => ({ cost, index }))
    .sort((a, b) => {
      if (a.cost.folds !== b.cost.folds) return a.cost.folds - b.cost.folds;
      if (a.cost.blocked !== b.cost.blocked) return a.cost.blocked - b.cost.blocked;
      return a.index - b.index;
    })
    .map((entry) => entry.index);
}

/** Apply an order to a parallel array. */
export function reorder<T>(items: readonly T[], order: readonly number[]): T[] {
  return order.map((index) => items[index]).filter((item): item is T => item !== undefined);
}

/** Endpoint-order-independent key, quantised well below the planner's `TOL`. */
function chordKey(a: RfPoint, b: RfPoint): string {
  const q = (v: number) => Math.round(v * 1e9);
  const first = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? a : b;
  const second = first === a ? b : a;
  return `${q(first[0])},${q(first[1])},${q(second[0])},${q(second[1])}`;
}
