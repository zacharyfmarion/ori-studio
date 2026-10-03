import { describe, expect, it, vi } from 'vitest';
import type { OristudioCpFold3dFoldResult } from '../../engine/oristudioCpTypes';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { DEFAULT_FOLDED_3D_CAMERA, antipodalCamera } from '../../cp-workspace/folded/folded3dCamera';
import { folded3dSceneStyleKey } from '../../cp-workspace/folded/folded3dScene';
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
import { cpDocument, fakeCaptureRuntime, LEFT_FOLD_LINE_IDS, twoSquaresSegmentation } from './capture.fixtures';
import { captureStep, SCENE_BUDGET_BYTES, storeScene, type CaptureStepRequest } from './captureFolded';
import { CAPTURE_PX_PER_UNIT } from './captureGeometry';

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

  it('says why when there is nothing to capture', async () => {
    const runtime = fakeCaptureRuntime();
    expect(await captureStep(runtime, request(FLAT, { segmentation: null }))).toEqual({ status: 'unknown' });
    expect(
      await captureStep(runtime, request(FLAT, { segmentation: twoSquaresSegmentation({ wall: false }) }))
    ).toEqual({ status: 'missing' });
    expect(runtime.fold).not.toHaveBeenCalled();
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
    expect(read.document.steps[0]!.picture).toEqual(picture);
    expect(runtime.free).toHaveBeenCalledWith(3);
  });

  it('frees the figure even when reading it fails', async () => {
    const runtime = fakeCaptureRuntime({ renderSnapshot: vi.fn(async () => null) });
    await expect(captureStep(runtime, request(FLAT))).rejects.toThrow(/nothing to draw/);
    expect(runtime.free).toHaveBeenCalledWith(7);
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

  it('refuses a scene with nothing in it', () => {
    expect(() => storeScene(sceneOf([]), null, null)).toThrow(/nothing to draw/);
  });
});
