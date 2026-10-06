import { describe, expect, it, vi } from 'vitest';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { antipodalCamera, DEFAULT_FOLDED_3D_CAMERA } from '../../cp-workspace/folded/folded3dCamera';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { sheetWithCrease } from '../../lib/paper/paperScene.fixtures';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import type { SpreadKind } from '../../cp-workspace/folded/foldedLayerSpread';
import {
  DEFAULT_AFFINE_SPREAD,
  DEFAULT_DIAGRAM_STYLE,
  DEFAULT_DEPTH_SPREAD,
  DEFAULT_LAYER_SPREAD,
  DEFAULT_SIMULATED_VIEW,
  type DiagramCpRender,
  type DiagramCpSource,
  type DiagramSimulatedView,
  type DiagramSpreadStarts,
} from '../document/diagramDocument';
import {
  cpDocument,
  fakeCaptureRuntime,
  halfFoldOnSheetKernelScene,
  LEFT_FOLD_LINE_IDS,
  twoSquaresSegmentation,
} from './capture.fixtures';
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
      solutions: { hasNext: false },
    });
    expect(vi.mocked(runtime.fold).mock.calls[0]![3]).toEqual(LEFT_FOLD_LINE_IDS);
  });
});

describe('a crease pattern seen from the paper’s back', () => {
  const BACK: DiagramCpRender = { mode: 'crease-pattern', rotationDeg: 15, side: 'back' };
  const sceneOf = (result: Awaited<ReturnType<typeof pose>>) =>
    result.status === 'posed' && result.picture.kind === 'picture' && result.picture.picture.kind === 'scene'
      ? JSON.parse(result.picture.picture.sceneJson)
      : null;

  it('turns it over where it lies: its other side, the turn the other way, and back again, folding nothing', async () => {
    const { session, runtime } = sessionWith();
    const over = await pose(session, CP, { verb: 'turn-over' });
    expect(over).toMatchObject({ status: 'posed', render: { mode: 'crease-pattern', rotationDeg: 15, side: 'back' } });
    // Its paper is the back, its fold the other way up.
    const scene = sceneOf(over);
    expect(scene.items[0]).toMatchObject({ kind: 'face', side: 'back' });
    expect(scene.items.some((item: { role?: string }) => item.role === 'diagram-valley')).toBe(true);
    expect(scene.items.some((item: { role?: string }) => item.role === 'diagram-mountain')).toBe(false);
    const again = await pose(session, BACK, { verb: 'turn-over' });
    expect(again).toMatchObject({ render: { mode: 'crease-pattern', rotationDeg: 345 } });
    expect(again.status === 'posed' && 'side' in again.render).toBe(false);
    expect(runtime.fold).not.toHaveBeenCalled();
  });

  it('keeps its side through every turn and Reset Pose: a choice about the picture, with its own field', async () => {
    const { session } = sessionWith();
    for (const request of [
      { verb: 'rotate-right' },
      { verb: 'rotate-left' },
      { verb: 'rotate-to', degrees: 40 },
      { verb: 'reset' },
      { verb: 'upright' },
    ] as const) {
      expect(await pose(session, BACK, request)).toMatchObject({ render: { mode: 'crease-pattern', side: 'back' } });
    }
    expect(await pose(session, BACK, { verb: 'reset' })).toMatchObject({ render: { rotationDeg: 0, side: 'back' } });
  });

  it('folds from the front, lying as its back does, and comes back to the back it was', async () => {
    const { session } = sessionWith();
    // A back at 15 is the front at 345, turned over: the fold lies as that front does.
    expect(await pose(session, BACK, { verb: 'show-folded' })).toMatchObject({
      render: { mode: 'folded-flat', side: 'front', rotationDeg: 345, foldCase: 1 },
    });
    const pattern = await pose(session, FLAT, { verb: 'show-crease-pattern' }, cpDocument(), { 'crease-pattern': BACK });
    expect(pattern).toMatchObject({ render: BACK });
    expect(sceneOf(pattern).items[0]).toMatchObject({ side: 'back' });
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
    // Turned over where it lies: the mirror of what showed, so its turn runs the other way.
    expect(over).toMatchObject({ render: { side: 'back', rotationDeg: 330 } });
    expect(vi.mocked(runtime.setModel).mock.calls.at(-1)![1]).toMatchObject({ state: 'Back1', rotation: 0, scale: 1 });
    await pose(session, { ...FLAT, side: 'back' }, { verb: 'rotate-right' }, document);
    expect(runtime.fold).toHaveBeenCalledOnce();
    expect(held.get(7)).toBe(1);
  });

  it('keeps how it lies when it turns over and back: the turn runs the other way while it shows its back', async () => {
    const { session } = sessionWith();
    const document = cpDocument();
    const over = await pose(session, { ...FLAT, rotationDeg: 75 }, { verb: 'turn-over' }, document);
    expect(over).toMatchObject({ render: { side: 'back', rotationDeg: 285 } });
    const back = await pose(session, { ...FLAT, side: 'back', rotationDeg: 285 }, { verb: 'turn-over' }, document);
    expect(back).toMatchObject({ render: { side: 'front', rotationDeg: 75 } });
    const upright = await pose(session, { ...FLAT, rotationDeg: 0 }, { verb: 'turn-over' }, document);
    expect(upright).toMatchObject({ render: { rotationDeg: 0 } });
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
      solutions: { discovered: 2, hasNext: false },
    });
    expect(runtime.foldAnother).toHaveBeenCalledWith(7);
  });

  it('goes back to the layer order before by a jump to it, still counting those found past it (D23)', async () => {
    // As the kernel does it: a jump back restarts the search and replays it
    // forward to the case asked for, which forgets every one found past it.
    let found = 1;
    const runtime = fakeCaptureRuntime({
      foldAnother: vi.fn(async () => {
        found += 1;
        return { discoveredCases: found, displayStyle: 'Paper5' as const, currentCase: found, hasNext: found < 3 };
      }),
      foldToCase: vi.fn(async (_handle: number, objective: number) => ({
        discoveredCases: objective,
        displayStyle: 'Paper5' as const,
        currentCase: objective,
        hasNext: true,
      })),
    });
    const { session } = sessionWith(runtime);
    const document = cpDocument();
    await pose(session, FLAT, { verb: 'next-solution' }, document);
    const last = await pose(session, { ...FLAT, foldCase: 2 }, { verb: 'next-solution' }, document);
    expect(last).toMatchObject({ render: { foldCase: 3 }, solutions: { discovered: 3, hasNext: false } });
    const back = await pose(session, { ...FLAT, foldCase: 3 }, { verb: 'previous-solution' }, document);
    expect(back).toMatchObject({ render: { foldCase: 2 }, solutions: { discovered: 3, hasNext: false } });
    expect(runtime.foldToCase).toHaveBeenLastCalledWith(7, 2);
    expect(runtime.foldAnother).toHaveBeenCalledTimes(2);
  });

  it('keeps a search that ran out closed, though the kernel says "maybe more" again at the last order (D23)', async () => {
    // As the kernel does it: the last order says "maybe more" until a search
    // past it fails; the wrap and every replay to it say so again.
    const N = 3;
    let at = 1;
    let failed = false;
    const state = (current: number, hasNext: boolean) => ({ discoveredCases: current, displayStyle: 'Paper5' as const, currentCase: current, hasNext });
    const runtime = fakeCaptureRuntime({
      foldAnother: vi.fn(async () => {
        if (at < N) return state(++at, true);
        if (!failed) {
          failed = true;
          return state(at, false);
        }
        at = 1;
        failed = false;
        return state(1, true);
      }),
      foldToCase: vi.fn(async (_handle: number, objective: number) => {
        at = objective;
        failed = false;
        return state(objective, true);
      }),
    });
    const { session } = sessionWith(runtime);
    const document = cpDocument();
    let render = FLAT;
    const step = async (verb: 'next-solution' | 'previous-solution') => {
      const result = await pose(session, render, { verb }, document);
      if (result.status !== 'posed') throw new Error('posed');
      render = result.render as typeof FLAT;
      return `${result.render.mode === 'folded-flat' ? result.render.foldCase : '?'}/${result.solutions!.discovered}${result.solutions!.hasNext ? '+' : ''}`;
    };
    const readouts = [];
    for (let n = 0; n < 6; n += 1) readouts.push(await step('next-solution'));
    readouts.push(await step('previous-solution'), await step('next-solution'));
    expect(readouts).toEqual(['2/2+', '3/3+', '3/3', '1/3', '2/3', '3/3', '2/3', '3/3']);
  });

  it('counts the order it leaves when a fold opened fresh goes back from it (D23)', async () => {
    const runtime = fakeCaptureRuntime({
      foldToCase: vi.fn(async (_handle: number, objective: number) => ({
        discoveredCases: objective,
        displayStyle: 'Paper5' as const,
        currentCase: objective,
        hasNext: true,
      })),
    });
    const { session } = sessionWith(runtime);
    // A step saved at its fifth layer order, and no fold held yet.
    const back = await pose(session, { ...FLAT, foldCase: 5 }, { verb: 'previous-solution' }, cpDocument());
    expect(back).toMatchObject({ render: { foldCase: 4 }, solutions: { discovered: 5, hasNext: true } });
  });

  it('says a fold has no layer order when its layers cannot be ordered', async () => {
    const none = { discoveredCases: 0, currentCase: 0, hasNext: false, displayStyle: 'Transparent3' as const, outcome: 'NoSolutions' as const };
    const runtime = fakeCaptureRuntime({ fold: vi.fn(async () => ({ handle: 7, ...none })) });
    const { session } = sessionWith(runtime);
    const shown = await pose(session, { mode: 'crease-pattern', rotationDeg: 0 }, { verb: 'show-folded' }, cpDocument());
    expect(shown).toMatchObject({ noLayerOrder: true, solutions: { none: true } });
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

describe('standing a flat fold upright (Zach, 2026-10-05)', () => {
  // The fake kernel folds a 100 × 50 rectangle: symmetric about its middle, across and down.
  it('turns it the nearer way to stand on a mirror axis, then the other way up, and reports its axes with every pose', async () => {
    const { session } = sessionWith();
    const upright = await pose(session, FLAT, { verb: 'upright' });
    // At 30°, the axis across stands at 0° — nearer than the one down, at 90°.
    expect(upright).toMatchObject({ status: 'posed', render: { mode: 'folded-flat', rotationDeg: 0 }, mirrorAxes: [0, 90] });
    const again = await pose(session, { ...FLAT, rotationDeg: 0 }, { verb: 'upright' });
    expect(again).toMatchObject({ render: { rotationDeg: 180 } });
    expect(await pose(session, { ...FLAT, rotationDeg: 70 }, { verb: 'upright' })).toMatchObject({ render: { rotationDeg: 90 } });
    // Any flat pose says whether it could stand: the toolbar holds Upright on that.
    expect(await pose(session, FLAT, { verb: 'rotate-right' })).toMatchObject({ render: { rotationDeg: 45 }, mirrorAxes: [0, 90] });
  });

  it('keeps the spread, the side and the layer order: only the turn changes', async () => {
    const { session } = sessionWith();
    const spread = { ...FLAT, side: 'back' as const, spread: DEFAULT_AFFINE_SPREAD };
    expect(await pose(session, spread, { verb: 'upright' })).toMatchObject({
      render: { side: 'back', foldCase: 1, rotationDeg: 0, spread: DEFAULT_AFFINE_SPREAD },
    });
  });

  it('leaves a fold with no mirror axis as it was, and says it has none', async () => {
    const lopsided = [
      { x: 0, y: 0 },
      { x: 90, y: 10 },
      { x: 30, y: 70 },
    ];
    const edges = lopsided.map((from, index) => ({ from, to: lopsided[(index + 1) % 3]!, kind: 'border' as const }));
    const runtime = fakeCaptureRuntime({
      paperScene: vi.fn(async () => ({
        schema_version: 2,
        sheet_points: [],
        flipped: false,
        sheet: 100,
        faces: [{ outline: lopsided, points: [0, 1, 2], front_up: true, edges }],
        subfaces: [{ polygon: lopsided, faces_top_to_bottom: [0] }],
        aux_lines: [],
      })),
    });
    const { session } = sessionWith(runtime);
    expect(await pose(session, FLAT, { verb: 'upright' })).toMatchObject({ render: { rotationDeg: 30 }, mirrorAxes: [] });
  });

  it('has no upright for a crease pattern: a sheet has no up', async () => {
    const { session, runtime } = sessionWith();
    expect(await pose(session, CP, { verb: 'upright' })).toMatchObject({ render: { mode: 'crease-pattern', rotationDeg: 345 } });
    expect(runtime.fold).not.toHaveBeenCalled();
  });
});

describe('a flat fold’s spread (Phase 13)', () => {
  const SPREAD = { kind: 'depth' as const, amount: 0.08, toward: 'down-right' as const };
  const SPREAD_FLAT: DiagramCpRender = { ...FLAT, spread: SPREAD };
  const AFFINE = { kind: 'affine' as const, amount: 0.06, keep: 'bottom' as const, skew: 0.7, axisDeg: 120 };
  const AFFINE_FLAT: DiagramCpRender = { ...FLAT, spread: AFFINE };

  /** The faces a posed picture draws. */
  function facesOf(result: Awaited<ReturnType<typeof pose>>): number[] {
    if (result.status !== 'posed' || result.picture.kind !== 'picture' || result.picture.picture.kind !== 'scene') {
      throw new Error('expected a scene');
    }
    const scene = JSON.parse(result.picture.picture.sceneJson) as { items: Array<{ kind: string; face: number }> };
    return scene.items.filter((item) => item.kind === 'face').map((item) => item.face);
  }

  it('keeps it through every other verb: Turn Over, Rotate, the layer orders, Show Folded and Reset Pose', async () => {
    const runtime = fakeCaptureRuntime({
      foldAnother: vi.fn(async () => ({ discoveredCases: 2, displayStyle: 'Paper5' as const, currentCase: 2, hasNext: false })),
    });
    const { session } = sessionWith(runtime);
    const document = cpDocument();
    const requests: Array<[DiagramCpRender, LinkedPoseRequest, Partial<DiagramCpRender>]> = [
      [SPREAD_FLAT, { verb: 'turn-over' }, { side: 'back', rotationDeg: 330 }],
      [SPREAD_FLAT, { verb: 'rotate-left' }, { rotationDeg: 15 }],
      [SPREAD_FLAT, { verb: 'rotate-right' }, { rotationDeg: 45 }],
      [SPREAD_FLAT, { verb: 'rotate-to', degrees: 200 }, { rotationDeg: 200 }],
      [SPREAD_FLAT, { verb: 'next-solution' }, { foldCase: 2 }],
      [{ ...SPREAD_FLAT, foldCase: 2 }, { verb: 'previous-solution' }, { foldCase: 1 }],
      [SPREAD_FLAT, { verb: 'show-folded' }, { rotationDeg: 30 }],
      // The spread has its own off switch.
      [{ ...SPREAD_FLAT, side: 'back' }, { verb: 'reset' }, { side: 'front', rotationDeg: 0, foldCase: 1 }],
    ];
    for (const spread of [SPREAD, AFFINE]) {
      for (const [render, request, expected] of requests) {
        const result = await pose(session, render.mode === 'folded-flat' ? { ...render, spread } : render, request, document);
        expect(result, `${spread.kind} ${request.verb}`).toMatchObject({ render: { mode: 'folded-flat', ...expected, spread } });
        // Every face kept: a layer the drawer covered may show an edge now.
        expect(facesOf(result).sort(), `${spread.kind} ${request.verb}`).toEqual([0, 1]);
      }
    }
  });

  /** Spread starts as `spreadStartsFor` gives them, each unlike its default. */
  const STARTS: DiagramSpreadStarts = {
    any: { kind: 'depth', amount: 0.12, toward: 'up' },
    depth: { kind: 'depth', amount: 0.12, toward: 'up' },
    affine: { kind: 'affine', amount: 0.05, keep: 'bottom', skew: 0.2, axisDeg: 10 },
  };

  function poseWith(
    session: ReturnType<typeof sessionWith>['session'],
    render: DiagramCpRender,
    request: LinkedPoseRequest,
    spreadStart?: DiagramSpreadStarts,
    remembered?: DiagramCpSource['remembered']
  ) {
    const document = cpDocument();
    return poseLinkedStep(
      session,
      { document, creases: creasesOf(document), render, remembered, style: DEFAULT_DIAGRAM_STYLE, spreadStart },
      request
    );
  }

  const spreadOf = (result: Awaited<ReturnType<typeof pose>>) =>
    result.status === 'posed' && result.render.mode === 'folded-flat' ? result.render.spread : null;

  it('turns it on from the step before, or the default, and off again, drawing the buried face only while on', async () => {
    const { session } = sessionWith();
    const document = cpDocument();
    expect(spreadOf(await poseWith(session, FLAT, { verb: 'spread-layers' }))).toEqual(DEFAULT_LAYER_SPREAD);
    // Affine, on (Zach, 2026-10-05).
    expect(DEFAULT_LAYER_SPREAD).toEqual({ kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 81 });
    expect(spreadOf(await poseWith(session, FLAT, { verb: 'spread-layers' }, STARTS))).toEqual(STARTS.any);
    const off = await pose(session, SPREAD_FLAT, { verb: 'spread-layers' }, document);
    expect(off.status === 'posed' && off.render).toEqual({ mode: 'folded-flat', side: 'front', rotationDeg: 30, foldCase: 1 });
    expect(facesOf(off)).toEqual([0]);
  });

  it('starts every new flat pose spread: a pattern folded for the first time, a 3D fold whose creases fold flat now (13g)', async () => {
    const { session } = sessionWith();
    const first = await poseWith(session, CP, { verb: 'show-folded' });
    expect(first).toMatchObject({ render: { mode: 'folded-flat', rotationDeg: 345, spread: DEFAULT_LAYER_SPREAD } });
    expect(facesOf(first).sort()).toEqual([0, 1]);
    expect(spreadOf(await poseWith(session, CP, { verb: 'show-folded' }, STARTS))).toEqual(STARTS.any);
    const threeD: DiagramCpRender = { mode: 'folded-3d', camera: DEFAULT_FOLDED_3D_CAMERA, side: 'front' };
    const flatAgain = await poseWith(session, threeD, { verb: 'view-top' }, STARTS);
    expect(flatAgain).toMatchObject({ render: { mode: 'folded-flat', spread: STARTS.any } });
    // Remembered 3D, its creases folding flat now: a new flat pose too.
    const remembered = await poseWith(session, CP, { verb: 'show-folded' }, STARTS, { folded: threeD });
    expect(remembered).toMatchObject({ render: { mode: 'folded-flat', spread: STARTS.any } });
  });

  it('keeps a flat fold that already has a pose as it was: one remembered with no spread comes back with none', async () => {
    const { session } = sessionWith();
    const back = await poseWith(session, CP, { verb: 'show-folded' }, STARTS, { folded: FLAT });
    expect(back).toMatchObject({ render: { mode: 'folded-flat', rotationDeg: 30 } });
    expect(spreadOf(back)).toBeUndefined();
    expect(spreadOf(await poseWith(session, FLAT, { verb: 'rotate-right' }, STARTS))).toBeUndefined();
  });

  it('switches the kind to the step before’s of that kind, or its default, and never turns one on', async () => {
    const { session } = sessionWith();
    const cases: Array<[DiagramCpRender, SpreadKind, DiagramSpreadStarts | undefined, unknown]> = [
      [SPREAD_FLAT, 'affine', undefined, DEFAULT_AFFINE_SPREAD],
      [SPREAD_FLAT, 'affine', STARTS, STARTS.affine],
      [AFFINE_FLAT, 'depth', undefined, DEFAULT_DEPTH_SPREAD],
      [AFFINE_FLAT, 'depth', STARTS, STARTS.depth],
      // The kind it has: nothing changes.
      [AFFINE_FLAT, 'affine', STARTS, AFFINE],
      [FLAT, 'affine', STARTS, undefined],
    ];
    for (const [render, kind, starts, spread] of cases) {
      expect(spreadOf(await poseWith(session, render, { verb: 'spread-kind', kind }, starts)), `${kind}`).toEqual(spread);
    }
    expect(DEFAULT_AFFINE_SPREAD).toEqual({ kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 81 });
  });

  it('sets each value within its range, only on a spread of its kind, and never turns one on', async () => {
    const { session } = sessionWith();
    const document = cpDocument();
    const cases: Array<[LinkedPoseRequest, DiagramCpRender, unknown]> = [
      [{ verb: 'spread-amount', amount: 0.123456 }, SPREAD_FLAT, { ...SPREAD, amount: 0.1235 }],
      [{ verb: 'spread-amount', amount: 0.9 }, SPREAD_FLAT, { ...SPREAD, amount: 0.2 }],
      [{ verb: 'spread-amount', amount: 0 }, SPREAD_FLAT, { ...SPREAD, amount: 0.005 }],
      [{ verb: 'spread-direction', toward: 'left' }, SPREAD_FLAT, { ...SPREAD, toward: 'left' }],
      [{ verb: 'spread-amount', amount: 0.9 }, AFFINE_FLAT, { ...AFFINE, amount: 0.25 }],
      [{ verb: 'spread-keep', keep: 'top' }, AFFINE_FLAT, { ...AFFINE, keep: 'top' }],
      [{ verb: 'spread-skew', skew: 0.333 }, AFFINE_FLAT, { ...AFFINE, skew: 0.33 }],
      [{ verb: 'spread-skew', skew: 2 }, AFFINE_FLAT, { ...AFFINE, skew: 1 }],
      [{ verb: 'spread-axis', axisDeg: 181.2 }, AFFINE_FLAT, { ...AFFINE, axisDeg: 1 }],
      // A value for the other kind leaves it as it is.
      [{ verb: 'spread-direction', toward: 'left' }, AFFINE_FLAT, AFFINE],
      [{ verb: 'spread-skew', skew: 0.5 }, SPREAD_FLAT, SPREAD],
      [{ verb: 'spread-axis', axisDeg: 45 }, SPREAD_FLAT, SPREAD],
      [{ verb: 'spread-keep', keep: 'top' }, SPREAD_FLAT, SPREAD],
      // None turns a spread on.
      [{ verb: 'spread-amount', amount: 0.1 }, FLAT, undefined],
      [{ verb: 'spread-direction', toward: 'left' }, FLAT, undefined],
      [{ verb: 'spread-skew', skew: 0.5 }, FLAT, undefined],
    ];
    for (const [request, render, spread] of cases) {
      const result = await pose(session, render, request, document);
      expect(spreadOf(result), JSON.stringify(request)).toEqual(spread ?? undefined);
    }
  });

  it('spreads and turns the held fold again with no call to the kernel; another side reads it again', async () => {
    const { session, runtime } = sessionWith();
    const document = cpDocument();
    await pose(session, SPREAD_FLAT, { verb: 'show-folded' }, document);
    const reads = () => [vi.mocked(runtime.paperScene).mock.calls.length, vi.mocked(runtime.renderSnapshot).mock.calls.length];
    const read = reads();
    await pose(session, SPREAD_FLAT, { verb: 'spread-amount', amount: 0.15 }, document);
    await pose(session, SPREAD_FLAT, { verb: 'spread-direction', toward: 'up' }, document);
    await pose(session, SPREAD_FLAT, { verb: 'spread-layers' }, document);
    await pose(session, FLAT, { verb: 'spread-layers' }, document);
    await pose(session, SPREAD_FLAT, { verb: 'rotate-right' }, document);
    expect(reads()).toEqual(read);
    await pose(session, SPREAD_FLAT, { verb: 'turn-over' }, document);
    expect(reads()).toEqual([read[0]! + 1, read[1]! + 1]);
    expect(runtime.fold).toHaveBeenCalledOnce();
  });

  it('draws the held fold now for a preview, and nothing for another side, layer order or pattern', async () => {
    const { session } = sessionWith();
    const document = cpDocument();
    const held = { document, side: 'front' as const, foldCase: 1 };
    expect(session.heldFlatPicture(held, 0, SPREAD)).toBeNull();
    await pose(session, SPREAD_FLAT, { verb: 'show-folded' }, document);
    expect(session.heldFlatPicture(held, 30, SPREAD)).toMatchObject({ kind: 'picture', picture: { kind: 'scene' } });
    expect(session.heldFlatPicture({ ...held, side: 'back' }, 30, SPREAD)).toBeNull();
    expect(session.heldFlatPicture({ ...held, foldCase: 2 }, 30, SPREAD)).toBeNull();
    expect(session.heldFlatPicture({ ...held, document: cpDocument() }, 30, SPREAD)).toBeNull();
    session.dispose();
    expect(session.heldFlatPicture(held, 30, SPREAD)).toBeNull();
  });

  it('draws a preview without the faces on the paper a committed flat capture keeps', async () => {
    const { session } = sessionWith(fakeCaptureRuntime({ paperScene: vi.fn(async () => halfFoldOnSheetKernelScene()) }));
    const document = cpDocument();
    const committed = await pose(session, SPREAD_FLAT, { verb: 'show-folded' }, document);
    if (committed.status !== 'posed' || committed.picture.kind !== 'picture' || committed.picture.picture.kind !== 'scene') {
      throw new Error('expected a scene');
    }
    expect(committed.picture.picture.paperFaces).toEqual(expect.any(String));
    const preview = session.heldFlatPicture({ document, side: 'front', foldCase: 1 }, 30, SPREAD);
    expect(preview).toMatchObject({ kind: 'picture', picture: { kind: 'scene' } });
    expect(preview?.kind === 'picture' && preview.picture.kind === 'scene' && preview.picture.paperFaces).toBeUndefined();
  });

  it('remembers it while the pattern is shown, and folds back to it (D19)', async () => {
    const { session } = sessionWith();
    const document = cpDocument();
    const folded = await pose(session, CP, { verb: 'show-folded' }, document, { folded: SPREAD_FLAT });
    expect(folded).toMatchObject({ render: SPREAD_FLAT });
    expect(facesOf(folded).sort()).toEqual([0, 1]);
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
