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
import { cpSource, cpStep, referencesStep, scenePicture, stepsIn } from '../document/diagramSteps.fixtures';
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
    const turned = stepsIn(setUploadPose(document, 'step-1', { rotationQuarterTurns: 1, mirrored: false }))[0]!;
    const arrow = turned.annotations[0] as KnownDiagramAnnotation;
    close(arrow.from, [0.75 - 0.2, 0.1]);
    expect(arrow.bend).toBe(0.1);
    expect(annotationsOutOfStep(turned)).toBe(false);
    const flipped = stepsIn(setUploadPose(document, 'step-1', { rotationQuarterTurns: 0, mirrored: true }))[0]!;
    expect((flipped.annotations[0] as KnownDiagramAnnotation).bend).toBe(-0.1);
  });
});

describe('a References step turned over', () => {
  it('flips its annotations about the sheet, and keeps them in step with the other side', () => {
    const document = annotated(referencesStep('step-1'));
    const back = stepsIn(setReferencesSide(document, 'step-1', true))[0]!;
    const arrow = back.annotations[0] as KnownDiagramAnnotation;
    close(arrow.from, [0.9, 0.2]);
    expect(arrow.bend).toBe(-0.1);
    expect(back.annotatedPictureKey).toBe(back.picture?.key);
    expect(annotationsOutOfStep(back)).toBe(false);
  });

  it('leaves them out of step if they already were', () => {
    const step = { ...referencesStep('step-1'), annotations: [ARROW], annotatedPictureKey: 'another-picture' };
    const document = { ...insertSteps(createDiagram(), [step], 0) };
    const back = stepsIn(setReferencesSide(document, 'step-1', true))[0]!;
    // Drawn on another picture, never placed on this one: not moved, and still out of step.
    expect(back.annotations).toEqual([ARROW]);
    expect(back.annotatedPictureKey).toBe('another-picture');
    expect(annotationsOutOfStep(back)).toBe(true);
    // Turned back, the picture is the one they are out of step with still.
    const again = stepsIn(setReferencesSide({ ...document, steps: [back] }, 'step-1', false))[0]!;
    expect(again.annotations).toEqual([ARROW]);
    expect(annotationsOutOfStep(again)).toBe(true);
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
    }).steps[0] as DiagramStep;
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

  describe('its layers spread (Phase 13)', () => {
    const FLAT = { mode: 'folded-flat' as const, side: 'front' as const, rotationDeg: 0, foldCase: 1 };
    const SPREAD = { amount: 0.05, toward: 'up-left' as const };

    /** The scene with a deeper layer stepped up and to the left: the nearest layer stays where it is. */
    function spreadScene(scene: PaperScene): PaperScene {
      const top = scene.items.find((item) => item.kind === 'face')!;
      if (top.kind !== 'face') throw new Error('a face');
      const deeper = {
        ...top,
        face: top.face + 1,
        rings: top.rings.map((ring) => ring.map(([x, y]): ScenePoint => [x - 30, y - 30])),
      };
      const items = [deeper, ...scene.items];
      const { bounds } = scene;
      return { ...scene, items, bounds: { ...bounds, minX: bounds.minX - 30, minY: bounds.minY - 30 } };
    }

    /** Where a picture point of `before` lands in `after`, carried as a scene point turned by `degrees`. */
    function expectedFrom(before: PaperScene, after: PaperScene, point: [number, number], degrees: number) {
      const span = (bounds: PaperScene['bounds']) => Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
      const { bounds: was } = before;
      const { bounds: is } = after;
      const at = turnClockwise(degrees)({ x: was.minX + point[0] * span(was), y: was.minY + point[1] * span(was) });
      return [(at.x - is.minX) / span(is), (at.y - is.minY) / span(is)];
    }

    it('keeps them on the nearest layer, which stays put in the scene, when only the spread changes', () => {
      const before = scenePicture();
      const sceneBefore = storedScene(before)!;
      const spread = spreadScene(sceneBefore);
      const after = { ...before, sceneJson: storedSceneJson(spread)!, key: 'scene-spread' };
      const document = annotated(cpStep('step-1', FLAT));
      const moved = setLinkedPicture(document, 'step-1', {
        source: cpSource({ ...FLAT, spread: SPREAD }),
        picture: after,
      }).steps[0] as DiagramStep;
      const arrow = moved.annotations[0] as KnownDiagramAnnotation;
      close(arrow.from, expectedFrom(sceneBefore, storedScene(after)!, [0.1, 0.2], 0));
      expect(arrow.from[0]).not.toBeCloseTo(0.1, 3);
      expect(moved.annotatedPictureKey).toBe('scene-spread');
      // Off again: back where they were drawn.
      const back = setLinkedPicture({ ...document, steps: [moved] }, 'step-1', {
        source: cpSource(FLAT),
        picture: before,
      }).steps[0] as DiagramStep;
      close((back.annotations[0] as KnownDiagramAnnotation).from, [0.1, 0.2]);
    });

    it('turns them with a turn that came with a spread', () => {
      const before = scenePicture();
      const sceneBefore = storedScene(before)!;
      const after = { ...before, sceneJson: storedSceneJson(turned(spreadScene(sceneBefore), 90))!, key: 'scene-both' };
      const document = annotated(cpStep('step-1', FLAT));
      const moved = setLinkedPicture(document, 'step-1', {
        source: cpSource({ ...FLAT, rotationDeg: 90, spread: SPREAD }),
        picture: after,
      }).steps[0] as DiagramStep;
      close((moved.annotations[0] as KnownDiagramAnnotation).from, expectedFrom(sceneBefore, storedScene(after)!, [0.1, 0.2], 90));
    });

    it('moves a mark with the face under it, where the spread stepped that face’s corners unequally', () => {
      const before = scenePicture();
      const sceneBefore = storedScene(before)!;
      // The face's corner at the sheet's far corner meets a deeper layer, and steps half its way.
      const top = sceneBefore.items.find((item) => item.kind === 'face')!;
      if (top.kind !== 'face') throw new Error('a face');
      const ring = top.rings[0]!.map(([x, y], corner): ScenePoint => (corner === 2 ? [x - 20, y - 20] : [x, y]));
      const sceneAfter: PaperScene = {
        ...sceneBefore,
        items: sceneBefore.items.map((item) => (item === top ? { ...top, rings: [ring] } : item)),
      };
      const after = { ...before, sceneJson: storedSceneJson(sceneAfter)!, key: 'scene-unequal' };
      const document = annotated(cpStep('step-1', FLAT), [{ ...ARROW, from: [0.5, 0.5], to: [0.9, 0.5] }]);
      const moved = setLinkedPicture(document, 'step-1', {
        source: cpSource({ ...FLAT, spread: SPREAD }),
        picture: after,
      }).steps[0] as DiagramStep;
      const arrow = moved.annotations[0] as KnownDiagramAnnotation;
      // The square's middle weighs its four corners alike: a quarter of the corner's step.
      const span = Math.max(sceneBefore.bounds.maxX - sceneBefore.bounds.minX, sceneBefore.bounds.maxY - sceneBefore.bounds.minY);
      close(arrow.from, [0.5 - 5 / span, 0.5 - 5 / span]);
      // Nearer that corner, more of its step; never more than all of it.
      const shift = 0.9 - arrow.to[0];
      expect(shift).toBeGreaterThan(5 / span);
      expect(shift).toBeLessThan(20 / span);
    });

    it('leaves them where they were when the spread came with another side or layer order', () => {
      const before = scenePicture();
      const after = { ...before, sceneJson: storedSceneJson(spreadScene(storedScene(before)!))!, key: 'scene-other' };
      for (const render of [
        { ...FLAT, side: 'back' as const, spread: SPREAD },
        { ...FLAT, foldCase: 2, spread: SPREAD },
      ]) {
        const document = annotated(cpStep('step-1', FLAT));
        const moved = setLinkedPicture(document, 'step-1', { source: cpSource(render), picture: after }).steps[0] as DiagramStep;
        expect(moved.annotations).toEqual([ARROW]);
        expect(annotationsOutOfStep(moved)).toBe(true);
      }
    });
  });

  it('leaves them where they were on a picture kept as a bitmap, which knows no turn (a deviation from D8)', () => {
    const raster = (key: string) => ({ kind: 'asset' as const, assetId: ASSET.id, paperScale: 100, key });
    const document = annotated({ ...cpStep('step-1'), picture: raster('raster-0') });
    const turnedRaster = setLinkedPicture(document, 'step-1', {
      source: cpSource({ mode: 'crease-pattern', rotationDeg: 15 }),
      picture: raster('raster-15'),
    }).steps[0] as DiagramStep;
    expect(turnedRaster.annotations).toEqual([ARROW]);
    expect(annotationsOutOfStep(turnedRaster)).toBe(true);
  });

  it('leaves them where they were for anything else: a refold, a new picture, one it cannot read', () => {
    const document = annotated(cpStep('step-1'));
    const refolded = setLinkedPicture(document, 'step-1', {
      source: { ...cpSource({ mode: 'crease-pattern', rotationDeg: 90 }), fingerprint: 'fp-2' },
      picture: { ...scenePicture(), key: 'scene-refolded' },
    }).steps[0] as DiagramStep;
    expect(refolded.annotations).toEqual([ARROW]);
    expect(annotationsOutOfStep(refolded)).toBe(true);

    const replaced = stepsIn(setStepPicture(document, 'step-1', ASSET))[0]!;
    expect(replaced.annotations).toEqual([ARROW]);
    expect(annotationsOutOfStep(replaced)).toBe(true);

    const carried = annotated(uploadStep(), [ARROW, { id: 'n-1', unknown: { id: 'n-1', kind: 'spiral' } }]);
    // A pose is refused outright for a step carrying one (`poseBlocker`).
    expect(setUploadPose(carried, 'step-1', { rotationQuarterTurns: 1, mirrored: false })).toBe(carried);
  });
});
