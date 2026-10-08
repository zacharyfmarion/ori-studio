import { describe, expect, it } from 'vitest';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { diagramInModel, rfToModel } from './referenceFinderStepInModel';
import type { PrecreaseFrame } from './sheetFrames';
import { arcEndPoint, arcSamplePoints } from './stepDiagramGeometry';

/**
 * A 100-unit square whose model y runs down while ReferenceFinder's runs up:
 * the unit sheet's lower-left corner sits at model (0, 100), and the frame
 * flips y — the common case for a pattern drawn with the paper's south edge
 * at the bottom of the screen.
 */
const FLIPPED: PrecreaseFrame = {
  origin: [0, 100],
  x_axis: [1, 0],
  y_axis: [0, -1],
  width: 100,
  height: 100,
};

describe('rfToModel', () => {
  it('lays the unit sheet along the frame from its origin, scaled by the longer side', () => {
    expect(rfToModel(FLIPPED, [0, 0])).toEqual([0, 100]);
    expect(rfToModel(FLIPPED, [1, 1])).toEqual([100, 0]);
    expect(rfToModel(FLIPPED, [0.5, 0.25])).toEqual([50, 75]);
    // A rectangle: the longer side is the unit, the shorter a fraction of it.
    const tall: PrecreaseFrame = { ...FLIPPED, width: 50, height: 100 };
    expect(rfToModel(tall, [0.5, 1])).toEqual([50, 0]);
  });
});

describe('diagramInModel', () => {
  const diagram: StepDiagramModel = {
    sheet: { width: 1, height: 1 },
    primitives: [
      { kind: 'sheet', width: 1, height: 1 },
      { kind: 'line', from: [0, 0.5], to: [1, 0.5], style: 'valley' },
      { kind: 'line', from: [0.2, 0.2], to: [0.4, 0.4], style: 'pinch' },
      // A quarter turn counter-clockwise about the centre, from the east.
      {
        kind: 'fold-arrow',
        out: { center: [0.5, 0.5], radius: 0.25, from: 0, to: Math.PI / 2, ccw: true },
      },
      { kind: 'point', at: [0.5, 0.5], style: 'action' },
      { kind: 'label', at: [0.5, 0.6], text: 'A', style: 'highlight' },
    ],
  };

  it('maps every primitive but the sheet, keeping styles, letters and dash rulers', () => {
    const model = diagramInModel(diagram, FLIPPED);
    expect(model.primitives.some((p) => p.kind === 'sheet')).toBe(false);
    const [valley, pinch] = model.primitives.filter((p) => p.kind === 'line');
    expect(valley).toMatchObject({ style: 'valley', from: [0, 50], to: [100, 50] });
    expect(valley.kind === 'line' && typeof valley.dashPhase).toBe('number');
    expect(pinch).toMatchObject({ style: 'pinch' });
    expect(model.primitives).toContainEqual({ kind: 'point', at: [50, 50], style: 'action' });
    expect(model.primitives).toContainEqual({
      kind: 'label',
      at: [50, 40],
      text: 'A',
      style: 'highlight',
    });
  });

  it('maps a white arrow’s every control point, keeping its width and tail', () => {
    const model = diagramInModel(
      {
        ...diagram,
        primitives: [
          {
            kind: 'white-arrow',
            width: 'wide',
            tail: 'cleft',
            fill: 'white',
            path: [
              [
                [0.1, 0.2],
                [0.3, 0.5],
                [0.6, 0.5],
                [0.8, 0.3],
              ],
            ],
          },
        ],
      },
      FLIPPED
    );
    expect(model.primitives).toEqual([
      {
        kind: 'white-arrow',
        width: 'wide',
        tail: 'cleft',
        fill: 'white',
        path: [
          [
            [10, 80],
            [30, 50],
            [60, 50],
            [80, 70],
          ],
        ],
      },
    ]);
  });

  it('refits an arc through the images of its points, so a flip turns it the other way', () => {
    const model = diagramInModel(diagram, FLIPPED);
    const arrow = model.primitives.find((p) => p.kind === 'fold-arrow');
    if (!arrow || arrow.kind !== 'fold-arrow') throw new Error('no arrow');
    const { out } = arrow;
    expect(out.center[0]).toBeCloseTo(50, 9);
    expect(out.center[1]).toBeCloseTo(50, 9);
    expect(out.radius).toBeCloseTo(25, 9);
    // Starts at the east point's image and ends at the north point's — which
    // the flip puts at a smaller y, above the centre on a y-down canvas —
    // travelling the short way, which is now clockwise.
    const [start, , end] = arcSamplePoints(out);
    expect(start[0]).toBeCloseTo(75, 6);
    expect(start[1]).toBeCloseTo(50, 6);
    expect(end[0]).toBeCloseTo(50, 6);
    expect(end[1]).toBeCloseTo(25, 6);
    expect(out.ccw).toBe(false);
    expect(arcEndPoint(out)[1]).toBeCloseTo(25, 6);
  });

  it('carries a right angle’s corner and the way it opens through the frame, which flips it', () => {
    const marked: StepDiagramModel = {
      ...diagram,
      primitives: [{ kind: 'right-angle', at: [0, 0], toward: [0.1, 0.1] }],
    };
    // The paper's lower-left corner, opening up and to the right: on a y-down canvas, up is a smaller y.
    expect(diagramInModel(marked, FLIPPED).primitives).toEqual([{ kind: 'right-angle', at: [0, 100], toward: [10, 90] }]);
  });

  it('carries a pleat arrow’s ends through the frame, and turns the side its Zs step to with a frame that flips (15c)', () => {
    const pleated: StepDiagramModel = {
      ...diagram,
      primitives: [{ kind: 'pleat-arrow', from: [0.1, 0.5], to: [0.9, 0.5], kinks: 2, mirrored: false }],
    };
    // Flipped into a y-down model, where a projector counts the paper turned over: once each, as it is drawn.
    expect(diagramInModel(pleated, FLIPPED).primitives).toEqual([
      { kind: 'pleat-arrow', from: [10, 50], to: [90, 50], kinks: 2, mirrored: true },
    ]);
    const upright: PrecreaseFrame = { ...FLIPPED, origin: [0, 0], y_axis: [0, 1] };
    expect(diagramInModel(pleated, upright).primitives).toEqual([
      { kind: 'pleat-arrow', from: [10, 50], to: [90, 50], kinks: 2, mirrored: false },
    ]);
  });

  it('carries equal divisions’ ends through the frame, and turns their side with a frame that flips, their offset a print size and their short dividers kept (Revisions 2 and 3)', () => {
    const look = { parts: 4, offset: 7.5, ticks: 2 as const, numbered: true, shortDividers: true };
    const divided: StepDiagramModel = {
      ...diagram,
      primitives: [{ kind: 'divisions', from: [0.1, 0.5], to: [0.9, 0.5], mirrored: false, ...look }],
    };
    expect(diagramInModel(divided, FLIPPED).primitives).toEqual([
      { kind: 'divisions', from: [10, 50], to: [90, 50], mirrored: true, ...look },
    ]);
    const upright: PrecreaseFrame = { ...FLIPPED, origin: [0, 0], y_axis: [0, 1] };
    expect(diagramInModel(divided, upright).primitives).toEqual([
      { kind: 'divisions', from: [10, 50], to: [90, 50], mirrored: false, ...look },
    ]);
  });

  it('measures the sheet in model units and knows where its middle is and which way it lies', () => {
    // Re-pinned for Phase 5's erode: the sheet carries the frame's axes, so a
    // turned paper's edge is found where it is and not on an upright box.
    const model = diagramInModel(diagram, FLIPPED);
    expect(model.sheet).toEqual({
      width: 100,
      height: 100,
      centre: [50, 50],
      axes: { x: [1, 0], y: [0, -1] },
    });
    const tall = diagramInModel({ ...diagram, sheet: { width: 0.5, height: 1 } }, FLIPPED);
    expect(tall.sheet.width).toBe(50);
    expect(tall.sheet.height).toBe(100);
  });
});
