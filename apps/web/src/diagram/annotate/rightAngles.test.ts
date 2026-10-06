import { describe, expect, it } from 'vitest';
import type { StepDiagramModel } from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import type { ScenePoint } from '../../lib/paper/paperScene';
import { face, line, SQUARE } from '../../lib/paper/paperScene.fixtures';
import { referencesStep, stepDiagramPicture } from '../document/diagramSteps.fixtures';
import type { PicturePoint } from './annotationModel';
import { annotation, FLAT, IN_3D, NO_ASSETS, sceneStep, STACKED_CROSSING, uploadStep } from './pictureSnap.fixtures';
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
/** A search out to the snap radius alone, for the sector a pointer near the vertex is in. */
const ONLY_RADIUS = { footprint: 0 };

describe('rightAngleCorner on a square with a diagonal', () => {
  const step = sceneStep([face([SQUARE]), crease([0, 0], [100, 100])]);

  it('finds the corner the diagonal leaves square, inside the paper', () => {
    // The top-right corner: its sides go left and down, clockwise on the page from down to left.
    expect(rounded(rightAngleCorner(step, NO_ASSETS, [0.95, 0.04], 0.1, ONLY_RADIUS))).toEqual({
      at: [1, 0],
      legs: [
        [0, 1],
        [-1, 0],
      ],
      diagonal: [-r, r],
    });
  });

  it('never offers the reflex side of a paper corner', () => {
    expect(rightAngleCorner(step, NO_ASSETS, [1.04, -0.03], 0.1, ONLY_RADIUS)).toBeNull();
    expect(rightAngleCorner(step, NO_ASSETS, [0.96, -0.04], 0.1, ONLY_RADIUS)).toBeNull();
  });

  it('finds none where the diagonal halves the corner', () => {
    expect(rightAngleCorner(step, NO_ASSETS, [0.06, 0.02], 0.1, ONLY_RADIUS)).toBeNull();
    expect(rightAngleCorner(step, NO_ASSETS, [0.02, 0.06], 0.1, ONLY_RADIUS)).toBeNull();
  });

  it('says which angle right up to the vertex, and nothing out of reach', () => {
    // No dead zone: a hair off the vertex, the side of the lines the pointer is on.
    expect(rounded(rightAngleCorner(step, NO_ASSETS, [0.99, 0.01], 0.1, ONLY_RADIUS))?.at).toEqual([1, 0]);
    expect(rightAngleCorner(step, NO_ASSETS, [0.85, 0.15], 0.1, ONLY_RADIUS)).toBeNull();
    expect(rightAngleCorner(step, NO_ASSETS, [0.95, 0.04], 0, ONLY_RADIUS)).toBeNull();
  });
});

describe('rightAngleCorner over the mark it puts down (Revision 2)', () => {
  // A square with a diagonal: its top-right corner square, opening down and to the left.
  const step = sceneStep([face([SQUARE]), crease([0, 0], [100, 100])]);
  // The canvas's snap radius at fit, about, and how far past its vertex the mark is drawn: about 0.1.
  const radius = 0.02;
  const footprint = 0.103;
  const intoCorner = (along: number): PicturePoint => [1 - along * R, along * R];

  it('finds the vertex from over its mark, past the snap radius, where it finds none without', () => {
    for (const along of [0.04, 0.07, 0.1, 0.12]) {
      expect(rightAngleCorner(step, NO_ASSETS, intoCorner(along), radius, ONLY_RADIUS)).toBeNull();
      expect(rounded(rightAngleCorner(step, NO_ASSETS, intoCorner(along), radius, { footprint }))).toMatchObject({
        at: [1, 0],
        diagonal: [-r, r],
      });
    }
    // Past the snap radius and the mark both: nothing.
    expect(rightAngleCorner(step, NO_ASSETS, intoCorner(0.13), radius, { footprint })).toBeNull();
  });

  it('has no dead zone: on the vertex, the angle the pointer is on the side of', () => {
    expect(rounded(rightAngleCorner(step, NO_ASSETS, [0.995, 0.005], 0.1, { footprint }))?.at).toEqual([1, 0]);
    // The reflex side of the paper's corner is still none.
    expect(rightAngleCorner(step, NO_ASSETS, [1.005, -0.005], 0.1, { footprint })).toBeNull();
  });

  it('finds none where no vertex in reach has a right angle the pointer is in', () => {
    // The top-left corner, which the diagonal halves: nothing, the top-right's mark far out of reach.
    expect(rightAngleCorner(step, NO_ASSETS, [0.015, 0.005], radius, { footprint })).toBeNull();
  });

  it('passes over a nearer vertex with no right angle where the pointer is, to the mark’s', () => {
    // Lines drawn on an upload meeting square at (0.3, 0.3), and a short line along the diagonal that
    // ends nearer the pointer, over the mark, with no angle there.
    const { step: upload, assets } = uploadStep();
    const lines = [
      annotation({ id: 'across', kind: 'valley-line', from: [0.3, 0.3], to: [0.6, 0.3] }),
      annotation({ id: 'down', kind: 'valley-line', from: [0.3, 0.3], to: [0.3, 0.6] }),
      annotation({ id: 'short', kind: 'mountain-line', from: [0.37, 0.37], to: [0.45, 0.45] }),
    ];
    const pointer: PicturePoint = [0.3 + 0.07 * R, 0.3 + 0.07 * R];
    expect(rounded(rightAngleCorner(upload, assets, pointer, radius, { annotations: lines, footprint }))).toMatchObject({
      at: [0.3, 0.3],
      diagonal: [r, r],
    });
  });

  it('offers none of a 3D picture’s own lines however far it looks', () => {
    const solid = sceneStep([line('edge', [0, 0], [100, 0]), line('edge', [0, 0], [0, 100])], IN_3D);
    expect(rightAngleCorner(solid, NO_ASSETS, [0.05, 0.05], radius, { footprint })).toBeNull();
  });

  describe('at a crossing with a flap’s corners either side of it, as on the crane’s step 8', () => {
    const { step: stacked, at: C, flaps } = STACKED_CROSSING;

    it('has no right angle at the flap’s corners, and four at the crossing', () => {
      for (const flap of flaps) expect(rightAnglesAt(stacked, NO_ASSETS, flap)).toEqual([]);
      expect(rightAnglesAt(stacked, NO_ASSETS, C)).toHaveLength(4);
    });

    it('takes the crossing’s quadrant the pointer is in, though a flap’s corner is nearer it', () => {
      // 0.0045 off the crossing each way, within the snap radius: nearer a flap's corner than the crossing.
      for (const [sx, sy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const) {
        const pointer: PicturePoint = [C[0] + 0.0045 * sx, C[1] + 0.0045 * sy];
        const corner = Math.hypot(pointer[0] - C[0], pointer[1] - C[1]);
        const flap = Math.hypot(pointer[0] - (C[0] + 0.0075 * sx), pointer[1] - C[1]);
        expect(flap).toBeLessThan(corner);
        expect(rounded(rightAngleCorner(stacked, NO_ASSETS, pointer, radius, { footprint }))).toMatchObject({
          at: C,
          diagonal: [r * sx, r * sy],
        });
      }
    });

    it('takes it from over the mark there too, past the flap’s corner', () => {
      // Down and to the right of the crossing, along the diagonal, as far as the mark is drawn.
      for (const along of [0.01, 0.04, 0.1]) {
        const pointer: PicturePoint = [C[0] + along * R, C[1] + along * R];
        expect(rounded(rightAngleCorner(stacked, NO_ASSETS, pointer, radius, { footprint }))).toMatchObject({
          at: C,
          diagonal: [r, r],
        });
      }
    });
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
      expect(rightAngleCorner(step, NO_ASSETS, [0.53, 0.47], 0.1, ONLY_RADIUS)).toBeNull();
    }
  });

  it('has the two either side of a midline where it meets the edge', () => {
    expect(rightAnglesAt(split, NO_ASSETS, [0.5, 0]).map(rounded)).toEqual([
      { at: [0.5, 0], legs: [[1, 0], [0, 1]], diagonal: [r, r] },
      { at: [0.5, 0], legs: [[0, 1], [-1, 0]], diagonal: [-r, r] },
    ]);
    // The pointer picks between them.
    expect(rounded(rightAngleCorner(split, NO_ASSETS, [0.46, 0.05], 0.1, ONLY_RADIUS))?.diagonal).toEqual([-r, r]);
    expect(rounded(rightAngleCorner(split, NO_ASSETS, [0.54, 0.05], 0.1, ONLY_RADIUS))?.diagonal).toEqual([r, r]);
  });

  it('has four at the middle with only the diagonals, which cross there unsplit', () => {
    const crossed = sceneStep([face([SQUARE]), crease([0, 0], [100, 100]), crease([100, 0], [0, 100])]);
    expect(rightAnglesAt(crossed, NO_ASSETS, [0.5, 0.5])).toHaveLength(4);
    // Above the middle: between the rays to the top corners.
    expect(rounded(rightAngleCorner(crossed, NO_ASSETS, [0.5, 0.45], 0.1, ONLY_RADIUS))).toEqual({
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
    expect(rightAngleCorner(step, NO_ASSETS, [0.54, 0.52], 0.1, ONLY_RADIUS)).toBeNull();
    expect(rounded(rightAngleCorner(step, NO_ASSETS, [0.46, 0.46], 0.1, ONLY_RADIUS))?.diagonal).toEqual([-r, -r]);
    expect(rounded(rightAngleCorner(step, NO_ASSETS, [0.46, 0.54], 0.1, ONLY_RADIUS))?.diagonal).toEqual([-r, r]);
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
      expect(rounded(rightAngleCorner(step, NO_ASSETS, pointer, 0.1, ONLY_RADIUS))?.legs).toEqual([
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

  it('reads a flat fold’s rays as they show: a layer’s edge under a later one is no way out', () => {
    // Two triangles either side of the diagonal, then a flap over the top-left quarter, painted last.
    const step = sceneStep(
      [
        face([[[0, 0], [100, 0], [100, 100]]], { outline: 'edge' }),
        face([[[0, 0], [100, 100], [0, 100]]], { outline: 'edge' }),
        face([[[0, 0], [50, 0], [50, 50], [0, 50]]], { outline: 'edge' }),
      ],
      FLAT
    );
    // The flap's corner shows square, the diagonal under it no way out.
    const corner = rightAngleCorner(step, NO_ASSETS, [0.47, 0.46], 0.1, ONLY_RADIUS);
    expect(corner?.at).toEqual([0.5, 0.5]);
    expect(rightAnglesAt(step, NO_ASSETS, [0.5, 0.5])).toHaveLength(1);
    // Where the flap's edge meets the paper's top edge, which runs along its own: a T, two square.
    expect(rightAnglesAt(step, NO_ASSETS, [0.5, 0])).toHaveLength(2);
  });

  it('offers none of a 3D picture’s own: a right angle is not drawn square through a camera', () => {
    const step = sceneStep([line('edge', [0, 0], [100, 0]), line('edge', [0, 0], [0, 100])], IN_3D);
    expect(rightAnglesAt(step, NO_ASSETS, [0, 0])).toEqual([]);
    expect(rightAngleCorner(step, NO_ASSETS, [0.05, 0.05], 0.1, ONLY_RADIUS)).toBeNull();
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
      expect(rightAngleCorner(step, NO_ASSETS, pointer, 0.1, { annotations: drawn, footprint: 0 })?.at).toEqual([0.2, 0.8]);
    }
  });

  it('finds where lines drawn on any picture meet square, an upload’s or a 3D one’s', () => {
    const lines = [
      annotation({ kind: 'valley-line', from: [0.2, 0.8], to: [0.8, 0.8] }),
      annotation({ id: 'annotation-up', kind: 'mountain-line', from: [0.2, 0.8], to: [0.2, 0.2] }),
    ];
    const { step: upload, assets } = uploadStep();
    expect(rightAngleCorner(upload, assets, [0.2, 0.8], 0.1, ONLY_RADIUS)).toBeNull();
    for (const [step, from] of [
      [upload, assets],
      [sceneStep([line('edge', [0, 0], [100, 0])], IN_3D), NO_ASSETS],
    ] as const) {
      expect(rounded(rightAngleCorner(step, from, [0.25, 0.75], 0.1, { annotations: lines, footprint: 0 }))).toEqual({
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
    const options = { annotations: lines, ignore: 'annotation-up', footprint: 0 };
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
      expect(rounded(rightAngleCorner(back, NO_ASSETS, [0.85, 0.45], 0.1, ONLY_RADIUS))).toMatchObject({
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
    expect(rightAngleCorner(step, NO_ASSETS, [0.53, 0.97], 0.1, { style: HIDDEN, footprint: 0 })).toBeNull();
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
