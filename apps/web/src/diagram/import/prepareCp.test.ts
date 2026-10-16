import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cpDocument, fakeCaptureRuntime, twoSquaresSegmentation } from '../capture/capture.fixtures';
import type { CpCaptureRuntime } from '../capture/captureFolded';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import { CpImportPreparer } from './prepareCp';

let runtime: CpCaptureRuntime;
const api = vi.hoisted(() => ({
  loadCp: vi.fn(async () => 1),
  documentGeometry: vi.fn(async () => ({
    segEndpoints: new Float64Array([0, 0, 200, 100]),
    auxEndpoints: new Float64Array(),
    pointCoords: new Float64Array(),
    circleData: new Float64Array(),
    tail: { texts: [] },
  })),
  segmentationArtifacts: vi.fn(),
  freeDocument: vi.fn(async () => {}),
}));
vi.mock('../../engines/cpTaskSession', () => ({
  createCpTaskSession: async () => ({
    client: api,
    runId: 1,
    run: (work: () => Promise<unknown>) => work(),
    close: async () => {},
  }),
}));
vi.mock('../../engine/oristudioCpGeometry', async (original) => ({
  ...(await original<typeof import('../../engine/oristudioCpGeometry')>()),
  decodeCpGeometryToSnapshot: () => cpDocument(),
}));
vi.mock('../../store/workspaceStore/cpFoldRuntimeBindings', () => ({
  createBoundCpCaptureRuntime: () => runtime,
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.segmentationArtifacts.mockResolvedValue(twoSquaresSegmentation());
  runtime = fakeCaptureRuntime();
});
async function prepare() {
  const preparer = new CpImportPreparer();
  try {
    return await preparer.prepare(
      'fixture',
      'fixture.cp',
      DEFAULT_DIAGRAM_STYLE,
      new AbortController().signal,
      new AbortController().signal,
      5000
    );
  } finally {
    await preparer.close();
  }
}
describe('CP import fold completion', () => {
  it.each([
    ['Wire2', 'NotAttempted'],
    ['Transparent3', 'NoSolutions'],
    ['Transparent3', 'Contradiction'],
    ['Paper5', 'NotAttempted'],
  ] as const)(
    'retains failed CP previews when the engine stops at %s / %s',
    async (displayStyle, outcome) => {
      vi.mocked(runtime.fold).mockResolvedValue({ handle: 7, discoveredCases: 0, displayStyle, outcome });
      const result = await prepare();
      expect(result.steps).toHaveLength(2);
      for (const step of result.steps) {
        expect(step.importStatus).toBe('failed');
        expect(step.source).toMatchObject({ kind: 'cp', render: { mode: 'crease-pattern' } });
        expect(step.picture?.kind).toBe('scene');
      }
      expect(runtime.free).toHaveBeenCalledTimes(2);
      expect(api.freeDocument).toHaveBeenCalledWith(1);
    }
  );
  it('retains the CP if a nominally solved figure has no paper scene', async () => {
    vi.mocked(runtime.fold).mockResolvedValue({
      handle: 7,
      discoveredCases: 1,
      displayStyle: 'Paper5',
      outcome: 'Solved',
    });
    vi.mocked(runtime.paperScene).mockResolvedValue(null);
    const result = await prepare();
    expect(
      result.steps.every(
        (step) =>
          step.importStatus === 'failed' &&
          step.source?.kind === 'cp' &&
          step.source.render.mode === 'crease-pattern'
      )
    ).toBe(true);
  });
  it('keeps completed paper folds without a failure marker', async () => {
    vi.mocked(runtime.fold).mockResolvedValue({
      handle: 7,
      discoveredCases: 1,
      displayStyle: 'Paper5',
      outcome: 'Solved',
    });
    const result = await prepare();
    for (const step of result.steps) {
      expect(step.importStatus).toBeUndefined();
      expect(step.source).toMatchObject({ render: { mode: 'folded-flat' } });
      expect(step.picture?.kind).toBe('scene');
    }
    expect(result.notices).toEqual([]);
  });
});
