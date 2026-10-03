import { describe, expect, it } from 'vitest';
import { turnClockwise } from '../../lib/geometry';
import type { PaperItem, PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import {
  annotationsOutOfStep,
  createDiagram,
  insertSteps,
  setLinkedPicture,
  setReferencesSide,
  setStepPicture,
  setUploadPose,
  type DiagramAnnotation,
  type DiagramDocument,
  type DiagramStep,
  type KnownDiagramAnnotation,
  type QuarterTurns,
} from '../document/diagramDocument';
import { storedSceneJson } from '../document/diagramFile';
import { cpSource, cpStep, referencesStep, scenePicture } from '../document/diagramSteps.fixtures';
import { storedScene } from '../pictures/pictureFrame';
import { poseMove } from './annotationCarry';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"/>';
const ASSET = { id: 'asset-1', kind: 'svg' as const, svg: SVG, widthPx: 400, heightPx: 300, bytes: SVG.length };

const POSES = [0, 1, 2, 3].flatMap((turns) =>
  [false, true].map((mirrored) => ({ rotationQuarterTurns: turns as QuarterTurns, mirrored }))
);

const ARROW: KnownDiagramAnnotation = { id: 'a-1', kind: 'valley-arrow', from: [0.1, 0.2], to: [0.5, 0.2], bend: 0.1 };

/** A document of one step, its annotations drawn on the picture it has. */
function annotated(step: DiagramStep, annotations: DiagramAnnotation[] = [ARROW]): DiagramDocument {
  const drawn = { ...step, annotations, annotatedPictureKey: step.picture?.key ?? null };
  return { ...insertSteps(createDiagram({ title: 'Crane' }), [drawn], 0), assets: { [ASSET.id]: ASSET } };
}

function uploadStep(): DiagramStep {
  return {
    ...cpStep('step-1'),
    source: { kind: 'upload', assetId: ASSET.id, rotationQuarterTurns: 0, mirrored: false },
    picture: { kind: 'asset', assetId: ASSET.id, paperScale: null, key: `asset:${ASSET.id}` },
  };
}

const close = (point: readonly number[], expected: readonly number[]) =>
  point.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 9));

describe('an upload re-posed', () => {
  it('moves a point with what the picture shows', () => {
    const upright = POSES[0]!;
    // A quarter turn clockwise: the top-left corner goes to the top right of a 300 × 400 picture.
    const right = poseMove(400, 300, upright, { rotationQuarterTurns: 1, mirrored: false });
    close(right.point([0, 0]), [0.75, 0]);
    close(right.point([1, 0.75]), [0, 1]);
    expect(right).toMatchObject({ mirrors: false, turnDeg: 90 });
    close(poseMove(400, 300, upright, { rotationQuarterTurns: 0, mirrored: true }).point([0.1, 0.2]), [0.9, 0.2]);
  });

  it('comes back to where it was from any pose, through any other', () => {
    for (const a of POSES) {
      for (const b of POSES) {
        const there = poseMove(400, 300, a, b);
        const back = poseMove(400, 300, b, a);
        close(back.point(there.point([0.13, 0.41])), [0.13, 0.41]);
        expect(there.mirrors).toBe(a.mirrored !== b.mirrored);
      }
    }
  });

  it('carries the annotations, and keeps them in step with the picture', () => {
    const document = annotated(uploadStep());
    const turned = setUploadPose(document, 'step-1', { rotationQuarterTurns: 1, mirrored: false }).steps[0]!;
    const arrow = turned.annotations[0] as KnownDiagramAnnotation;
    close(arrow.from, [0.75 - 0.2, 0.1]);
    expect(arrow.bend).toBe(0.1);
    expect(annotationsOutOfStep(turned)).toBe(false);
    const flipped = setUploadPose(document, 'step-1', { rotationQuarterTurns: 0, mirrored: true }).steps[0]!;
    expect((flipped.annotations[0] as KnownDiagramAnnotation).bend).toBe(-0.1);
  });
});

describe('a References step turned over', () => {
  it('flips its annotations about the sheet, and keeps them in step with the other side', () => {
    const document = annotated(referencesStep('step-1'));
    const back = setReferencesSide(document, 'step-1', true).steps[0]!;
    const arrow = back.annotations[0] as KnownDiagramAnnotation;
    close(arrow.from, [0.9, 0.2]);
    expect(arrow.bend).toBe(-0.1);
    expect(back.annotatedPictureKey).toBe(back.picture?.key);
    expect(annotationsOutOfStep(back)).toBe(false);
  });

  it('leaves them out of step if they already were', () => {
    const step = { ...referencesStep('step-1'), annotations: [ARROW], annotatedPictureKey: 'another-picture' };
    const document = { ...insertSteps(createDiagram(), [step], 0) };
    const back = setReferencesSide(document, 'step-1', true).steps[0]!;
    expect(back.annotatedPictureKey).toBe('another-picture');
    expect(annotationsOutOfStep(back)).toBe(true);
  });
});

/** A scene turned clockwise about its origin, as a linked capture turns its pattern. */
function turned(scene: PaperScene, degrees: number): PaperScene {
  const turn = turnClockwise(degrees);
  const point = ([x, y]: ScenePoint): ScenePoint => {
    const p = turn({ x, y });
    return [p.x, p.y];
  };
  const items = scene.items.map((item): PaperItem =>
    item.kind === 'face'
      ? { ...item, rings: item.rings.map((ring) => ring.map(point)) }
      : item.kind === 'line'
        ? { ...item, a: point(item.a), b: point(item.b) }
        : item
  );
  const xs = items.flatMap((item) => (item.kind === 'face' ? item.rings.flat().map(([x]) => x) : []));
  const ys = items.flatMap((item) => (item.kind === 'face' ? item.rings.flat().map(([, y]) => y) : []));
  return {
    ...scene,
    items,
    bounds: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
  };
}

describe('a linked picture turned about its middle', () => {
  it('turns its annotations with it, through the two pictures’ frames', () => {
    const before = scenePicture();
    const sceneBefore = storedScene(before)!;
    const after = { ...before, sceneJson: storedSceneJson(turned(sceneBefore, 90))!, key: 'scene-turned' };
    const document = annotated(cpStep('step-1'));
    const moved = setLinkedPicture(document, 'step-1', {
      source: cpSource({ mode: 'crease-pattern', rotationDeg: 90 }),
      picture: after,
    }).steps[0]!;
    // Where the arrow's tail was on the paper, turned, in the new frame.
    const { bounds: was } = sceneBefore;
    const { bounds: is } = storedScene(after)!;
    const span = (bounds: typeof was) => Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    const scenePoint = turnClockwise(90)({ x: was.minX + 0.1 * span(was), y: was.minY + 0.2 * span(was) });
    close((moved.annotations[0] as KnownDiagramAnnotation).from, [
      (scenePoint.x - is.minX) / span(is),
      (scenePoint.y - is.minY) / span(is),
    ]);
    expect(moved.annotatedPictureKey).toBe('scene-turned');
  });

  it('leaves them where they were for anything else: a refold, a new picture, one it cannot read', () => {
    const document = annotated(cpStep('step-1'));
    const refolded = setLinkedPicture(document, 'step-1', {
      source: { ...cpSource({ mode: 'crease-pattern', rotationDeg: 90 }), fingerprint: 'fp-2' },
      picture: { ...scenePicture(), key: 'scene-refolded' },
    }).steps[0]!;
    expect(refolded.annotations).toEqual([ARROW]);
    expect(annotationsOutOfStep(refolded)).toBe(true);

    const replaced = setStepPicture(document, 'step-1', ASSET).steps[0]!;
    expect(replaced.annotations).toEqual([ARROW]);
    expect(annotationsOutOfStep(replaced)).toBe(true);

    const carried = annotated(uploadStep(), [ARROW, { id: 'n-1', unknown: { id: 'n-1', kind: 'spiral' } }]);
    // A pose is refused outright for a step carrying one (`poseBlocker`).
    expect(setUploadPose(carried, 'step-1', { rotationQuarterTurns: 1, mirrored: false })).toBe(carried);
  });
});
