/**
 * A small folded figure for the Layer order panes' tests, as the kernel's
 * paper scene would draw it. Imported only by tests.
 *
 * A strip of paper, 40 by 10 in the crease pattern's coordinates, folded at
 * x = 20 and x = 30 into a Z: face 0 (x 0–20) stays; face 1 (x 20–30) folds
 * back over its right half; face 2 (x 30–40) folds again, over that. So the
 * folded paper is 20 by 10, with two spots: spot 0 (x 0–10), face 0 alone,
 * and spot 1 (x 10–20), faces 2, 1 and 0 from the top.
 */
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';

const rect = (x0: number, x1: number): Point[] => [
  { x: x0, y: 0 },
  { x: x1, y: 0 },
  { x: x1, y: 10 },
  { x: x0, y: 10 },
];

/** The crease pattern's points: each face's four corners, face after face. */
const SHEET_POINTS: Point[] = [...rect(0, 20), ...rect(20, 30), ...rect(30, 40)];

/** The folded outlines, front up. */
const FOLDED: Point[][] = [rect(0, 20), rect(10, 20), rect(10, 20)];

/** The Z, from `side`: the back pass mirrors it across x = 10 and reads each stack bottom up. */
export function zScene(side: 'front' | 'back' = 'front', stack: readonly number[] = [2, 1, 0]): OristudioCpFoldedPaperScene {
  const mirror = (ring: Point[]): Point[] => (side === 'back' ? ring.map(({ x, y }) => ({ x: 20 - x, y })) : ring);
  const frontUp = [true, false, true];
  return {
    schema_version: 3,
    flipped: side === 'back',
    sheet: 40,
    faces: FOLDED.map((outline, k) => {
      const ring = mirror(outline);
      return {
        outline: ring,
        points: [0, 1, 2, 3].map((corner) => k * 4 + corner),
        front_up: frontUp[k] === (side === 'front'),
        edges: ring.map((from, i) => ({ from, to: ring[(i + 1) % ring.length]!, kind: 'border' as const })),
      };
    }),
    subfaces: [
      { polygon: mirror(rect(0, 10)), faces_top_to_bottom: [0] },
      { polygon: mirror(rect(10, 20)), faces_top_to_bottom: side === 'front' ? [...stack] : [...stack].reverse() },
    ],
    aux_lines: [],
    sheet_points: SHEET_POINTS,
  };
}
