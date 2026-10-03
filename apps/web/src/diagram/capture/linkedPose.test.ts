import { describe, expect, it, vi } from 'vitest';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { antipodalCamera, DEFAULT_FOLDED_3D_CAMERA } from '../../cp-workspace/folded/folded3dCamera';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { sheetWithCrease } from '../../lib/paper/paperScene.fixtures';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import {
  DEFAULT_DIAGRAM_STYLE,
  DEFAULT_SIMULATED_VIEW,
  type DiagramCpRender,
  type DiagramCpSource,
  type DiagramSimulatedView,
} from '../document/diagramDocument';
import { cpDocument, fakeCaptureRuntime, LEFT_FOLD_LINE_IDS, twoSquaresSegmentation } from './capture.fixtures';
import { chooseStepCreases } from './captureCreases';
import type { CpCaptureRuntime } from './captureFolded';
import { CaptureSessionClosedError, createCaptureSession, type CaptureSessionDeps } from './captureSession';
import { poseLinkedStep, type LinkedPoseRequest } from './linkedPose';

const folded3dStoredScene = vi.hoisted(() => ({ folded3dFigureScene: vi.fn() }));
vi.mock('../../cp-workspace/folded/folded3dStoredScene', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/folded/folded3dStoredScene')>()),
  ...folded3dStoredScene,
}));

const segmentation = twoSquaresSegmentation();
const [left] = resolveCpSegments(segmentation);

function creasesOf(document = cpDocument()) {
  const choice = chooseStepCreases(document, { kind: 'segment', region: regionReferenceFor(left!) }, segmentation);
  if (choice.status !== 'found') throw new Error('the left region should be found');
  return choice.creases;
}

/** A session over a fake kernel, its registry a plain count. */
function sessionWith(runtime: CpCaptureRuntime = fakeCaptureRuntime()) {
  const held = new Map<number, number>();
  let epoch = 0;
  const deps: CaptureSessionDeps = {
    search: (work) => work(runtime),
    runtime: () => runtime,
    retain: (handle) => held.set(handle, (held.get(handle) ?? 0) + 1),
    release: (handle) => held.set(handle, (held.get(handle) ?? 1) - 1),
    epoch: () => epoch,
  };
  return {
    runtime,
    held,
    session: createCaptureSession(deps),
    resetEngine: () => {
      epoch += 1;
      held.clear();
    },
  };
}

const placed = {
  status: 'placed' as const,
  handle: 11,
  snapshot: {} as never,
  render: { cell_points: [0, 0, 0, 1, 0, 0, 0, 1, 0], span: 1 } as never,
};

async function pose(
  session: ReturnType<typeof sessionWith>['session'],
  render: DiagramCpRender,
  request: LinkedPoseRequest,
  document = cpDocument(),
  remembered?: DiagramCpSource['remembered']
) {
  return poseLinkedStep(
    session,
    { document, creases: creasesOf(document), render, remembered, style: DEFAULT_DIAGRAM_STYLE },
    request
  );
}

const CP: DiagramCpRender = { mode: 'crease-pattern', rotationDeg: 345 };
const FLAT: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 30, foldCase: 1 };

describe('posing a crease pattern', () => {
  it('turns it a step at a time, within one turn, and folds nothing', async () => {
    const { session, runtime } = sessionWith();
    const right = await pose(session, CP, { verb: 'rotate-right' });
    expect(right).toMatchObject({ status: 'posed', render: { mode: 'crease-pattern', rotationDeg: 0 } });
    expect(await pose(session, CP, { verb: 'rotate-left' })).toMatchObject({ render: { rotationDeg: 330 } });
    expect(await pose(session, CP, { verb: 'reset' })).toMatchObject({ render: { rotationDeg: 0 } });
    expect(runtime.fold).not.toHaveBeenCalled();
  });

  it('turns it to an angle typed in degrees, within one turn', async () => {
    const { session, runtime } = sessionWith();
    expect(await pose(session, CP, { verb: 'rotate-to', degrees: 40 })).toMatchObject({ render: { rotationDeg: 40 } });
    expect(await pose(session, CP, { verb: 'rotate-to', degrees: -90 })).toMatchObject({ render: { rotationDeg: 270 } });
    expect(await pose(session, CP, { verb: 'rotate-to', degrees: 725 })).toMatchObject({ render: { rotationDeg: 5 } });
    expect(runtime.fold).not.toHaveBeenCalled();
  });

  it('folds it flat, turned as it was, from the front at the first layer order', async () => {
    const { session, runtime } = sessionWith();
    const result = await pose(session, CP, { verb: 'show-folded' });
    expect(result).toMatchObject({
      status: 'posed',
      render: { mode: 'folded-flat', side: 'front', rotationDeg: 345, foldCase: 1 },
      hasNextSolution: false,
    });
    expect(vi.mocked(runtime.fold).mock.calls[0]![3]).toEqual(LEFT_FOLD_LINE_IDS);
  });
});

describe('showing it another way (D19)', () => {
  it('folds it in the pose the folded form last had, and shows the pattern turned as it last was', async () => {
    const { session } = sessionWith();
    const document = cpDocument();
    const folded = await pose(session, CP, { verb: 'show-folded' }, document, {
      folded: { mode: 'folded-flat', side: 'back', rotationDeg: 60, foldCase: 1 },
    });
    expect(folded).toMatchObject({ render: { mode: 'folded-flat', side: 'back', rotationDeg: 60, foldCase: 1 } });
    const pattern = await pose(session, FLAT, { verb: 'show-crease-pattern' }, document, {
      'crease-pattern': { mode: 'crease-pattern', rotationDeg: 90 },
    });
    expect(pattern).toMatchObject({ render: { mode: 'crease-pattern', rotationDeg: 90 } });
  });
});

describe('showing it simulated (D19)', () => {
  it('shows the simulator’s flat sheet at the camera it last had, and turns back to the other ways from there', async () => {
    const { session, runtime } = sessionWith();
    const document = cpDocument();
    const simulateFlat = vi.fn(async () => sheetWithCrease());
    const asSimulated = (render: DiagramCpRender, request: LinkedPoseRequest, remembered?: DiagramCpSource['remembered']) =>
      poseLinkedStep(
        session,
        { document, creases: creasesOf(document), render, remembered, style: DEFAULT_DIAGRAM_STYLE, simulateFlat },
        request
      );
    const view = { yaw: 1, pitch: -0.5, zoom: 2 };
    const shown = await asSimulated(CP, { verb: 'show-simulated' }, { simulated: { mode: 'simulated', foldPercent: 40, view } });
    // Back at 0% — the one fold % taken outside the live simulator — from the camera it had.
    expect(shown).toMatchObject({ status: 'posed', render: { mode: 'simulated', foldPercent: 0, view } });
    expect(runtime.fold).not.toHaveBeenCalled();
    const simulated: DiagramCpRender = { mode: 'simulated', foldPercent: 0, view };
    expect(await asSimulated(simulated, { verb: 'reset' })).toMatchObject({ render: { view: DEFAULT_SIMULATED_VIEW } });
    expect(await asSimulated(simulated, { verb: 'show-crease-pattern' })).toMatchObject({ render: { mode: 'crease-pattern' } });
    expect(await asSimulated(simulated, { verb: 'show-folded' })).toMatchObject({ render: { mode: 'folded-flat' } });
  });

  it('captures Pose’s live simulator where it rests, through the still it is handed, at its fold %', async () => {
    const { session, runtime } = sessionWith();
    const document = cpDocument();
    const simulateFlat = vi.fn(async () => sheetWithCrease());
    const still = vi.fn(async (_view: DiagramSimulatedView, _style: PaperStyle) => sheetWithCrease());
    const view = { yaw: 0.4, pitch: -0.7, zoom: 1.6, orient: [1, 0, 0, 0, 0, -1, 0, 1, 0] as const };
    const result = await poseLinkedStep(
      session,
      {
        document,
        creases: creasesOf(document),
        render: { mode: 'simulated', foldPercent: 0, view: DEFAULT_SIMULATED_VIEW },
        style: DEFAULT_DIAGRAM_STYLE,
        simulateFlat,
      },
      { verb: 'simulate', foldPercent: 40, view: { ...view, orient: [...view.orient] }, still }
    );
    expect(result).toMatchObject({ status: 'posed', render: { mode: 'simulated', foldPercent: 40, view } });
    // The live model, never the flat sheet, and in the simulator's light.
    expect(still).toHaveBeenCalledOnce();
    expect(still.mock.calls[0]![0]).toMatchObject(view);
    expect(simulateFlat).not.toHaveBeenCalled();
    expect(runtime.fold).not.toHaveBeenCalled();
    expect(result.status === 'posed' && result.picture.kind === 'picture' && result.picture.picture.kind === 'scene'
      ? result.picture.picture.styleKey
      : null).not.toBeNull();
  });

  it('says the region cannot be simulated', async () => {
    const { session } = sessionWith();
    const document = cpDocument();
    const result = await poseLinkedStep(
      session,
      { document, creases: creasesOf(document), render: CP, style: DEFAULT_DIAGRAM_STYLE, simulateFlat: async () => null },
      { verb: 'show-simulated' }
    );
    expect(result).toEqual({ status: 'unavailable' });
  });
});

describe('posing a flat fold', () => {
  it('folds once, then turns it over and turns it on the same handle', async () => {
    const { session, runtime, held } = sessionWith();
    const document = cpDocument();
    const over = await pose(session, FLAT, { verb: 'turn-over' }, document);
    expect(over).toMatchObject({ render: { side: 'back', rotationDeg: 30 } });
    expect(vi.mocked(runtime.setModel).mock.calls.at(-1)![1]).toMatchObject({ state: 'Back1', rotation: 0, scale: 1 });
    await pose(session, { ...FLAT, side: 'back' }, { verb: 'rotate-right' }, document);
    expect(runtime.fold).toHaveBeenCalledOnce();
    expect(held.get(7)).toBe(1);
  });

  it('turns it to an angle on the held fold, keeping its side and layer order', async () => {
    const { session, runtime } = sessionWith();
    const document = cpDocument();
    const turned = await pose(session, { ...FLAT, side: 'back' }, { verb: 'rotate-to', degrees: 100 }, document);
    expect(turned).toMatchObject({ render: { mode: 'folded-flat', side: 'back', rotationDeg: 100, foldCase: 1 } });
    await pose(session, { ...FLAT, side: 'back', rotationDeg: 100 }, { verb: 'rotate-to', degrees: 0 }, document);
    expect(runtime.fold).toHaveBeenCalledOnce();
  });

  it('steps to the next layer order on the held fold', async () => {
    const runtime = fakeCaptureRuntime({
      foldAnother: vi.fn(async () => ({
        discoveredCases: 2,
        displayStyle: 'Paper5' as const,
        currentCase: 2,
        hasNext: false,
      })),
    });
    const { session } = sessionWith(runtime);
    const document = cpDocument();
    expect(await pose(session, FLAT, { verb: 'next-solution' }, document)).toMatchObject({
      render: { foldCase: 2 },
      hasNextSolution: false,
    });
    expect(runtime.foldAnother).toHaveBeenCalledWith(7);
  });

  it('shows the crease pattern again, letting the fold go', async () => {
    const { session, held } = sessionWith();
    await pose(session, FLAT, { verb: 'turn-over' });
    expect(await pose(session, FLAT, { verb: 'show-crease-pattern' })).toMatchObject({
      render: { mode: 'crease-pattern', rotationDeg: 30 },
    });
    expect(held.get(7)).toBe(0);
  });

  it('folds again when the pattern changed, or the engine was reset, under the held fold', async () => {
    const { session, runtime, held, resetEngine } = sessionWith();
    await pose(session, FLAT, { verb: 'turn-over' });
    // Another document snapshot: the held fold is of the old one.
    await pose(session, FLAT, { verb: 'rotate-right' }, cpDocument());
    expect(runtime.fold).toHaveBeenCalledTimes(2);
    expect(held.get(7)).toBe(1);
    resetEngine();
    const document = cpDocument();
    await pose(session, FLAT, { verb: 'rotate-right' }, document);
    expect(runtime.fold).toHaveBeenCalledTimes(3);
    // What the reset freed is not released again.
    expect(held.get(7)).toBe(1);
  });

  it('folds in 3D when its creases now have a partial fold', async () => {
    folded3dStoredScene.folded3dFigureScene.mockReturnValue(sheetWithCrease());
    const runtime = fakeCaptureRuntime({ fold3d: vi.fn(async () => placed) });
    const { session } = sessionWith(runtime);
    const partial = cpDocument(undefined, (cp, id) => (id === 8 ? { ...cp, fold_magnitude: 90 } : cp));
    const result = await pose(session, FLAT, { verb: 'turn-over' }, partial);
    expect(result).toMatchObject({ render: { mode: 'folded-3d', side: 'front' } });
    expect(runtime.fold).not.toHaveBeenCalled();
  });
});

describe('posing a 3D fold', () => {
  const THREE_D: DiagramCpRender = { mode: 'folded-3d', camera: DEFAULT_FOLDED_3D_CAMERA, side: 'front' };
  const partial = () => cpDocument(undefined, (cp, id) => (id === 8 ? { ...cp, fold_magnitude: 90 } : cp));

  it('looks from the other side, from above, and from where the view rests, on one fold', async () => {
    folded3dStoredScene.folded3dFigureScene.mockReturnValue(sheetWithCrease());
    const runtime = fakeCaptureRuntime({ fold3d: vi.fn(async () => placed) });
    const { session } = sessionWith(runtime);
    const document = partial();
    const over = await pose(session, THREE_D, { verb: 'turn-over' }, document);
    expect(over).toMatchObject({ render: { side: 'back', camera: antipodalCamera(DEFAULT_FOLDED_3D_CAMERA) } });
    expect(over.status === 'posed' && over.spatial?.handle).toBe(11);
    expect(await pose(session, THREE_D, { verb: 'view-top' }, document)).toMatchObject({
      render: { camera: { yaw: 0, pitch: 0, zoom: 1 } },
    });
    const camera = { yaw: 1, pitch: -0.5, zoom: 1.5 };
    expect(await pose(session, THREE_D, { verb: 'orbit', camera }, document)).toMatchObject({
      render: { camera },
    });
    expect(runtime.fold3d).toHaveBeenCalledOnce();
  });

  it('hands back the 3D folder’s refusal', async () => {
    const refusal = { code: 'self_intersection' } as never;
    const runtime = fakeCaptureRuntime({ fold3d: vi.fn(async () => ({ status: 'refused' as const, refusal })) });
    const { session } = sessionWith(runtime);
    expect(await pose(session, THREE_D, { verb: 'view-iso' }, partial())).toEqual({ status: 'refused', refusal });
  });
});

describe('a session let go while it folds', () => {
  // The detail closed while a fold searched: the fold landed into a session
  // nothing referenced, was retained, and was never freed.
  it('frees a fold that lands after it was disposed, and says the verb is over', async () => {
    let land: () => void = () => {};
    const runtime = fakeCaptureRuntime();
    const fold = runtime.fold;
    runtime.fold = vi.fn(async (...args: Parameters<typeof fold>) => {
      await new Promise<void>((resolve) => (land = resolve));
      return fold(...args);
    }) as typeof fold;
    const { session, held } = sessionWith(runtime);
    const posing = pose(session, FLAT, { verb: 'turn-over' });
    await vi.waitFor(() => expect(runtime.fold).toHaveBeenCalled());
    session.dispose();
    land();
    await expect(posing).rejects.toBeInstanceOf(CaptureSessionClosedError);
    expect(held.get(7)).toBe(0);
    // And it can fold again.
    land = () => {};
    const again = pose(session, FLAT, { verb: 'turn-over' });
    await vi.waitFor(() => expect(runtime.fold).toHaveBeenCalledTimes(2));
    land();
    await again;
    expect(held.get(7)).toBe(1);
  });

  it('frees a 3D fold that lands after it was disposed', async () => {
    let land: () => void = () => {};
    const runtime = fakeCaptureRuntime({
      fold3d: vi.fn(async () => {
        await new Promise<void>((resolve) => (land = resolve));
        return placed;
      }),
    });
    const { session, held } = sessionWith(runtime);
    const partial = cpDocument(undefined, (cp, id) => (id === 8 ? { ...cp, fold_magnitude: 90 } : cp));
    const folding = session.spatial(partial, LEFT_FOLD_LINE_IDS);
    await vi.waitFor(() => expect(runtime.fold3d).toHaveBeenCalled());
    session.dispose();
    land();
    await expect(folding).rejects.toBeInstanceOf(CaptureSessionClosedError);
    expect(held.get(placed.handle)).toBe(0);
  });
});
