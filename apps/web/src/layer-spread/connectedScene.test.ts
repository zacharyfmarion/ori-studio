import { expect, it } from 'vitest';
import type { SpreadSolution } from '@oristudio/layer-spread';
import type { ConnectedSpreadSource } from '../cp-workspace/folded/connectedSpreadSource';
import { DEFAULT_CONNECTED_SPREAD } from '../cp-workspace/folded/layerSpreadSettings';
import type { OristudioCpFoldedPaperScene } from '../engine/oristudioCpTypes';
import type { PaperLineItem } from '../lib/paper/paperScene';
import { erodeLine } from '../lib/paper/paperSvg';
import { connectedDrawing } from './connectedScene';

/** One flat layer: two unit squares side by side, the crease between them at x = 1. */
const source: ConnectedSpreadSource = {
  frame: { origin: [0, 0], ex: [1, 0], ey: [0, 1] },
  vertices: [0, 1, 2, 3, 4, 5],
  back: false,
  input: {
    xy: [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [0, 1],
    ],
    faces: [
      [0, 1, 4, 5],
      [1, 2, 3, 4],
    ],
    triangles: [
      [0, 1, 4],
      [0, 4, 5],
      [1, 2, 3],
      [1, 3, 4],
    ],
    triangleFaces: [0, 0, 1, 1],
    orders: [],
    cells: [],
  },
};
// Every layer at the reference plane: the spread moves nothing, so the scene is the material, scaled.
const solution = {
  heights: [0, 0, 0, 0, 0, 0],
  references: [{ plane: [0, 0, 0] }, { plane: [0, 0, 0] }],
} as unknown as SpreadSolution;
const kernel = { faces: [{ front_up: true }, { front_up: true }] } as unknown as OristudioCpFoldedPaperScene;

it('erodes a piece of a crease that runs on past its face along the piece, in the scene’s units', () => {
  // A precrease across both faces, drawn as its piece on face 0: the crease's far end lies on face 1.
  const piece: PaperLineItem = {
    kind: 'line',
    role: 'aux',
    face: 0,
    hidden: false,
    a: [0, 0.5],
    b: [1, 0.5],
    onBoundary: [true, false],
    whole: { a: [0, 0.5], b: [2, 0.5], onBoundary: [true, true] },
  };
  const drawing = connectedDrawing(
    kernel,
    { source, solution },
    DEFAULT_CONNECTED_SPREAD,
    ({ x, y }) => [x * 10, y * 10],
    [piece]
  );
  // Split where it crosses the face's diagonal; pulled in at the paper's edge only, and never off its own line.
  expect(drawing.ink.map((edge) => erodeLine(edge.line, 0.5))).toEqual([
    [
      [0.5, 5],
      [5, 5],
    ],
    [
      [5, 5],
      [10, 5],
    ],
  ]);
});
