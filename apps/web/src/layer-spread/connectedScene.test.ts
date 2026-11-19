import { expect, it } from 'vitest';
import type { ConnectedSpread, Point3, SpreadSolution } from '@oristudio/layer-spread';
import { connectedSpreadSource } from '../cp-workspace/folded/connectedSpreadSource';
import { foldedFlatPaperScene } from '../cp-workspace/folded/foldedFlatScene';
import { kernelFace } from '../cp-workspace/folded/foldedPrecrease.fixtures';
import type { OristudioCpFoldedPaperScene } from '../engine/oristudioCpTypes';
import type { PaperLineItem } from '../lib/paper/paperScene';
import { erodeLine } from '../lib/paper/paperSvg';

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
