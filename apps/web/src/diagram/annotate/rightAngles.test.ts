import { describe, expect, it } from 'vitest';
import type { StepDiagramModel } from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import type { ScenePoint } from '../../lib/paper/paperScene';
import { face, line, SQUARE } from '../../lib/paper/paperScene.fixtures';
import { referencesStep, stepDiagramPicture } from '../document/diagramSteps.fixtures';
import type { PicturePoint } from './annotationModel';
import { annotation, FLAT, IN_3D, NO_ASSETS, sceneStep, uploadStep } from './pictureSnap.fixtures';
import { rightAngleCorner, rightAnglesAt, type RightAngleCorner } from './rightAngles';
import { pictureSnapTarget } from './pictureSnap';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import type { DiagramStyle } from '../document/diagramDocument';

const crease = (a: ScenePoint, b: ScenePoint) => line('diagram-valley', a, b);

/** A corner's directions rounded, so a test can say them as numbers a reader checks by eye. */
function rounded(corner: RightAngleCorner | null) {
  if (!corner) return null;
  // `+ 0`: a rounded -0 is 0, as a reader writes it.
  const third = (value: number) => Math.round(value * 1000) / 1000 + 0;
  const round = ([x, y]: PicturePoint): PicturePoint => [third(x), third(y)];
  return { at: round(corner.at), legs: corner.legs.map(round), diagonal: round(corner.diagonal) };
}

const R = Math.SQRT1_2;
const r = Math.round(R * 1000) / 1000;

describe('rightAngleCorner on a square with a diagonal', () => {
  const step = sceneStep([face([SQUARE]), crease([0, 0], [100, 100])]);

  it('finds the corner the diagonal leaves square, inside the paper', () => {
    // The top-right corner: its sides go left and down, clockwise on the page from down to left.
    expect(rounded(rightAngleCorner(step, NO_ASSETS, [0.95, 0.04], 0.1))).toEqual({
      at: [1, 0],
      legs: [
        [0, 1],
        [-1, 0],
      ],
      diagonal: [-r, r],
    });
  });

  it('never offers the reflex side of a paper corner', () => {
    expect(rightAngleCorner(step, NO_ASSETS, [1.04, -0.03], 0.1)).toBeNull();
    expect(rightAngleCorner(step, NO_ASSETS, [0.96, -0.04], 0.1)).toBeNull();
  });

  it('finds none where the diagonal halves the corner', () => {
    expect(rightAngleCorner(step, NO_ASSETS, [0.06, 0.02], 0.1)).toBeNull();
    expect(rightAngleCorner(step, NO_ASSETS, [0.02, 0.06], 0.1)).toBeNull();
  });

  it('says nothing in the dead zone round the vertex, or out of reach', () => {
    expect(rightAngleCorner(step, NO_ASSETS, [0.99, 0.01], 0.1)).toBeNull();
    expect(rightAngleCorner(step, NO_ASSETS, [0.99, 0.01], 0.1, { deadZone: 0.001 })).not.toBeNull();
    expect(rightAngleCorner(step, NO_ASSETS, [0.85, 0.15], 0.1)).toBeNull();
    expect(rightAngleCorner(step, NO_ASSETS, [0.95, 0.04], 0)).toBeNull();
  });
});

describe('rightAngleCorner at a waterbomb-like vertex', () => {
  // Both diagonals and both midlines, all through the middle.
  const SPOKES: ScenePoint[] = [
    [0, 0],
    [50, 0],
    [100, 0],
    [100, 50],
    [100, 100],
    [50, 100],
    [0, 100],
    [0, 50],
  ];
  const split = sceneStep([face([SQUARE]), ...SPOKES.map((end) => crease([50, 50], end))]);
  const whole = sceneStep([
    face([SQUARE]),
    crease([0, 0], [100, 100]),
    crease([100, 0], [0, 100]),
    crease([50, 0], [50, 100]),
    crease([0, 50], [100, 50]),
  ]);

  it('has none at the middle, its eight sectors each 45°, split there or crossing whole', () => {
    for (const step of [split, whole]) {
      expect(rightAnglesAt(step, NO_ASSETS, [0.5, 0.5])).toEqual([]);
      expect(rightAngleCorner(step, NO_ASSETS, [0.53, 0.47], 0.1)).toBeNull();
    }
  });

  it('has the two either side of a midline where it meets the edge', () => {
    expect(rightAnglesAt(split, NO_ASSETS, [0.5, 0]).map(rounded)).toEqual([
      { at: [0.5, 0], legs: [[1, 0], [0, 1]], diagonal: [r, r] },
      { at: [0.5, 0], legs: [[0, 1], [-1, 0]], diagonal: [-r, r] },
    ]);
    // The pointer picks between them.
    expect(rounded(rightAngleCorner(split, NO_ASSETS, [0.46, 0.05], 0.1))?.diagonal).toEqual([-r, r]);
    expect(rounded(rightAngleCorner(split, NO_ASSETS, [0.54, 0.05], 0.1))?.diagonal).toEqual([r, r]);
  });

  it('has four at the middle with only the diagonals, which cross there unsplit', () => {
    const crossed = sceneStep([face([SQUARE]), crease([0, 0], [100, 100]), crease([100, 0], [0, 100])]);
    expect(rightAnglesAt(crossed, NO_ASSETS, [0.5, 0.5])).toHaveLength(4);
    // Above the middle: between the rays to the top corners.
    expect(rounded(rightAngleCorner(crossed, NO_ASSETS, [0.5, 0.45], 0.1))).toEqual({
      at: [0.5, 0.5],
      legs: [
        [-r, -r],
        [r, -r],
      ],
      diagonal: [0, -1],
    });
  });
});

describe('rightAngleCorner at a box-pleated vertex', () => {
  const GRID: ScenePoint[] = [
    [100, 50],
    [50, 100],
    [0, 50],
    [50, 0],
  ];
  const DIAGONALS: ScenePoint[] = [
    [100, 100],
    [0, 100],
    [0, 0],
    [100, 0],
  ];
  const vertex = (ends: ScenePoint[]) => sceneStep([face([SQUARE]), ...ends.map((end) => crease([50, 50], end))]);

  it('has four at a grid vertex', () => {
    expect(rightAnglesAt(vertex(GRID), NO_ASSETS, [0.5, 0.5])).toHaveLength(4);
  });

  it('has none at an eight-way vertex, whose rays split every right angle', () => {
    expect(rightAnglesAt(vertex([...GRID, ...DIAGONALS]), NO_ASSETS, [0.5, 0.5])).toEqual([]);
  });

  it('picks the sector the pointer is in at a grid vertex with one diagonal', () => {
    // Rays at 0°, 45° (down-right), 90°, 180°, 270°: two 45° sectors, then three square.
    const step = vertex([...GRID, [100, 100]]);
    expect(rightAnglesAt(step, NO_ASSETS, [0.5, 0.5])).toHaveLength(3);
    expect(rightAngleCorner(step, NO_ASSETS, [0.54, 0.52], 0.1)).toBeNull();
    expect(rounded(rightAngleCorner(step, NO_ASSETS, [0.46, 0.46], 0.1))?.diagonal).toEqual([-r, -r]);
    expect(rounded(rightAngleCorner(step, NO_ASSETS, [0.46, 0.54], 0.1))?.diagonal).toEqual([-r, r]);
  });

  it('takes a crease drawn twice, and one along an edge, as one ray', () => {
    const step = sceneStep([
      face([SQUARE]),
      crease([50, 50], [100, 50]),
      line('aux', [50, 50], [100, 50]),
      crease([50, 50], [50, 0]),
    ]);
    expect(rightAnglesAt(step, NO_ASSETS, [0.5, 0.5])).toHaveLength(1);
  });

  it('finds a right angle that goes round past the +x axis', () => {
    // Rays at 30° and 300° on the page: the square sector between them holds 0°.
    const ray = (degrees: number): ScenePoint => [
      50 + 40 * Math.cos((degrees * Math.PI) / 180),
      50 + 40 * Math.sin((degrees * Math.PI) / 180),
    ];
    const step = sceneStep([face([SQUARE]), crease([50, 50], ray(30)), crease([50, 50], ray(300))]);
    for (const pointer of [
      [0.56, 0.51],
      [0.56, 0.49],
    ] as PicturePoint[]) {
      expect(rounded(rightAngleCorner(step, NO_ASSETS, pointer, 0.1))?.legs).toEqual([
        [0.5, -0.866],
        [0.866, 0.5],
      ]);
    }
  });

  it('allows a degree off square, and not two', () => {
    const tilt = (degrees: number): ScenePoint => {
      const angle = ((90 + degrees) * Math.PI) / 180;
      return [50 + 40 * Math.cos(angle), 50 + 40 * Math.sin(angle)];
    };
    const square = (degrees: number) => {
      const step = sceneStep([face([SQUARE]), crease([50, 50], [90, 50]), crease([50, 50], tilt(degrees))]);
      return rightAnglesAt(step, NO_ASSETS, [0.5, 0.5]);
    };
    expect(square(0.9)).toHaveLength(1);
    expect(square(-0.9)).toHaveLength(1);
    expect(square(2)).toEqual([]);
  });
});

describe('rightAngleCorner by kind of picture', () => {
  it('finds a flat fold’s square corners', () => {
    const step = sceneStep([face([SQUARE], { outline: 'edge' })], FLAT);
    expect(rightAnglesAt(step, NO_ASSETS, [0, 1])).toHaveLength(1);
  });

  it('offers none of a 3D picture’s own: a right angle is not drawn square through a camera', () => {
    const step = sceneStep([line('edge', [0, 0], [100, 0]), line('edge', [0, 0], [0, 100])], IN_3D);
    expect(rightAnglesAt(step, NO_ASSETS, [0, 0])).toEqual([]);
    expect(rightAngleCorner(step, NO_ASSETS, [0.05, 0.05], 0.1)).toBeNull();
  });

  it('finds drawn lines’ right angle on a 3D picture though one of its own lines crosses them nearer the pointer', () => {
    // A projected edge at x = 0.26, crossing the drawn valley just past the drawn corner.
    const step = sceneStep([line('edge', [26, 0], [26, 100]), line('edge', [0, 0], [100, 0])], IN_3D);
    const drawn = [
      annotation({ kind: 'valley-line', from: [0.2, 0.8], to: [0.8, 0.8] }),
      annotation({ id: 'annotation-up', kind: 'mountain-line', from: [0.2, 0.8], to: [0.2, 0.2] }),
    ];
    for (const pointer of [
      [0.25, 0.77],
      [0.24, 0.78],
      [0.27, 0.77],
    ] as PicturePoint[]) {
      expect(rightAngleCorner(step, NO_ASSETS, pointer, 0.1, { annotations: drawn })?.at).toEqual([0.2, 0.8]);
    }
  });

  it('finds where lines drawn on any picture meet square, an upload’s or a 3D one’s', () => {
    const lines = [
      annotation({ kind: 'valley-line', from: [0.2, 0.8], to: [0.8, 0.8] }),
      annotation({ id: 'annotation-up', kind: 'mountain-line', from: [0.2, 0.8], to: [0.2, 0.2] }),
    ];
    const { step: upload, assets } = uploadStep();
    expect(rightAngleCorner(upload, assets, [0.2, 0.8], 0.1)).toBeNull();
    for (const [step, from] of [
      [upload, assets],
      [sceneStep([line('edge', [0, 0], [100, 0])], IN_3D), NO_ASSETS],
    ] as const) {
      expect(rounded(rightAngleCorner(step, from, [0.25, 0.75], 0.1, { annotations: lines }))).toEqual({
        at: [0.2, 0.8],
        legs: [
          [0, -1],
          [1, 0],
        ],
        diagonal: [r, -r],
      });
    }
  });

  it('never reads the line being dragged', () => {
    const lines = [
      annotation({ kind: 'valley-line', from: [0.2, 0.8], to: [0.8, 0.8] }),
      annotation({ id: 'annotation-up', kind: 'mountain-line', from: [0.2, 0.8], to: [0.2, 0.2] }),
    ];
    const { step, assets } = uploadStep();
    const options = { annotations: lines, ignore: 'annotation-up' };
    expect(rightAngleCorner(step, assets, [0.25, 0.75], 0.1, options)).toBeNull();
  });

  describe('on a References step, mirrored on the back', () => {
    // A crease across, a valley up it at a fifth: four square sectors where they cross.
    const MODEL: StepDiagramModel = {
      sheet: { width: 1, height: 1 },
      primitives: [
        { kind: 'sheet', width: 1, height: 1 },
        { kind: 'line', from: [0, 0.5], to: [1, 0.5], style: 'crease' },
        { kind: 'line', from: [0.2, 0], to: [0.2, 1], style: 'valley' },
      ],
    };
    const front = { ...referencesStep('step-front'), picture: stepDiagramPicture(false, MODEL) };
    const back = { ...referencesStep('step-back', { side: 'back' }), picture: stepDiagramPicture(true, MODEL) };

    it('finds the crossing’s four, where the picture draws it', () => {
      expect(rightAnglesAt(front, NO_ASSETS, [0.2, 0.5])).toHaveLength(4);
      expect(rightAnglesAt(back, NO_ASSETS, [0.8, 0.5])).toHaveLength(4);
      expect(rightAnglesAt(back, NO_ASSETS, [0.2, 0.5])).toEqual([]);
    });

    it('picks the sector toward the pointer, the back’s left its right', () => {
      expect(rounded(rightAngleCorner(back, NO_ASSETS, [0.85, 0.45], 0.1))).toMatchObject({
        at: [0.8, 0.5],
        diagonal: [r, -r],
      });
    });

    it('finds the sheet’s corners square, and the valley’s foot square both ways', () => {
      expect(rightAnglesAt(back, NO_ASSETS, [0, 0])).toHaveLength(1);
      expect(rightAnglesAt(back, NO_ASSETS, [0.8, 1])).toHaveLength(2);
    });
  });
});

describe('right angles and snapping with the aux lines the style leaves out', () => {
  const auxPen = { width: 0.25, color: '#00ff00' as const, dash: null, cap: 'butt' as const };
  const HIDDEN: DiagramStyle = { style: { ...DEFAULT_PAPER_STYLE, auxCreases: { visible: false, pen: auxPen } } };
  const SHOWN: DiagramStyle = { style: { ...DEFAULT_PAPER_STYLE, auxCreases: { visible: true, pen: auxPen } } };

  it('reads a References step’s aux lines only where the style draws them', () => {
    const model: StepDiagramModel = {
      sheet: { width: 1, height: 1 },
      primitives: [
        { kind: 'sheet', width: 1, height: 1 },
        { kind: 'line', from: [0, 0], to: [1, 1], style: 'aux' },
        { kind: 'line', from: [0.5, 0], to: [0.5, 0.3], style: 'aux' },
      ],
    };
    const step = { ...referencesStep('step-aux'), picture: stepDiagramPicture(false, model) };
    // Hidden: the bare corner is square, and a plain edge has no corner on it.
    expect(rightAnglesAt(step, NO_ASSETS, [0, 1], { style: HIDDEN })).toHaveLength(1);
    expect(rightAnglesAt(step, NO_ASSETS, [0.5, 1], { style: HIDDEN })).toEqual([]);
    expect(rightAngleCorner(step, NO_ASSETS, [0.53, 0.97], 0.1, { style: HIDDEN })).toBeNull();
    expect(pictureSnapTarget(step, NO_ASSETS, [0.51, 0.69], 0.03, { style: HIDDEN })).toBeNull();
    // Shown: the diagonal halves the corner, and the short line meets the edge square.
    expect(rightAnglesAt(step, NO_ASSETS, [0, 1], { style: SHOWN })).toEqual([]);
    expect(rightAnglesAt(step, NO_ASSETS, [0.5, 1], { style: SHOWN })).toHaveLength(2);
    expect(pictureSnapTarget(step, NO_ASSETS, [0.51, 0.69], 0.03, { style: SHOWN })?.kind).toBe('end');
  });

  it('reads a fold’s aux lines as the style says, and a crease pattern’s always', () => {
    const items = [face([SQUARE], { outline: 'edge' }), line('aux', [0, 0], [100, 100])];
    const flat = sceneStep(items, FLAT);
    expect(rightAnglesAt(flat, NO_ASSETS, [0, 0], { style: HIDDEN })).toHaveLength(1);
    expect(rightAnglesAt(flat, NO_ASSETS, [0, 0], { style: SHOWN })).toEqual([]);
    const pattern = sceneStep(items);
    expect(rightAnglesAt(pattern, NO_ASSETS, [0, 0], { style: HIDDEN })).toEqual([]);
  });
});
