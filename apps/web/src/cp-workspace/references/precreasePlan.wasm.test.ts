import { nextActionDouble } from './driveRulesDouble';
import type { PrecreaseLastStep, PrecreasePlanAction } from './precreaseSequence';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPrecreasePlan, type PrecreasePlannerHandle } from './precreasePlan';
import type {
  PrecreaseCloseReport,
  PrecreaseExplanation,
  PrecreaseFoldOutcome,
  PrecreasePlannerInfo,
  PrecreaseSequence,
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
    fixtures: { file: string; crate: number | null; status: string }[];
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
  async function plan(file: string, component = 0) {
    const wasm = await import('../../generated/oristudio-precrease-wasm/oristudio_precrease_wasm');
    wasm.initSync({ module: readFileSync(WASM) });
    const { segments, colors } = loadFold(file);
    const planner = new wasm.PrecreasePlanner(segments, colors, undefined, component, '');
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

  it('plans grid6 with the auxiliary count the manifest records', async () => {
    const { result } = await plan('grid6.fold');
    // The same manifest entry the Rust driver is held to.
    expect(result.stopReason).toBe(expectedStatus('grid6.fold'));
    expect(result.sequence.status).toBe(expectedStatus('grid6.fold'));
    expect(result.sequence.totals.aux).toBe(expectedAux('grid6.fold'));
    expect(result.sequence.totals.unsolved).toBe(0);
    expect(result.rfAuxFolded).toBe(0);
  });

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
