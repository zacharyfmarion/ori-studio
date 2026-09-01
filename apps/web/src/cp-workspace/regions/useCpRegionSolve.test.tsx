import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CP_EXACT_SOLVE_REQUEST_EVENT } from '../../commands/menuActions';
import { runCpExactSolve, type CpExactSolver } from '../../engine/cpExactSolve';
import {
  bindCpExactSolveRunStop,
  resetCpExactSolveRuns,
  withCpExactSolveRun,
} from '../../engine/cpExactSolveRuns';
import { CpExactSolveCancelledError } from '../../engine/cpExactSolveSession';
import { CpExactSolveInputRebuildError } from '../../engine/cpExactSolveInputRebuild';
import type {
  CpExactSolveMovementReport,
  CpExactSolveTheoremReport,
  CpExactSolvedGraph,
} from '../../engine/cpExactSolveTypes';
import type { OristudioCpLineSegment } from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { CanvasAnnotation } from '../annotations/annotation';
import { createCpSuppressionRegion } from '../annotations/suppressionRegion';
import { createCpImage } from '../images/cpImage';
import type { CpRegionSolveBinding } from './CpRegionLayer';
import { useCpRegionSolve } from './useCpRegionSolve';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';

/**
 * The solve binding: what each verb does to the document, what it records in
 * history, and what the chip is told while it runs.
 *
 * The real {@link runCpExactSolve} is used throughout with only its *bridge*
 * stubbed, so the two-stage split, the shared budget and the run registry are
 * all exercised rather than mocked past — those are the parts a chip binds to.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const track = vi.hoisted(() => vi.fn());
vi.mock('../../analytics', () => ({ track }));

/**
 * The toast is the result: a solve takes seconds and the user is watching the
 * creases, not the chip. So what it *says* is under test here, not just that one
 * fired — "Solved" over an editor still showing 70 angle markers is the single
 * most misleading thing this flow can do.
 */
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock('sonner', () => ({ toast }));

/**
 * The two bridge calls the solve makes *before* the solver: export the region's
 * creases as FOLD, and have the compiler rebuild an `ExactSolveInput` from it.
 *
 * Both need a kernel, so both are stubbed — but the FOLD they exchange is the
 * real shape, because it is what numbers the solver's vertices. `edges_vertices`
 * here mirrors {@link SEGMENTS}: four boundary edges round vertices 0-3, then the
 * interior crease between 4 and 5. That is what makes `vertex_id: 4` in a
 * movement report land on the crease it is supposed to.
 */
const FOLD_JSON = JSON.stringify({
  vertices_coords: [
    [100, 100],
    [500, 100],
    [500, 500],
    [100, 500],
    [300, 100],
    [300, 500],
  ],
  edges_vertices: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
  ],
});

const exportCreasesAsFold = vi.hoisted(() => vi.fn());
vi.mock('../../store/workspaceStore/oristudioCpRuntime', () => ({
  exportOristudioCpCreasesAsFold: exportCreasesAsFold,
}));

const rebuildSolveInput = vi.hoisted(() => vi.fn());
vi.mock('../../engine/cpExactSolveInputRebuild', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  rebuildCpExactSolveInput: rebuildSolveInput,
}));

/** The frame for the [100,500]² paper: no rotation, 400 units across. */
const REBUILT = {
  schema: 'oristudio/cp-detect/exact-solve-input-from-fold-v1',
  // Deliberately distinguishable from `REGION.solveInput`: the whole point is
  // which of the two reaches the solver.
  input: { schema: 'exact-solve-input', source: 'rebuilt-from-document', vertices: [] },
  transform: { origin: { x: 100, y: 100 }, ux: [1, 0], uy: [0, 1], side: 400, flip: 1 },
} as const;

const ACCEPTED: CpExactSolveMovementReport = {
  timed_out: false,
  accepted: true,
  rejection_reasons: [],
  elapsed_seconds: 0.4,
  max_vertex_movement: 0.001,
  // Vertex 4 is the interior crease's top end in `FOLD_JSON` — placement is by
  // id now, so this is the id that decides which crease end moves.
  moved_vertices: [
    { vertex_id: 4, before: { x: 0.5, y: 0 }, after: { x: 0.51, y: 0 }, movement: 0.01 },
  ],
};

const REJECTED: CpExactSolveMovementReport = {
  timed_out: false,
  accepted: false,
  rejection_reasons: ['movement_budget_exceeded'],
  elapsed_seconds: 0.3,
};

const TIMED_OUT: CpExactSolveMovementReport = {
  timed_out: true,
  accepted: false,
  rejection_reasons: ['exact solve timed out after 25.000s'],
  timeout_seconds: 25,
  elapsed_seconds: 25,
  attempted_max_vertex_movement: 0.002,
  attempted_moved_vertices: [
    { vertex_id: 4, before: { x: 0.5, y: 0 }, after: { x: 0.505, y: 0 }, movement: 0.005 },
  ],
};

/**
 * The theorem report `mid-solve_2.osf` came back with: accepted, `Ambiguous`,
 * Kawasaki 14.367° -> 0.00747° (a 1,900x improvement, and still ~7,500x above
 * the editor's own 1e-6° bar), three odd-degree vertices in and three out.
 */
const AMBIGUOUS_RESIDUALS: CpExactSolveTheoremReport = {
  before: { max_kawasaki_residual_degrees: 14.367, odd_degree_vertices: [12, 41, 77] },
  after: { max_kawasaki_residual_degrees: 0.00747, odd_degree_vertices: [12, 41, 77] },
};

/**
 * The solved geometry for {@link FOLD_JSON}, in the solver's unit square: the
 * paper corners, then the interior crease's two ends with the top one nudged to
 * 0.51 — 304 in document units.
 *
 * This, not `moved_vertices`, is what placement reads. The report is filtered by
 * the solver's own movement comparison and omits vertices it finishes after
 * taking it, so a fixture that carried only the report would not exercise the
 * channel the product uses.
 */
const VERTICES_EXACT = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: 0.51, y: 0 },
  { x: 0.5, y: 1 },
];

function graph(
  report: CpExactSolveMovementReport,
  theorem: CpExactSolveTheoremReport = {},
  verticesExact: { x: number; y: number }[] = VERTICES_EXACT
): CpExactSolvedGraph {
  return {
    schema: 'oristudio/cp-compiler/exact-solved-graph-v1',
    vertices_exact: report.accepted ? verticesExact : [],
    edges_exact: [],
    movement_report: report,
    theorem_residual_report: theorem,
    // `accepted` and `status` are two different questions and the solver answers
    // both: a run can be kept and still not be exact, which is what a theorem
    // report carrying odd-degree vertices means here.
    status: report.accepted ? (theorem.after ? 'ambiguous' : 'solved') : 'failed',
  };
}

/** What the last `solveExact` was actually handed, parsed back. */
let lastSolveInputJson: string | null = null;
function solveInputSeen(): unknown {
  return lastSolveInputJson === null ? null : JSON.parse(lastSolveInputJson);
}

/** A bridge that answers both stages with `report`, after `gate` settles. */
function bridge(
  report: CpExactSolveMovementReport,
  gate?: Promise<void>,
  theorem?: CpExactSolveTheoremReport,
  verticesExact?: { x: number; y: number }[]
): CpExactSolver {
  const answer = async () => {
    if (gate) await gate;
    return graph(report, theorem, verticesExact);
  };
  return {
    solveExact: async (inputJson) => {
      lastSolveInputJson = inputJson;
      return answer();
    },
    solveExactToFold: async () => ({
      schema: 'oristudio/cp-detect/solve-exact-fold-v1',
      solved: await answer(),
      fold: {},
    }),
  };
}

function segment(ax: number, ay: number, bx: number, by: number): OristudioCpLineSegment {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    active: 'Mountain',
    color: 'Mountain',
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
  } as OristudioCpLineSegment;
}

/** The paper square [100,500]², plus one interior crease the solve moves. */
const SEGMENTS: OristudioCpLineSegment[] = [
  segment(100, 100, 500, 100),
  segment(500, 100, 500, 500),
  segment(500, 500, 100, 500),
  segment(100, 500, 100, 100),
  segment(300, 100, 300, 500),
];

const REGION = createCpSuppressionRegion({
  id: 'region-1',
  center: { x: 300, y: 300 },
  width: 420,
  height: 420,
  label: 'Detected crease pattern',
  solveInput: { schema: 'exact-solve-input', vertices: [] },
  imageId: 'image-1',
});

/** A second detected pattern, well clear of the first. */
const OTHER_REGION = createCpSuppressionRegion({
  id: 'region-2',
  center: { x: 1300, y: 300 },
  width: 420,
  height: 420,
  solveInput: {},
});

/** The rectified underlay the repair flow places behind the creases. */
const IMAGE = createCpImage({
  id: 'image-1',
  src: 'data:image/jpeg;base64,xx',
  naturalWidth: 1024,
  naturalHeight: 1024,
  center: { x: 300, y: 300 },
  width: 400,
  height: 400,
  // Locked during repair so it never takes a click meant for the creases over
  // it — which is exactly why Accept has to release it.
  locked: true,
  opacity: 0.5,
});

describe('useCpRegionSolve', () => {
  // Scoped to the suite rather than the module: a `Probe` publishing its hook's
  // return has to assign to something, and `react-hooks/globals` reads a
  // module-scope assignment during render as the side effect it usually is.
  let host: HTMLDivElement;
  let root: Root;
  let api: CpRegionSolveBinding;
  let replaceLineSegments: ReturnType<typeof vi.fn>;
  let setSelection: ReturnType<typeof vi.fn>;
  let solver: CpExactSolver;

  function Probe() {
    api = useCpRegionSolve({
      // The real staged runner; only the bridge under it is stubbed.
      solve: (input, options) => runCpExactSolve(input, { ...options, solver: async () => solver }),
    });
    return null;
  }

  function seed(annotations: CanvasAnnotation[] = [IMAGE, REGION]): void {
    setSelection = vi.fn();
    replaceLineSegments = vi.fn(async (_ids: number[], segments: OristudioCpLineSegment[]) => {
      // Stands in for the kernel round trip: the store bumps the revision and
      // records one history entry carrying the previous document *and* the
      // annotation layer as it stands.
      const state = useWorkspaceStore.getState();
      useWorkspaceStore.setState({
        oristudioCpRevision: state.oristudioCpRevision + 1,
        oristudioCpHistoryPast: [
          ...state.oristudioCpHistoryPast,
          { annotations: state.oristudioCpAnnotations, segments },
        ],
      } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
      return true;
    });
    useWorkspaceStore.setState({
      oristudioCpDocument: {
        document: { crease_pattern: { line_segments: SEGMENTS }, metadata: {} },
      },
      oristudioCpAnnotations: annotations,
      oristudioCpSelectedAnnotationId: null,
      oristudioCpSelection: { lines: [], points: [], circles: [] },
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      oristudioCpRevision: 1,
      oristudioCpCamvResult: null,
      replaceOristudioCpLineSegments: replaceLineSegments,
      setOristudioCpSelection: setSelection,
    } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
  }

  function history(): { annotations: CanvasAnnotation[] }[] {
    return useWorkspaceStore.getState().oristudioCpHistoryPast as unknown as {
      annotations: CanvasAnnotation[];
    }[];
  }

  function annotationIds(): string[] {
    return useWorkspaceStore.getState().oristudioCpAnnotations.map((annotation) => annotation.id);
  }

  async function settle(run: () => void): Promise<void> {
    await act(async () => {
      run();
      await Promise.resolve();
    });
  }

  const solve = (regionId = REGION.id) => settle(() => api.onSolve(regionId));

  beforeEach(() => {
    resetCpExactSolveRuns();
    track.mockClear();
    toast.success.mockClear();
    toast.warning.mockClear();
    toast.error.mockClear();
    lastSolveInputJson = null;
    exportCreasesAsFold.mockReset().mockResolvedValue(FOLD_JSON);
    rebuildSolveInput.mockReset().mockResolvedValue(REBUILT);
    solver = bridge(ACCEPTED);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    seed();
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  });

  it('starts idle, so the chip offers Solve', () => {
    expect(api.stateFor(REGION.id)).toBeUndefined();
  });

  it('names the stage while a solve is running, and clears when it ends', async () => {
    let release = () => {};
    solver = bridge(
      ACCEPTED,
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );

    await settle(() => api.onSolve(REGION.id));
    // A live run is the readout, not a flag this hook keeps: the registry is
    // where the two stages are already recorded.
    expect(api.stateFor(REGION.id)).toEqual({
      status: 'solving',
      stage: 'geometry',
      // Injected bridge, so there is no worker of ours to terminate — and the
      // chip is told so rather than shown a Stop that reaches nothing.
      cancellable: false,
      stopping: false,
    });

    await settle(release);
    expect(api.stateFor(REGION.id)).toMatchObject({ status: 'solved' });
  });

  it('passes the run’s stoppability through to the chip', async () => {
    // The chip renders Stop from this and nothing else, so it has to be the
    // registry's answer rather than a guess about the environment. Registered
    // by hand because a genuinely cancellable run needs a real worker, which
    // jsdom does not have.
    let release = () => {};
    const running = withCpExactSolveRun(
      { kind: 'region', targetId: REGION.id, cancellable: true },
      (live) => {
        bindCpExactSolveRunStop(live.runId, () => undefined);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    );
    await settle(() => undefined);

    expect(api.stateFor(REGION.id)).toMatchObject({ status: 'solving', cancellable: true });

    await settle(() => api.onStop(REGION.id));
    expect(api.stateFor(REGION.id)).toMatchObject({ stopping: true });

    release();
    await running;
  });

  it('leaves the document untouched when the solve is stopped, and goes back to Solve', async () => {
    // The whole contract of Stop: the run is abandoned before anything is
    // placed, so there is nothing to revert — and nothing stale left on the chip
    // either, because a cancelled run reached no verdict to report.
    await settle(() => api.onSolve(REGION.id));
    expect(api.stateFor(REGION.id)).toMatchObject({ status: 'solved' });
    replaceLineSegments.mockClear();

    solver = {
      solveExact: () => Promise.reject(new CpExactSolveCancelledError()),
      solveExactToFold: () => Promise.reject(new CpExactSolveCancelledError()),
    };
    await settle(() => api.onSolve(REGION.id));

    expect(api.stateFor(REGION.id)).toBeUndefined();
    expect(replaceLineSegments).not.toHaveBeenCalled();
  });

  it('writes the solved coordinates onto the region’s creases', async () => {
    await solve();

    expect(replaceLineSegments).toHaveBeenCalledTimes(1);
    const [lineIds, segments] = replaceLineSegments.mock.calls[0];
    // 1-based ids for the five creases inside the region.
    expect(lineIds).toEqual([1, 2, 3, 4, 5]);
    // The moved vertex, mapped from the unit square onto the 400-unit paper.
    expect(segments[4].a).toEqual({ x: 304, y: 100 });
    expect(api.stateFor(REGION.id)).toEqual({
      status: 'solved',
      movedVertices: 1,
      // 0.001 of a paper edge, on the 1024 px ruler the sentence uses.
      maxMovementPx: 1.024,
      // `status: Solved` with no theorem report to qualify it — so the chip is
      // told the solver's own verdict and nothing more. See `solveCompletion`.
      completion: 'exact',
      residuals: null,
    });
  });

  /**
   * The bug this whole split came from. `mid-solve_2.osf` was accepted with
   * `status: Ambiguous` at 0.00747° — a 1,900x improvement that still left all
   * 70 "Incorrect angles" markers standing — and the chip said "Solved".
   *
   * The coordinates still land: an ambiguous solve is *accepted*, so it takes
   * the same placement path. What must differ is every sentence about it.
   */
  it('places an ambiguous solve, and does not call it solved', async () => {
    solver = bridge(ACCEPTED, undefined, AMBIGUOUS_RESIDUALS);
    await solve();

    expect(replaceLineSegments).toHaveBeenCalledTimes(1);
    expect(api.stateFor(REGION.id)).toMatchObject({
      status: 'solved',
      completion: 'unfoldable',
      residuals: {
        maxKawasakiDegreesBefore: 14.367,
        maxKawasakiDegreesAfter: 0.00747,
        oddDegreeVerticesAfter: 3,
      },
    });
  });

  it('says what the solve did, in the numbers, rather than "Solved"', async () => {
    solver = bridge(ACCEPTED, undefined, AMBIGUOUS_RESIDUALS);
    await solve();

    // A warning, not a success: the user is looking at the creases, and this
    // toast is the only place a 1,900x improvement that still fails is told
    // apart from a no-op.
    expect(toast.success).not.toHaveBeenCalled();
    const [headline, options] = toast.warning.mock.calls[0];
    expect(headline).toBe('Improved, but this pattern cannot fold flat');
    // Odd degree first — it is the cause no amount of re-solving clears.
    expect(options.description.startsWith('3 vertices still have an odd number of creases')).toBe(
      true
    );
    expect(options.description).toContain('14.4°');
    expect(options.description).toContain('0.007°');
    expect(options.description).toContain('Accept anyway');
  });

  it('keeps the success toast for a solve that really did finish', async () => {
    await solve();

    expect(toast.warning).not.toHaveBeenCalled();
    const [headline, options] = toast.success.mock.calls[0];
    expect(headline).toBe('Solved');
    expect(options.description).toContain('now meets the foldability check');
  });

  /**
   * A solve rewrites every crease in the pattern, and the mutation helper
   * derives the selection from what the kernel replaced — so without this the
   * user is handed the whole pattern selected and the selection toolbar opens
   * on top of the region's own chip. Nothing was aimed at, so nothing is
   * selected.
   */
  it('leaves nothing selected, so the selection toolbar does not cover the chip', async () => {
    await solve();

    expect(setSelection).toHaveBeenCalledTimes(1);
    // Against the shared constructor, not a literal: the selection has five
    // kinds and a hand-written three would pass while leaving faces and texts
    // selected.
    expect(setSelection.mock.calls[0][0]).toEqual(emptyOristudioCpSelection());
  });

  it('records the coordinates and the region state in one history entry', async () => {
    await solve();

    // One entry, and it carries the annotation layer *as it was* — so a single
    // undo takes the coordinates and the region back together. A second entry
    // here would land the user on unsolved coordinates with checking already
    // restored, silently.
    expect(history()).toHaveLength(1);
    expect(history()[0].annotations.map((annotation) => annotation.id)).toEqual([
      IMAGE.id,
      REGION.id,
    ]);
  });

  it('stops reporting a solved result once the document moves past it', async () => {
    await solve();
    expect(api.stateFor(REGION.id)).toMatchObject({ status: 'solved' });

    // What an undo across the solve looks like from here: the revision the
    // result was true of is no longer the current one, so the chip goes back to
    // Solve rather than standing over coordinates that are gone.
    act(() => {
      useWorkspaceStore.setState({
        oristudioCpRevision: useWorkspaceStore.getState().oristudioCpRevision + 1,
      } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
    });
    expect(api.stateFor(REGION.id)).toBeUndefined();
  });

  it('puts the pre-solve creases back on Try again, and returns to idle', async () => {
    await solve();
    await settle(() => api.onTryAgain(REGION.id));

    expect(replaceLineSegments).toHaveBeenCalledTimes(2);
    const [lineIds, segments] = replaceLineSegments.mock.calls[1];
    expect(lineIds).toEqual([1, 2, 3, 4, 5]);
    // Exactly what was there before the solve — and the region stays, in repair
    // state, so the topology can be changed and solved again.
    expect(segments[4].a).toEqual({ x: 300, y: 100 });
    expect(annotationIds()).toContain(REGION.id);
    expect(api.stateFor(REGION.id)).toBeUndefined();

    // And nothing is left selected. Try again replaces every crease in the
    // pattern exactly as the solve does, so it inherits the same problem — the
    // mutation's derived selection marks all of them — and needs the same clear.
    // It called the store directly and skipped it until this test existed.
    expect(setSelection).toHaveBeenCalledTimes(2);
    expect(setSelection.mock.calls[1][0]).toEqual(emptyOristudioCpSelection());
  });

  it('deletes the region on Accept and keeps the source image, unlocked', async () => {
    await solve();
    await settle(() => api.onAccept(REGION.id));

    // Checking comes back with the region gone; the underlay is the user's own
    // annotation by now and is still the best thing to compare against.
    expect(annotationIds()).toEqual([IMAGE.id]);
    // Unlocked, which is the half that makes "the user's own annotation" true.
    // Locked is absolute — no body, no handles, no context menu, and no lock
    // toggle anywhere in the product — so a locked image released from its
    // region is one the user can see and can never select, fade or delete.
    const image = useWorkspaceStore
      .getState()
      .oristudioCpAnnotations.find((annotation) => annotation.id === IMAGE.id);
    expect(image?.locked).toBe(false);
    // No further coordinate write: the solve already applied them.
    expect(replaceLineSegments).toHaveBeenCalledTimes(1);
  });

  it('reports a rejection in the solver’s own words, and changes nothing', async () => {
    solver = bridge(REJECTED);
    await solve();

    expect(replaceLineSegments).not.toHaveBeenCalled();
    expect(api.stateFor(REGION.id)).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('further than the solver is allowed to'),
    });
  });

  it('offers a timeout’s partial answer rather than applying it', async () => {
    solver = bridge(TIMED_OUT);
    await solve();

    // On every non-acceptance the solver hands back the coordinates it was
    // given, so the document is untouched and the partial is an offer.
    expect(replaceLineSegments).not.toHaveBeenCalled();
    expect(api.stateFor(REGION.id)).toMatchObject({
      status: 'failed',
      partialMovedVertices: 1,
    });

    await settle(() => api.onAccept(REGION.id));
    // Accepting is what writes it — and it is written before the region goes, so
    // undoing walks back through the coordinates rather than past them.
    expect(replaceLineSegments).toHaveBeenCalledTimes(1);
    expect(replaceLineSegments.mock.calls[0][1][4].a).toEqual({ x: 302, y: 100 });
    expect(annotationIds()).toEqual([IMAGE.id]);
  });

  it('refuses a region with no attachment, without touching the worker', async () => {
    const plain = createCpSuppressionRegion({
      id: 'plain',
      center: { x: 300, y: 300 },
      width: 420,
      height: 420,
    });
    seed([plain]);
    await solve('plain');

    expect(replaceLineSegments).not.toHaveBeenCalled();
    expect(api.stateFor('plain')).toBeUndefined();
  });

  it('writes the solved geometry, including vertices the report omits', async () => {
    // A collinear degree-2 vertex is dissolved for the solve and placed back on
    // the straightened crease *after* the solver takes its movement comparison,
    // so it reaches `vertices_exact` and never appears in `moved_vertices`.
    // Placing from the report left it at its old, off-line coordinate while both
    // neighbours moved, and a degree-2 vertex is Kawasaki-clean only when
    // exactly collinear — so it came back as an angle violation on a pattern the
    // solver had just called foldable.
    //
    // Vertex 5 is that vertex here: solved, and deliberately absent from the
    // report below.
    solver = bridge(
      {
        ...ACCEPTED,
        moved_vertices: [
          { vertex_id: 4, before: { x: 0.5, y: 0 }, after: { x: 0.51, y: 0 }, movement: 0.01 },
        ],
      },
      undefined,
      undefined,
      // Vertex 5 is solved to x = 0.505 — document x = 302, away from the 300 it
      // sits at in `SEGMENTS` — and named nowhere in the report above.
      [...VERTICES_EXACT.slice(0, 5), { x: 0.505, y: 1 }]
    );
    await solve();

    const [, segments] = replaceLineSegments.mock.calls[0];
    // The reported vertex landed.
    expect(segments[4].a).toEqual({ x: 304, y: 100 });
    // And so did the unreported one, which used to keep the document's x = 300
    // while its own crease moved underneath it.
    expect(segments[4].b).toEqual({ x: 302, y: 500 });
  });

  it('solves the creases on screen, not the input attached at import', async () => {
    // The bug behind every "it says N errors but I fixed them" report. The region
    // carries an `ExactSolveInput` published by the decode, and solving *that*
    // meant no hand repair — a merged degree-2 vertex, two corners joined, a
    // recoloured crease — ever reached the solver.
    await solve();

    const [creasePattern, owned] = exportCreasesAsFold.mock.calls[0];
    expect(creasePattern.line_segments).toHaveLength(SEGMENTS.length);
    expect(owned).toHaveLength(SEGMENTS.length);
    expect(rebuildSolveInput).toHaveBeenCalledWith(FOLD_JSON);
    // And what the solver received is the rebuild, not the attachment.
    expect(solveInputSeen()).toEqual(REBUILT.input);
    expect(solveInputSeen()).not.toEqual(REGION.solveInput);
  });

  it('reports the compiler’s own words when it will not rebuild the pattern', async () => {
    // Non-square paper, a boundary that is not a closed quadrilateral. The
    // refusal names the geometry rather than the failure, so it is shown as-is
    // instead of being flattened into "could not solve".
    rebuildSolveInput.mockRejectedValue(
      new CpExactSolveInputRebuildError('non-square paper is not yet supported')
    );
    await solve();

    expect(replaceLineSegments).not.toHaveBeenCalled();
    expect(api.stateFor(REGION.id)).toMatchObject({
      status: 'failed',
      reason: 'non-square paper is not yet supported',
    });
  });

  it('runs the same solve for the Exact Solve command', async () => {
    await settle(() => window.dispatchEvent(new CustomEvent(CP_EXACT_SOLVE_REQUEST_EVENT)));

    // The menu route reaches the identical implementation — one solvable
    // pattern, so the selection is not consulted at all.
    expect(replaceLineSegments).toHaveBeenCalledTimes(1);
    expect(api.stateFor(REGION.id)).toMatchObject({ status: 'solved' });
  });

  it('refuses the command when more than one pattern is solvable and none is picked', async () => {
    seed([REGION, OTHER_REGION]);
    await settle(() => window.dispatchEvent(new CustomEvent(CP_EXACT_SOLVE_REQUEST_EVENT)));

    // The menu entry is disabled in this state, but the listener refuses rather
    // than assuming the capability was checked — a host may supply none.
    expect(replaceLineSegments).not.toHaveBeenCalled();
  });

  it('lets a selected crease say which pattern the command means', async () => {
    seed([OTHER_REGION, REGION]);
    act(() => {
      useWorkspaceStore.setState({
        // The interior crease, inside REGION and inside nothing else.
        oristudioCpSelection: { lines: [5], points: [], circles: [] },
      } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
    });
    await settle(() => window.dispatchEvent(new CustomEvent(CP_EXACT_SOLVE_REQUEST_EVENT)));

    expect(replaceLineSegments).toHaveBeenCalledTimes(1);
    expect(api.stateFor(REGION.id)).toMatchObject({ status: 'solved' });
  });
});
