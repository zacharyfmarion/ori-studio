/**
 * What the detect modal does between recognition and a finished pattern.
 *
 * Four things are load-bearing here and none has a type-level backstop:
 *
 * 1. **The solve is the modal's, not the decode's.** Detection recognizes;
 *    whether to solve is a decision made here, out of the recognize report's
 *    combinatorial findings. A regression that solves everything again looks
 *    identical on screen until you time it.
 * 2. **The budget is the caller's obligation.** `runCpExactSolve` must be handed
 *    the published `solve.budget.total_seconds`, or the staged flow silently gets
 *    twice the cap every measurement in `crease-topology-repair.md` assumed.
 * 3. **Buttons say what they do.** "Add" only after a solve that landed, "Add
 *    as-is" only where the pattern is genuinely unsolved, "Review & Fix" at any
 *    site count whatsoever.
 * 4. **It must never replace the document.** This path used to call
 *    `loadCreasePatternText`, so detecting a crease pattern discarded whatever
 *    was open. The tests assert that action is *not* called — a regression would
 *    otherwise pass every other check in the suite.
 *
 * The store, the layout store, the camera, the detect worker and the solver are
 * all mocked: the subject is which calls the modal makes with which arguments,
 * and the real ones answer none of them under jsdom anyway.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isImageAnnotation,
  isSuppressionRegionAnnotation,
  type CanvasAnnotation,
} from '../cp-workspace/annotations/annotation';
import {
  bindCpExactSolveRunStop,
  cpExactSolveRunFor,
  resetCpExactSolveRuns,
  withCpExactSolveRun,
  type CpExactSolveRunKind,
} from '../engine/cpExactSolveRuns';
import { CpExactSolveCancelledError } from '../engine/cpExactSolveSession';
import type { CpExactSolveOutcome } from '../engine/cpExactSolveTypes';

type RunDescriptor = { kind: CpExactSolveRunKind; targetId: string };

const storeActions = {
  ensureEditCreasePattern: vi.fn(async () => undefined),
  importAddOristudioCpText: vi.fn(async () => true),
  loadCreasePatternText: vi.fn(async () => undefined),
  executeOristudioCpCommand: vi.fn(async (_operation: string) => true),
  addAnnotation: vi.fn((_annotation: CanvasAnnotation) => undefined),
  recordAnnotationHistory: vi.fn(() => undefined),
  oristudioCpAnnotations: [] as CanvasAnnotation[],
  oristudioCpError: null as string | null,
};

const activateWorkspace = vi.fn();
const frameModelBounds = vi.fn();
const track = vi.fn();
let placement: { bounds: { minX: number; minY: number; maxX: number; maxY: number } | null } | null =
  null;

vi.mock('../store/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => storeActions },
}));

vi.mock('../store/layoutStore', () => ({
  useLayoutStore: { getState: () => ({ activateWorkspace }) },
}));

vi.mock('../cp-workspace/renderer/cpCameraRegistry', () => ({
  cpCamera: () => ({ frameModelBounds }),
}));

vi.mock('../store/workspaceStore/oristudioCpRuntime', () => ({
  lastOristudioCpImportAddPlacement: () => placement,
}));

vi.mock('../analytics', () => ({ track: (...args: unknown[]) => track(...args) }));

const detectClient = {
  modelStatus: vi.fn(async () => ({ manifest: manifest(), version: modelVersion(), installed: true })),
  loadModel: vi.fn(async () => manifest()),
  autoRectifyImage: vi.fn(async () => rectifiedImage()),
  manualRectifyImage: vi.fn(async () => rectifiedImage()),
  recognizeRectifiedFold: vi.fn(async () => recognition(diagnostics(2))),
};

vi.mock('../store/workspaceStore/cpDetectRuntime', () => ({
  getCpDetectClient: async () => detectClient,
  whileCpDetectClientAlive: <T,>(pending: Promise<T>) => pending,
  cpDetectError: (error: unknown) => ({
    code: 'cp_detect',
    message: error instanceof Error ? error.message : String(error),
  }),
}));

vi.mock('./cpDetectModelState', async (importOriginal) => {
  const original = await importOriginal<typeof import('./cpDetectModelState')>();
  return {
    ...original,
    loadDetectorModel: vi.fn(async (client: { modelStatus: () => Promise<{ manifest: unknown; installed: boolean }> }) => {
      const status = await client.modelStatus();
      return {
        registry: { schema: 'oristudio/cp-detect-model-registry/v1', families: {} },
        active: modelVersion(),
        manifest: status.manifest,
        installed: status.installed,
        update: null,
      };
    }),
  };
});

vi.mock('../platform/fileService', () => ({
  getFileService: () => ({
    openBinaryFile: async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      name: 'crane.png',
      path: null,
      mimeType: 'image/png',
    }),
  }),
}));

/**
 * The shared solve, stubbed at its own seam.
 *
 * Mocked rather than driven through a fake worker because the staging under test
 * is *when* this is called and *with what* — the two-stage split, the budget
 * arithmetic and the run registry are `cpExactSolve.ts`'s own tests.
 */
const runCpExactSolve = vi.fn();
vi.mock('../engine/cpExactSolve', () => ({
  runCpExactSolve: (...args: unknown[]) => runCpExactSolve(...args),
  // Negative disables the solver's deadline — the real constant, spelled here
  // because the module is replaced wholesale.
  CP_EXACT_SOLVE_NO_DEADLINE: -1,
}));

import { TooltipProvider } from './ui/Tooltip';
import { CpDetectImportModal } from './CpDetectImportModal';

const IMAGE_SIZE = 1024;
const PAPER_SIZE = 400;
const BUDGET_SECONDS = 25;

function manifest() {
  return { id: 'test-model' } as never;
}

function modelVersion() {
  return {
    id: 'test-model',
    version: 1,
    released: '2026-07-08',
    size_bytes: 45_206_364,
    sha256: 'f'.repeat(64),
    manifest_url: '/models/cp-detector-v3/manifest.json',
    model_url: '/models/cp-detector-v3/model.onnx',
  };
}

/** jsdom has no `ImageData`; the modal only reads `width`/`height` off one. */
function imageData(size: number): ImageData {
  return {
    width: size,
    height: size,
    colorSpace: 'srgb',
    data: new Uint8ClampedArray(4),
  } as unknown as ImageData;
}

function rectifiedImage() {
  return {
    image: imageData(IMAGE_SIZE),
    report: { source_quad: quad(), detected_source_quad: quad(), warnings: [] },
  } as never;
}

function quad() {
  return {
    top_left: { x: 0, y: 0 },
    top_right: { x: 10, y: 0 },
    bottom_right: { x: 10, y: 10 },
    bottom_left: { x: 0, y: 10 },
  };
}

/**
 * `topology_diagnostics.combinatorial` carrying `sites` odd-degree vertices —
 * the dominant repair signal, and the only one that needs to vary here.
 */
function diagnostics(sites: number, blockers: string[] = []) {
  return {
    schema: 'oristudio/cp-topology-diagnostics/v1',
    blockers,
    combinatorial: {
      odd_degree_vertices: Array.from({ length: sites }, (_, index) => index),
      // Deliberately large: a degree-2 vertex is not an error on its own, so it
      // must not be counted as a repair site.
      degree_two_vertices: Array.from({ length: 40 }, (_, index) => 900 + index),
      maekawa_failures: [],
      degenerate_edges: [],
      unmodeled_crossings: [],
      boundary_failures: [],
    },
    angle_dependent: { max_kawasaki_residual_degrees: 4.25, max_carrier_residual: 0.002 },
    vertices: [],
  };
}

/** The candidate FOLD: two vertices, one edge, and the id map a partial needs. */
function candidateFold() {
  return JSON.stringify({
    vertices_coords: [
      [0, 0],
      [1, 1],
    ],
    edges_vertices: [[0, 1]],
    edges_assignment: ['M'],
    cp_detector: { source: 'exact_solve_candidate', vertex_original_ids: [4, 7] },
  });
}

function recognition(
  topologyDiagnostics: unknown,
  solveInput: unknown = { schema: 'exact-solve-input-v1' }
) {
  return {
    status: 'recognized',
    foldJson: candidateFold(),
    detectorReport: {
      status: 'recognized',
      decoder_backend: 'legacy_candidate_exact_solve_v1',
      vertex_count: 12,
      edge_count: 20,
      warnings: [],
      quality_report: { compiler_report: { output: { selected: 'recognized_candidate' } } },
    },
    manifest: manifest(),
    candidateSource: 'exact_solve_candidate',
    solve: {
      attempted: false,
      reason: 'recognize_only',
      budget: {
        totalSeconds: BUDGET_SECONDS,
        spentSeconds: 0,
        policy: 'shared_total_across_staged_solve_calls',
      },
    },
    solveInput,
    topologyDiagnostics,
  } as never;
}

function solvedOutcome(): CpExactSolveOutcome {
  return {
    kind: 'solved',
    stage: 'refinement',
    movedVertices: [],
    verticesExact: [],
    maxMovement: 0.0004,
    elapsedSeconds: 1.2,
    residuals: {
      maxKawasakiDegreesBefore: 0.8,
      maxKawasakiDegreesAfter: 0,
      oddDegreeVerticesBefore: 0,
      oddDegreeVerticesAfter: 0,
      bigLittleBigViolationsBefore: 0,
      bigLittleBigViolationsAfter: 0,
    },
    polishAdopted: true,
  };
}

/** The solved FOLD the modal adds — distinguishable from the candidate. */
function solvedFold() {
  return {
    vertices_coords: [
      [0, 0],
      [0.5, 0.5],
    ],
    edges_vertices: [[0, 1]],
    edges_assignment: ['M'],
    cp_detector: { source: 'exact_solve' },
  };
}

/**
 * `mid-solve_2.osf`'s ending: accepted, kept, and not exact. Three odd-degree
 * vertices went in and three came out — those are structurally unfoldable at any
 * coordinates, which is why the answer is repair rather than a longer solve.
 */
function ambiguousOutcome(): CpExactSolveOutcome {
  return {
    ...(solvedOutcome() as Extract<CpExactSolveOutcome, { kind: 'solved' }>),
    kind: 'ambiguous',
    // The moves are the *only* record of this geometry: `runCpExactSolve` returns
    // no `fold` for an ambiguous acceptance, so the improved offer is built from
    // these or it is not offered at all.
    movedVertices: [
      { vertex_id: 7, before: { x: 1, y: 1 }, after: { x: 0.9, y: 0.95 }, movement: 0.11 },
    ],
    residuals: {
      maxKawasakiDegreesBefore: 14.367,
      maxKawasakiDegreesAfter: 0.00747,
      oddDegreeVerticesBefore: 3,
      oddDegreeVerticesAfter: 3,
      bigLittleBigViolationsBefore: 0,
      bigLittleBigViolationsAfter: 0,
    },
    polishAdopted: false,
  };
}

function solveResult(outcome: CpExactSolveOutcome, fold: Record<string, unknown> | null = null) {
  return { outcome, fold, durationMs: 1200 };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** Let the component's chained promises settle. */
async function settle(turns = 6): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function button(label: string): HTMLButtonElement | null {
  const buttons = [...document.querySelectorAll('button')] as HTMLButtonElement[];
  return buttons.find((element) => element.textContent?.trim() === label) ?? null;
}

function click(label: string): void {
  const target = button(label);
  if (!target) throw new Error(`no button labelled "${label}"`);
  act(() => target.click());
}

function bodyText(): string {
  return document.body.textContent ?? '';
}

/** Walk the modal from the upload stage to the review stage. */
async function reachReviewStage(): Promise<void> {
  await act(async () => {
    root?.render(
      <TooltipProvider>
        <CpDetectImportModal />
      </TooltipProvider>
    );
  });
  await act(async () => {
    window.dispatchEvent(new CustomEvent('ori-studio:detect-cp-image'));
  });
  await settle();
  click('Choose Image');
  await settle();
  click('Detect');
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  storeActions.oristudioCpAnnotations = [];
  storeActions.oristudioCpError = null;
  storeActions.importAddOristudioCpText.mockResolvedValue(true);
  detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(2)));
  runCpExactSolve.mockResolvedValue(solveResult(solvedOutcome(), solvedFold()));
  placement = { bounds: { minX: -200, minY: -200, maxX: 200, maxY: 200 } };

  // jsdom has no canvas backend, and this component decodes an image, reads it
  // back as `ImageData`, and re-encodes the rectified frame as a data URL.
  globalThis.createImageBitmap = vi.fn(async () => ({
    width: 64,
    height: 64,
    close: vi.fn(),
  })) as never;
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:source');
  globalThis.URL.revokeObjectURL = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
    putImageData: vi.fn(),
    getImageData: () => imageData(64),
    // The crop loupe draws lines and a crosshair as well.
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  })) as never;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/jpeg;base64,AAAA');

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

/**
 * The decision the whole staging exists to make.
 *
 * A candidate with a broken graph costs up to 25 s to solve and the answer is
 * thrown away the moment the user edits it — 123 of 140 hard solves spend the
 * whole cap. So the flagged case must never reach the solver.
 */
describe('CpDetectImportModal recognize-then-solve', () => {
  it('does not solve a candidate with repair sites, and offers to repair it', async () => {
    await reachReviewStage();

    expect(runCpExactSolve).not.toHaveBeenCalled();
    expect(button('Review & Fix')).not.toBeNull();
    expect(button('Add as-is')).not.toBeNull();
    expect(bodyText()).toMatch(/2 places to repair/);
    expect(bodyText()).toMatch(/the solve was not run/);
  });

  it('solves a clean candidate itself, and lands on Add', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(0)));
    await reachReviewStage();

    expect(runCpExactSolve).toHaveBeenCalledTimes(1);
    expect(button('Add')).not.toBeNull();
    // Never beside a solve that landed: the pattern is not unsolved, and one
    // button under two names was the whole complaint about the old screen.
    expect(button('Add as-is')).toBeNull();
    expect(button('Solve & Add')).toBeNull();
    expect(bodyText()).toMatch(/now meets the foldability check/);
  });

  /**
   * The reading `mid-solve_2.osf` broke. An accepted solve at `status: Ambiguous`
   * moved Kawasaki 14.367° -> 0.00747° — a 1,900x improvement — and still sat
   * ~7,500x above the editor's own 1e-6° bar, so all 70 angle markers survived.
   * The screen said "Exactly solved" and offered one button called Add.
   */
  it('does not present an ambiguous solve as a finished one', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(0)));
    // `fold: null`, as the runner really returns for this ending — the exactly
    // solved document is the one thing an ambiguous solve does not produce.
    runCpExactSolve.mockResolvedValue(solveResult(ambiguousOutcome(), null));
    await reachReviewStage();

    // The numbers, because they are the only way to tell a 1,900x improvement
    // that still fails from a solve that did nothing.
    expect(bodyText()).toMatch(/14\.4°/);
    expect(bodyText()).toMatch(/0\.007°/);
    expect(bodyText()).toMatch(/odd number of creases/);
    expect(bodyText()).not.toMatch(/now meets the foldability check/);

    // Repair leads, because that is what an odd-degree vertex needs. The improved
    // coordinates stay on offer under a name that says what they are — never as a
    // plain "Add", which promises the one thing they do not deliver.
    expect(button('Review & Fix')).not.toBeNull();
    expect(button('Add improved result')).not.toBeNull();
    expect(button('Add')).toBeNull();
  });

  it('adds the improved result at the coordinates the solve reached', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(0)));
    runCpExactSolve.mockResolvedValue(solveResult(ambiguousOutcome(), null));
    await reachReviewStage();
    click('Add improved result');
    await settle();

    const [{ text }] = storeActions.importAddOristudioCpText.mock.calls[0] as unknown as [
      { text: string },
    ];
    // Mapped through `vertex_original_ids` like the partial is: id 7 is index 1,
    // and nothing else moves.
    expect(JSON.parse(text).vertices_coords).toEqual([
      [0, 0],
      [0.9, 0.95],
    ]);
  });

  /**
   * The budget rule Rust cannot enforce. `solve_exact` builds its deadline from
   * the `timeout_seconds` of the call it is in, so the published total has to be
   * handed over for `runCpExactSolve` to divide between its two stages.
   */
  it('runs the solve without a deadline, whatever budget the recognize path published', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(0)));
    await reachReviewStage();

    const [input, options] = runCpExactSolve.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input).toEqual({ schema: 'exact-solve-input-v1' });
    // Negative disables the solver's timeout; the published 25 s is not sent.
    expect(options.timeoutSeconds).toBe(-1);
    expect(options.run).toEqual({ kind: 'detect-import', targetId: expect.any(String) });
  });

  /**
   * The recognized creases go on screen while the solve runs, rather than a
   * spinner over an opaque call — and the two stages are named, because they are
   * an order of magnitude apart and only one of them can fail.
   */
  it('shows the recognized creases and the named stage while solving', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(0)));
    let release: ((value: unknown) => void) | null = null;
    runCpExactSolve.mockImplementation((_input: unknown, options: { onStage?: (s: string) => void }) => {
      options.onStage?.('geometry');
      return new Promise((resolve) => {
        release = resolve;
      });
    });

    await reachReviewStage();
    expect(bodyText()).toContain('Solving geometry');
    expect(document.querySelector('.cp-detect-modal__fold-line')).not.toBeNull();
    // Nothing to decide yet, so nothing is offered.
    expect(button('Add')).toBeNull();
    expect(button('Review & Fix')).toBeNull();

    await act(async () => {
      release?.(solveResult(solvedOutcome(), solvedFold()));
    });
    await settle();
    expect(bodyText()).not.toContain('Solving geometry');
    expect(button('Add')).not.toBeNull();
  });

  it('names the refinement stage when the solver reaches it', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(0)));
    runCpExactSolve.mockImplementation((_input: unknown, options: { onStage?: (s: string) => void }) => {
      options.onStage?.('geometry');
      options.onStage?.('refinement');
      return new Promise(() => {});
    });

    await reachReviewStage();
    expect(bodyText()).toContain('Refining to fold precision');
  });
});

describe('CpDetectImportModal stopping the solve', () => {
  /**
   * Hold the solve open under a **real** registry entry.
   *
   * The mock stands in for `runCpExactSolve`'s bridge, not for its bookkeeping:
   * the run is registered and bound exactly as the real one does it, so the Stop
   * button the modal renders is driven by the same `cancellable` a real solve
   * publishes, and pressing it goes through `requestCpExactSolveStop` for real.
   */
  function holdSolveOpen(cancellable = true): void {
    runCpExactSolve.mockImplementation((_input: unknown, options: { run: RunDescriptor }) =>
      withCpExactSolveRun(
        { ...options.run, cancellable },
        (live) =>
          new Promise((_resolve, reject) => {
            if (cancellable) {
              bindCpExactSolveRunStop(live.runId, () => reject(new CpExactSolveCancelledError()));
            }
          })
      )
    );
  }

  beforeEach(() => {
    resetCpExactSolveRuns();
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(0)));
  });

  it('offers Stop while the solve runs, and a stop leaves the candidate exactly as recognized', async () => {
    holdSolveOpen();
    await reachReviewStage();

    // While it runs there is no terminal button at all — nothing to decide yet.
    expect(bodyText()).toContain('Solving geometry');
    expect(button('Review & Fix')).toBeNull();

    click('Stop');
    await settle();

    expect(bodyText()).toMatch(/You stopped the solve, so nothing was changed/);
    // The unsolved candidate is still there and still repairable; what is absent
    // is Add, because no solve was accepted and there is no solved FOLD.
    expect(button('Review & Fix')).not.toBeNull();
    expect(button('Add as-is')).not.toBeNull();
    expect(button('Add')).toBeNull();
    // A stop is not an error, and must not leave one on screen.
    expect(document.querySelector('.cp-detect-modal__error')).toBeNull();
  });

  it('reports the stop as a cancel on the import, not as a solver verdict', async () => {
    holdSolveOpen();
    await reachReviewStage();
    click('Stop');
    await settle();

    click('Add as-is');
    await settle();

    const imported = track.mock.calls.find(([name]) => name === 'cp detect imported');
    expect(imported?.[1]).toMatchObject({ outcome: 'cancelled' });
  });

  it('offers no Stop for a run nothing can reach', async () => {
    // The honest-degradation rule, at this surface: the wait is still named, and
    // there is no button rather than a dead one.
    holdSolveOpen(false);
    await reachReviewStage();

    expect(bodyText()).toContain('Solving geometry');
    expect(button('Stop')).toBeNull();
  });

  it('lets the dialog be closed during a solve, by stopping it', async () => {
    // The gate this removes: `close()` refused while busy, so a running
    // detection could not be abandoned at all.
    holdSolveOpen();
    await reachReviewStage();

    const closeButton = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    expect(closeButton?.disabled).toBe(false);
    act(() => closeButton?.click());
    await settle();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(cpExactSolveRunFor(runTargetId())).toBeUndefined();
  });

  it('keeps the dialog shut during a solve it cannot stop', async () => {
    holdSolveOpen(false);
    await reachReviewStage();

    expect(
      document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.disabled
    ).toBe(true);
  });

  function runTargetId(): string {
    const call = runCpExactSolve.mock.calls.at(-1) as [unknown, { run: RunDescriptor }] | undefined;
    return call?.[1].run.targetId ?? '';
  }
});

describe('CpDetectImportModal failure reporting', () => {
  it('explains a rejection in the solver’s own terms and offers repair', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(0)));
    runCpExactSolve.mockResolvedValue(
      solveResult({
        kind: 'rejected',
        stage: 'geometry',
        status: 'failed',
        reasons: ['movement_budget_exceeded'],
        elapsedSeconds: 0.4,
      })
    );
    await reachReviewStage();

    expect(bodyText()).toMatch(/further than the solver is allowed to/);
    expect(bodyText()).toContain('movement_budget_exceeded');
    expect(button('Review & Fix')).not.toBeNull();
    expect(button('Add as-is')).not.toBeNull();
    expect(button('Add')).toBeNull();
  });

  /**
   * A timeout is told apart on the `timed_out` boolean, never by matching the
   * reason string — that one embeds a formatted number.
   */
  it('reports a timeout as a timeout, and offers the partial it reached', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(0)));
    runCpExactSolve.mockResolvedValue(
      solveResult({
        kind: 'timeout',
        stage: 'refinement',
        partialMovedVertices: [
          { vertex_id: 7, before: { x: 1, y: 1 }, after: { x: 0.75, y: 0.8 }, movement: 0.3 },
        ],
        partialMaxMovement: 0.3,
        timeoutSeconds: BUDGET_SECONDS,
        elapsedSeconds: BUDGET_SECONDS,
      })
    );
    await reachReviewStage();

    expect(bodyText()).toContain('solve timed out');
    expect(bodyText()).toMatch(/ran out of time/);
    expect(bodyText()).toMatch(/moved 1 vertex into place/);
    expect(button('Add partial result')).not.toBeNull();
  });

  /**
   * The partial's coordinates are mapped through `cp_detector
   * .vertex_original_ids`, not by position — the exporter renumbers vertices, so
   * a positional write would scatter them onto the wrong ones.
   */
  it('adds the partial at the coordinates the solver reached', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(0)));
    runCpExactSolve.mockResolvedValue(
      solveResult({
        kind: 'timeout',
        stage: 'refinement',
        partialMovedVertices: [
          { vertex_id: 7, before: { x: 1, y: 1 }, after: { x: 0.75, y: 0.8 }, movement: 0.3 },
        ],
        partialMaxMovement: 0.3,
        timeoutSeconds: BUDGET_SECONDS,
        elapsedSeconds: BUDGET_SECONDS,
      })
    );
    await reachReviewStage();
    click('Add partial result');
    await settle();

    const [{ text }] = storeActions.importAddOristudioCpText.mock.calls[0] as unknown as [
      { text: string },
    ];
    // Vertex id 7 is index 1 in `vertex_original_ids`, and only that one moves.
    expect(JSON.parse(text).vertices_coords).toEqual([
      [0, 0],
      [0.75, 0.8],
    ]);
  });

  /**
   * A malformed input returns `{status: "not_run", blockers: [...]}` with no
   * `rejection_reasons` key at all, so there is no token to print — only a
   * sentence. A reader that showed the reason list alone would show nothing.
   */
  it('says something when the solver could not read the input at all', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(0)));
    runCpExactSolve.mockResolvedValue(
      solveResult({ kind: 'malformed', stage: 'geometry', blockerCount: 3 })
    );
    await reachReviewStage();

    expect(bodyText()).toMatch(/does not match this crease pattern/);
    expect(button('Review & Fix')).not.toBeNull();
    expect(button('Add partial result')).toBeNull();
  });

  /**
   * A dead worker is not one of the solver's endings, so it must not be reported
   * as a rejection the user could fix by editing.
   */
  it('reports a solve that could not run, without calling it a rejection', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(0)));
    runCpExactSolve.mockRejectedValue(new Error('the detection worker stopped'));
    await reachReviewStage();

    expect(bodyText()).toContain('the detection worker stopped');
    expect(button('Review & Fix')).not.toBeNull();
    expect(button('Add')).toBeNull();
  });

  it('falls back to Add as-is when the graph is blocked, and never solves it', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(
      recognition(diagnostics(0, ['selected span references missing vertex']))
    );
    await reachReviewStage();

    expect(runCpExactSolve).not.toHaveBeenCalled();
    expect(button('Review & Fix')).toBeNull();
    expect(button('Add as-is')).not.toBeNull();
    expect(bodyText()).toMatch(/could not read this candidate graph/);
  });

  /**
   * There is no site count at which repair stops being offered.
   *
   * An earlier version refused past eight sites as "not practical". That was
   * wrong in both directions: the alternative to this feature is tracing the
   * entire pattern by hand, so a 13-site repair is a large saving; and the
   * fallback it steered people to — adding the candidate unsolved — leaves ~4°
   * of Kawasaki error at every vertex, which is the defect the feature exists
   * to remove. The harness agrees: hard-bucket repairs came out 131/140
   * identical to ground truth.
   */
  it('offers hand repair at any site count, however large', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(37)));
    await reachReviewStage();

    expect(button('Review & Fix')).not.toBeNull();
    expect(bodyText()).toMatch(/37 places to repair/);
    expect(bodyText()).not.toMatch(/not practical|out of hand-repair range/);
  });
});

describe('CpDetectImportModal add', () => {
  it('adds beside the document instead of replacing it', async () => {
    await reachReviewStage();
    click('Add as-is');
    await settle();

    expect(storeActions.loadCreasePatternText).not.toHaveBeenCalled();
    expect(storeActions.ensureEditCreasePattern).toHaveBeenCalled();
    expect(storeActions.importAddOristudioCpText).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'fold', filename: 'crane.fold' })
    );
    // No annotations on this path: the underlay and the region belong to repair.
    expect(storeActions.addAnnotation).not.toHaveBeenCalled();
    // And no sweep: this is the raw detection, whose collinear pieces are only
    // nearly collinear and are the user's to repair.
    expect(storeActions.importAddOristudioCpText).toHaveBeenCalledWith(
      expect.objectContaining({ mergeExtraVertices: false })
    );
    // But its undecided creases land as auxiliary lines, on every path.
    expect(storeActions.importAddOristudioCpText).toHaveBeenCalledWith(
      expect.objectContaining({ unassignedAsAuxiliary: true })
    );
  });

  it('adds the solved document after a solve, not the candidate it started from', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(0)));
    await reachReviewStage();
    click('Add');
    await settle();

    const [{ text }] = storeActions.importAddOristudioCpText.mock.calls[0] as unknown as [
      { text: string },
    ];
    expect(JSON.parse(text)).toEqual(solvedFold());
    // An accepted solve puts detection's split creases back together — among
    // the added creases only, which the add itself scopes.
    expect(storeActions.importAddOristudioCpText).toHaveBeenCalledWith(
      expect.objectContaining({ mergeExtraVertices: true })
    );
  });

  it('runs no kernel command after adding: the fixes would edit the user’s creases, and the boundary check needs a dragged path', async () => {
    await reachReviewStage();
    click('Add as-is');
    await settle();

    const operations = storeActions.executeOristudioCpCommand.mock.calls.map((call) => call[0]);
    expect(operations).toEqual([]);
  });

  it('places the source image and a solve-carrying region over the added paper', async () => {
    await reachReviewStage();
    click('Review & Fix');
    await settle();

    expect(storeActions.addAnnotation).toHaveBeenCalledTimes(2);
    const added = storeActions.addAnnotation.mock.calls.map((call) => call[0]);
    const image = added.find(isImageAnnotation);
    const region = added.find(isSuppressionRegionAnnotation);
    if (!image || !region) throw new Error('expected an image and a region');

    // Both centred on the added paper, wherever `import_add` put it.
    expect(image.center).toEqual({ x: 0, y: 0 });
    expect(region.center).toEqual({ x: 0, y: 0 });
    // The underlay is sized to the DECODER, not to where the rectifier says it
    // put the paper.
    //
    // `unit_from_px` always divides by `image_size - 64`
    // (`junction_carrier_v1.rs:23`) and never reads `report.target_quad`, so the
    // candidate's unit square is at pixels [32, 992] of 1024 whatever the
    // rectifier did — and the whole frame is therefore 1024/960 of the paper.
    // Sizing from `target_quad` instead was tried and reverted: on the two
    // rectification paths that do not inset, it lines the image's border up with
    // the paper and leaves every crease inside it 6.7% off, which is exactly the
    // alignment a repair flow needs to be right.
    expect(image.width).toBeCloseTo((PAPER_SIZE * IMAGE_SIZE) / (IMAGE_SIZE - 64), 6);
    expect(image.height).toBeCloseTo((PAPER_SIZE * IMAGE_SIZE) / (IMAGE_SIZE - 64), 6);
    expect(image.opacity).toBe(0.5);
    // Locked so it never takes a click meant for the creases being repaired over
    // it — and locked is absolute, so the region has to own it or nothing can
    // reach it. That is what `imageId` is for; Accept unlocks it, deleting the
    // region deletes it.
    expect(image.locked).toBe(true);
    expect(region.imageId).toBe(image.id);
    // The region covers the paper edge with room to spare, so a boundary vertex
    // sitting exactly on it is inside.
    expect(region.width).toBeGreaterThan(PAPER_SIZE);
    expect(region.suppress).toEqual(['kawasaki', 'bigLittleBig']);
    // Straight off the recognize result, so the region's Solve runs on the same
    // seam the modal's own solve would have.
    expect(region.solveInput).toEqual({ schema: 'exact-solve-input-v1' });
    expect(region.hidden).toBe(false);
    // Behind everything already on the layer, so neither swallows a click meant
    // for a reference image the user placed.
    expect(image.z).toBeLessThan(0);
    expect(region.z).toBeLessThan(image.z);
    // One overlay-only history entry for both, so undo peels them off together.
    expect(storeActions.recordAnnotationHistory).toHaveBeenCalledTimes(1);
  });

  it('frames the addition, which would otherwise land off-screen', async () => {
    await reachReviewStage();
    click('Add as-is');
    await settle();

    expect(activateWorkspace).toHaveBeenCalledWith('edit');
    expect(frameModelBounds).toHaveBeenCalledWith({
      minX: -200,
      minY: -200,
      maxX: 200,
      maxY: 200,
    });
  });

  it('reports the failure and keeps the modal open when the merge is refused', async () => {
    storeActions.importAddOristudioCpText.mockResolvedValue(false);
    storeActions.oristudioCpError = 'No editable crease-pattern document is loaded';
    await reachReviewStage();
    click('Add as-is');
    await settle();

    expect(bodyText()).toContain('No editable crease-pattern document is loaded');
    expect(storeActions.addAnnotation).not.toHaveBeenCalled();
  });

  it('sends a bucketed repair-site count and the staged outcome, never a raw count', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(6)));
    await reachReviewStage();
    click('Review & Fix');
    await settle();

    expect(track).toHaveBeenCalledWith('cp detect imported', {
      mode: 'reviewAndFix',
      outcome: 'recognized',
      repair_sites: '5-8',
    });
  });

  it('reports a solved add as solved', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(0)));
    await reachReviewStage();
    click('Add');
    await settle();

    expect(track).toHaveBeenCalledWith('cp detect imported', {
      mode: 'add',
      outcome: 'solved',
      repair_sites: '0',
    });
  });
});

/**
 * The `ori-studio:cp-detect-result` event is what
 * `scripts/cp-detect/benchmark-browser-vs-oracle.mjs` reads, and it compares the
 * published fold against an oracle. Publishing the candidate the instant it
 * exists would have quietly turned every browser-vs-oracle number into a
 * candidate-coordinate number.
 */
describe('CpDetectImportModal result event', () => {
  it('publishes the solved fold once the solve lands', async () => {
    detectClient.recognizeRectifiedFold.mockResolvedValue(recognition(diagnostics(0)));
    const seen: unknown[] = [];
    const listen = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener('ori-studio:cp-detect-result', listen);
    try {
      await reachReviewStage();
    } finally {
      window.removeEventListener('ori-studio:cp-detect-result', listen);
    }

    expect(seen).toHaveLength(1);
    const detail = seen[0] as { detection: { foldJson: string } };
    expect(JSON.parse(detail.detection.foldJson)).toEqual(solvedFold());
  });

  it('publishes the candidate when the solve was not run', async () => {
    const seen: unknown[] = [];
    const listen = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener('ori-studio:cp-detect-result', listen);
    try {
      await reachReviewStage();
    } finally {
      window.removeEventListener('ori-studio:cp-detect-result', listen);
    }

    expect(seen).toHaveLength(1);
    const detail = seen[0] as { detection: { foldJson: string } };
    expect(detail.detection.foldJson).toBe(candidateFold());
  });
});

/**
 * Closing the modal has to forget the image.
 *
 * It used to clear only the error and the drop highlight, so the second open
 * came back to the first image, its crop and its detection — a file you picked
 * looked like it had been ignored. Nothing else in the suite would catch it,
 * because every other test opens the modal exactly once.
 */
describe('CpDetectImportModal session reset', () => {
  it('starts from the file picker after a successful add', async () => {
    await reachReviewStage();
    expect(button('Detect')).not.toBeNull();

    click('Review & Fix');
    await settle();

    await act(async () => {
      window.dispatchEvent(new CustomEvent('ori-studio:detect-cp-image'));
    });
    await settle();

    // The upload stage offers Choose Image and nothing derived from an image.
    expect(button('Choose Image')).not.toBeNull();
    expect(button('Detect')).toBeNull();
    expect(button('Review & Fix')).toBeNull();
  });

  it('starts from the file picker after being closed', async () => {
    await reachReviewStage();
    expect(button('Detect')).not.toBeNull();

    // IconButton puts its `title` on `aria-label` and renders the visible one
    // in a tooltip, so the attribute to match is aria-label.
    const dismiss = [...document.querySelectorAll('button')].find(
      (element) => element.getAttribute('aria-label') === 'Close'
    );
    if (!dismiss) throw new Error('no close button');
    act(() => dismiss.click());
    await settle();

    await act(async () => {
      window.dispatchEvent(new CustomEvent('ori-studio:detect-cp-image'));
    });
    await settle();

    expect(button('Choose Image')).not.toBeNull();
    expect(button('Detect')).toBeNull();
  });

  it('releases the source object URL rather than holding it for the session', async () => {
    await reachReviewStage();
    click('Review & Fix');
    await settle();

    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:source');
  });
});

/**
 * The crop step: a corner drag is the whole interaction, and the crop must
 * follow the pointer, show the magnifier while it does, and re-rectify itself
 * when the corner is let go — there is no button for that, and the one that was
 * sat beside a blue Detect that kept getting pressed instead.
 */
describe('CpDetectImportModal crop editing', () => {
  async function reachCropStage(): Promise<void> {
    await act(async () => {
      root?.render(
        <TooltipProvider>
          <CpDetectImportModal />
        </TooltipProvider>
      );
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent('ori-studio:detect-cp-image'));
    });
    await settle();
    click('Choose Image');
    await settle();
  }

  function pointer(type: string, target: Element, x: number, y: number): void {
    act(() => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    });
  }

  function handle(): SVGCircleElement {
    const found = document.querySelector('.cp-detect-modal__handle');
    if (!found) throw new Error('no crop handle on screen');
    return found as SVGCircleElement;
  }

  function loupe(): Element | null {
    return document.querySelector('[data-testid="cp-detect-crop-loupe"]');
  }

  beforeEach(() => {
    // jsdom lays nothing out: the image is 100 × 100 CSS pixels at the origin, so
    // a pointer at (50, 50) is the middle of the 64 px source image.
    HTMLElement.prototype.getBoundingClientRect = vi.fn(
      () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
    ) as never;
  });

  it('has no Update Crop button: the crop re-rectifies itself when a corner is let go', async () => {
    await reachCropStage();
    expect(button('Update Crop')).toBeNull();
    expect(button('Detect')).not.toBeNull();
    expect(detectClient.manualRectifyImage).not.toHaveBeenCalled();

    const wrap = document.querySelector('.cp-detect-modal__image-wrap');
    if (!wrap) throw new Error('no crop editor');
    pointer('pointerdown', handle(), 0, 0);
    pointer('pointermove', wrap, 50, 50);
    pointer('pointerup', wrap, 50, 50);
    await settle();

    expect(detectClient.manualRectifyImage).toHaveBeenCalledTimes(1);
    const call = detectClient.manualRectifyImage.mock.calls[0] as unknown[];
    const movedQuad = call[1] as { top_left: { x: number; y: number } };
    expect(movedQuad.top_left).toEqual({ x: 32, y: 32 });
  });

  it('mounts a fresh canvas for each rectified image instead of updating the old one', async () => {
    await reachCropStage();
    const before = document.querySelector('.cp-detect-modal__canvas');
    expect(before).not.toBeNull();

    const wrap = document.querySelector('.cp-detect-modal__image-wrap');
    if (!wrap) throw new Error('no crop editor');
    pointer('pointerdown', handle(), 0, 0);
    pointer('pointermove', wrap, 50, 50);
    pointer('pointerup', wrap, 50, 50);
    await settle();

    expect(detectClient.manualRectifyImage).toHaveBeenCalledTimes(1);
    const after = document.querySelector('.cp-detect-modal__canvas');
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it('shows the magnifier only while a corner is being dragged', async () => {
    await reachCropStage();
    const wrap = document.querySelector('.cp-detect-modal__image-wrap');
    if (!wrap) throw new Error('no crop editor');
    expect(loupe()).toBeNull();

    pointer('pointerdown', handle(), 0, 0);
    expect(loupe()).not.toBeNull();
    pointer('pointermove', wrap, 50, 50);
    expect(loupe()).not.toBeNull();
    pointer('pointerup', wrap, 50, 50);
    expect(loupe()).toBeNull();
  });

  it('does not re-rectify when the corner was pressed and released in place', async () => {
    await reachCropStage();
    const wrap = document.querySelector('.cp-detect-modal__image-wrap');
    if (!wrap) throw new Error('no crop editor');
    pointer('pointerdown', handle(), 0, 0);
    pointer('pointerup', wrap, 0, 0);
    await settle();
    expect(detectClient.manualRectifyImage).not.toHaveBeenCalled();
  });

  it('offers Edit Crop on the review step, which goes back to the crop', async () => {
    await reachReviewStage();
    expect(button('Update Crop')).toBeNull();
    click('Edit Crop');
    await settle();
    expect(detectClient.manualRectifyImage).toHaveBeenCalledTimes(1);
    expect(button('Edit Crop')).toBeNull();
    expect(document.querySelector('.cp-detect-modal__image-wrap')).not.toBeNull();
  });
});
