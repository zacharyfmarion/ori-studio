import { describe, expect, it } from 'vitest';
import type { Rgba } from '../../renderer/types';
import type { DiagramLineStyleName, StepDiagramPrimitive } from '../referenceFinderDiagramToPrimitives';
import { DIAGRAM_LINE_INK, canvasDiagramPens, diagramDashSlot } from './diagramInk';
import { diagramToScene, type DiagramInkColors } from './diagramToScene';

const GREY: Rgba = [0.5, 0.5, 0.5, 1];
const COLORS = Object.fromEntries(
  (Object.keys(DIAGRAM_LINE_INK) as DiagramLineStyleName[]).map((style) => [style, GREY])
) as DiagramInkColors;

const SHEET = { width: 1, height: 1 };
const primitives: StepDiagramPrimitive[] = [
  { kind: 'sheet', width: 1, height: 1 },
  // Edge to edge: both ends on the paper's boundary.
  { kind: 'line', from: [0, 0.5], to: [1, 0.5], style: 'crease' },
  { kind: 'line', from: [0, 0], to: [1, 1], style: 'valley' },
  { kind: 'point', at: [0.5, 0.5], style: 'normal' },
];

describe('diagramToScene', () => {
  it('sends lines to the GPU and symbols to the DOM, and no sheet to either', () => {
    const scene = diagramToScene(primitives, COLORS, 1);
    expect(scene.strokes?.count).toBe(2);
    expect(scene.symbols.map((symbol) => symbol.kind)).toEqual(['point']);
  });

  // A crease an earlier step made is the paper as it stands, and is drawn
  // whether the pattern's aux lines are shown or not.
  it('always draws the creases an earlier step made', () => {
    const scene = diagramToScene(primitives, COLORS, 1, {
      creases: { showAux: false, erode: 0 },
    });
    expect(scene.strokes?.count).toBe(2);
    expect(scene.symbols).toHaveLength(1);
  });

  // The pattern's own aux lines are the reader's to show or hide; shown, they
  // are drawn in the made crease's pen and dash.
  it('leaves the pattern’s aux lines out unless they are shown', () => {
    const withAux: StepDiagramPrimitive[] = [
      ...primitives,
      { kind: 'line', from: [0.5, 0], to: [0.5, 1], style: 'aux' },
    ];
    const hidden = diagramToScene(withAux, COLORS, 1, { creases: { showAux: false, erode: 0 } });
    expect(hidden.strokes?.count).toBe(2);
    const shown = diagramToScene(withAux, COLORS, 1, { creases: { showAux: true, erode: 0 } });
    expect(shown.strokes?.count).toBe(3);
    expect(shown.strokes?.dashSlot?.[2]).toBe(diagramDashSlot('crease'));
  });

  // ...and pulls them back from the sheet's edge by its erode, the rule the
  // card applies, so the two pictures of a step agree.
  it('erodes an existing crease at the sheet’s edge, given the sheet', () => {
    const scene = diagramToScene(primitives, COLORS, 1, {
      sheet: SHEET,
      creases: { showAux: true, erode: 0.1 },
    });
    // Float32 on the way to the GPU.
    const near = (values: ArrayLike<number>) => Array.from(values).map((v) => Number(v.toFixed(6)));
    expect(near(scene.strokes!.a.slice(0, 2))).toEqual([0.1, 0.5]);
    expect(near(scene.strokes!.b.slice(0, 2))).toEqual([0.9, 0.5]);
    // The valley reaches the corners.
    expect(near(scene.strokes!.a.slice(2, 4))).toEqual([0, 0]);
    // A crease the pull would invert is dropped rather than drawn backwards.
    const gone = diagramToScene(primitives, COLORS, 1, {
      sheet: SHEET,
      creases: { showAux: true, erode: 0.5 },
    });
    expect(gone.strokes?.count).toBe(1);
  });

  it('erodes on the paper’s own edge when the frame has turned it', () => {
    // The unit sheet under a 45° frame of side 100 about (50, 50): its
    // diagonal runs up the space's y axis, corner to corner, past the upright
    // box the sheet's size alone would describe.
    const r = Math.SQRT1_2;
    const turned = {
      width: 100,
      height: 100,
      centre: [50, 50] as const,
      axes: { x: [r, r] as const, y: [-r, r] as const },
    };
    const half = 50 / r;
    const scene = diagramToScene(
      [{ kind: 'line', from: [50, 50 - half], to: [50, 50 + half], style: 'crease' }],
      COLORS,
      1,
      { sheet: turned, creases: { showAux: true, erode: 0.1 } }
    );
    const near = (values: ArrayLike<number>) => Array.from(values).map((v) => Number(v.toFixed(3)));
    expect(near(scene.strokes!.a.slice(0, 2))).toEqual([50, Number((50 - half + 10).toFixed(3))]);
    expect(near(scene.strokes!.b.slice(0, 2))).toEqual([50, Number((50 + half - 10).toFixed(3))]);
    // Without the axes the same ends are off an upright paper, and stay.
    const upright = diagramToScene(
      [{ kind: 'line', from: [50, 50 - half], to: [50, 50 + half], style: 'crease' }],
      COLORS,
      1,
      { sheet: { width: 100, height: 100, centre: [50, 50] }, creases: { showAux: true, erode: 0.1 } }
    );
    expect(near(upright.strokes!.a.slice(0, 2))).toEqual([50, Number((50 - half).toFixed(3))]);
  });

  it('draws the existing crease in the pens it is handed: width, and dash in the fourth slot', () => {
    const pens = canvasDiagramPens(1, 1.4, {
      pen: { width: 0.45, color: '#9aa4ad', dash: [4, 2], cap: 'round' },
      css: 0.6,
    });
    const scene = diagramToScene(primitives, COLORS, 2, { pens });
    expect(scene.strokes?.widthMul[0]).toBeCloseTo(pens.crease.width, 6);
    expect(scene.strokes?.dashSlot?.[0]).toBe(diagramDashSlot('crease'));
    const runs = scene.strokes!.dashPatterns![diagramDashSlot('crease') - 1]!;
    expect(runs.map((run) => run / (pens.crease.width * 2))).toEqual([4, 2]);
    // The table's crease is solid: an empty pattern in its slot.
    expect(diagramToScene(primitives, COLORS, 2).strokes!.dashPatterns![3]).toEqual([]);
  });
});
