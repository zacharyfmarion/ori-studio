import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpFoldedFigureEntry, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { foldedFigureObjScene } from './foldedFigureObjScene';

const mock = vi.hoisted(() => ({
  state: { oristudioCpDocument: { handle: 7, document: { crease_pattern: { line_segments: [] } } } as unknown },
  stale: vi.fn(() => false),
  route: vi.fn(() => ({ kind: 'flat', lineIds: [1, 2, 3] })),
  liveScene: vi.fn(),
  runtime: {
    fold: vi.fn(),
    foldToCase: vi.fn(),
    paperScene: vi.fn(),
    free: vi.fn(async () => {}),
  },
}));
vi.mock('../../store/workspaceStore', () => ({ useWorkspaceStore: { getState: () => mock.state } }));
vi.mock('../../store/workspaceStore/cpFoldRuntimeBindings', () => ({ createCpFoldRuntime: () => mock.runtime }));
vi.mock('../../store/workspaceStore/oristudioCpRuntime', () => ({
  getOristudioCpFoldedFigurePaperScene: mock.liveScene,
}));
vi.mock('./foldedFigureStaleness', () => ({ isFoldedFigureStale: mock.stale, reselectFoldableLineIds: () => [1, 2, 3, 4] }));
vi.mock('./foldRoute', () => ({ resolveFoldRoute: mock.route }));

const SCENE = { faces: [{ outline: [], points: [], front_up: true, edges: [] }] } as unknown as OristudioCpFoldedPaperScene;
const MODEL = { state: 'front', rotation: 0, scale: 1 };

/** A flat figure reopened from its file: its picture and snapshot, no handle, solution 3 shown. */
function reopened(overrides: Partial<OristudioCpFoldedFigureEntry> = {}): OristudioCpFoldedFigureEntry {
  return {
    id: 'figure',
    handle: null,
    startingFaceId: 5,
    sourceBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    snapshot: { model: MODEL, outcome: 'Solved', discovered_fold_cases: 4, current_fold_case: 3 },
    ...overrides,
  } as unknown as OristudioCpFoldedFigureEntry;
}

const folded = (currentCase: number) => ({
  handle: 42,
  discoveredCases: currentCase,
  currentCase,
  displayStyle: 'Paper5',
  outcome: 'Solved',
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.stale.mockReturnValue(false);
  mock.route.mockReturnValue({ kind: 'flat', lineIds: [1, 2, 3] });
  mock.runtime.fold.mockResolvedValue(folded(1));
  mock.runtime.foldToCase.mockResolvedValue({ discoveredCases: 3, currentCase: 3, displayStyle: 'Paper5', outcome: 'Solved' });
  mock.runtime.paperScene.mockResolvedValue(SCENE);
  mock.liveScene.mockResolvedValue(SCENE);
});

describe('foldedFigureObjScene', () => {
  it('has none for a 3D figure, a fold with no layer order, or a figure with no recorded creases', () => {
    expect(foldedFigureObjScene(reopened({ folded3d: {} as OristudioCpFoldedFigureEntry['folded3d'] }))).toBeNull();
    expect(foldedFigureObjScene(reopened({ snapshot: null }))).toBeNull();
    expect(
      foldedFigureObjScene(reopened({ snapshot: { ...reopened().snapshot!, outcome: 'NoSolutions' } }))
    ).toBeNull();
    expect(foldedFigureObjScene(reopened({ sourceBounds: null }))).toBeNull();
  });

  it('reads a live fold’s own scene, with the document’s aux lines', async () => {
    await expect(foldedFigureObjScene(reopened({ handle: 9 }))!()).resolves.toBe(SCENE);
    expect(mock.liveScene).toHaveBeenCalledWith(9, 7);
    expect(mock.runtime.fold).not.toHaveBeenCalled();
  });

  it('hands a reopened spread figure the scene its file carried, folding nothing', async () => {
    await expect(foldedFigureObjScene(reopened({ spreadScene: SCENE }))!()).resolves.toBe(SCENE);
    expect(mock.runtime.fold).not.toHaveBeenCalled();
  });

  it('folds a reopened figure again at the solution it shows, reads its scene, and lets the fold go', async () => {
    const read = foldedFigureObjScene(reopened())!;
    // Asked for only when called.
    expect(mock.runtime.fold).not.toHaveBeenCalled();
    await expect(read()).resolves.toBe(SCENE);
    expect(mock.runtime.fold).toHaveBeenCalledWith(5, 'Order5', MODEL, [1, 2, 3]);
    expect(mock.runtime.foldToCase).toHaveBeenCalledWith(42, 3);
    expect(mock.runtime.paperScene).toHaveBeenCalledWith(42);
    expect(mock.runtime.free).toHaveBeenCalledWith(42);
  });

  it('refuses a fold that would not be the one drawn, and lets it go', async () => {
    mock.runtime.foldToCase.mockResolvedValue({ discoveredCases: 2, currentCase: 2, displayStyle: 'Paper5', outcome: 'Solved' });
    await expect(foldedFigureObjScene(reopened())!()).rejects.toMatchObject({ reason: 'needs-refold' });
    expect(mock.runtime.paperScene).not.toHaveBeenCalled();
    expect(mock.runtime.free).toHaveBeenCalledWith(42);
  });

  it.each([
    ['its creases moved since it was folded', () => mock.stale.mockReturnValue(true), reopened()],
    ['its layer order was set by hand', () => {}, reopened({ snapshot: { ...reopened().snapshot!, shown_order: 'given' } })],
    ['its creases now fold in 3D', () => mock.route.mockReturnValue({ kind: 'spatial', lineIds: [1] }), reopened()],
  ])('refuses without folding when %s', async (_why, arrange, figure) => {
    arrange();
    await expect(foldedFigureObjScene(figure)!()).rejects.toMatchObject({ reason: 'needs-refold' });
    expect(mock.runtime.fold).not.toHaveBeenCalled();
  });
});
