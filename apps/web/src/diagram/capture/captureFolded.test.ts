import { describe, expect, it, vi } from 'vitest';
import type { OristudioCpFold3dFoldResult } from '../../engine/oristudioCpTypes';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { DEFAULT_FOLDED_3D_CAMERA, antipodalCamera } from '../../cp-workspace/folded/folded3dCamera';
import { folded3dSceneStyleKey } from '../../cp-workspace/folded/folded3dScene';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { line, sceneOf, sheetWithCrease } from '../../lib/paper/paperScene.fixtures';
import {
  createDiagram,
  DEFAULT_DIAGRAM_STYLE,
  insertSteps,
  createStep,
  type DiagramCpRender,
  type DiagramCpScope,
} from '../document/diagramDocument';
import { readDiagram, writeDiagram } from '../document/diagramFile';
import { diagramPaperStyle } from '../pictures/diagramPaperStyle';
import { paintScene } from '../pictures/paintDiagramStep';
import { simulatorSceneStyleKey } from '../../simulator/simulatorExportTarget';
import {
  cpDocument,
  fakeCaptureRuntime,
  LEFT_FOLD_LINE_IDS,
  movedLines,
  TWO_SQUARES,
  twoSquaresSegmentation,
} from './capture.fixtures';
import {
  captureStep,
  readFlatPicture,
  SCENE_BUDGET_BYTES,
  storeScene,
  type CaptureStepRequest,
} from './captureFolded';
import { CAPTURE_PX_PER_UNIT } from './captureGeometry';
import { stepsIn } from '../document/diagramSteps.fixtures';

const folded3dStoredScene = vi.hoisted(() => ({ folded3dFigureScene: vi.fn() }));
vi.mock('../../cp-workspace/folded/folded3dStoredScene', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/folded/folded3dStoredScene')>()),
  ...folded3dStoredScene,
}));

const segmentation = twoSquaresSegmentation();
const [left] = resolveCpSegments(segmentation);
const scope: DiagramCpScope = { kind: 'segment', region: regionReferenceFor(left!) };

function request(render: DiagramCpRender, patch: Partial<CaptureStepRequest> = {}): CaptureStepRequest {
  return { document: cpDocument(), segmentation, scope, render, style: DEFAULT_DIAGRAM_STYLE, ...patch };
}

const FLAT: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 };

/** The left square's diagonal as a partial fold: the pattern folds in 3D. */
const partial = () => cpDocument(undefined, (cp, id) => (id === 8 ? { ...cp, fold_magnitude: 90 } : cp));

describe('captureStep, a crease pattern', () => {
  it('draws the creases with no fold, and records what it was made from', async () => {
    const runtime = fakeCaptureRuntime();
    const result = await captureStep(runtime, request({ mode: 'crease-pattern', rotationDeg: 30 }));
    expect(runtime.fold).not.toHaveBeenCalled();
    expect(result.status).toBe('captured');
    if (result.status !== 'captured') return;
    expect(result.source).toMatchObject({
      kind: 'cp',
      scope,
      render: { mode: 'crease-pattern', rotationDeg: 30 },
    });
    expect(result.source.thumbnail.strokes.length).toBeGreaterThan(0);
    expect(result.captured).toMatchObject({ kind: 'picture', picture: { kind: 'scene', paperScale: CAPTURE_PX_PER_UNIT } });
  });

  // The stored scene lost every line's `joined` flags on its way through the
  // file's reader, so the border's corners painted with butt-cap notches.
  it('paints its stored picture with the joins its lines were captured with', async () => {
    const result = await captureStep(fakeCaptureRuntime(), request({ mode: 'crease-pattern', rotationDeg: 0 }));
    if (result.status !== 'captured' || result.captured.kind !== 'picture') throw new Error('captured');
    const picture = result.captured.picture;
    if (picture.kind !== 'scene') throw new Error('a scene');
    expect(picture.sceneJson).toContain('"joined"');
    const painted = paintScene({ kind: 'scene', picture, pattern: true }, DEFAULT_DIAGRAM_STYLE)!;
    // Round joins at the shared ends, where the diagram's butt-capped pens would notch.
    expect(painted.svg).toMatch(/stroke-linecap="round"/);
  });

  // Refresh, Show as or a Pose verb on a step whose pattern moved since it was captured.
  it('captures a moved sheet by what the step remembers, its fingerprint unchanged, and follows it there', async () => {
    const CP: DiagramCpRender = { mode: 'crease-pattern', rotationDeg: 0 };
    const before = await captureStep(fakeCaptureRuntime(), request(CP));
    if (before.status !== 'captured') throw new Error('captured');
    const known = { fingerprint: before.source.fingerprint, drawn: true };
    const moved = twoSquaresSegmentation({ dx: 750.3, dy: -12.9 });
    const after = await captureStep(
      fakeCaptureRuntime(),
      request(CP, { document: cpDocument(movedLines(TWO_SQUARES, 750.3, -12.9)), segmentation: moved, known })
    );
    if (after.status !== 'captured') throw new Error('captured after the move');
    expect(after.source.fingerprint).toBe(before.source.fingerprint);
    expect(after.source.scope.region).toEqual(regionReferenceFor(resolveCpSegments(moved)[0]!));
    // In its place, the scope it was asked with stands — a stale id hint and
    // all, which a re-anchor to the segment would have replaced.
    const asked: DiagramCpScope = { kind: 'segment', region: { ...regionReferenceFor(left!), segmentIdHint: 99 } };
    const again = await captureStep(fakeCaptureRuntime(), request(CP, { scope: asked, known }));
    if (again.status !== 'captured') throw new Error('captured in place');
    expect(again.source.scope).toEqual(asked);
  });

  it('says why when there is nothing to capture', async () => {
    const runtime = fakeCaptureRuntime();
    expect(await captureStep(runtime, request(FLAT, { segmentation: null }))).toEqual({ status: 'unknown' });
    expect(
      await captureStep(runtime, request(FLAT, { segmentation: twoSquaresSegmentation({ wall: false }) }))
    ).toEqual({ status: 'missing' });
    expect(runtime.fold).not.toHaveBeenCalled();
  });
});

describe('captureStep, simulated (D19)', () => {
  const VIEW = { yaw: 0.5, pitch: -0.7, zoom: 1.4 };
  const SIMULATED: DiagramCpRender = { mode: 'simulated', foldPercent: 0, view: VIEW };

  it('takes the simulator’s flat sheet for the region at its camera, folding nothing, in the simulator’s light', async () => {
    const runtime = fakeCaptureRuntime();
    const simulateFlat = vi.fn(async () => sheetWithCrease());
    const result = await captureStep(runtime, request(SIMULATED, { simulateFlat }));
    expect(runtime.fold).not.toHaveBeenCalled();
    expect(simulateFlat).toHaveBeenCalledOnce();
    const [segment, view, style] = simulateFlat.mock.calls[0]! as unknown as [{ id: number }, unknown, unknown];
    expect(segment.id).toBe(left!.id);
    expect(view).toEqual(VIEW);
    expect(style).toEqual(diagramPaperStyle(DEFAULT_DIAGRAM_STYLE));
    if (result.status !== 'captured' || result.captured.kind !== 'picture') throw new Error('captured');
    expect(result.source.render).toEqual(SIMULATED);
    expect(result.captured.picture).toMatchObject({
      kind: 'scene',
      paperScale: null,
      styleKey: simulatorSceneStyleKey(diagramPaperStyle(DEFAULT_DIAGRAM_STYLE)),
    });
  });

  it('leaves a fold above 0% to Pose, and says when the region cannot be simulated', async () => {
    const runtime = fakeCaptureRuntime();
    const simulateFlat = vi.fn(async () => sheetWithCrease());
    expect(await captureStep(runtime, request({ ...SIMULATED, foldPercent: 40 } as DiagramCpRender, { simulateFlat }))).toEqual({
      status: 'needs-pose',
    });
    expect(simulateFlat).not.toHaveBeenCalled();
    expect(await captureStep(runtime, request(SIMULATED, { simulateFlat: async () => null }))).toEqual({ status: 'unavailable' });
    expect(await captureStep(runtime, request(SIMULATED))).toEqual({ status: 'unavailable' });
  });
});

describe('captureStep, flat', () => {
  it('folds exactly the scope’s foldable creases, at rotation 0 and scale 1, and frees the figure', async () => {
    const runtime = fakeCaptureRuntime();
    const result = await captureStep(runtime, request({ ...FLAT, side: 'back', rotationDeg: 90 }));
    expect(runtime.fold).toHaveBeenCalledOnce();
    const [startingFace, , model, lineIds] = vi.mocked(runtime.fold).mock.calls[0]!;
    expect(startingFace).toBe(1);
    expect(lineIds).toEqual(LEFT_FOLD_LINE_IDS);
    expect(model).toMatchObject({ rotation: 0, scale: 1, state: 'Back1' });
    expect(runtime.free).toHaveBeenCalledWith(7);
    expect(result.status).toBe('captured');
    if (result.status !== 'captured' || result.captured.kind !== 'picture') throw new Error('expected a picture');
    const scene = JSON.parse((result.captured.picture as { sceneJson: string }).sceneJson);
    // The buried face is left out.
    expect(scene.items.filter((item: { kind: string }) => item.kind === 'face')).toHaveLength(1);
    // Turned a quarter: the 100 × 50 fold stands 100 tall.
    expect(scene.bounds.maxY - scene.bounds.minY).toBeCloseTo(100 * CAPTURE_PX_PER_UNIT, 1);
    expect(result.noLayerOrder).toBe(false);
  });

  it('steps to the solution asked for, and keeps the last one found when there are fewer', async () => {
    const runtime = fakeCaptureRuntime();
    const result = await captureStep(runtime, request({ ...FLAT, foldCase: 5 }));
    expect(runtime.foldToCase).toHaveBeenCalledWith(7, 5);
    expect(result.status === 'captured' && result.source.render).toMatchObject({ foldCase: 2 });
  });

  it('keeps a fold with no layer order as its sanitized development, which the file reads back unchanged', async () => {
    const runtime = fakeCaptureRuntime({
      fold: vi.fn(async () => ({
        handle: 3,
        discoveredCases: 0,
        displayStyle: 'Transparent3' as const,
        outcome: 'NoSolutions' as const,
      })),
    });
    const result = await captureStep(runtime, request(FLAT));
    expect(runtime.paperScene).not.toHaveBeenCalled();
    if (result.status !== 'captured' || result.captured.kind !== 'picture') throw new Error('expected a picture');
    expect(result.noLayerOrder).toBe(true);
    const picture = result.captured.picture;
    expect(picture.kind).toBe('fixed');
    expect(picture.key).toMatch(/^fixed-/);
    const document = insertSteps(createDiagram({ title: 'Fixed' }), [
      { ...createStep(() => 'step-1'), source: result.source, picture },
    ], 0);
    const read = readDiagram(JSON.parse(JSON.stringify(writeDiagram(document))))!;
    expect(stepsIn(read.document)[0]!.picture).toEqual(picture);
    expect(runtime.free).toHaveBeenCalledWith(3);
  });

  it('frees the figure even when reading it fails', async () => {
    const runtime = fakeCaptureRuntime({ renderSnapshot: vi.fn(async () => null) });
    await expect(captureStep(runtime, request(FLAT))).rejects.toThrow(/nothing to draw/);
    expect(runtime.free).toHaveBeenCalledWith(7);
  });

  it('keeps a render’s spread through a Refresh, and draws every face spread (Phase 13)', async () => {
    const render: DiagramCpRender = { ...FLAT, rotationDeg: 90, spread: { kind: 'depth' as const, amount: 0.05, toward: 'up-left' } };
    const result = await captureStep(fakeCaptureRuntime(), request(render));
    if (result.status !== 'captured' || result.captured.kind !== 'picture') throw new Error('expected a picture');
    expect(result.source.render).toEqual(render);
    const scene = JSON.parse((result.captured.picture as { sceneJson: string }).sceneJson);
    expect(scene.items.filter((item: { kind: string }) => item.kind === 'face')).toHaveLength(2);
  });

  it('captures a 3D request flat when every crease is a full fold', async () => {
    const runtime = fakeCaptureRuntime();
    const result = await captureStep(
      runtime,
      request({ mode: 'folded-3d', side: 'back', camera: DEFAULT_FOLDED_3D_CAMERA })
    );
    expect(runtime.fold3d).not.toHaveBeenCalled();
    expect(result.status === 'captured' && result.source.render).toEqual({
      mode: 'folded-flat',
      side: 'back',
      rotationDeg: 0,
      foldCase: 1,
    });
  });

  it('starts that flat fold with the spread it is handed, as every new flat pose starts (13g)', async () => {
    const spreadStart = { kind: 'affine' as const, amount: 0.04, keep: 'top' as const, skew: 1, axisDeg: 81 };
    const result = await captureStep(
      fakeCaptureRuntime(),
      request({ mode: 'folded-3d', side: 'front', camera: DEFAULT_FOLDED_3D_CAMERA }, { spreadStart })
    );
    expect(result.status === 'captured' && result.source.render).toEqual({
      mode: 'folded-flat',
      side: 'front',
      rotationDeg: 0,
      foldCase: 1,
      spread: spreadStart,
    });
    // A flat fold asked for keeps its own pose, spread or not.
    const flat = await captureStep(fakeCaptureRuntime(), request(FLAT, { spreadStart }));
    expect(flat.status === 'captured' && flat.source.render).toEqual(FLAT);
  });
});

describe('readFlatPicture with a spread', () => {
  /** The stored scene's faces, by kernel face. */
  async function facesOf(rotationDeg: number, spread?: LayerSpreadOptions) {
    const captured = await readFlatPicture(fakeCaptureRuntime(), 7, { displayStyle: 'Paper5' }, rotationDeg, undefined, spread);
    if (captured.kind !== 'picture' || captured.picture.kind !== 'scene') throw new Error('expected a scene');
    const scene = JSON.parse(captured.picture.sceneJson) as { items: Array<{ kind: string; face: number; rings: number[][][] }> };
    return new Map(scene.items.filter((item) => item.kind === 'face').map((item) => [item.face, item.rings[0]!]));
  }

  it('keeps the buried face, stepped by its depth on the screen however the picture is turned', async () => {
    // The half fold: face 0 over face 1. They share the fold's ends (corners
    // 2 and 3, sheet vertices 2 and 3), which step half as far as face 1's
    // own corners; face 0's own corners stay. The model is 100 units across,
    // so 5% steps the deepest layer 5 units, on the screen whatever the turn.
    expect([...(await facesOf(0)).keys()]).toEqual([0]);
    const reach = 5 * CAPTURE_PX_PER_UNIT;
    const depth = new Map([
      [0, [0, 0, 0.5, 0.5]],
      [1, [1, 1, 0.5, 0.5]],
    ]);
    const unit = { 'up-left': [-Math.SQRT1_2, -Math.SQRT1_2], down: [0, 1] } as const;
    for (const rotationDeg of [0, 90]) {
      const plain = (await facesOf(rotationDeg)).get(0)!;
      for (const toward of ['up-left', 'down'] as const) {
        const spread = await facesOf(rotationDeg, { kind: 'depth', amount: 0.05, toward });
        expect([...spread.keys()].sort()).toEqual([0, 1]);
        for (const [face, fractions] of depth) {
          fractions.forEach((fraction, corner) => {
            const at = spread.get(face)![corner]!;
            expect(at[0]).toBeCloseTo(plain[corner]![0] + fraction * reach * unit[toward][0], 1);
            expect(at[1]).toBeCloseTo(plain[corner]![1] + fraction * reach * unit[toward][1], 1);
          });
        }
      }
    }
  });
});

describe('captureStep, 3D', () => {
  const placed: OristudioCpFold3dFoldResult = {
    status: 'placed',
    handle: 11,
    snapshot: {} as never,
    render: { cell_points: [0, 0, 0, 1, 0, 0, 0, 1, 0], span: 1 } as never,
  };

  it('folds a pattern with a partial fold in 3D, in the diagram’s light, and frees the figure', async () => {
    folded3dStoredScene.folded3dFigureScene.mockReturnValue(sheetWithCrease());
    const runtime = fakeCaptureRuntime({ fold3d: vi.fn(async () => placed) });
    const result = await captureStep(runtime, request(FLAT, { document: partial() }));
    expect(runtime.fold).not.toHaveBeenCalled();
    expect(runtime.fold3d).toHaveBeenCalledOnce();
    expect(vi.mocked(runtime.fold3d).mock.calls[0]![1]).toMatchObject({ state: 'Front0', rotation: 0 });
    const [, , options] = folded3dStoredScene.folded3dFigureScene.mock.calls[0]!;
    expect(options).toMatchObject({ markHidden: true, space: 'document' });
    expect(runtime.free).toHaveBeenCalledWith(11);
    if (result.status !== 'captured' || result.captured.kind !== 'picture') throw new Error('expected a picture');
    // A flat request from the front: Edit's default camera.
    expect(result.source.render).toEqual({
      mode: 'folded-3d',
      side: 'front',
      camera: { ...DEFAULT_FOLDED_3D_CAMERA },
    });
    expect(result.captured.picture).toMatchObject({
      kind: 'scene',
      paperScale: null,
      styleKey: folded3dSceneStyleKey(diagramPaperStyle(DEFAULT_DIAGRAM_STYLE)),
    });
  });

  it('turns a flat request from the back into the camera on the back', async () => {
    folded3dStoredScene.folded3dFigureScene.mockReturnValue(sheetWithCrease());
    const runtime = fakeCaptureRuntime({ fold3d: vi.fn(async () => placed) });
    const result = await captureStep(runtime, request({ ...FLAT, side: 'back' }, { document: partial() }));
    const { yaw, pitch, zoom } = antipodalCamera(DEFAULT_FOLDED_3D_CAMERA);
    expect(result.status === 'captured' && result.source.render).toMatchObject({
      camera: { yaw, pitch, zoom },
    });
  });

  it('hands back a refusal, with nothing to free', async () => {
    const refusal = { code: 'self_intersection' } as never;
    const runtime = fakeCaptureRuntime({ fold3d: vi.fn(async () => ({ status: 'refused' as const, refusal })) });
    expect(await captureStep(runtime, request(FLAT, { document: partial() }))).toEqual({
      status: 'refused',
      refusal,
    });
    expect(runtime.free).not.toHaveBeenCalled();
  });
});

describe('a capture in the file', () => {
  it.each([
    ['a crease pattern', { mode: 'crease-pattern', rotationDeg: 15 } as DiagramCpRender, cpDocument()],
    ['a flat fold', FLAT, cpDocument()],
    ['a flat fold with its layers spread', { ...FLAT, spread: { kind: 'depth' as const, amount: 0.075, toward: 'down' } } as DiagramCpRender, cpDocument()],
    // Asked for flat from the back: routed to 3D, its render built by the capture.
    ['a 3D fold', { ...FLAT, side: 'back' } as DiagramCpRender, partial()],
  ])('writes %s exactly as a load reads it back', async (_label, render, document) => {
    folded3dStoredScene.folded3dFigureScene.mockReturnValue(sheetWithCrease());
    const runtime = fakeCaptureRuntime({
      fold3d: vi.fn(async () => ({
        status: 'placed' as const,
        handle: 11,
        snapshot: {} as never,
        render: { cell_points: [0, 0, 0, 1, 0, 0, 0, 1, 0], span: 1 } as never,
      })),
    });
    const result = await captureStep(runtime, request(render, { document }));
    if (result.status !== 'captured' || result.captured.kind !== 'picture') throw new Error('expected a picture');
    const diagram = insertSteps(createDiagram({ title: 'Linked' }), [
      { ...createStep(() => 'step-1'), source: result.source, picture: result.captured.picture },
    ], 0);
    const read = readDiagram(JSON.parse(JSON.stringify(writeDiagram(diagram))))!;
    // Field for field and in order, so a save of what was loaded is the same bytes.
    expect(JSON.stringify(read.document)).toBe(JSON.stringify(diagram));
  });
});

describe('storeScene', () => {
  it('keys a scene by what it draws, and sends one past the budget back to be kept as a bitmap', () => {
    const scene = sheetWithCrease();
    const first = storeScene(scene, 3, null);
    const again = storeScene(sheetWithCrease(), 3, null);
    expect(first.kind === 'picture' && first.picture.key).toBe(again.kind === 'picture' && again.picture.key);
    const lines = Array.from({ length: Math.ceil(SCENE_BUDGET_BYTES / 60) }, (_, i) =>
      line('mountain', [i, 0], [i, 100.5])
    );
    expect(storeScene(sceneOf(lines, 400), 3, null)).toMatchObject({ kind: 'over-budget', paperScale: 3 });
  });

  it('sends a spread picture past the budget back to be kept as a bitmap: every face is kept with a spread', async () => {
    // A sheet cut into many small faces, none of them buried: too much to keep as vector.
    const side = 130;
    const faces = Array.from({ length: side * side }, (_, index) => {
      const [x, y] = [index % side, Math.floor(index / side)];
      const outline = [
        { x, y },
        { x: x + 1, y },
        { x: x + 1, y: y + 1 },
        { x, y: y + 1 },
      ];
      const edges = outline.map((from, corner) => ({ from, to: outline[(corner + 1) % 4]!, kind: 'border' as const }));
      return { outline, points: [0, 1, 2, 3].map((corner) => index * 4 + corner), front_up: true, edges };
    });
    const runtime = fakeCaptureRuntime({
      paperScene: vi.fn(async () => ({ schema_version: 2, flipped: false, sheet: side, faces, subfaces: [], aux_lines: [], sheet_points: [] })),
    });
    const spread = await readFlatPicture(runtime, 7, { displayStyle: 'Paper5' }, 0, undefined, {
      kind: 'depth',
      amount: 0.05,
      toward: 'up-left',
    });
    expect(spread).toMatchObject({ kind: 'over-budget', paperScale: CAPTURE_PX_PER_UNIT });
  });

  it('refuses a scene with nothing in it', () => {
    expect(() => storeScene(sceneOf([]), null, null)).toThrow(/nothing to draw/);
  });
});
