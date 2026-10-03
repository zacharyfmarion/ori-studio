import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OristudioCpDocumentState,
  OristudioCpFoldedFigureEntry,
} from '../../engine/oristudioCpTypes';
import { setFolded3dRenderModel, resetFolded3dRenderModels } from '../../cp-workspace/folded/folded3dRenderModels';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { sheetWithCrease } from '../../lib/paper/paperScene.fixtures';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cpDocument, fakeCaptureRuntime, twoSquaresSegmentation } from './capture.fixtures';
import type { CpCaptureRuntime } from './captureFolded';
import { addFigureToDiagram, addPatternToDiagram, canAddFigureToDiagram } from './addToDiagram';

const bindings = vi.hoisted(() => ({ runtime: null as CpCaptureRuntime | null }));
vi.mock('../../store/workspaceStore/cpFoldRuntimeBindings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/workspaceStore/cpFoldRuntimeBindings')>()),
  createCpCaptureRuntime: () => bindings.runtime,
}));
vi.mock('../../cp-workspace/cpSegmentationArtifacts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/cpSegmentationArtifacts')>()),
  ensureCpSegmentationArtifacts: vi.fn(async () => segmentation),
}));
const folded3dStoredScene = vi.hoisted(() => ({ folded3dFigureScene: vi.fn() }));
vi.mock('../../cp-workspace/folded/folded3dStoredScene', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/folded/folded3dStoredScene')>()),
  ...folded3dStoredScene,
}));
const analytics = vi.hoisted(() => ({ trackDiagramStepAdded: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const segmentation = twoSquaresSegmentation();
const [left] = resolveCpSegments(segmentation);
const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();
const steps = () => state().diagram?.steps ?? [];

const BOX = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

function figure(overrides: Partial<OristudioCpFoldedFigureEntry> = {}): OristudioCpFoldedFigureEntry {
  return {
    id: 'folded-1',
    handle: 4,
    status: 'ready',
    displayStyle: 'Paper5',
    snapshot: { model: { state: 'Back1' }, discovered_fold_cases: 2, current_fold_case: 2 },
    renderSnapshot: {},
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: Math.PI / 2 },
    sourceBounds: BOX,
    sourceFingerprint: 'cs1:figure',
    error: null,
    ...overrides,
  } as unknown as OristudioCpFoldedFigureEntry;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFolded3dRenderModels();
  useWorkspaceStore.setState(initialState, true);
  useWorkspaceStore.setState({
    oristudioCpDocument: { handle: 1, document: cpDocument(), geometry: null } as unknown as OristudioCpDocumentState,
  });
  bindings.runtime = fakeCaptureRuntime();
});

describe('Add to diagram', () => {
  it('adds a pattern as a crease-pattern step after the selected one, and says which step it became', async () => {
    const first = state().addDiagramStep()!;
    state().addDiagramStep();
    state().selectDiagramStep(first);
    const stepId = await addPatternToDiagram(left!);
    expect(steps().map((step) => step.id)).toEqual([first, stepId, expect.any(String)]);
    expect(steps()[1]).toMatchObject({
      source: { kind: 'cp', scope: { kind: 'segment' }, render: { mode: 'crease-pattern' } },
      picture: { kind: 'scene' },
    });
    // One undo step, and the Diagram is not opened behind the user's back.
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Add to diagram');
    expect(toasts.success).toHaveBeenCalledWith('Added as step 2', expect.objectContaining({ action: expect.anything() }));
    expect(analytics.trackDiagramStepAdded).toHaveBeenCalledWith('crease_pattern', 'edit_toolbar');
  });

  it('adds a flat figure posed as Edit shows it, folded again from its box', async () => {
    const stepId = await addFigureToDiagram(figure());
    expect(bindings.runtime!.fold).toHaveBeenCalledOnce();
    const step = steps().find((candidate) => candidate.id === stepId)!;
    expect(step.source).toMatchObject({
      scope: { kind: 'figure-bounds', bounds: BOX },
      render: { mode: 'folded-flat', side: 'back', rotationDeg: 90, foldCase: 2 },
    });
    expect(step.picture?.kind).toBe('scene');
    expect(analytics.trackDiagramStepAdded).toHaveBeenCalledWith('cp_folded', 'folded_figure');
  });

  it('adds a live 3D figure from its render model, with no fold, keeping its fingerprint', async () => {
    folded3dStoredScene.folded3dFigureScene.mockReturnValue(sheetWithCrease());
    setFolded3dRenderModel(4, { cell_points: [0, 0, 0, 1, 0, 0, 0, 1, 0] } as never);
    const camera = { yaw: 0.3, pitch: -0.2, zoom: 1.4 };
    const stepId = await addFigureToDiagram(
      figure({ snapshot: null, folded3d: {} as never, camera, frameRadius: 2 })
    );
    expect(bindings.runtime!.fold3d).not.toHaveBeenCalled();
    const step = steps().find((candidate) => candidate.id === stepId)!;
    expect(step.source).toMatchObject({
      fingerprint: 'cs1:figure',
      render: { mode: 'folded-3d', camera, side: 'front' },
    });
    expect(step.picture).toMatchObject({ kind: 'scene', paperScale: null, styleKey: expect.any(String) });
    expect(analytics.trackDiagramStepAdded).toHaveBeenCalledWith('cp_3d', 'folded_figure');
  });

  it('folds a figure reopened from a file, with nothing live to read, from its box', async () => {
    const stepId = await addFigureToDiagram(figure({ handle: null }));
    expect(bindings.runtime!.fold).toHaveBeenCalledOnce();
    const step = steps().find((candidate) => candidate.id === stepId)!;
    expect(step).toMatchObject({ picture: { kind: 'scene' }, source: { render: { mode: 'folded-flat', side: 'back' } } });
  });

  it('adds nothing for a figure with no box to link to', async () => {
    const unlinked = figure({ sourceBounds: null, sourceFingerprint: null });
    expect(canAddFigureToDiagram(unlinked)).toBe(false);
    expect(await addFigureToDiagram(unlinked)).toBeNull();
    expect(steps()).toEqual([]);
  });
});
