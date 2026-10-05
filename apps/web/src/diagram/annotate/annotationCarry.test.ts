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
import { storableScene } from '../capture/captureGeometry';
import { storedSceneJson } from '../document/diagramFile';
import { cpSource, cpStep, referencesStep, scenePicture, stepsIn } from '../document/diagramSteps.fixtures';
import { storedScene } from '../pictures/pictureFrame';
import { face, sceneOf } from '../../lib/paper/paperScene.fixtures';
import { poseMove } from './annotationCarry';
import { rightAngleAt, rightAngleDiagonal } from './annotationModel';

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
    const SPREAD = { kind: 'depth' as const, amount: 0.05, toward: 'up-left' as const };

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

    it('keeps a right angle in its corner of the face it is drawn in, and a circle on that corner, wherever the spread steps the faces round them (review)', () => {
      // A flap over a sheet; the spread steps the sheet up and to the left, the flap stays put in the scene.
      const square = (lo: number, hi: number): ScenePoint[] => [
        [lo, lo],
        [hi, lo],
        [hi, hi],
        [lo, hi],
      ];
      const sheet = (step: number) => face([square(0, 100).map(([x, y]): ScenePoint => [x - step, y - step])], { face: 0 });
      const flap = face([square(20, 60)], { face: 1 });
      const before = { ...scenePicture(), sceneJson: storedSceneJson(sceneOf([sheet(0), flap]))!, key: 'scene-flat' };
      const after = { ...before, sceneJson: storedSceneJson(sceneOf([sheet(30), flap]))!, key: 'scene-spread' };
      // A mark in each of the flap's corners, opening into it; a circle on its far corner.
      const corners: [number, number][] = [
        [0.2, 0.2],
        [0.6, 0.2],
        [0.2, 0.6],
        [0.6, 0.6],
      ];
      const marks = corners.map(([x, y], index): KnownDiagramAnnotation => ({
        id: `r-${index}`,
        kind: 'right-angle',
        ...rightAngleAt([x, y], [0.4 - x, 0.4 - y]),
      }));
      const circle: KnownDiagramAnnotation = { id: 'c', kind: 'circle', from: [0.6, 0.6], to: [0.6, 0.6] };
      const document = annotated(cpStep('step-1', FLAT, before), [...marks, circle]);
      const moved = setLinkedPicture(document, 'step-1', {
        source: cpSource({ ...FLAT, spread: SPREAD }),
        picture: after,
      }).steps[0] as DiagramStep;
      // The sheet's bounds moved 30 of 100 up and left: the flap's corners are 0.3 further along.
      corners.forEach(([x, y], index) => {
        const carried = moved.annotations[index] as KnownDiagramAnnotation;
        close(carried.from, [x + 0.3, y + 0.3]);
        close(rightAngleDiagonal(carried), rightAngleDiagonal(marks[index]!));
      });
      close((moved.annotations[4] as KnownDiagramAnnotation).from, [0.9, 0.9]);

      // A flap thinner than the way a mark's `to` is written along: `to` lies on the sheet under it, the
      // mark on the flap. Carried with the flap, its opening kept.
      const sliver = face([[[20, 20], [60, 20], [60, 21], [20, 21]]], { face: 1 });
      const thin = { ...before, sceneJson: storedSceneJson(sceneOf([sheet(0), sliver]))!, key: 'scene-thin' };
      const thinAfter = { ...before, sceneJson: storedSceneJson(sceneOf([sheet(30), sliver]))!, key: 'scene-thin-spread' };
      const mark: KnownDiagramAnnotation = { id: 'r', kind: 'right-angle', ...rightAngleAt([0.2, 0.2], [1, 1]) };
      const carried = (
        setLinkedPicture(annotated(cpStep('step-1', FLAT, thin), [mark]), 'step-1', {
          source: cpSource({ ...FLAT, spread: SPREAD }),
          picture: thinAfter,
        }).steps[0] as DiagramStep
      ).annotations[0] as KnownDiagramAnnotation;
      close(carried.from, [0.5, 0.5]);
      close(rightAngleDiagonal(carried), rightAngleDiagonal(mark));
    });

    it('carries a mark with its face through a turn while a depth spread stays on, the spread staying on the screen (review)', () => {
      // A flap over a sheet, the sheet stepped 30 up and to the left on the screen, before the turn and after it.
      const square = (lo: number, hi: number): ScenePoint[] => [
        [lo, lo],
        [hi, lo],
        [hi, hi],
        [lo, hi],
      ];
      const turn = turnClockwise(90);
      const turnedRing = (ring: ScenePoint[]) => ring.map(([x, y]): ScenePoint => [turn({ x, y }).x, turn({ x, y }).y]);
      const spreadOn = (sheet: ScenePoint[], flap: ScenePoint[]) =>
        sceneOf([face([sheet.map(([x, y]): ScenePoint => [x - 30, y - 30])], { face: 0 }), face([flap], { face: 1 })]);
      const [sheet, flap] = [square(0, 100), square(20, 60)];
      const sceneBefore = spreadOn(sheet, flap);
      const sceneAfter = spreadOn(turnedRing(sheet), turnedRing(flap));
      const before = { ...scenePicture(), sceneJson: storedSceneJson(sceneBefore)!, key: 'scene-0' };
      const after = { ...before, sceneJson: storedSceneJson(sceneAfter)!, key: 'scene-90' };
      const picturePoint = ({ bounds }: PaperScene, [x, y]: ScenePoint): [number, number] => {
        const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
        return [(x - bounds.minX) / span, (y - bounds.minY) / span];
      };
      // A circle on the sheet's corner past the flap, and one on the flap's.
      const marks: KnownDiagramAnnotation[] = [
        { id: 'sheet', kind: 'circle', from: picturePoint(sceneBefore, [70, -30]), to: picturePoint(sceneBefore, [70, -30]) },
        { id: 'flap', kind: 'circle', from: picturePoint(sceneBefore, [60, 60]), to: picturePoint(sceneBefore, [60, 60]) },
      ];
      const spread = { ...FLAT, spread: SPREAD };
      const moved = setLinkedPicture(annotated(cpStep('step-1', spread, before), marks), 'step-1', {
        source: cpSource({ ...spread, rotationDeg: 90 }),
        picture: after,
      }).steps[0] as DiagramStep;
      // Each on the same corner of its face in the turned picture: the sheet's turned, then stepped as before.
      const [sheetCorner] = turnedRing([[100, 0]]);
      const [flapCorner] = turnedRing([[60, 60]]);
      close((moved.annotations[0] as KnownDiagramAnnotation).from, picturePoint(sceneAfter, [sheetCorner![0] - 30, sheetCorner![1] - 30]));
      close((moved.annotations[1] as KnownDiagramAnnotation).from, picturePoint(sceneAfter, flapCorner!));
      expect(moved.annotatedPictureKey).toBe('scene-90');
    });

    it('carries marks on corners through a turn by less than a quarter, then a spread, as through both at once, though the turn rounds the corners to the stored grid (review)', () => {
      const square = (lo: number, hi: number): ScenePoint[] => [
        [lo, lo],
        [hi, lo],
        [hi, hi],
        [lo, hi],
      ];
      const [sheet, flap] = [square(0, 100), square(20, 60)];
      /** The flap over the sheet turned by `degrees`, the sheet stepped by `step` on the screen, stored as a capture stores it. */
      const posed = (degrees: number, step: number) => {
        const turn = turnClockwise(degrees);
        const point = ([x, y]: ScenePoint): ScenePoint => [turn({ x, y }).x, turn({ x, y }).y];
        const stepped = ([x, y]: ScenePoint): ScenePoint => [x - step, y - step];
        const scene = storableScene(sceneOf([face([sheet.map(point).map(stepped)], { face: 0 }), face([flap.map(point)], { face: 1 })]));
        return { scene, sheetCorner: (corner: ScenePoint) => stepped(point(corner)), flapCorner: point };
      };
      const picture = (scene: PaperScene, key: string) => ({ ...scenePicture(), sceneJson: storedSceneJson(scene)!, key });
      const picturePoint = ({ bounds }: PaperScene, [x, y]: ScenePoint): [number, number] => {
        const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
        return [(x - bounds.minX) / span, (y - bounds.minY) / span];
      };
      const [flat, turned15, spread15] = [posed(0, 0), posed(15, 0), posed(15, 30)];
      // A circle on each of the flap's corners and the sheet's, and a right angle in each of the flap's, opening into it.
      const opening = ([x, y]: ScenePoint): [number, number] => [40 - x, 40 - y];
      const marks: KnownDiagramAnnotation[] = [
        ...flap.map((corner, index): KnownDiagramAnnotation => {
          const at = picturePoint(flat.scene, corner);
          return { id: `flap-${index}`, kind: 'circle', from: at, to: at };
        }),
        ...sheet.map((corner, index): KnownDiagramAnnotation => {
          const at = picturePoint(flat.scene, corner);
          return { id: `sheet-${index}`, kind: 'circle', from: at, to: at };
        }),
        ...flap.map((corner, index): KnownDiagramAnnotation => ({
          id: `angle-${index}`,
          kind: 'right-angle',
          ...rightAngleAt(picturePoint(flat.scene, corner), opening(corner)),
        })),
      ];
      const document = annotated(cpStep('step-1', FLAT, picture(flat.scene, 'flat')), marks);
      const spreadOn = { source: cpSource({ ...FLAT, rotationDeg: 15, spread: SPREAD }), picture: picture(spread15.scene, 'both') };
      const once = setLinkedPicture(document, 'step-1', spreadOn).steps[0] as DiagramStep;
      const turnedFirst = setLinkedPicture(document, 'step-1', {
        source: cpSource({ ...FLAT, rotationDeg: 15 }),
        picture: picture(turned15.scene, 'turned'),
      });
      const twice = setLinkedPicture(turnedFirst, 'step-1', spreadOn).steps[0] as DiagramStep;
      // Within the stored grid's rounding of the corners: a quarter of a thousandth of the picture.
      const near = (point: readonly number[], expected: readonly number[], what: string) =>
        point.forEach((value, index) => expect(Math.abs(value - expected[index]!), what).toBeLessThan(2.5e-4));
      const turn = turnClockwise(15);
      for (const [path, step] of [['once', once], ['twice', twice]] as const) {
        const carried = (id: string) => step.annotations.find((it) => it.id === id) as KnownDiagramAnnotation;
        flap.forEach((corner, index) => {
          near(carried(`flap-${index}`).from, picturePoint(spread15.scene, spread15.flapCorner(corner)), `${path} flap ${index}`);
          near(carried(`angle-${index}`).from, picturePoint(spread15.scene, spread15.flapCorner(corner)), `${path} angle ${index}`);
          const way = turn({ x: opening(corner)[0], y: opening(corner)[1] });
          const length = Math.hypot(way.x, way.y);
          near(rightAngleDiagonal(carried(`angle-${index}`)), [way.x / length, way.y / length], `${path} angle ${index} opening`);
        });
        sheet.forEach((corner, index) => {
          near(carried(`sheet-${index}`).from, picturePoint(spread15.scene, spread15.sheetCorner(corner)), `${path} sheet ${index}`);
        });
      }
    });

    it('keeps a mark on the corner it was put on when a face has since come over it, as a turn under a depth spread brings one', () => {
      // A deeper face, and one drawn over it that has come over its far corner (40, 40).
      const square = (lo: number, hi: number): ScenePoint[] => [
        [lo, lo],
        [hi, lo],
        [hi, hi],
        [lo, hi],
      ];
      const scene = (step: number) =>
        sceneOf([face([square(0, 40).map(([x, y]): ScenePoint => [x - step, y - step])], { face: 0 }), face([square(30, 70)], { face: 1 })]);
      const before = { ...scenePicture(), sceneJson: storedSceneJson(scene(0))!, key: 'scene-0' };
      const after = { ...before, sceneJson: storedSceneJson(scene(10))!, key: 'scene-10' };
      const picturePoint = ({ bounds }: PaperScene, [x, y]: ScenePoint): [number, number] => {
        const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
        return [(x - bounds.minX) / span, (y - bounds.minY) / span];
      };
      const corner = picturePoint(scene(0), [40, 40]);
      // And one drawn on the face over it, a hair off that corner: it goes with that face.
      const inside = picturePoint(scene(0), [40.5, 40.5]);
      const marks: KnownDiagramAnnotation[] = [
        { id: 'corner', kind: 'circle', from: corner, to: corner },
        { id: 'inside', kind: 'circle', from: inside, to: inside },
      ];
      const moved = setLinkedPicture(annotated(cpStep('step-1', { ...FLAT, spread: SPREAD }, before), marks), 'step-1', {
        source: cpSource({ ...FLAT, spread: { ...SPREAD, amount: 0.1 } }),
        picture: after,
      }).steps[0] as DiagramStep;
      close((moved.annotations[0] as KnownDiagramAnnotation).from, picturePoint(scene(10), [30, 30]));
      close((moved.annotations[1] as KnownDiagramAnnotation).from, picturePoint(scene(10), [40.5, 40.5]));

      // Where the face over it has an edge through that corner, the corner is still what it was put on.
      const edged = (step: number) =>
        sceneOf([
          face([square(0, 40).map(([x, y]): ScenePoint => [x - step, y - step])], { face: 0 }),
          face([[[40, 20], [80, 20], [80, 60], [40, 60]]], { face: 1 }),
        ]);
      const edgedBefore = { ...before, sceneJson: storedSceneJson(edged(0))!, key: 'edged-0' };
      const edgedAfter = { ...before, sceneJson: storedSceneJson(edged(10))!, key: 'edged-10' };
      const onEdge = picturePoint(edged(0), [40, 40]);
      const carried = setLinkedPicture(
        annotated(cpStep('step-1', { ...FLAT, spread: SPREAD }, edgedBefore), [{ id: 'corner', kind: 'circle', from: onEdge, to: onEdge }]),
        'step-1',
        { source: cpSource({ ...FLAT, spread: { ...SPREAD, amount: 0.1 } }), picture: edgedAfter }
      ).steps[0] as DiagramStep;
      close((carried.annotations[0] as KnownDiagramAnnotation).from, picturePoint(edged(10), [30, 30]));
    });

    it('keeps a right angle in its face’s corner when a face without a corner there has since come over the angle (review)', () => {
      // A deeper face, and one drawn over it that has come over its far corner (40, 40) and the angle there.
      const square = (lo: number, hi: number): ScenePoint[] => [
        [lo, lo],
        [hi, lo],
        [hi, hi],
        [lo, hi],
      ];
      const scene = (step: number) =>
        sceneOf([face([square(0, 40).map(([x, y]): ScenePoint => [x - step, y - step])], { face: 0 }), face([square(30, 70)], { face: 1 })]);
      const before = { ...scenePicture(), sceneJson: storedSceneJson(scene(0))!, key: 'scene-0' };
      const after = { ...before, sceneJson: storedSceneJson(scene(10))!, key: 'scene-10' };
      const picturePoint = ({ bounds }: PaperScene, [x, y]: ScenePoint): [number, number] => {
        const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
        return [(x - bounds.minX) / span, (y - bounds.minY) / span];
      };
      // In the deeper face's corner, opening into it; and in the face over it, whose corner it is not.
      const marks: KnownDiagramAnnotation[] = [
        { id: 'deeper', kind: 'right-angle', ...rightAngleAt(picturePoint(scene(0), [40, 40]), [-1, -1]) },
        { id: 'over', kind: 'right-angle', ...rightAngleAt(picturePoint(scene(0), [40, 40]), [1, 1]) },
      ];
      const moved = setLinkedPicture(annotated(cpStep('step-1', { ...FLAT, spread: SPREAD }, before), marks), 'step-1', {
        source: cpSource({ ...FLAT, spread: { ...SPREAD, amount: 0.1 } }),
        picture: after,
      }).steps[0] as DiagramStep;
      const [deeper, over] = moved.annotations as KnownDiagramAnnotation[];
      close(deeper!.from, picturePoint(scene(10), [30, 30]));
      close(rightAngleDiagonal(deeper!), [-Math.SQRT1_2, -Math.SQRT1_2]);
      // Not a corner of the face it opens into: carried by a point inside its angle, with that face.
      close(over!.from, picturePoint(scene(10), [40, 40]));
      close(rightAngleDiagonal(over!), [Math.SQRT1_2, Math.SQRT1_2]);
    });

    it('keeps a mark inside a face with that face, though a deeper face has an edge through it (review)', () => {
      // A flap over a sheet whose fold runs under the flap's diagonal: the spread steps the sheet, the flap stays.
      const square = (lo: number, hi: number): ScenePoint[] => [
        [lo, lo],
        [hi, lo],
        [hi, hi],
        [lo, hi],
      ];
      const scene = (step: number) =>
        sceneOf([
          face([[[0, 0], [100, 0], [100, 100]].map(([x, y]): ScenePoint => [x! - step, y! - step])], { face: 0 }),
          face([square(20, 60)], { face: 1 }),
        ]);
      const before = { ...scenePicture(), sceneJson: storedSceneJson(scene(0))!, key: 'scene-0' };
      const after = { ...before, sceneJson: storedSceneJson(scene(30))!, key: 'scene-30' };
      const picturePoint = ({ bounds }: PaperScene, [x, y]: ScenePoint): [number, number] => {
        const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
        return [(x - bounds.minX) / span, (y - bounds.minY) / span];
      };
      // A right angle in the flap's corner, opening along the fold under it, and a circle on the fold inside the flap.
      const marks: KnownDiagramAnnotation[] = [
        { id: 'angle', kind: 'right-angle', ...rightAngleAt(picturePoint(scene(0), [20, 20]), [1, 1]) },
        { id: 'circle', kind: 'circle', from: picturePoint(scene(0), [40, 40]), to: picturePoint(scene(0), [40, 40]) },
      ];
      const moved = setLinkedPicture(annotated(cpStep('step-1', FLAT, before), marks), 'step-1', {
        source: cpSource({ ...FLAT, spread: SPREAD }),
        picture: after,
      }).steps[0] as DiagramStep;
      const [angle, circle] = moved.annotations as KnownDiagramAnnotation[];
      close(angle!.from, picturePoint(scene(30), [20, 20]));
      close(rightAngleDiagonal(angle!), [Math.SQRT1_2, Math.SQRT1_2]);
      close(circle!.from, picturePoint(scene(30), [40, 40]));
    });

    it('moves a callout with the face under its point, its box keeping its place beside it', () => {
      const before = scenePicture();
      const sceneBefore = storedScene(before)!;
      // As above: the face's far corner steps, so a box farther along it would be carried farther.
      const top = sceneBefore.items.find((item) => item.kind === 'face')!;
      if (top.kind !== 'face') throw new Error('a face');
      const ring = top.rings[0]!.map(([x, y], corner): ScenePoint => (corner === 2 ? [x - 20, y - 20] : [x, y]));
      const sceneAfter: PaperScene = {
        ...sceneBefore,
        items: sceneBefore.items.map((item) => (item === top ? { ...top, rings: [ring] } : item)),
      };
      const after = { ...before, sceneJson: storedSceneJson(sceneAfter)!, key: 'scene-callout' };
      const callout: KnownDiagramAnnotation = { id: 'c-1', kind: 'callout', from: [0.5, 0.5], to: [0.9, 0.6], text: 'Repeat behind' };
      const document = annotated(cpStep('step-1', FLAT), [callout]);
      const moved = setLinkedPicture(document, 'step-1', {
        source: cpSource({ ...FLAT, spread: SPREAD }),
        picture: after,
      }).steps[0] as DiagramStep;
      const carried = moved.annotations[0] as KnownDiagramAnnotation;
      const span = Math.max(sceneBefore.bounds.maxX - sceneBefore.bounds.minX, sceneBefore.bounds.maxY - sceneBefore.bounds.minY);
      // Its point as any mark's on that face: a quarter of the corner's step.
      close(carried.from, [0.5 - 5 / span, 0.5 - 5 / span]);
      // Its box where it was beside the point, not stretched with the face under it.
      close([carried.to[0] - carried.from[0], carried.to[1] - carried.from[1]], [0.4, 0.1]);
      expect(carried.text).toBe('Repeat behind');
    });

    it('moves a mark with the face under it when an affine spread changes, which moves a face by an affine map (13g)', () => {
      const before = scenePicture();
      const sceneBefore = storedScene(before)!;
      const top = sceneBefore.items.find((item) => item.kind === 'face')!;
      if (top.kind !== 'face') throw new Error('a face');
      const [, y0] = top.rings[0]![0]!;
      // An affine opening takes each face by an affine map of its own: here a shear along x.
      const shear = ([x, y]: ScenePoint): ScenePoint => [x + 0.2 * (y - y0), y];
      const sceneAfter: PaperScene = {
        ...sceneBefore,
        items: sceneBefore.items.map((item) => (item === top ? { ...top, rings: [top.rings[0]!.map(shear)] } : item)),
      };
      const after = { ...before, sceneJson: storedSceneJson(sceneAfter)!, key: 'scene-affine' };
      const AFFINE = { kind: 'affine' as const, amount: 0.03, keep: 'top' as const, skew: 1, axisDeg: 81 };
      // Only its skew changed: the same amount, the same kind.
      const document = annotated(cpStep('step-1', { ...FLAT, spread: { ...AFFINE, skew: 0.5 } }), [{ ...ARROW, from: [0.5, 0.5], to: [0.6, 0.4] }]);
      const moved = setLinkedPicture(document, 'step-1', {
        source: cpSource({ ...FLAT, spread: AFFINE }),
        picture: after,
      }).steps[0] as DiagramStep;
      const { bounds } = sceneBefore;
      const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
      const carried = (u: number, v: number) => {
        const [x, y] = shear([bounds.minX + u * span, bounds.minY + v * span]);
        return [(x - bounds.minX) / span, (y - bounds.minY) / span];
      };
      const arrow = moved.annotations[0] as KnownDiagramAnnotation;
      close(arrow.from, carried(0.5, 0.5));
      close(arrow.to, carried(0.6, 0.4));
      expect(arrow.from[0]).not.toBeCloseTo(0.5, 3);
      expect(moved.annotatedPictureKey).toBe('scene-affine');
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
