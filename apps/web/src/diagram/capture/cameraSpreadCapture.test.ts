import { describe, expect, it } from 'vitest';
import { captureCameraSpread } from './cameraSpreadCapture';
import { storeScene } from './captureFolded';
import { halfFoldOnSheetKernelScene } from './capture.fixtures';
import { DEFAULT_CAMERA_SPREAD, createDiagram } from '../document/diagramDocument';
import { cpStep, stepsIn } from '../document/diagramSteps.fixtures';
import { readDiagram, writeDiagram } from '../document/diagramFile';
import { paperFacesOf, faceSpreadMove, unspreadOn } from '../zoom/zoomImprint';
import { cameraSpreadInitialView } from '../../cp-workspace/folded/cameraSpreadView';
import { withSpreadField } from './linkedPose';
import { withCarriedAnnotations } from '../annotate/annotationCarry';
import { readXRayFaces } from '../xray/xrayScene';
import type { PaperScene, ScenePoint } from '../../lib/paper/paperScene';

function captured(projection: 'diagram' | 'orthographic' | 'perspective', amount = 0.18) {
  const spread = {
    ...DEFAULT_CAMERA_SPREAD,
    projection,
    amount,
    camera: {
      ...cameraSpreadInitialView({ directionDeg: 143, inclinationDeg: 86 }),
      pan: [0.13, -0.08] as const,
      zoom: 1.3,
    },
  };
  const result = captureCameraSpread(halfFoldOnSheetKernelScene(), spread, 15);
  const stored = storeScene(result.scene, result.paperScale, null, result.paperFaces!);
  if (stored.kind !== 'picture' || stored.picture.kind !== 'scene') throw new Error('Expected vector capture');
  return { spread, result, picture: stored.picture };
}

describe('production camera spread capture', () => {
  it('carries marks on a clipped face with disjoint islands, but not through a hole', () => {
    const first = captured('perspective');
    const spread = { ...first.spread, amount: 0.3, camera: { ...first.spread.camera, pan: [0.25, -0.08] as const } };
    const next = captureCameraSpread(halfFoldOnSheetKernelScene(), spread, 15);
    const afterStored = storeScene(next.scene, next.paperScale, null, next.paperFaces!);
    if (afterStored.kind !== 'picture') throw new Error('Expected picture');
    const render = { mode: 'folded-flat' as const, side: 'front' as const, foldCase: 1, rotationDeg: 15 };
    const beforeStep = cpStep('camera', { ...render, spread: first.spread }, first.picture);
    const afterStep = cpStep('camera', { ...render, spread }, afterStored.picture);
    const beforeFaces = paperFacesOf(beforeStep)!;
    const afterFaces = paperFacesOf(afterStep)!;
    const ring = beforeFaces.unspread[0]!;
    const paper: ScenePoint = [
      ring.reduce((n, p) => n + p[0], 0) / ring.length,
      ring.reduce((n, p) => n + p[1], 0) / ring.length,
    ];
    const at = faceSpreadMove(beforeFaces, 0, paper);
    const target = faceSpreadMove(afterFaces, 0, paper);
    const square = (cx: number, cy: number, r: number): ScenePoint[] => [
      [cx - r, cy - r],
      [cx + r, cy - r],
      [cx + r, cy + r],
      [cx - r, cy + r],
    ];
    const inPicture = (p: ScenePoint, scene: PaperScene): ScenePoint => {
      const b = scene.bounds,
        edge = Math.max(b.maxX - b.minX, b.maxY - b.minY);
      return [(p[0] - b.minX) / edge, (p[1] - b.minY) / edge];
    };
    for (const hole of [false, true]) {
      const scene: PaperScene = {
        ...first.result.scene,
        items: [
          {
            kind: 'face',
            hidden: false,
            face: 0,
            side: 'front',
            shade: 1,
            rings: [square(at[0], at[1], 2), hole ? square(at[0], at[1], 1) : square(at[0] + 6, at[1], 1)],
          },
        ],
      };
      const saved = storeScene(scene, first.result.paperScale, null, first.result.paperFaces!);
      if (saved.kind !== 'picture') throw new Error('Expected picture');
      const from = inPicture(at, scene);
      const annotations = [{ id: 'mark', kind: 'valley-arrow' as const, from, to: from, bend: 0.1 }];
      const before = { ...beforeStep, picture: saved.picture, annotations, annotatedPictureKey: saved.picture.key };
      const moved = withCarriedAnnotations(before, { ...afterStep, annotations }, {});
      const arrow = moved.annotations[0] as (typeof annotations)[number];
      const expected = hole ? from : inPicture(target, next.scene);
      expect(arrow.from[0]).toBeCloseTo(expected[0], 5);
      expect(arrow.from[1]).toBeCloseTo(expected[1], 5);
    }
  });
  it('reconstructs full projected faces for x-ray instead of the clipped visible fragments', () => {
    const { spread, result, picture } = captured('perspective');
    const step = cpStep(
      'camera',
      { mode: 'folded-flat', side: 'front', foldCase: 1, rotationDeg: 15, spread },
      picture
    );
    const faces = paperFacesOf(step)!;
    const xray = readXRayFaces(faces, result.scene)!;
    for (const [face, item] of xray.items.entries()) expect(item?.rings).toEqual([faces.drawn[face]]);
  });
  for (const projection of ['diagram', 'orthographic', 'perspective'] as const)
    for (const amount of [0, 0.18]) {
      it(`keeps its frame, clipped vectors and full paper anchors on reopen: ${projection}, ${amount}`, () => {
        const { spread, result, picture } = captured(projection, amount);
        expect(JSON.parse(picture.sceneJson).bounds).toEqual(result.scene.bounds);
        const step = cpStep(
          'camera',
          { mode: 'folded-flat', side: 'front', foldCase: 1, rotationDeg: 15, spread },
          picture
        );
        const diagram = { ...createDiagram(), steps: [step] };
        const read = readDiagram(JSON.parse(JSON.stringify(writeDiagram(diagram))))!;
        const reopened = stepsIn(read.document)[0]!;
        expect(reopened.unknown).toBeUndefined();
        expect(reopened.source).toEqual(step.source);
        expect(reopened.picture).toEqual(picture);
        const faces = paperFacesOf(reopened)!;
        expect(faces.projection).toBeDefined();
        // Both faces remain anchorable, including the one buried by clipping.
        for (const face of [0, 1]) {
          const ring = faces.unspread[face]!;
          const center: [number, number] = [
            ring.reduce((sum, p) => sum + p[0], 0) / ring.length,
            ring.reduce((sum, p) => sum + p[1], 0) / ring.length,
          ];
          const at = faceSpreadMove(faces, face, center);
          const back = unspreadOn(faces, face, at);
          expect(back[0]).toBeCloseTo(center[0], 3);
          expect(back[1]).toBeCloseTo(center[1], 3);
        }
      });
    }
  it('remembers an independently orbited camera across Diagram / 3D switches', () => {
    const first = withSpreadField(DEFAULT_CAMERA_SPREAD, { verb: 'spread-view', projection: 'perspective' });
    if (first.kind !== 'camera') throw new Error('camera');
    const composed = { ...first, camera: { ...first.camera, yaw: 0.8, pan: [0.2, -0.1] as const } };
    const diagram = withSpreadField(composed, { verb: 'spread-view', projection: 'diagram' });
    const again = withSpreadField(diagram, { verb: 'spread-view', projection: 'orthographic' });
    expect(again).toMatchObject({ camera: composed.camera });
  });
  it('preserves unknown camera fields as newer content and rejects malformed rotations', () => {
    const { spread, picture } = captured('perspective');
    const raw = writeDiagram({
      ...createDiagram(),
      steps: [cpStep('camera', { mode: 'folded-flat', side: 'front', foldCase: 1, rotationDeg: 0, spread }, picture)],
    }) as { steps: Array<{ source: { render: { spread: { camera: Record<string, unknown> } } } }> };
    raw.steps[0].source.render.spread.camera.futureLens = 3;
    const newer = readDiagram(raw)!;
    expect(stepsIn(newer.document)[0]!.unknown).toEqual(raw.steps[0]);
    delete raw.steps[0].source.render.spread.camera.futureLens;
    raw.steps[0].source.render.spread.camera.orient = [2, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(stepsIn(readDiagram(raw)!.document)[0]!.source).toBeNull();
  });
});
