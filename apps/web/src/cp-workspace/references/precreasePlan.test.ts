import { nextActionDouble } from './driveRulesDouble';
import type {
  PrecreaseDriverState,
  PrecreasePlanAction,
} from './precreaseSequence';
import { describe, expect, it, vi } from 'vitest';
import lineExact from './referenceFinder/__fixtures__/line-exact.json';
import lineApproximate from './referenceFinder/__fixtures__/line-approximate.json';
import {
  createReplayReferenceFinderClient,
  type ReferenceFinderReplayFixture,
} from './referenceFinder/replayClient';
import type { ReferenceFinderClient, ReferenceFinderLineRequest } from './referenceFinder/client';
import { extractSolution } from './referenceFinder/extractor';
import { bestCandidate, runPrecreasePlan, type PrecreasePlannerHandle } from './precreasePlan';
import type {
  PrecreaseCloseReport,
  PrecreaseExplanation,
  PrecreaseFinding,
  PrecreaseFoldOutcome,
  PrecreasePlanLine,
  PrecreasePlannerInfo,
  PrecreaseSequence,
  PrecreaseStuckSummary,
} from './precreaseSequence';

/**
 * A planner just real enough to drive the loop.
 *
 * It models the one thing the loop reasons about: a set of target lines, which
 * of them the closure can reach, and which auxiliary line unlocks which. The
 * real geometry, the certificates and the search are the crate's and are
 * tested there; what these tests are about is whether the TypeScript loop
 * calls `close` until the fixpoint, hands a stuck state to the search, falls
 * back to ReferenceFinder only when it has to, folds nothing it was not
 * offered, and honours its budget and its signal.
 */
interface FakeTarget {
  key: string;
  line: PrecreasePlanLine;
  segment: [[number, number], [number, number]];
}

interface FakeSpec {
  targets: FakeTarget[];
  /** Targets the closure reaches from the bare sheet. */
  closable: string[];
  /** Auxiliary line key → the targets folding it unlocks. */
  auxUnlocks?: Record<string, string[]>;
  /** What `stuckSearch` returns, in order; `null` means "found nothing". */
  stuck?: (string | null)[];
  offLattice?: boolean;
  /** `foldApproximation` refuses everything: the state has no construction. */
  refuseApproximations?: boolean;
  /**
   * Folding a construction's own auxiliary lines lets the closure fold the
   * target exactly — `fold` marks every remaining target closable, so the
   * approximation itself finds nothing left to approximate.
   */
  auxiliariesSolve?: boolean;
  refused?: boolean;
}

function keyOf(line: PrecreasePlanLine): string {
  return `${round(line.n[0])},${round(line.n[1])},${round(line.d)}`;
}

function round(value: number): string {
  return (Math.round(value * 1e6) / 1e6).toFixed(6);
}

/** The canonical line through two points, as the crate's `from_rf` builds it. */
function lineThrough(
  a: [number, number],
  b: [number, number]
): PrecreasePlanLine {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  let n: [number, number] = [-dy / length, dx / length];
  let d = n[0] * a[0] + n[1] * a[1];
  const sign = n[0] !== 0 ? Math.sign(n[0]) : Math.sign(n[1]);
  if (sign < 0) {
    n = [-n[0], -n[1]];
    d = -d;
  }
  return { n, d };
}

class FakePlanner implements PrecreasePlannerHandle {
  readonly calls = { close: 0, stuck: 0, fold: 0, score: 0, approximate: 0 };
  /** Targets folded by an approximation, with the error and the line handed in. */
  readonly approximations: { key: string; err: number; constructed: PrecreasePlanLine }[] = [];
  /** Every line `fold` was handed, in order. */
  readonly foldedLines: PrecreasePlanLine[] = [];
  private readonly remainingKeys: Set<string>;
  private readonly closable: Set<string>;
  private readonly foldedTargets: string[] = [];
  private readonly foldedAux: string[] = [];
  private stuckAt = 0;

  constructor(private readonly spec: FakeSpec) {
    this.remainingKeys = new Set(spec.targets.map((target) => target.key));
    this.closable = new Set(spec.closable);
  }

  get auxFolded(): readonly string[] {
    return this.foldedAux;
  }

  async info(): Promise<PrecreasePlannerInfo> {
    return {
      component: 0,
      status: 'partial_unsolved',
      sheet: { width: 1, height: 1 },
      exactness: null,
      refused: this.spec.refused ?? false,
      off_lattice: this.spec.offLattice ?? false,
      targets: this.spec.targets.length,
      free_targets: 0,
      remaining: this.remainingKeys.size,
      point_cap: 600_000,
    };
  }

  /**
   * The rules, from the test double — see `driveRulesDouble.ts` for why that is
   * not simply a second implementation left lying about.
   */
  async nextAction(driver: PrecreaseDriverState): Promise<PrecreasePlanAction> {
    return nextActionDouble(
      {
        refused: this.spec.refused ?? false,
        complete: this.remainingKeys.size === 0,
        point_cap_hit: false,
      },
      driver
    );
  }

  async close(): Promise<PrecreaseCloseReport> {
    this.calls.close += 1;
    let folded = 0;
    for (const key of [...this.remainingKeys]) {
      if (!this.closable.has(key)) continue;
      this.remainingKeys.delete(key);
      this.foldedTargets.push(key);
      folded += 1;
    }
    const fixpoint = ![...this.remainingKeys].some((key) => this.closable.has(key));
    return { folded, remaining: this.remainingKeys.size, exhausted: fixpoint, fixpoint, budget_hit: false };
  }

  async remaining(): Promise<Float64Array> {
    const out: number[] = [];
    for (const target of this.spec.targets) {
      if (!this.remainingKeys.has(target.key)) continue;
      out.push(
        target.line.n[0],
        target.line.n[1],
        target.line.d,
        target.segment[0][0],
        target.segment[0][1],
        target.segment[1][0],
        target.segment[1][1]
      );
    }
    return Float64Array.from(out);
  }

  async lineKeys(): Promise<string[]> {
    return this.spec.targets.filter((t) => this.remainingKeys.has(t.key)).map((t) => t.key);
  }

  async stuckSearch(): Promise<PrecreaseStuckSummary | null> {
    this.calls.stuck += 1;
    const found = this.spec.stuck?.[this.stuckAt++] ?? null;
    if (found === null) return null;
    this.applyAux(found);
    return {
      aux: [],
      aux_folds: 1,
      visible_aux: 0,
      unlocked: 1,
      ease_sum: 0,
      depth_reached: 2,
      exhausted: true,
      complete: false,
      root_candidates: 4,
      candidates_evaluated: 12,
      closures_run: 3,
    };
  }

  async score(lines: Float64Array): Promise<Uint32Array> {
    this.calls.score += 1;
    const out = new Uint32Array(lines.length / 3);
    for (let i = 0; i < out.length; i += 1) {
      const key = keyOf({ n: [lines[i * 3], lines[i * 3 + 1]], d: lines[i * 3 + 2] });
      const unlocks = this.spec.auxUnlocks?.[key];
      out[i] = unlocks && !this.foldedAux.includes(key) ? unlocks.length + 1 : 0;
    }
    return out;
  }

  async fold(lines: Float64Array): Promise<PrecreaseFoldOutcome[]> {
    this.calls.fold += 1;
    const out: PrecreaseFoldOutcome[] = [];
    for (let i = 0; i < lines.length / 3; i += 1) {
      this.foldedLines.push({ n: [lines[i * 3], lines[i * 3 + 1]], d: lines[i * 3 + 2] });
      if (this.spec.auxiliariesSolve) {
        for (const target of this.spec.targets) this.closable.add(target.key);
        await this.close();
      }
      const key = keyOf({ n: [lines[i * 3], lines[i * 3 + 1]], d: lines[i * 3 + 2] });
      if (this.spec.auxUnlocks?.[key] && !this.foldedAux.includes(key)) {
        this.applyAux(key);
        out.push({ kind: 'folded', line_id: 10 + i, cp_target: null });
      } else {
        out.push({ kind: 'not_constructible' });
      }
    }
    return out;
  }

  async foldApproximation(
    target: Float64Array,
    constructed: Float64Array,
    err: number
  ): Promise<PrecreaseFoldOutcome> {
    this.calls.approximate += 1;
    const key = keyOf({ n: [target[0], target[1]], d: target[2] });
    if (this.spec.refuseApproximations) return { kind: 'not_constructible' };
    // A target no longer remaining was folded — by this event's own
    // auxiliary lines and the close that follows them, as the crate answers.
    if (!this.remainingKeys.has(key)) return { kind: 'already_folded', line_id: 0 };
    this.remainingKeys.delete(key);
    this.foldedTargets.push(key);
    this.approximations.push({
      key,
      err,
      constructed: { n: [constructed[0], constructed[1]], d: constructed[2] },
    });
    return { kind: 'folded', line_id: 20 + this.approximations.length, cp_target: 0 };
  }

  async sequence(): Promise<PrecreaseSequence> {
    const findings: PrecreaseFinding[] = this.spec.targets
      .filter((target) => this.remainingKeys.has(target.key))
      .map((target) => ({
        line: target.line,
        segment: target.segment,
        cp_line_ids: [],
        reason: this.spec.offLattice ? 'off_lattice' : 'unsolved',
        facts: {
          points_on: 0,
          perpendiculars: 0,
          o2_pairs: 0,
          o3_pairs: 0,
          landers: 0,
          landers_computed: true,
        },
      }));
    return {
      status: findings.length === 0 ? 'complete' : 'partial_unsolved',
      certification: 'best_found_to_depth_2',
      sheet: { width: 1, height: 1 },
      landmarks_first: false,
      steps: [],
      groups: [],
      totals: {
        folds: this.foldedTargets.length + this.foldedAux.length,
        cp_lines: this.foldedTargets.length,
        aux: this.foldedAux.length,
        visible_aux: 0,
        grid_lines: 0,
        grid_cp_lines: 0,
        grid_unwanted_length: 0,
        lower_bound: this.spec.targets.length,
        free_lines: 0,
        unsolved: findings.length,
        approximate: this.approximations.length,
        cards: this.foldedTargets.length + this.foldedAux.length,
      },
      findings,
      points: [],
      lines: [],
      exactness: null,
      diagnostics: {
        closure: { rounds: 1, tier1_sweeps: 1, tier2_sweeps: 0, target_evaluations: 1 },
        stuck_events: this.calls.stuck,
        candidates_evaluated: 0,
        closures_run: this.calls.close,
        points: 4,
        lines: 4,
        elapsed_ms: 1,
        budget_hit: false,
        point_cap_hit: false,
        max_depth_searched: 2,
        search_exhausted: true,
        witnesses_incomplete_steps: 0,
        rf_lines_folded: this.foldedAux.length,
      },
    };
  }

  async explain(): Promise<PrecreaseExplanation> {
    throw new Error('the plan loop never explains a line');
  }

  async toRf(): Promise<Float64Array> {
    return new Float64Array();
  }

  async fromRf(points: Float64Array): Promise<Float64Array> {
    const out: number[] = [];
    for (let i = 0; i + 4 <= points.length; i += 4) {
      const line = lineThrough([points[i], points[i + 1]], [points[i + 2], points[i + 3]]);
      out.push(line.n[0], line.n[1], line.d);
    }
    return Float64Array.from(out);
  }

  private applyAux(key: string): void {
    this.foldedAux.push(key);
    for (const target of this.spec.auxUnlocks?.[key] ?? []) this.closable.add(target);
  }
}

const HALF = keyOf({ n: [0, 1], d: 0.5 });
const QUARTER = keyOf({ n: [0, 1], d: 0.25 });

/** One remaining target: y = ¼, the line `line-exact.json` was captured for. */
const quarterTarget: FakeTarget = {
  key: QUARTER,
  line: { n: [0, 1], d: 0.25 },
  segment: [
    [0, 0.25],
    [1, 0.25],
  ],
};

function exactClient() {
  return createReplayReferenceFinderClient([
    lineExact as unknown as ReferenceFinderReplayFixture,
  ]);
}

describe('runPrecreasePlan', () => {
  it('closes to the fixpoint and reports a complete plan', async () => {
    const planner = new FakePlanner({
      targets: [quarterTarget],
      closable: [QUARTER],
    });
    const result = await runPrecreasePlan(planner, { computedAtRevision: 'r1' });
    expect(result.stopReason).toBe('complete');
    expect(result.partial).toBe(false);
    expect(result.sequence.totals.cp_lines).toBe(1);
    expect(planner.calls.stuck).toBe(0);
  });

  it('hands a stuck state to the search before it asks ReferenceFinder', async () => {
    const planner = new FakePlanner({
      targets: [quarterTarget],
      closable: [],
      auxUnlocks: { [HALF]: [QUARTER] },
      stuck: [HALF],
    });
    const client = exactClient();
    const result = await runPrecreasePlan(planner, {
      computedAtRevision: 'r1',
      referenceFinder: { exact: client },
    });
    expect(result.stopReason).toBe('complete');
    expect(result.stuckEvents).toBe(1);
    // The whole point of the forward-first rule: no query was needed.
    expect(result.rfQueries).toBe(0);
    expect(client.transport.calls).toHaveLength(0);
  });

  it('falls back to ReferenceFinder, and folds only what the planner certifies', async () => {
    const planner = new FakePlanner({
      targets: [quarterTarget],
      closable: [],
      // The half line is the one the core's own construction of y = ¼ makes
      // first; the fallback has to find it in the answer and fold *it*, not
      // the target line the answer was about.
      auxUnlocks: { [HALF]: [QUARTER] },
      stuck: [null],
    });
    const client = exactClient();
    const result = await runPrecreasePlan(planner, {
      computedAtRevision: 'r1',
      referenceFinder: { exact: client },
    });
    expect(result.stopReason).toBe('complete');
    expect(result.rfAuxFolded).toBe(1);
    expect(result.rfQueries).toBe(1);
    expect(planner.auxFolded).toEqual([HALF]);
    expect(client.transport.calls[0]).toMatchObject({ kind: 'line' });
  });

  it('stops at unsolved rather than inventing a fold', async () => {
    const planner = new FakePlanner({
      targets: [quarterTarget],
      closable: [],
      stuck: [null],
    });
    const result = await runPrecreasePlan(planner, {
      computedAtRevision: 'r1',
      referenceFinder: { exact: exactClient() },
    });
    expect(result.stopReason).toBe('unsolved');
    expect(result.partial).toBe(true);
    expect(result.rfAuxFolded).toBe(0);
    expect(result.sequence.findings).toHaveLength(1);
  });

  /** The line `line-approximate.json` was captured for: nothing exact reaches it. */
  const awkwardTarget: FakeTarget = {
    key: keyOf(lineThrough([0.123, 0], [0.789, 1])),
    line: lineThrough([0.123, 0], [0.789, 1]),
    segment: [
      [0.123, 0],
      [0.789, 1],
    ],
  };

  function approximateClient() {
    return createReplayReferenceFinderClient([
      lineApproximate as unknown as ReferenceFinderReplayFixture,
    ]);
  }

  it('searches an off-lattice component like any other, and reports what it cannot make exactly', async () => {
    const planner = new FakePlanner({
      targets: [awkwardTarget],
      closable: [],
      offLattice: true,
      stuck: [null],
    });
    const result = await runPrecreasePlan(planner, {
      computedAtRevision: 'r1',
      referenceFinder: { exact: exactClient() },
    });
    // No approximate client: the line stays a finding, as it always did —
    // but the search and the exact ReferenceFinder query ran first.
    expect(result.stopReason).toBe('unsolved');
    expect(planner.calls.stuck).toBe(1);
    expect(planner.calls.approximate).toBe(0);
    expect(result.sequence.findings[0].reason).toBe('off_lattice');
  });

  it('folds the closest construction once nothing exact is left, and marks it', async () => {
    const planner = new FakePlanner({
      targets: [awkwardTarget],
      closable: [],
      offLattice: true,
      stuck: [null],
    });
    const result = await runPrecreasePlan(planner, {
      computedAtRevision: 'r1',
      referenceFinder: { exact: exactClient(), approximate: approximateClient() },
    });
    expect(result.stopReason).toBe('complete');
    // Every exact avenue first: the search, then an exact query.
    expect(planner.calls.stuck).toBe(1);
    expect(planner.calls.approximate).toBe(1);
    expect(result.approximated).toBe(1);
    expect(planner.approximations).toHaveLength(1);
    expect(planner.approximations[0].key).toBe(awkwardTarget.key);
    expect(planner.approximations[0].err).toBeCloseTo(0.000748779415597783, 12);
    // The construction's own lines were folded first — the fixture's four
    // line steps A–D, not its final line E — and the target was folded *as*
    // E: the line ReferenceFinder's `solution` names.
    expect(planner.calls.fold).toBe(1);
    expect(planner.foldedLines).toHaveLength(4);
    const made = planner.approximations[0].constructed;
    expect(Math.abs(made.n[0])).toBeCloseTo(0.832428993720862, 9);
    expect(Math.abs(made.n[1])).toBeCloseTo(0.554131726589331, 9);
    expect(Math.abs(made.d)).toBeCloseTo(0.103012071923111, 9);
    expect(result.sequence.totals.approximate).toBe(1);
    expect(result.sequence.findings).toHaveLength(0);
    expect(result.approximate).toHaveLength(0);
  });

  it('approximates every line that needs it, however many exact asks the cap allows', async () => {
    // Five independent lines with no exact construction, and a cap of two
    // exact ReferenceFinder asks. Each approximation round comes back through
    // the search and the exact ask; the cap must not end the run.
    const targets: FakeTarget[] = [0, 1, 2, 3, 4].map((i) => {
      const line = lineThrough([0.123 + i * 0.01, 0], [0.789, 1]);
      return {
        key: keyOf(line),
        line,
        segment: [
          [0.123 + i * 0.01, 0],
          [0.789, 1],
        ],
      };
    });
    const planner = new FakePlanner({ targets, closable: [], offLattice: true, stuck: [null, null, null, null, null] });
    // The replay client only knows one line; a client answering every line
    // with the same near-miss stands in for ReferenceFinder here.
    const near = lineApproximate as unknown as ReferenceFinderReplayFixture;
    const solution = extractSolution(near.solutions[0]!, near.query);
    const approximate = {
      ...approximateClient(),
      batchLines: async (requests: ReferenceFinderLineRequest[]) => ({
        results: requests.map((request) => ({
          key: request.key ?? '',
          a: request.a,
          b: request.b,
          solutions: [solution],
        })),
        fromCache: 0,
        aborted: false,
      }),
    } as unknown as ReferenceFinderClient;
    const result = await runPrecreasePlan(planner, {
      computedAtRevision: 'r1',
      maxReferenceFinderEvents: 2,
      referenceFinder: { exact: exactClient(), approximate },
    });
    expect(result.stopReason).toBe('complete');
    expect(result.approximated).toBe(5);
    expect(result.sequence.findings).toHaveLength(0);
  });

  it('counts a target its construction’s own lines folded exactly as progress, not as an approximation', async () => {
    const planner = new FakePlanner({
      targets: [awkwardTarget],
      closable: [],
      offLattice: true,
      stuck: [null],
      auxiliariesSolve: true,
    });
    const result = await runPrecreasePlan(planner, {
      computedAtRevision: 'r1',
      referenceFinder: { exact: exactClient(), approximate: approximateClient() },
    });
    expect(result.stopReason).toBe('complete');
    expect(result.approximated).toBe(0);
    expect(planner.approximations).toHaveLength(0);
    expect(result.sequence.findings).toHaveLength(0);
  });

  it('attaches ReferenceFinder’s best approximation to a finding it could not fold', async () => {
    const planner = new FakePlanner({
      targets: [awkwardTarget],
      closable: [],
      offLattice: true,
      stuck: [null],
      refuseApproximations: true,
    });
    const result = await runPrecreasePlan(planner, {
      computedAtRevision: 'r1',
      referenceFinder: { exact: exactClient(), approximate: approximateClient() },
    });
    expect(result.stopReason).toBe('unsolved');
    expect(result.approximated).toBe(0);
    expect(result.approximate).toHaveLength(1);
    expect(result.approximate[0].finding).toBe(0);
    expect(result.approximate[0].err).toBeGreaterThan(0);
  });

  it('returns a partial result on abort instead of throwing', async () => {
    const planner = new FakePlanner({
      targets: [quarterTarget],
      closable: [],
      stuck: [null],
    });
    const controller = new AbortController();
    controller.abort();
    const result = await runPrecreasePlan(planner, {
      computedAtRevision: 'r1',
      signal: controller.signal,
    });
    expect(result.stopReason).toBe('aborted');
    expect(result.partial).toBe(true);
    expect(planner.calls.close).toBe(0);
  });

  it('gives up on its budget rather than looping', async () => {
    let now = 0;
    const planner = new FakePlanner({
      targets: [quarterTarget],
      closable: [],
      // The search keeps finding auxiliary lines that unlock nothing, which is
      // the shape of a run that would never terminate on its own.
      stuck: [null],
    });
    const result = await runPrecreasePlan(planner, {
      computedAtRevision: 'r1',
      totalBudgetMs: 10,
      now: () => (now += 50),
    });
    expect(result.partial).toBe(true);
    expect(['budget', 'unsolved']).toContain(result.stopReason);
  });

  it('answers a refused sheet without touching the closure', async () => {
    const planner = new FakePlanner({ targets: [quarterTarget], closable: [], refused: true });
    const result = await runPrecreasePlan(planner, { computedAtRevision: 'r1' });
    expect(result.stopReason).toBe('refused_sheet');
    expect(planner.calls.close).toBe(0);
  });

  it('reports progress while it works', async () => {
    const onProgress = vi.fn();
    const planner = new FakePlanner({ targets: [quarterTarget], closable: [QUARTER] });
    await runPrecreasePlan(planner, { computedAtRevision: 'r1', onProgress });
    const phases = onProgress.mock.calls.map(([progress]) => progress.phase);
    expect(phases).toContain('closing');
    expect(phases.at(-1)).toBe('done');
  });

  it('carries the revision it was computed for', async () => {
    const planner = new FakePlanner({ targets: [quarterTarget], closable: [QUARTER] });
    const result = await runPrecreasePlan(planner, { computedAtRevision: '3:7:9' });
    expect(result.computedAtRevision).toBe('3:7:9');
  });
});

describe('bestCandidate', () => {
  const a: PrecreasePlanLine = { n: [0, 1], d: 0.5 };
  const b: PrecreasePlanLine = { n: [1, 0], d: 0.5 };

  it('refuses a candidate that unlocks nothing', () => {
    // `score` is `1 + unlocks`, so 1 means "constructible but useless" — an
    // auxiliary crease for no progress, and a loop that never terminates.
    expect(bestCandidate([a, b], [1, 0])).toBeNull();
  });

  it('takes the one that unlocks the most', () => {
    expect(bestCandidate([a, b], [2, 5])).toEqual(b);
  });

  it('breaks ties on canonical order, so the same state picks the same fold', () => {
    expect(bestCandidate([b, a], [3, 3])).toEqual(a);
    expect(bestCandidate([a, b], [3, 3])).toEqual(a);
  });
});
