/**
 * Small Fold scenes for the sequence chrome's tests, in the bridge's shape
 * (`FoldScene`): the flat unit square, and the square folded in half along its
 * bottom-left to top-right diagonal, the top-left half valley-folded onto the
 * bottom-right.
 */
import type { FoldIsometry, FoldScene, FoldSceneCrease } from '../engine/foldEngineWire';

const IDENTITY: FoldIsometry = [1, 0, 0, 0, 1, 0];

/** Reflection across `y = x`: where the folded half lands. */
const ACROSS_DIAGONAL: FoldIsometry = [0, 1, 0, 1, 0, 0];

const point = ([x, y]: readonly [number, number]) => ({ x, y });

function crease(id: number, from: [number, number], to: [number, number], rest: Partial<FoldSceneCrease> = {}): FoldSceneCrease {
  return { id, vertices: [0, 0], from: point(from), to: point(to), kind: 'border', letter: null, made_at: 0, ...rest };
}

const CORNERS: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/** The flat unit square, front up: one face, its four borders. */
export function squareScene(): FoldScene {
  const ring = CORNERS.map(point);
  return {
    schema_version: 3,
    flipped: false,
    sheet: 1,
    faces: [
      {
        outline: ring,
        points: [0, 1, 2, 3],
        front_up: true,
        edges: ring.map((from, k) => ({ from, to: ring[(k + 1) % 4]!, kind: 'border' as const })),
      },
    ],
    subfaces: [{ polygon: ring, faces_top_to_bottom: [0] }],
    aux_lines: [],
    sheet_points: ring,
    fold_schema: 1,
    view: { flipped: false, rotation: 0 },
    view_transform: IDENTITY,
    face_transforms: [IDENTITY],
    creases: [
      crease(0, [0, 0], [1, 0]),
      crease(1, [1, 0], [1, 1]),
      crease(2, [1, 1], [0, 1]),
      crease(3, [0, 1], [0, 0]),
    ],
    lineage: [{ id: 0, parent: null, born: 0 }],
  };
}

/**
 * The square folded in half along the diagonal from the bottom-left corner to
 * the top-right: the top-left half, valley-folded, lies over the bottom-right.
 */
export function diagonalHalfScene(): FoldScene {
  const stays = [point([0, 0]), point([1, 0]), point([1, 1])];
  // The top-left half's image, counter-clockwise: (0,0), (1,0) — where (0,1) lands — and (1,1).
  const lands = [point([0, 0]), point([1, 0]), point([1, 1])];
  return {
    schema_version: 3,
    flipped: false,
    sheet: 1,
    faces: [
      {
        outline: stays,
        points: [0, 1, 2],
        front_up: true,
        edges: [
          { from: stays[0]!, to: stays[1]!, kind: 'border' },
          { from: stays[1]!, to: stays[2]!, kind: 'border' },
          { from: stays[2]!, to: stays[0]!, kind: 'fold' },
        ],
      },
      {
        outline: lands,
        points: [0, 3, 2],
        front_up: false,
        edges: [
          { from: lands[0]!, to: lands[1]!, kind: 'border' },
          { from: lands[1]!, to: lands[2]!, kind: 'border' },
          { from: lands[2]!, to: lands[0]!, kind: 'fold' },
        ],
      },
    ],
    subfaces: [{ polygon: stays, faces_top_to_bottom: [1, 0] }],
    aux_lines: [],
    sheet_points: CORNERS.map(point),
    fold_schema: 1,
    view: { flipped: false, rotation: 0 },
    view_transform: IDENTITY,
    face_transforms: [IDENTITY, ACROSS_DIAGONAL],
    creases: [
      crease(0, [0, 0], [1, 0]),
      crease(1, [1, 0], [1, 1]),
      crease(2, [1, 1], [0, 1]),
      crease(3, [0, 1], [0, 0]),
      crease(4, [0, 0], [1, 1], { kind: 'fold', letter: 'valley', made_at: 1 }),
    ],
    lineage: [
      { id: 0, parent: null, born: 0 },
      { id: 1, parent: 0, born: 1 },
    ],
  };
}
