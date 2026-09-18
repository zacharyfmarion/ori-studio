import { nextActionDouble } from './driveRulesDouble';
import type { PrecreaseLastStep, PrecreasePlanAction } from './precreaseSequence';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { runPrecreasePlan, type PrecreasePlannerHandle } from './precreasePlan';
import { describePlannerStep } from './referencesStepSentences';
import type {
  PrecreaseCloseReport,
  PrecreaseExplanation,
  PrecreaseFoldOutcome,
  PrecreasePlannerInfo,
  PrecreaseSequence,
  PrecreaseStep,
  PrecreaseStuckSummary,
} from './precreaseSequence';

/**
 * The orchestrator over the real planner, on real crease patterns.
 *
 * The crate's own tests prove the planner; the fake-planner tests prove the
 * loop's control flow. What neither covers is the two of them together — that
 * the chunked `close`, the stuck search and the budgets, driven from
 * TypeScript through the wasm bridge, reproduce the auxiliary counts
 * `tests/fixtures/precrease/manifest.json` records. A regression here would
 * mean the loop is not driving the planner the way the crate's own `plan()`
 * does, which no other test would notice.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
// Vitest runs with `apps/web` as its root; `import.meta.url` is not a file
// URL under jsdom, so the paths are resolved from there rather than from the
// module.
const ROOT = process.cwd();
const WASM = resolve(
  ROOT,
  'src/generated/oristudio-precrease-wasm/oristudio_precrease_wasm_bg.wasm'
);
/** Planner options with the precrease grid off: every line folded on its own. */
const LINE_BY_LINE = JSON.stringify({ precrease_grid: false });
const FIXTURES = resolve(ROOT, '../../tests/fixtures/precrease');
const MANIFEST = resolve(FIXTURES, 'manifest.json');
const available = existsSync(WASM) && existsSync(MANIFEST);

/**
 * The English default with `{{name}}` interpolations applied, plural and
 * ordinal forms picked as English picks them — the sentence tests' renderer.
 */
function render(_key: string, second?: unknown, third?: unknown): string {
  const options = (typeof second === 'object' && second !== null ? second : third) as
    | Record<string, unknown>
    | undefined;
  let fallback = typeof second === 'string' ? second : '';
  if (typeof options?.count === 'number') {
    const type = options.ordinal === true ? 'ordinal' : 'cardinal';
    const category = new Intl.PluralRules('en', { type }).select(options.count);
    const suffix = type === 'ordinal' ? `_ordinal_${category}` : `_${category}`;
    fallback = String(options[`defaultValue${suffix}`] ?? options.defaultValue ?? fallback);
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    String(options?.[name] ?? `{{${name}}}`)
  );
}
const t = render as unknown as TFunction;

/** Oriedita colour code for a FOLD assignment (`crates/…/fixture_io.rs`). */
function colorOfAssignment(assignment: string | undefined): number {
  switch (assignment) {
    case 'B':
      return 0;
    case 'M':
      return 1;
    case 'V':
      return 2;
    case 'U':
      return -1;
    default:
      return 3;
  }
}

function loadFold(name: string): { segments: Float64Array; colors: Int32Array } {
  const fold = JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8')) as {
    vertices_coords: [number, number][];
    edges_vertices: [number, number][];
    edges_assignment?: string[];
  };
  const segments = new Float64Array(fold.edges_vertices.length * 4);
  const colors = new Int32Array(fold.edges_vertices.length);
  fold.edges_vertices.forEach(([a, b], index) => {
    const va = fold.vertices_coords[a];
    const vb = fold.vertices_coords[b];
    segments.set([va[0], va[1], vb[0], vb[1]], index * 4);
    colors[index] = colorOfAssignment(fold.edges_assignment?.[index]);
  });
  return { segments, colors };
}

function fixtureEntry(file: string) {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
    fixtures: {
      file: string;
      crate: number | null;
      status: string;
      grid: { kind: 'box' | 'hex'; n: number; steps: number; lines: number } | null;
    }[];
  };
  const entry = manifest.fixtures.find((fixture) => fixture.file.endsWith(file));
  if (!entry) throw new Error(`no manifest entry for ${file}`);
  return entry;
}

function expectedAux(file: string): number {
  const { crate } = fixtureEntry(file);
  if (crate === null) throw new Error(`no crate value for ${file} in the manifest`);
  return crate;
}

/**
 * The status the manifest records, which `planner_fixtures.rs` asserts the
 * headless driver reaches.
 *
 * Read from the same file rather than written here, because that is what makes
 * this an agreement test: with `referenceFinder: null` this driver and
 * `Planner::plan_without_reference_finder` are supposed to be the same planner,
 * and two hard-coded copies of the answer could not tell you when they stopped
 * being one.
 */
function expectedStatus(file: string): string {
  return fixtureEntry(file).status;
}

/** The wasm planner as the loop's handle: every call is already synchronous. */
function handleFor(planner: {
  info(): unknown;
  close(budget: number): unknown;
  remaining(): Float64Array;
  line_keys(): string[];
  stuck_search(depth: number, budget: number): unknown;
  score(lines: Float64Array): Uint32Array;
  fold(lines: Float64Array, tags: Uint8Array, budget: number): unknown;
  fold_approximation(
    target: Float64Array,
    constructed: Float64Array,
    err: number,
    budget: number
  ): unknown;
  sequence(landmarksFirst: boolean): unknown;
  next_action(driver: unknown): unknown;
  explain(line: Float64Array): unknown;
  to_rf(lines: Float64Array): Float64Array;
  from_rf(points: Float64Array): Float64Array;
}): PrecreasePlannerHandle {
  return {
    info: async () => planner.info() as PrecreasePlannerInfo,
    nextAction: async (driver) => planner.next_action(driver) as PrecreasePlanAction,
    close: async (budgetMs) => planner.close(budgetMs) as PrecreaseCloseReport,
    remaining: async () => planner.remaining(),
    lineKeys: async () => planner.line_keys(),
    stuckSearch: async (depth, budgetMs) =>
      planner.stuck_search(depth, budgetMs) as PrecreaseStuckSummary | null,
    score: async (lines) => planner.score(lines),
    fold: async (lines, tags, budgetMs) =>
      planner.fold(lines, tags, budgetMs) as PrecreaseFoldOutcome[],
    foldApproximation: async (target, constructed, err, budgetMs) =>
      planner.fold_approximation(target, constructed, err, budgetMs) as PrecreaseFoldOutcome,
    sequence: async (landmarksFirst) => planner.sequence(landmarksFirst) as PrecreaseSequence,
    explain: async (line) => planner.explain(line) as PrecreaseExplanation,
    toRf: async (lines) => planner.to_rf(lines),
    fromRf: async (points) => planner.from_rf(points),
  };
}

describe.skipIf(!available)('runPrecreasePlan over the real planner bridge', () => {
  async function plan(file: string, component = 0, options = '') {
    const wasm = await import('../../generated/oristudio-precrease-wasm/oristudio_precrease_wasm');
    wasm.initSync({ module: readFileSync(WASM) });
    const { segments, colors } = loadFold(file);
    const planner = new wasm.PrecreasePlanner(segments, colors, undefined, component, options);
    try {
      const started = performance.now();
      const result = await runPrecreasePlan(handleFor(planner), {
        computedAtRevision: 'wasm',
        // No ReferenceFinder: both fixtures are on a lattice, so the closure
        // and the forward-first search are meant to be enough. Handing the
        // loop no fallback is how that claim is tested rather than assumed.
        referenceFinder: null,
      });
      return { result, wallMs: performance.now() - started };
    } finally {
      planner.free();
    }
  }

  // The unit tests drive the loop against a fake, and a fake has to answer
  // "what next?" — so `driveRulesDouble.ts` is a second copy of rules whose
  // whole purpose is to exist once. This is what keeps that honest: every
  // combination of inputs, through the double and through the crate, asserted
  // equal. A rule changed in Rust and not in the double turns this red.
  it('the unit tests’ rules double answers exactly as the crate does', async () => {
    const wasm = await import('../../generated/oristudio-precrease-wasm/oristudio_precrease_wasm');
    wasm.initSync({ module: readFileSync(WASM) });
    const { segments, colors } = loadFold('grid6.fold');
    const planner = new wasm.PrecreasePlanner(segments, colors, undefined, 0, '');
    try {
      // A fresh planner: nothing folded, nothing refused, on a lattice — so
      // `PlanState` is all false and the double can be handed the same.
      const plan = {
        refused: false,
        complete: false,
        point_cap_hit: false,
      };
      const lasts: PrecreaseLastStep[] = [
        { kind: 'nothing' },
        { kind: 'closed', stalled: false },
        { kind: 'closed', stalled: true },
        { kind: 'searched', found: false },
        { kind: 'searched', found: true },
        { kind: 'asked_reference_finder', folded: false },
        { kind: 'asked_reference_finder', folded: true },
        { kind: 'approximated', folded: false },
        { kind: 'approximated', folded: true },
      ];
      let checked = 0;
      for (const last of lasts) {
        for (const out_of_time of [false, true]) {
          for (const aborted of [false, true]) {
            for (const reference_finder of [false, true]) {
              for (const approximate of [false, true]) {
                for (const [rf_events, max_rf_events] of [
                  [0, 0],
                  [0, 3],
                  [3, 3],
                  [4, 3],
                ]) {
                  const driver = {
                    last,
                    out_of_time,
                    aborted,
                    reference_finder,
                    rf_events,
                    max_rf_events,
                    approximate,
                  };
                  expect(nextActionDouble(plan, driver)).toEqual(
                    planner.next_action(driver) as PrecreasePlanAction
                  );
                  checked += 1;
                }
              }
            }
          }
        }
      }
      // A loop that silently checked nothing would pass too.
      expect(checked).toBe(lasts.length * 2 * 2 * 2 * 2 * 4);
    } finally {
      planner.free();
    }
  });

  // The crate raises the `|P|` cap as an error from `close`, records it, and
  // answers `stop` to it on the next ask — a contract the loop only honours if
  // it survives the error. Grid off, so the cap trips inside the closure and
  // not in the grid pass, which swallows it on its own.
  it('reports the point cap as a stop reason rather than an error', async () => {
    const { result } = await plan(
      'grid6.fold',
      0,
      JSON.stringify({ precrease_grid: false, point_cap: 8 })
    );
    expect(result.stopReason).toBe('point_cap');
    expect(result.partial).toBe(true);
    expect(result.sequence.diagnostics.point_cap_hit).toBe(true);
    expect(result.sequence.totals.unsolved).toBeGreaterThan(0);
    // What was folded before the cap is on the paper, and in the plan.
    expect(result.sequence.totals.folds).toBeGreaterThan(0);
  });

  it('plans grid6 with the auxiliary count the manifest records', async () => {
    const { result } = await plan('grid6.fold');
    // The same manifest entry the Rust driver is held to.
    expect(result.stopReason).toBe(expectedStatus('grid6.fold'));
    expect(result.sequence.status).toBe(expectedStatus('grid6.fold'));
    expect(result.sequence.totals.aux).toBe(expectedAux('grid6.fold'));
    expect(result.sequence.totals.unsolved).toBe(0);
    expect(result.rfAuxFolded).toBe(0);
  });

  it('opens grid6 with the grid the manifest records, in the shape the cards read', async () => {
    const { result } = await plan('grid6.fold');
    const { sequence } = result;
    const recorded = fixtureEntry('grid6.fold').grid;
    expect(recorded).not.toBeNull();
    expect(sequence.grid).toMatchObject({
      kind: recorded!.kind,
      n: recorded!.n,
      steps: recorded!.steps,
      lines: recorded!.lines,
      families: 2,
    });
    expect(typeof sequence.totals.grid_unwanted_length).toBe('number');
    // Every field the browser reads off a grid step crosses the bridge — a
    // field the crate stopped emitting would otherwise read as undefined
    // and the sentence would say "into undefined".
    const first = sequence.steps[0]!;
    expect(first.kind).toBe('grid');
    expect(first.grid).toBeDefined();
    expect(first.grid!.cells).toBe(6);
    expect(first.grid!.level).toBe(6);
    expect(first.grid!.pleat).toBe(true);
    expect(first.grid!.regions).toEqual([]);
    expect(first.grid!.lines).toHaveLength(5);
    for (const line of first.grid!.lines) {
      expect(['mountain', 'valley']).toContain(line.direction);
      expect(typeof line.pattern_share).toBe('number');
      expect(line.cp_line_ids.length).toBe(line.cp_spans.length);
    }
    expect(describePlannerStep(t, sequence, 0)).toBe(
      'Pleat the sheet into 6ths vertically: 5 lines, alternating mountain and valley, mountain first.'
    );
    expect(sequence.steps.slice(2).every((step) => step.kind !== 'grid')).toBe(true);
  });

  // The iguana's horizontals are held only across the middle: made where
  // needed, they are a band of 25ths and a band of 50ths there, and every
  // field a band step's card and sentence read crosses the bridge.
  it('makes the iguana’s grid in bands where the pattern needs it, and whole when asked', async () => {
    const { result } = await plan('iguana-c0.fold');
    const { sequence } = result;
    const recorded = fixtureEntry('iguana-c0.fold').grid!;
    expect(sequence.grid).toMatchObject({ steps: recorded.steps, lines: recorded.lines });
    const grid = sequence.steps.filter((step) => step.kind === 'grid');
    expect(grid).toHaveLength(recorded.steps);
    const bands = grid.filter((step) => !step.grid!.pleat);
    expect(bands.length).toBeGreaterThan(0);
    for (const step of bands) {
      const family = step.grid!;
      expect(family.level).toBeGreaterThan(0);
      expect(family.regions.length).toBeGreaterThan(0);
      for (const region of family.regions) {
        expect(region.lines).toBeGreaterThan(0);
        for (const bound of [...region.bounds, ...(region.along ?? [])]) {
          expect(typeof bound.fraction).toBe('number');
          expect(bound.edge === null || typeof bound.edge === 'string').toBe(true);
          expect(bound.line_id === null || typeof bound.line_id === 'number').toBe(true);
        }
        if (region.extent) {
          expect(region.extent[0]).toBeLessThan(region.extent[1]);
          expect(region.along).toBeDefined();
        }
      }
      // A band line's extent crosses as a list of spans, each within the
      // chord, with every pattern crease inside it.
      for (const line of family.lines) {
        expect(Array.isArray(line.spans)).toBe(true);
        for (const crease of line.cp_spans) {
          if (line.spans.length === 0) continue;
          const t = (p: [number, number]) =>
            (p[0] - line.segment[0][0]) * (line.segment[1][0] - line.segment[0][0]) +
            (p[1] - line.segment[0][1]) * (line.segment[1][1] - line.segment[0][1]);
          const inside = line.spans.some(([a, b]) => {
            const [u, v] = [t(a), t(b)].sort((x, y) => x - y);
            return t(crease[0]) >= u - 1e-9 && t(crease[0]) <= v + 1e-9 && t(crease[1]) >= u - 1e-9 && t(crease[1]) <= v + 1e-9;
          });
          expect(inside).toBe(true);
        }
      }
      expect(describePlannerStep(t, sequence, step.id - 1)).toMatch(/^Add the \d+\w+ .* between .*: \d+ lines, creased as shown\.$/);
    }
    // Whole: one pleat per family, every line of the finest grid.
    const { result: whole } = await plan('iguana-c0.fold', 0, JSON.stringify({ grid_where_needed: false }));
    const pleats = whole.sequence.steps.filter((step) => step.kind === 'grid');
    expect(pleats).toHaveLength(2);
    expect(pleats.every((step) => step.grid!.pleat)).toBe(true);
    expect(whole.sequence.totals.grid_lines).toBe(98);
    expect(whole.sequence.totals.grid_unwanted_length).toBeGreaterThan(
      sequence.totals.grid_unwanted_length
    );
  }, 120_000);

  // Every CP step's crease crosses the bridge as runs that hold the
  // pattern's pieces, carried out to references where those are near
  // enough, with the reach length that cost; asked not to reach, the plan
  // sends the pieces as they are and no reach at all.
  it('makes each CP step’s crease run from reference to reference, and the pieces when asked', async () => {
    const { result } = await plan('iguana-c0.fold');
    const { sequence } = result;
    const along = (step: PrecreaseStep, p: [number, number]) =>
      (p[0] - step.segment[0][0]) * (step.segment[1][0] - step.segment[0][0]) +
      (p[1] - step.segment[0][1]) * (step.segment[1][1] - step.segment[0][1]);
    const cp = sequence.steps.filter((step) => step.kind === 'cp' && step.cp_spans.length > 0);
    expect(cp.length).toBeGreaterThan(0);
    for (const step of cp) {
      expect(step.made.length).toBeGreaterThanOrEqual(1);
      const runs = step.made.map((run) =>
        [along(step, run[0]), along(step, run[1])].sort((a, b) => a - b)
      );
      for (const span of step.cp_spans) {
        const [a, b] = [along(step, span[0]), along(step, span[1])].sort((x, y) => x - y);
        expect(runs.some(([u, v]) => a >= u! - 1e-9 && b <= v! + 1e-9)).toBe(true);
      }
    }
    for (const step of sequence.steps.filter((step) => step.kind !== 'cp')) {
      expect(step.made).toEqual([]);
    }
    expect(sequence.totals.reach_length).toBeGreaterThan(0);
    // Line by line — the grid makes most of the iguana's lines — without
    // the rule: the pieces come back, and no reach at all. (The presses do
    // not: a mark on a crease left short is pinched while that crease is
    // made, whichever way the plan was made.)
    const { result: plain } = await plan(
      'iguana-c0.fold',
      0,
      JSON.stringify({ precrease_grid: false, reach_references: false })
    );
    expect(plain.sequence.totals.reach_length).toBeLessThan(1e-9);
    expect(
      plain.sequence.steps.some((step) => step.kind === 'cp' && (step.made?.length ?? 0) > 1)
    ).toBe(true);
  }, 180_000);

  it('plans the iguana component 0 with the auxiliary count the manifest records', async () => {
    const { result, wallMs } = await plan('iguana-c0.fold');
    // 1,774 segments merging to 89 distinct lines, one depth-2 stuck event.
    expect(result.stopReason).toBe(expectedStatus('iguana-c0.fold'));
    expect(result.sequence.status).toBe(expectedStatus('iguana-c0.fold'));
    expect(result.sequence.totals.aux).toBe(expectedAux('iguana-c0.fold'));
    expect(result.sequence.totals.unsolved).toBe(0);
    expect(result.rfQueries).toBe(0);
    // Recorded rather than asserted tightly: the number that matters is in the
    // PR notes, and a wall-clock assertion on a shared runner is a flake.
    expect(wallMs).toBeGreaterThan(0);
  }, 60_000);

  it('drives the closure in resumable chunks and reports progress', async () => {
    const wasm = await import('../../generated/oristudio-precrease-wasm/oristudio_precrease_wasm');
    wasm.initSync({ module: readFileSync(WASM) });
    const { segments, colors } = loadFold('iguana-c0.fold');
    // Line by line: pleated on its grid, iguana closes in one chunk, and
    // this is a test of the chunking.
    const planner = new wasm.PrecreasePlanner(segments, colors, undefined, 0, LINE_BY_LINE);
    const phases: string[] = [];
    try {
      await runPrecreasePlan(handleFor(planner), {
        computedAtRevision: 'wasm',
        referenceFinder: null,
        closeChunkMs: 20,
        onProgress: (progress) => phases.push(progress.phase),
      });
    } finally {
      planner.free();
    }
    // Several closing reports, not one: that is what makes a long run
    // cancellable and what the resumable `close(budget_ms)` exists for.
    expect(phases.filter((phase) => phase === 'closing').length).toBeGreaterThan(1);
    expect(phases.at(-1)).toBe('done');
  }, 60_000);

  it('returns a partial plan when the signal fires mid-run', async () => {
    const wasm = await import('../../generated/oristudio-precrease-wasm/oristudio_precrease_wasm');
    wasm.initSync({ module: readFileSync(WASM) });
    const { segments, colors } = loadFold('iguana-c0.fold');
    const planner = new wasm.PrecreasePlanner(segments, colors, undefined, 0, LINE_BY_LINE);
    const controller = new AbortController();
    try {
      const result = await runPrecreasePlan(handleFor(planner), {
        computedAtRevision: 'wasm',
        referenceFinder: null,
        closeChunkMs: 5,
        signal: controller.signal,
        onProgress: () => controller.abort(),
      });
      expect(result.stopReason).toBe('aborted');
      expect(result.partial).toBe(true);
      // Whatever it had folded is still a usable, clearly-partial answer.
      expect(result.sequence.totals.unsolved).toBeGreaterThan(0);
    } finally {
      planner.free();
    }
  }, 60_000);
});
