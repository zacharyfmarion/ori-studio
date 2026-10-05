import { describe, expect, it } from 'vitest';
import type { StepDiagramModel } from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import type { ScenePoint } from '../../lib/paper/paperScene';
import { face, line, SQUARE } from '../../lib/paper/paperScene.fixtures';
import { referencesStep, stepDiagramPicture } from '../document/diagramSteps.fixtures';
import { pictureGeometry } from './pictureGeometry';
import { pictureSnapTarget } from './pictureSnap';
import { annotation, FLAT, IN_3D, NO_ASSETS, sceneStep, uploadStep } from './pictureSnap.fixtures';

const crease = (a: ScenePoint, b: ScenePoint) => line('diagram-valley', a, b);

/** The unit square with one diagonal, from its top-left corner. */
const DIAGONAL = [face([SQUARE]), crease([0, 0], [100, 100])];
/** The square with both diagonals, each whole: they cross at the middle, unsplit. */
const CROSSED = [...DIAGONAL, crease([100, 0], [0, 100])];

describe('pictureSnapTarget on a crease pattern', () => {
  const step = sceneStep(DIAGONAL);

  it('snaps to the paper’s corner, where the diagonal also ends', () => {
    expect(pictureSnapTarget(step, NO_ASSETS, [0.02, 0.01], 0.05)).toEqual({ at: [0, 0], kind: 'corner' });
    expect(pictureSnapTarget(step, NO_ASSETS, [0.97, 1.02], 0.05)).toEqual({ at: [1, 1], kind: 'corner' });
  });

  it('leaves a point with nothing within the radius where it is', () => {
    // On the diagonal, but a line is not a point to land on.
    expect(pictureSnapTarget(step, NO_ASSETS, [0.5, 0.5], 0.05)).toBeNull();
    expect(pictureSnapTarget(step, NO_ASSETS, [0.02, 0.01], 0.01)).toBeNull();
    expect(pictureSnapTarget(step, NO_ASSETS, [0, 0], 0)).toBeNull();
  });

  it('finds where two whole lines cross, though neither is split there', () => {
    expect(pictureSnapTarget(sceneStep(CROSSED), NO_ASSETS, [0.53, 0.49], 0.05)).toEqual({
      at: [0.5, 0.5],
      kind: 'crossing',
    });
  });

  it('calls a point on a side of the paper a vertex, and a line meeting nothing an end', () => {
    const scene = sceneStep([
      // The rim has a point halfway along its top side, where a crease meets it.
      face([[[0, 0], [50, 0], [100, 0], [100, 100], [0, 100]]]),
      crease([50, 0], [50, 40]),
      // A pinch, meeting nothing at either end.
      crease([20, 70], [40, 70]),
    ]);
    expect(pictureSnapTarget(scene, NO_ASSETS, [0.51, 0.01], 0.05)).toEqual({ at: [0.5, 0], kind: 'vertex' });
    expect(pictureSnapTarget(scene, NO_ASSETS, [0.5, 0.41], 0.05)).toEqual({ at: [0.5, 0.4], kind: 'end' });
    expect(pictureSnapTarget(scene, NO_ASSETS, [0.21, 0.7], 0.05)).toEqual({ at: [0.2, 0.7], kind: 'end' });
  });

  it('calls a line’s end on another line, which runs on through it, a vertex', () => {
    const tee = sceneStep([face([SQUARE]), crease([0, 50], [100, 50]), crease([50, 50], [50, 100])]);
    expect(pictureSnapTarget(tee, NO_ASSETS, [0.5, 0.52], 0.05)).toEqual({ at: [0.5, 0.5], kind: 'vertex' });
  });

  it('takes the nearest of every kind', () => {
    // An arrow's tip a little nearer than the corner.
    const arrow = annotation({ kind: 'valley-arrow', from: [0.5, 0.2], to: [0.05, 0.03] });
    expect(pictureSnapTarget(step, NO_ASSETS, [0.06, 0.04], 0.1, { annotations: [arrow] })).toEqual({
      at: [0.05, 0.03],
      kind: 'annotation',
    });
    expect(pictureSnapTarget(step, NO_ASSETS, [0.02, 0.01], 0.1, { annotations: [arrow] })).toEqual({
      at: [0, 0],
      kind: 'corner',
    });
  });
});

describe('pictureSnapTarget on annotations', () => {
  const step = sceneStep(DIAGONAL);

  it('reports the picture’s own point where an annotation was snapped onto it', () => {
    const line = annotation({ kind: 'valley-line', from: [0, 0], to: [0.4, 0.6] });
    expect(pictureSnapTarget(step, NO_ASSETS, [0.01, 0.01], 0.05, { annotations: [line] })).toEqual({
      at: [0, 0],
      kind: 'corner',
    });
  });

  it('snaps to arrow and line ends, never to a sign’s or a letter’s place', () => {
    const marks = [
      annotation({ kind: 'push-arrow', from: [0.3, 0.6], to: [0.3, 0.8] }),
      annotation({ kind: 'label', from: [0.6, 0.3], to: [0.6, 0.3], text: 'A' }),
      annotation({ kind: 'turn-over', from: [0.8, 0.4], to: [0.8, 0.4] }),
    ];
    expect(pictureSnapTarget(step, NO_ASSETS, [0.31, 0.79], 0.05, { annotations: marks })).toMatchObject({
      at: [0.3, 0.8],
      kind: 'annotation',
    });
    expect(pictureSnapTarget(step, NO_ASSETS, [0.6, 0.31], 0.05, { annotations: marks })).toBeNull();
    expect(pictureSnapTarget(step, NO_ASSETS, [0.8, 0.41], 0.05, { annotations: marks })).toBeNull();
  });

  it('snaps to a circle’s centre, which an arrow lands on', () => {
    const circle = annotation({ kind: 'circle', from: [0.45, 0.35], to: [0.45, 0.35] });
    expect(pictureSnapTarget(step, NO_ASSETS, [0.46, 0.34], 0.05, { annotations: [circle] })).toEqual({
      at: [0.45, 0.35],
      kind: 'annotation',
    });
    // Not when it is the one being moved.
    expect(pictureSnapTarget(step, NO_ASSETS, [0.46, 0.34], 0.05, { annotations: [circle], ignore: circle.id })).toBeNull();
  });

  it('snaps to the corner a right angle marks, not to the way it opens', () => {
    const square = annotation({ kind: 'right-angle', from: [0.45, 0.35], to: [0.47, 0.35] });
    expect(pictureSnapTarget(step, NO_ASSETS, [0.46, 0.34], 0.05, { annotations: [square] })).toEqual({
      at: [0.45, 0.35],
      kind: 'annotation',
    });
    expect(pictureSnapTarget(step, NO_ASSETS, [0.47, 0.35], 0.01, { annotations: [square] })).toBeNull();
  });

  it('never snaps to the annotation being drawn or dragged', () => {
    const line = annotation({ kind: 'mountain-line', from: [0.3, 0.6], to: [0.7, 0.6] });
    expect(pictureSnapTarget(step, NO_ASSETS, [0.7, 0.61], 0.05, { annotations: [line], ignore: line.id })).toBeNull();
  });

  it('reads the step’s own annotations when none are given', () => {
    const line = annotation({ kind: 'hidden-line', from: [0.3, 0.6], to: [0.7, 0.6] });
    expect(pictureSnapTarget({ ...step, annotations: [line] }, NO_ASSETS, [0.71, 0.6], 0.05)).toMatchObject({
      kind: 'annotation',
    });
  });

  it('finds where a drawn line crosses the picture’s lines, and another drawn line', () => {
    const across = annotation({ kind: 'valley-line', from: [0, 0.6], to: [1, 0.6] });
    expect(pictureSnapTarget(step, NO_ASSETS, [0.62, 0.61], 0.05, { annotations: [across] })).toEqual({
      at: [0.6, 0.6],
      kind: 'crossing',
    });
  });
});

describe('pictureSnapTarget along a line drawn on a crease', () => {
  /** A stored scene's coordinate: to 0.01 px, as `storableScene` keeps it. */
  const stored = (value: number) => Math.round(value * 100) / 100;

  it('finds no crossing where a drawn line runs along a split crease, whatever its angle', () => {
    for (const degrees of [15, 22.5, 37]) {
      // From the square's bottom-left corner up across it, split where other creases meet it.
      const rise = 100 * Math.tan((degrees * Math.PI) / 180);
      const along = (x: number): ScenePoint => [stored(x), stored(100 - (rise * x) / 100)];
      const splits = [0, 15.25, 42.5, 75, 100];
      const pieces = splits.slice(1).map((x, i) => crease(along(splits[i]!), along(x)));
      const step = sceneStep([face([SQUARE]), ...pieces]);
      const drawn = annotation({ kind: 'valley-line', from: [0, 1], to: [1, 1 - rise / 100] });
      for (let x = 0.2; x < 0.95; x += 0.01) {
        // Clear of every split, a little off the line.
        if (splits.some((split) => Math.abs(split / 100 - x) < 0.04)) continue;
        const pointer: [number, number] = [x, 1 - (rise * x) / 100 + 0.003];
        const target = pictureSnapTarget(step, NO_ASSETS, pointer, 0.02, { annotations: [drawn] });
        expect(target?.kind, `${degrees}° at ${x.toFixed(2)}`).not.toBe('crossing');
      }
    }
  });
});

describe('pictureSnapTarget by kind of picture', () => {
  it('reads a flat fold’s rings as vertices, and finds no crossings among its own lines (v1)', () => {
    const flat = sceneStep(CROSSED, FLAT);
    expect(pictureSnapTarget(flat, NO_ASSETS, [0.98, 0.01], 0.05)).toEqual({ at: [1, 0], kind: 'vertex' });
    expect(pictureSnapTarget(flat, NO_ASSETS, [0.51, 0.5], 0.05)).toBeNull();
  });

  it('takes a cut crease’s whole ends on a flat fold, not where it was cut', () => {
    const cut = line('aux', [20, 50], [60, 50], {
      whole: { a: [0, 50], b: [100, 50], onBoundary: [true, true] },
    });
    const flat = sceneStep([face([SQUARE], { outline: 'edge' }), cut], FLAT);
    expect(pictureSnapTarget(flat, NO_ASSETS, [0.6, 0.51], 0.05)).toBeNull();
    expect(pictureSnapTarget(flat, NO_ASSETS, [0.01, 0.51], 0.05)).toEqual({ at: [0, 0.5], kind: 'vertex' });
  });

  it('counts a crease cut in pieces once: its free end an end, its line one segment', () => {
    // Two pieces of one aux crease, each carrying the whole of it, which meets nothing at either end.
    const whole = { a: [10, 50] as ScenePoint, b: [90, 50] as ScenePoint, onBoundary: [false, false] as [boolean, boolean] };
    const pieces = [line('aux', [20, 50], [40, 50], { whole }), line('aux', [60, 50], [80, 50], { whole })];
    const flat = sceneStep([face([SQUARE], { outline: 'edge' }), ...pieces], FLAT);
    expect(pictureSnapTarget(flat, NO_ASSETS, [0.11, 0.51], 0.05)).toEqual({ at: [0.1, 0.5], kind: 'end' });
    const along = pictureGeometry(flat, NO_ASSETS).segments.filter(({ a, b }) => a.y === 0.5 && b.y === 0.5);
    expect(along).toHaveLength(1);
  });

  it('snaps a 3D picture to its lines’ ends, the projected vertices, and not to its faces’ corners', () => {
    // A face whose ring a painter's cut left with a corner at (50, 50).
    const step = sceneStep(
      [face([[[0, 0], [100, 0], [50, 50]]]), line('edge', [0, 0], [100, 0]), line('valley', [0, 100], [100, 100])],
      IN_3D
    );
    expect(pictureSnapTarget(step, NO_ASSETS, [0.99, 0.01], 0.05)).toEqual({ at: [1, 0], kind: 'end' });
    expect(pictureSnapTarget(step, NO_ASSETS, [0.5, 0.49], 0.05)).toBeNull();
  });

  it('snaps an upload only to its annotations, and to where their lines cross', () => {
    const { step: upload, assets } = uploadStep();
    expect(pictureGeometry(upload, assets).kind).toBe('none');
    expect(pictureSnapTarget(upload, assets, [0.5, 0.5], 0.2)).toBeNull();
    const lines = [
      annotation({ kind: 'valley-line', from: [0.2, 0.2], to: [0.8, 0.8] }),
      { ...annotation({ kind: 'mountain-line', from: [0.8, 0.2], to: [0.2, 0.8] }), id: 'annotation-2' },
    ];
    expect(pictureSnapTarget(upload, assets, [0.21, 0.19], 0.05, { annotations: lines })).toEqual({
      at: [0.2, 0.2],
      kind: 'annotation',
    });
    expect(pictureSnapTarget(upload, assets, [0.52, 0.5], 0.05, { annotations: lines })).toEqual({
      at: [0.5, 0.5],
      kind: 'crossing',
    });
  });
});

describe('pictureSnapTarget on a References step', () => {
  /** A crease across the sheet, a valley up it at a fifth, a mark where they cross. */
  const MODEL: StepDiagramModel = {
    sheet: { width: 1, height: 1 },
    primitives: [
      { kind: 'sheet', width: 1, height: 1 },
      { kind: 'line', from: [0, 0.5], to: [1, 0.5], style: 'crease' },
      { kind: 'line', from: [0.2, 0], to: [0.2, 1], style: 'valley' },
      { kind: 'point', at: [0.2, 0.25], style: 'highlight' },
      { kind: 'fold-arrow', out: { center: [0.5, 0.5], radius: 0.3, from: 0.4, to: 1.4, ccw: true } },
      { kind: 'label', at: [0.9, 0.9], text: 'A', style: 'normal' },
    ],
  };
  const front = { ...referencesStep('step-front'), picture: stepDiagramPicture(false, MODEL) };
  const back = { ...referencesStep('step-back', { side: 'back' }), picture: stepDiagramPicture(true, MODEL) };

  it('maps its model y up into the picture y down, and mirrors it on the back', () => {
    // The crossing at (0.2, 0.5) in the model.
    expect(pictureSnapTarget(front, NO_ASSETS, [0.21, 0.52], 0.05)).toEqual({ at: [0.2, 0.5], kind: 'crossing' });
    expect(pictureSnapTarget(back, NO_ASSETS, [0.79, 0.52], 0.05)).toEqual({ at: [0.8, 0.5], kind: 'crossing' });
    // The mark at (0.2, 0.25), a quarter up: three quarters down the picture.
    expect(pictureSnapTarget(front, NO_ASSETS, [0.2, 0.74], 0.05)).toEqual({ at: [0.2, 0.75], kind: 'point' });
    expect(pictureSnapTarget(back, NO_ASSETS, [0.8, 0.74], 0.05)).toEqual({ at: [0.8, 0.75], kind: 'point' });
  });

  it('snaps to the sheet’s corners and to where a line meets its edge', () => {
    expect(pictureSnapTarget(back, NO_ASSETS, [0.02, 0.97], 0.05)).toEqual({ at: [0, 1], kind: 'corner' });
    // The valley's foot, at (0.2, 0) in the model: the bottom edge, mirrored.
    expect(pictureSnapTarget(back, NO_ASSETS, [0.81, 0.99], 0.05)).toEqual({ at: [0.8, 1], kind: 'vertex' });
  });

  it('never snaps to an arrow or a letter of its drawing', () => {
    expect(pictureSnapTarget(front, NO_ASSETS, [0.9, 0.1], 0.05)).toBeNull();
  });
});

describe('pictureGeometry', () => {
  it('reads a picture once, for as long as the picture object lives', () => {
    const step = sceneStep(CROSSED);
    const first = pictureGeometry(step, NO_ASSETS);
    expect(pictureGeometry({ ...step, annotations: [] }, NO_ASSETS)).toBe(first);
    // The same picture shown another way is read again rather than misread.
    const flat = pictureGeometry({ ...step, source: sceneStep(CROSSED, FLAT).source }, NO_ASSETS);
    expect(flat).not.toBe(first);
    expect(flat.kind).toBe('flat-fold');
  });

  it('says whether a picture’s angles are the paper’s', () => {
    expect(pictureGeometry(sceneStep(DIAGONAL), NO_ASSETS).trueAngles).toBe(true);
    expect(pictureGeometry(sceneStep(DIAGONAL, FLAT), NO_ASSETS).trueAngles).toBe(true);
    expect(pictureGeometry(sceneStep(DIAGONAL, IN_3D), NO_ASSETS).trueAngles).toBe(false);
  });
});
