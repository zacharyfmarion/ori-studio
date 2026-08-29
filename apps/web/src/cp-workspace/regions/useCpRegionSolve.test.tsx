import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CP_EXACT_SOLVE_REQUEST_EVENT } from '../../commands/menuActions';
import { runCpExactSolve, type CpExactSolver } from '../../engine/cpExactSolve';
import { resetCpExactSolveRuns } from '../../engine/cpExactSolveRuns';
import type {
  CpExactSolveMovementReport,
  CpExactSolvedGraph,
} from '../../engine/cpExactSolveTypes';
import type { OristudioCpLineSegment } from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { CanvasAnnotation } from '../annotations/annotation';
import { createCpSuppressionRegion } from '../annotations/suppressionRegion';
import { createCpImage } from '../images/cpImage';
import type { CpRegionSolveBinding } from './CpRegionLayer';
import { useCpRegionSolve } from './useCpRegionSolve';

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

const ACCEPTED: CpExactSolveMovementReport = {
  timed_out: false,
  accepted: true,
  rejection_reasons: [],
  elapsed_seconds: 0.4,
  max_vertex_movement: 0.001,
  moved_vertices: [
    { vertex_id: 1, before: { x: 0.5, y: 0 }, after: { x: 0.51, y: 0 }, movement: 0.01 },
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
    { vertex_id: 1, before: { x: 0.5, y: 0 }, after: { x: 0.505, y: 0 }, movement: 0.005 },
  ],
};

function graph(report: CpExactSolveMovementReport): CpExactSolvedGraph {
  return {
    schema: 'oristudio/cp-compiler/exact-solved-graph-v1',
    vertices_exact: [],
    edges_exact: [],
    movement_report: report,
    theorem_residual_report: {},
    status: report.accepted ? 'solved' : 'failed',
  };
}

/** A bridge that answers both stages with `report`, after `gate` settles. */
function bridge(report: CpExactSolveMovementReport, gate?: Promise<void>): CpExactSolver {
  const answer = async () => {
    if (gate) await gate;
    return graph(report);
  };
  return {
    solveExact: answer,
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
  src: 'data:image/jpeg;base64,xx',
  naturalWidth: 1024,
  naturalHeight: 1024,
  center: { x: 300, y: 300 },
  width: 400,
  height: 400,
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
  let solver: CpExactSolver;

  function Probe() {
    api = useCpRegionSolve({
      // The real staged runner; only the bridge under it is stubbed.
      solve: (input, options) => runCpExactSolve(input, { ...options, solver: async () => solver }),
    });
    return null;
  }

  function seed(annotations: CanvasAnnotation[] = [IMAGE, REGION]): void {
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
    expect(api.stateFor(REGION.id)).toEqual({ status: 'solving', stage: 'geometry' });

    await settle(release);
    expect(api.stateFor(REGION.id)).toMatchObject({ status: 'solved' });
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
    });
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
  });

  it('deletes the region on Accept and keeps the source image', async () => {
    await solve();
    await settle(() => api.onAccept(REGION.id));

    // Checking comes back with the region gone; the underlay is the user's own
    // annotation by now and is still the best thing to compare against.
    expect(annotationIds()).toEqual([IMAGE.id]);
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

  it('says so when the solved answer does not line up with the creases', async () => {
    solver = bridge({
      ...ACCEPTED,
      moved_vertices: [
        { vertex_id: 1, before: { x: 0.31, y: 0.42 }, after: { x: 0.32, y: 0.42 }, movement: 0.01 },
        { vertex_id: 2, before: { x: 0.77, y: 0.18 }, after: { x: 0.78, y: 0.18 }, movement: 0.01 },
      ],
    });
    await solve();

    expect(replaceLineSegments).not.toHaveBeenCalled();
    expect(api.stateFor(REGION.id)).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('does not line up'),
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
