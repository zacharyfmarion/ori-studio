/**
 * The whole-pattern planning loop: closure → stuck search → ReferenceFinder
 * fallback → repeat, as the plan's "Algorithm" section defines it.
 *
 * The geometry is all Rust's (plan decision D6). What lives here is the
 * *orchestration* the crate deliberately does not do: driving `close()` in
 * resumable chunks so a long run stays cancellable and can report progress,
 * reaching out to the ReferenceFinder worker between stuck events, spending a
 * budget, and deciding when a partial answer is the answer.
 *
 * Three rules this module exists to keep:
 *
 * - **No approximation is ever folded** (D8). ReferenceFinder's solutions are
 *   mined for the *lines* they construct; each is scored against the planner's
 *   own state and only folded when the planner certifies it, tagged `rf_aux`.
 *   A line the planner will not certify is reported, never applied.
 * - **The search is bounded, not exhaustive.** Everything that stops early —
 *   the budget, the abort, the fallback limit — comes back as a `partial`
 *   result with the reason, so no surface can print "minimum".
 * - **A result belongs to one revision of the document.** `computedAtRevision`
 *   travels with it and the caller drops it when the pattern moves on.
 *
 * React-free and worker-free: the planner is an interface, so the unit tests
 * drive a fake alongside the replay ReferenceFinder client.
 */
import type {
  ReferenceFinderBatchResult,
  ReferenceFinderClient,
  ReferenceFinderLineRequest,
} from './referenceFinder/client';
import type { RfPoint } from './referenceFinder/solution';
import {
  decodeLines,
  decodeRemaining,
  encodeLines,
  PRECREASE_TAG,
  type PrecreaseCloseReport,
  type PrecreaseExplanation,
  type PrecreaseFinding,
  type PrecreaseFoldOutcome,
  type PrecreasePlanLine,
  type PrecreasePlannerInfo,
  type PrecreaseSequence,
  type PrecreaseStuckSummary,
  type PrecreaseLastStep,
  type PrecreaseStopReason,
  type PrecreasePlanAction,
  type PrecreaseDriverState,
} from './precreaseSequence';

/** The planner handle the loop drives; the worker's bound to one token. */
export interface PrecreasePlannerHandle {
  info(): Promise<PrecreasePlannerInfo>;
  close(budgetMs: number): Promise<PrecreaseCloseReport>;
  remaining(): Promise<Float64Array>;
  lineKeys(): Promise<string[]>;
  /** The crate's `drive::next_action` — the one copy of the loop's rules. */
  nextAction(driver: PrecreaseDriverState): Promise<PrecreasePlanAction>;
  stuckSearch(depth: number, budgetMs: number): Promise<PrecreaseStuckSummary | null>;
  score(lines: Float64Array): Promise<Uint32Array>;
  fold(lines: Float64Array, tags: Uint8Array, budgetMs: number): Promise<PrecreaseFoldOutcome[]>;
  sequence(landmarksFirst: boolean): Promise<PrecreaseSequence>;
  explain(line: Float64Array): Promise<PrecreaseExplanation>;
  toRf(lines: Float64Array): Promise<Float64Array>;
  fromRf(points: Float64Array): Promise<Float64Array>;
}

/**
 * The subset of the precrease worker's API a planner handle needs.
 *
 * Structural rather than the worker's own type, so this module never imports
 * the runtime (which would drag a `new Worker(...)` into every unit test) and
 * so a comlink `Remote<PrecreaseWorkerApi>` satisfies it as it stands.
 */
export interface PrecreasePlannerWorkerApi {
  plannerInfo(token: number): Promise<PrecreasePlannerInfo>;
  plannerClose(token: number, budgetMs: number): Promise<PrecreaseCloseReport>;
  plannerRemaining(token: number): Promise<Float64Array>;
  plannerLineKeys(token: number): Promise<string[]>;
  plannerNextAction(token: number, driver: PrecreaseDriverState): Promise<PrecreasePlanAction>;
  plannerStuckSearch(
    token: number,
    depth: number,
    budgetMs: number
  ): Promise<PrecreaseStuckSummary | null>;
  plannerScore(token: number, lines: Float64Array): Promise<Uint32Array>;
  plannerFold(
    token: number,
    lines: Float64Array,
    tags: Uint8Array,
    budgetMs: number
  ): Promise<PrecreaseFoldOutcome[]>;
  plannerSequence(token: number, landmarksFirst: boolean): Promise<PrecreaseSequence>;
  plannerExplain(token: number, line: Float64Array): Promise<PrecreaseExplanation>;
  plannerToRf(token: number, lines: Float64Array): Promise<Float64Array>;
  plannerFromRf(token: number, points: Float64Array): Promise<Float64Array>;
}

/** Bind the worker's planner calls to one token. */
export function createWorkerPlannerHandle(
  api: PrecreasePlannerWorkerApi,
  token: number
): PrecreasePlannerHandle {
  return {
    info: () => api.plannerInfo(token),
    close: (budgetMs) => api.plannerClose(token, budgetMs),
    remaining: () => api.plannerRemaining(token),
    lineKeys: () => api.plannerLineKeys(token),
    nextAction: (driver) => api.plannerNextAction(token, driver),
    stuckSearch: (depth, budgetMs) => api.plannerStuckSearch(token, depth, budgetMs),
    score: (lines) => api.plannerScore(token, lines),
    fold: (lines, tags, budgetMs) => api.plannerFold(token, lines, tags, budgetMs),
    sequence: (landmarksFirst) => api.plannerSequence(token, landmarksFirst),
    explain: (line) => api.plannerExplain(token, line),
    toRf: (lines) => api.plannerToRf(token, lines),
    fromRf: (points) => api.plannerFromRf(token, points),
  };
}

/**
 * The two ReferenceFinder clients the loop may use, both over the **planner**
 * instance so per-target settings can never change what the planner's cache
 * was computed from (plan decision D7).
 */
export interface PrecreasePlanReferenceFinder {
  /** `goodEnoughError` 1e-9, `count` 5 — the stuck fallback's exact queries. */
  exact: ReferenceFinderClient;
  /**
   * `goodEnoughError` 0.005, `count` 1 — the best *approximation* of a line no
   * exact construction reaches, for the findings list. Never folded.
   */
  approximate?: ReferenceFinderClient;
}

export type PrecreasePlanPhase =
  | 'closing'
  | 'searching'
  | 'querying'
  | 'approximating'
  | 'done';

export interface PrecreasePlanProgress {
  phase: PrecreasePlanPhase;
  /** CP lines folded so far. */
  folded: number;
  /** CP lines still to fold. */
  remaining: number;
  /** Distinct CP lines the component has (free outline lines excluded). */
  targets: number;
  /** Lines queried out of the batch in flight, when `phase` is a query phase. */
  queried?: number;
  queryTotal?: number;
}

export interface PrecreasePlanOptions {
  /** The revision the caller will compare against before using the result. */
  computedAtRevision: string;
  referenceFinder?: PrecreasePlanReferenceFinder | null;
  /** Whole-run ceiling, milliseconds (plan default 30 s). */
  totalBudgetMs?: number;
  /** One resumable `close()` chunk, milliseconds. */
  closeChunkMs?: number;
  /** Stuck-search depth (plan: 2, the crate deepens to 3 itself when it can). */
  stuckDepth?: number;
  /** Per stuck event, milliseconds (plan: 4 s, twice the measured worst case). */
  stuckBudgetMs?: number;
  /** How many ReferenceFinder fallbacks one run may spend. */
  maxReferenceFinderEvents?: number;
  landmarksFirst?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: PrecreasePlanProgress) => void;
  /** Injectable clock, so the tests are not timing-dependent. */
  now?: () => number;
}

/**
 * Why the loop stopped. `complete` and `off_lattice` are the two ends the
 * algorithm reaches on purpose; every other value means the answer is partial.
 */
/**
 * Why a plan run ended.
 *
 * The crate's `drive::StopReason`, not a second list. This was that second
 * list — it had grown `budget`, `aborted` and `point_cap`, which the crate
 * could not express, so the same pattern could stop for different reasons
 * depending on which driver ran it.
 */
export type PrecreasePlanStopReason = PrecreaseStopReason;

/** ReferenceFinder's best approximation of a line the plan cannot construct. */
export interface PrecreaseApproximateFinding {
  /** Index into `sequence.findings`. */
  finding: number;
  cpLineIds: number[];
  /** Steps in the approximating construction, including its free diagonals. */
  foldCount: number;
  err: number;
  rank: number;
}

export interface PrecreasePlanResult {
  computedAtRevision: string;
  component: number;
  info: PrecreasePlannerInfo;
  sequence: PrecreaseSequence;
  stopReason: PrecreasePlanStopReason;
  /** The plan does not cover every line, for whatever reason. */
  partial: boolean;
  /** Best approximations for the lines in `sequence.findings`, when asked for. */
  approximate: PrecreaseApproximateFinding[];
  /** Auxiliary lines taken from a ReferenceFinder solution and certified. */
  rfAuxFolded: number;
  /** ReferenceFinder line queries the run made. */
  rfQueries: number;
  stuckEvents: number;
  durationMs: number;
  landmarksFirst: boolean;
}

const DEFAULTS = {
  totalBudgetMs: 30_000,
  closeChunkMs: 250,
  stuckDepth: 2,
  stuckBudgetMs: 4_000,
  maxReferenceFinderEvents: 4,
} as const;

/** A `close()` that never advances would spin; this many in a row ends it. */
const MAX_IDLE_CLOSE_CHUNKS = 4;

/** Raised when the caller's signal fires; caught by the loop, never escapes. */
class PlanAborted extends Error {
  constructor() {
    super('precrease plan aborted');
    this.name = 'PlanAborted';
  }
}

/**
 * Run the loop. Always resolves — an abort, an exhausted budget and an
 * unsolvable line are all *results*, distinguished by `stopReason`, so the
 * caller can render the partial plan instead of an error.
 */
export async function runPrecreasePlan(
  planner: PrecreasePlannerHandle,
  options: PrecreasePlanOptions
): Promise<PrecreasePlanResult> {
  const now = options.now ?? (() => Date.now());
  const started = now();
  const totalBudgetMs = options.totalBudgetMs ?? DEFAULTS.totalBudgetMs;
  const closeChunkMs = options.closeChunkMs ?? DEFAULTS.closeChunkMs;
  const stuckDepth = options.stuckDepth ?? DEFAULTS.stuckDepth;
  const stuckBudgetMs = options.stuckBudgetMs ?? DEFAULTS.stuckBudgetMs;
  const maxRfEvents = options.maxReferenceFinderEvents ?? DEFAULTS.maxReferenceFinderEvents;
  const landmarksFirst = options.landmarksFirst ?? false;
  const { signal, onProgress, referenceFinder } = options;

  const info = await planner.info();
  const outOfTime = () => totalBudgetMs > 0 && now() - started >= totalBudgetMs;
  const checkAbort = () => {
    if (signal?.aborted) throw new PlanAborted();
  };
  const report = (phase: PrecreasePlanPhase, state: { folded: number; remaining: number }, extra?: { queried: number; queryTotal: number }) => {
    onProgress?.({
      phase,
      folded: state.folded,
      remaining: state.remaining,
      targets: info.targets - info.free_targets,
      ...(extra ?? {}),
    });
  };

  let remaining = info.remaining;
  let folded = 0;
  let rfEvents = 0;
  let rfQueries = 0;
  let rfAuxFolded = 0;
  let stuckEvents = 0;

  if (info.refused) {
    const sequence = await planner.sequence(landmarksFirst);
    return {
      computedAtRevision: options.computedAtRevision,
      component: info.component,
      info,
      sequence,
      stopReason: 'refused_sheet',
      partial: true,
      approximate: [],
      rfAuxFolded: 0,
      rfQueries: 0,
      stuckEvents: 0,
      durationMs: now() - started,
      landmarksFirst,
    };
  }

  // Assigned by every arm of the loop below, including the abort handler.
  let stop: PrecreasePlanStopReason;
  try {
    // The loop BODY is here because it has to be: it awaits ReferenceFinder,
    // it chunks the closure so a large pattern does not freeze the UI, and it
    // checks for abort between chunks. None of that can be a synchronous Rust
    // loop, which is why this function exists at all.
    //
    // The DECISIONS are not here, and that is the point. `planner.nextAction`
    // is the crate's `drive::next_action` — the one copy of the rules. This was
    // a hand-written ladder of exits, and it had drifted from the Rust one:
    // separate arms for stalling, off-lattice patterns and the RF cap, and
    // three stop reasons the crate had never heard of. The same pattern could
    // stop for different reasons depending on which driver ran it.
    let last: PrecreaseLastStep = { kind: 'nothing' };
    for (;;) {
      checkAbort();
      const action = await planner.nextAction({
        last,
        out_of_time: outOfTime(),
        // Abort is a throw here, not a state: `checkAbort` above has already
        // unwound if the signal fired. The field exists for a driver that
        // polls rather than throws.
        aborted: false,
        reference_finder: Boolean(referenceFinder),
        rf_events: rfEvents,
        max_rf_events: maxRfEvents,
      });

      if (action.kind === 'stop') {
        stop = action.reason;
        break;
      }

      if (action.kind === 'close') {
        const closed = await closeToFixpoint();
        folded += closed.folded;
        remaining = closed.remaining;
        last = { kind: 'closed', stalled: closed.stalled };
        continue;
      }

      if (action.kind === 'stuck_search') {
        // Before the search, not only at the top of the loop: `stuckSearch` is
        // the one call that cannot be interrupted once it starts, and it has a
        // four-second budget. A Stop pressed during the closure must not buy
        // four more seconds of searching.
        checkAbort();
        report('searching', { folded, remaining });
        const summary = await planner.stuckSearch(stuckDepth, stuckBudgetMs);
        if (summary) stuckEvents += 1;
        last = { kind: 'searched', found: Boolean(summary) };
        continue;
      }

      // `ask_reference_finder`, which the rules only ever return because we
      // told them we have one.
      rfEvents += 1;
      const fallback = await referenceFinderFallback();
      rfQueries += fallback.queries;
      if (fallback.aborted) checkAbort();
      if (fallback.folded) rfAuxFolded += 1;
      last = { kind: 'asked_reference_finder', folded: fallback.folded };
    }
  } catch (error) {
    if (!(error instanceof PlanAborted)) throw error;
    stop = 'aborted';
  }

  const sequence = await planner.sequence(landmarksFirst);
  if (sequence.diagnostics.point_cap_hit) stop = 'point_cap';

  let approximate: PrecreaseApproximateFinding[] = [];
  if (referenceFinder?.approximate && sequence.findings.length > 0 && !signal?.aborted) {
    report('approximating', { folded, remaining });
    approximate = await approximateFindings(
      referenceFinder.approximate,
      sequence.findings,
      signal,
      (queried, queryTotal) =>
        report('approximating', { folded, remaining }, { queried, queryTotal })
    );
  }

  report('done', { folded, remaining });
  return {
    computedAtRevision: options.computedAtRevision,
    component: info.component,
    info,
    sequence,
    stopReason: stop,
    // Off-lattice is a deliberate end, not a failure — but it still leaves
    // lines unfolded, so the summary strip must say so.
    partial: stop !== 'complete',
    approximate,
    rfAuxFolded,
    rfQueries,
    stuckEvents,
    durationMs: now() - started,
    landmarksFirst,
  };

  /**
   * `close()` in chunks until the fixpoint, the budget or the signal. Chunked
   * so a 2 s closure yields to the message loop eight times instead of once —
   * that is the whole reason the crate's `close` is resumable.
   */
  async function closeToFixpoint(): Promise<{ folded: number; remaining: number; stalled: boolean }> {
    let closedFolded = 0;
    let idle = 0;
    for (;;) {
      checkAbort();
      const budget = outOfTime() ? 1 : closeChunkMs;
      const chunk = await planner.close(budget);
      closedFolded += chunk.folded;
      report('closing', { folded: folded + closedFolded, remaining: chunk.remaining });
      if (chunk.fixpoint || chunk.remaining === 0) {
        return { folded: closedFolded, remaining: chunk.remaining, stalled: false };
      }
      idle = chunk.folded === 0 ? idle + 1 : 0;
      if (outOfTime() && idle >= MAX_IDLE_CLOSE_CHUNKS) {
        return { folded: closedFolded, remaining: chunk.remaining, stalled: true };
      }
    }
  }

  /**
   * The fallback: ask ReferenceFinder about every remaining line once, from
   * the **bare sheet**, mine the answers for the lines they construct, and
   * fold the one the planner certifies that unlocks the most.
   *
   * Nothing is applied verbatim. A candidate that scores 1 unlocks nothing —
   * folding it would add an auxiliary crease for no progress — so the floor is
   * 2, which also makes the loop terminate: every accepted fold strictly
   * reduces the remaining set.
   */
  async function referenceFinderFallback(): Promise<{
    folded: boolean;
    queries: number;
    aborted: boolean;
  }> {
    const client = referenceFinder?.exact;
    if (!client) return { folded: false, queries: 0, aborted: false };
    const lines = decodeRemaining(await planner.remaining());
    const keys = await planner.lineKeys();
    const requests: ReferenceFinderLineRequest[] = lines.map((line, i) => ({
      a: line.segment[0] as RfPoint,
      b: line.segment[1] as RfPoint,
      key: keys[i] ?? `${line.line.n[0]},${line.line.n[1]},${line.line.d}`,
    }));
    report('querying', { folded, remaining }, { queried: 0, queryTotal: requests.length });
    const outcome = await client.batchLines(
      requests,
      (done, total) => report('querying', { folded, remaining }, { queried: done, queryTotal: total }),
      signal
    );
    const queries = outcome.results.length - outcome.fromCache;
    const candidates = candidateLinesFrom(outcome.results);
    if (candidates.length === 0) {
      return { folded: false, queries, aborted: outcome.aborted };
    }
    const planLines = decodeLines(await planner.fromRf(Float64Array.from(candidates.flat())));
    const scores = await planner.score(encodeLines(planLines));
    const best = bestCandidate(planLines, scores);
    if (!best) return { folded: false, queries, aborted: outcome.aborted };
    const outcomes = await planner.fold(
      encodeLines([best]),
      Uint8Array.from([PRECREASE_TAG.rfAux]),
      stuckBudgetMs
    );
    const applied = outcomes.some((entry) => entry.kind === 'folded');
    return { folded: applied, queries, aborted: outcome.aborted };
  }
}

/**
 * Every distinct line a batch's solutions construct, as `[ax, ay, bx, by]`
 * quadruples in ReferenceFinder coordinates.
 *
 * Deduped on a quantised chord key so the same line reached from five
 * solutions of five targets is scored once. Only *line* steps contribute: a
 * mark step makes no crease, and a free diagonal is not a fold.
 */
function candidateLinesFrom(
  results: readonly ReferenceFinderBatchResult[]
): [number, number, number, number][] {
  const seen = new Set<string>();
  const out: [number, number, number, number][] = [];
  for (const result of results) {
    if (!('solutions' in result)) continue;
    for (const solution of result.solutions) {
      for (const step of solution.steps) {
        if (!step.line) continue;
        const { a, b } = step.line;
        if (!Number.isFinite(a[0]) || !Number.isFinite(a[1])) continue;
        if (!Number.isFinite(b[0]) || !Number.isFinite(b[1])) continue;
        if (a[0] === b[0] && a[1] === b[1]) continue;
        const key = chordKey(a, b);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([a[0], a[1], b[0], b[1]]);
      }
    }
  }
  return out;
}

/**
 * An endpoint-order-independent key for a chord, quantised well below the
 * planner's own tolerance. Only a pre-filter — the planner decides line
 * identity itself, in Rust, at `TOL`.
 */
function chordKey(a: RfPoint, b: RfPoint): string {
  const q = (v: number) => Math.round(v * 1e9);
  const first: [number, number] = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? a : b;
  const second: [number, number] = first === a ? b : a;
  return `${q(first[0])},${q(first[1])},${q(second[0])},${q(second[1])}`;
}

/**
 * The cheapest useful candidate: the one unlocking the most CP lines, ties
 * broken by canonical line order so the same state always picks the same fold.
 * `score` is `0` for "not constructible from here" and `1 + unlocks`
 * otherwise, so a score below 2 unlocks nothing.
 */
export function bestCandidate(
  lines: readonly PrecreasePlanLine[],
  scores: ArrayLike<number>
): PrecreasePlanLine | null {
  let best: PrecreasePlanLine | null = null;
  let bestScore = 1;
  for (let i = 0; i < lines.length; i += 1) {
    const score = scores[i] ?? 0;
    if (score < 2) continue;
    if (score > bestScore || (score === bestScore && best !== null && lineBefore(lines[i], best))) {
      best = lines[i];
      bestScore = score;
    }
  }
  return best;
}

function lineBefore(a: PrecreasePlanLine, b: PrecreasePlanLine): boolean {
  if (a.n[0] !== b.n[0]) return a.n[0] < b.n[0];
  if (a.n[1] !== b.n[1]) return a.n[1] < b.n[1];
  return a.d < b.d;
}

/**
 * ReferenceFinder's best approximation of each finding, for the sidebar's
 * "approximate findings" section. Reported only — a finding never becomes a
 * fold (D8), which is why this runs after the loop rather than inside it.
 */
async function approximateFindings(
  client: ReferenceFinderClient,
  findings: readonly PrecreaseFinding[],
  signal: AbortSignal | undefined,
  onProgress: (done: number, total: number) => void
): Promise<PrecreaseApproximateFinding[]> {
  const indexed = findings
    .map((finding, index) => ({ finding, index }))
    .filter((entry) => entry.finding.segment !== null);
  if (indexed.length === 0) return [];
  const outcome = await client.batchLines(
    indexed.map(({ finding }) => {
      const segment = finding.segment as [[number, number], [number, number]];
      return {
        a: segment[0] as RfPoint,
        b: segment[1] as RfPoint,
        key: `approx:${finding.line.n[0]},${finding.line.n[1]},${finding.line.d}`,
      };
    }),
    onProgress,
    signal
  );
  const out: PrecreaseApproximateFinding[] = [];
  outcome.results.forEach((result, i) => {
    if (!('solutions' in result) || result.solutions.length === 0) return;
    const best = result.solutions.reduce((a, b) => (b.err < a.err ? b : a));
    out.push({
      finding: indexed[i].index,
      cpLineIds: indexed[i].finding.cp_line_ids,
      foldCount: best.foldCount,
      err: best.err,
      rank: best.rank,
    });
  });
  return out;
}
