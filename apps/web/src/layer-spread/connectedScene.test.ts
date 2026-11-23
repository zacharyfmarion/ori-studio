import { expect, it } from 'vitest';
import type { ConnectedSpread, Point3, SpreadSolution } from '@oristudio/layer-spread';
import { connectedSpreadSource, type ConnectedSpreadSource } from '../cp-workspace/folded/connectedSpreadSource';
import { foldedFlatPaperScene } from '../cp-workspace/folded/foldedFlatScene';
import { kernelFace } from '../cp-workspace/folded/foldedPrecrease.fixtures';
import { DEFAULT_CONNECTED_SPREAD } from '../cp-workspace/folded/layerSpreadSettings';
import type { OristudioCpFoldedPaperScene } from '../engine/oristudioCpTypes';
import type { PaperLineItem } from '../lib/paper/paperScene';
import { erodeLine } from '../lib/paper/paperSvg';
import { connectedDrawing } from './connectedScene';

/**
 * A 2 × 2 sheet precreased in half both ways: four square faces around the
 * centre, sheet vertices 0 1 2 along the bottom, 3 4 5 across the middle and
 * 6 7 8 along the top. Each precrease is two collinear pieces, one on each
 * side of the centre, so a piece's crease runs on into faces it is not in.
 */
function crossPrecreased(): OristudioCpFoldedPaperScene {
  const square = (x: number, y: number): Array<[number, number]> => [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
  const faces = [
    kernelFace(square(0, 0), [0, 1, 4, 3], ['border', 'flat', 'flat', 'border']),
    kernelFace(square(1, 0), [1, 2, 5, 4], ['border', 'border', 'flat', 'flat']),
    kernelFace(square(0, 1), [3, 4, 7, 6], ['flat', 'flat', 'border', 'border']),
    kernelFace(square(1, 1), [4, 5, 8, 7], ['flat', 'border', 'border', 'flat']),
  ];
  return {
    schema_version: 3,
    flipped: false,
    sheet: 2,
    faces,
    subfaces: faces.map((face, index) => ({ polygon: face.outline, faces_top_to_bottom: [index] })),
    aux_lines: [],
    sheet_points: [0, 1, 2].flatMap((y) => [0, 1, 2].map((x) => ({ x, y }))),
  };
}

it.each([0, 1])('keeps a crease piece on its own drawn line when the crease runs on into another face (lift %s)', (lift) => {
  const kernel = crossPrecreased();
  const source = connectedSpreadSource(kernel);
  const reference = { plane: [0, 0, 0] as Point3, center: [0, 0, 0] as Point3, samples: 1, rms: 0 };
  const solution: SpreadSolution = {
    version: 'normalized-50-v1',
    // With lift, the right-hand faces tilt, so the reveal moves them apart from the left.
    heights: source.input.xy.map(([x]) => (x > 0.5 ? 0.2 * lift : 0)),
    references: [reference, reference],
    diagnostics: { status: 'solved', iterations: 1, qp_seconds: 0, variables: 9, constraints: 0,
      overlap_regions: 0, crossing_weight: 50, opening_scale: 1, max_relative_warp: 0,
      max_slope: 0.2, max_crossing: 0, rms_crossing: 0, mean_gap: 0 },
  };
  const spread: ConnectedSpread = { kind: 'connected', version: 1, amount: 1, reveal: [0.8, 0.6] };
  // A capture is scaled and placed, so the fold's own coordinates are nowhere near the picture.
  const scene = foldedFlatPaperScene(kernel, {
    connected: { source, solution }, spread, live: false, markHidden: false, scale: 40,
    toScenePx: (p: { x: number; y: number }): [number, number] => [40 * p.x + 300, -40 * p.y + 500],
  });
  const lines = scene.items.filter((item): item is PaperLineItem => item.kind === 'line');
  const pieces = lines.filter((line) => {
    if (!line.whole) return false;
    const own = Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]);
    return Math.hypot(line.whole.b[0] - line.whole.a[0], line.whole.b[1] - line.whole.a[1]) > 1.5 * own;
  });
  // Both precreases are cut at the centre, into pieces half as long as their crease.
  expect(pieces.length).toBeGreaterThanOrEqual(4);
  for (const line of lines) {
    const whole = line.whole;
    if (!whole) continue;
    const dx = whole.b[0] - whole.a[0], dy = whole.b[1] - whole.a[1];
    const span = dx * dx + dy * dy;
    for (const end of [line.a, line.b]) {
      // On the crease's line, between its ends.
      expect(Math.abs((end[0] - whole.a[0]) * dy - (end[1] - whole.a[1]) * dx) / Math.sqrt(span)).toBeLessThan(1e-6);
      const along = ((end[0] - whole.a[0]) * dx + (end[1] - whole.a[1]) * dy) / span;
      expect(along).toBeGreaterThan(-1e-9);
      expect(along).toBeLessThan(1 + 1e-9);
    }
    // So eroding the crease only ever shortens the piece along itself.
    const drawn = erodeLine(line, 2);
    if (!drawn) continue;
    for (const end of drawn) {
      const px = line.b[0] - line.a[0], py = line.b[1] - line.a[1];
      const length = Math.hypot(px, py);
      expect(Math.abs((end[0] - line.a[0]) * py - (end[1] - line.a[1]) * px) / length).toBeLessThan(1e-6);
      const along = ((end[0] - line.a[0]) * px + (end[1] - line.a[1]) * py) / (length * length);
      expect(along).toBeGreaterThan(-1e-9);
      expect(along).toBeLessThan(1 + 1e-9);
    }
  }
});

it('erodes a piece of a crease that runs on past its face at the paper’s edge only, in the scene’s units', () => {
  // One flat layer: two unit squares side by side, the crease between them at x = 1.
  const strip: ConnectedSpreadSource = {
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
  const still = {
    heights: [0, 0, 0, 0, 0, 0],
    references: [{ plane: [0, 0, 0] }, { plane: [0, 0, 0] }],
  } as unknown as SpreadSolution;
  const kernel = { faces: [{ front_up: true }, { front_up: true }] } as unknown as OristudioCpFoldedPaperScene;
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
    { source: strip, solution: still },
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
