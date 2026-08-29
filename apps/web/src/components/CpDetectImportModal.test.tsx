/**
 * What the detect modal does with a finished detection.
 *
 * Two things are load-bearing here and neither has a type-level backstop:
 *
 * 1. **It must never replace the document.** This path used to call
 *    `loadCreasePatternText`, so detecting a crease pattern discarded whatever
 *    was open. The tests therefore also assert that action is *not* called — a
 *    regression would otherwise pass every other check in the suite.
 * 2. **The primary button is chosen by the compiler's own topology finding**,
 *    read out of `compiler_report.exact_solve.theorem_residual_report.before`.
 *    Nothing else in the app reads that path, so nothing else would notice it
 *    moving.
 *
 * The store, the layout store, the camera and the detect worker are all mocked:
 * the subject is which store calls the modal makes with which arguments, and the
 * real ones answer none of them under jsdom anyway.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isImageAnnotation,
  isSuppressionRegionAnnotation,
  type CanvasAnnotation,
} from '../cp-workspace/annotations/annotation';

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
  verifyModelAssets: vi.fn(async () => manifest()),
  autoRectifyImage: vi.fn(async () => rectifiedImage()),
  manualRectifyImage: vi.fn(async () => rectifiedImage()),
  detectRectifiedFold: vi.fn(async () => detection(unsolvedReport(2))),
};

vi.mock('../store/workspaceStore/cpDetectRuntime', () => ({
  getCpDetectClient: async () => detectClient,
  cpDetectError: (error: unknown) => ({
    code: 'cp_detect',
    message: error instanceof Error ? error.message : String(error),
  }),
}));

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

import { TooltipProvider } from './ui/Tooltip';
import { CpDetectImportModal } from './CpDetectImportModal';

const IMAGE_SIZE = 1024;
const PAPER_SIZE = 400;

function manifest() {
  return { id: 'test-model' } as never;
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

/** A `theorem_residual_report` whose solve was accepted: nothing to repair. */
function solvedReport() {
  return {
    accepted: true,
    rejection_reasons: [],
    before: { odd_degree_vertices: [], maekawa_failures: [] },
  };
}

/**
 * A rejected solve carrying `sites` odd-degree vertices — the dominant repair
 * signal, and the only one that needs to vary here.
 */
function unsolvedReport(sites: number) {
  return {
    accepted: false,
    rejection_reasons: ['candidate_status_failed'],
    before: {
      odd_degree_vertices: Array.from({ length: sites }, (_, index) => index),
      maekawa_failures: [],
      // Deliberately large: a degree-2 vertex is not an error on its own, so it
      // must not be counted as a repair site.
      degree_two_vertices: Array.from({ length: 40 }, (_, index) => 900 + index),
      degenerate_edges: [],
      unmodeled_crossings: [],
      boundary_failures: [],
    },
  };
}

function detection(theorem: unknown, solveInput: unknown = { schema: 'exact-solve-input-v1' }) {
  return {
    status: 'ok',
    foldJson: JSON.stringify({ vertices_coords: [], edges_vertices: [] }),
    detectorReport: {
      decoder_backend: 'legacy_candidate_exact_solve_v1',
      vertex_count: 12,
      edge_count: 20,
      warnings: [],
      quality_report: {
        compiler_report: {
          output: { selected: 'compiled' },
          exact_solve_input: solveInput,
          exact_solve: {
            theorem_residual_report: theorem,
            movement_report: { timed_out: false },
          },
        },
      },
    },
  } as never;
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
  detectClient.detectRectifiedFold.mockResolvedValue(detection(unsolvedReport(2)));
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

describe('CpDetectImportModal primary action', () => {
  it('offers Review & Fix for a rejected solve with a workable number of repair sites', async () => {
    await reachReviewStage();
    expect(button('Review & Fix')).not.toBeNull();
    // Available in every case, beside the primary.
    expect(button('Add as-is')).not.toBeNull();
    expect(bodyText()).toMatch(/2 places to repair/);
  });

  it('offers Solve & Add when the pipeline already solved the candidate', async () => {
    detectClient.detectRectifiedFold.mockResolvedValue(detection(solvedReport()));
    await reachReviewStage();
    expect(button('Solve & Add')).not.toBeNull();
    expect(bodyText()).toMatch(/Exactly solved/);
  });

  it('refuses to offer hand repair past the practical site limit, and says so', async () => {
    detectClient.detectRectifiedFold.mockResolvedValue(detection(unsolvedReport(11)));
    await reachReviewStage();
    expect(button('Review & Fix')).toBeNull();
    expect(button('Add as-is')).not.toBeNull();
    expect(bodyText()).toMatch(/not practical/);
  });

  it('reports the solver’s own rejection, and a timeout as a timeout', async () => {
    await reachReviewStage();
    expect(bodyText()).toContain('candidate_status_failed');

    const timedOut = detection(unsolvedReport(2)) as unknown as {
      detectorReport: {
        quality_report: { compiler_report: { exact_solve: { movement_report: unknown } } };
      };
    };
    timedOut.detectorReport.quality_report.compiler_report.exact_solve.movement_report = {
      timed_out: true,
    };
    detectClient.detectRectifiedFold.mockResolvedValue(timedOut as never);
    click('Detect');
    await settle();

    expect(bodyText()).toContain('solve timed out');
    expect(bodyText()).not.toContain('candidate_status_failed');
  });

  it('says so when a rejected candidate has nothing flagged to repair', async () => {
    detectClient.detectRectifiedFold.mockResolvedValue(detection(unsolvedReport(0)));
    await reachReviewStage();
    // Still Review & Fix: with no marker worklist the source image underlay is
    // the only tool, and that is what this mode adds.
    expect(button('Review & Fix')).not.toBeNull();
    expect(bodyText()).toMatch(/nothing is flagged for repair/);
    expect(bodyText()).not.toMatch(/0 places to repair/);
  });

  it('falls back to Add as-is when the solver could not read the candidate graph', async () => {
    detectClient.detectRectifiedFold.mockResolvedValue(
      detection({ status: 'failed', blockers: ['span references missing vertex'] })
    );
    await reachReviewStage();
    expect(button('Review & Fix')).toBeNull();
    expect(bodyText()).toMatch(/could not read this candidate graph/);
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
  });

  it('never runs the mutating fixes, which would now edit the user’s own creases', async () => {
    await reachReviewStage();
    click('Add as-is');
    await settle();

    const operations = storeActions.executeOristudioCpCommand.mock.calls.map((call) => call[0]);
    expect(operations.length).toBeGreaterThan(0);
    expect(operations).not.toContain('Fix1');
    expect(operations).not.toContain('Fix2');
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
    // The paper occupies image pixels [32, 992] of 1024, so the whole frame is
    // 1024/960 of the paper. Anything else is a registration bug.
    expect(image.width).toBeCloseTo((PAPER_SIZE * IMAGE_SIZE) / (IMAGE_SIZE - 64), 6);
    expect(image.height).toBeCloseTo((PAPER_SIZE * IMAGE_SIZE) / (IMAGE_SIZE - 64), 6);
    expect(image.opacity).toBe(0.5);
    expect(image.locked).toBe(true);
    // The region covers the paper edge with room to spare, so a boundary vertex
    // sitting exactly on it is inside.
    expect(region.width).toBeGreaterThan(PAPER_SIZE);
    expect(region.suppress).toEqual(['kawasaki', 'bigLittleBig']);
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

  it('sends a bucketed repair-site count, never the raw number', async () => {
    detectClient.detectRectifiedFold.mockResolvedValue(detection(unsolvedReport(6)));
    await reachReviewStage();
    click('Review & Fix');
    await settle();

    expect(track).toHaveBeenCalledWith('cp detect imported', {
      mode: 'reviewAndFix',
      outcome: 'repairable',
      repair_sites: '5-8',
    });
  });
});
