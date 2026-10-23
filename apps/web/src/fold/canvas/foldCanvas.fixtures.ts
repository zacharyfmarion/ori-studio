/**
 * Small scenes the Fold canvas's tests read, written out by hand in the
 * engine's shapes (`foldEngineWire`): a flat square, and the square folded in
 * half like a book — its right half valley-folded over its left. Face ids
 * deliberately differ from scene indices, as they do after a split.
 */
import type { Point } from '../../lib/geometry';
import type { FoldIsometry, FoldLandmarks, FoldScene, FoldSceneCrease } from '../engine/foldEngineWire';

const IDENTITY: FoldIsometry = [1, 0, 0, 0, 1, 0];
/** x ↦ 1 − x: the right half laid over the left. */
const MIRROR_HALF: FoldIsometry = [-1, 0, 1, 0, 1, 0];

const p = (x: number, y: number): Point => ({ x, y });

function crease(
  id: number,
  vertices: [number, number],
  from: Point,
  to: Point,
  kind: FoldSceneCrease['kind'],
  letter: FoldSceneCrease['letter'] = null,
  madeAt = 0
): FoldSceneCrease {
  return { id, vertices, from, to, kind, letter, made_at: madeAt };
}

const ring = (points: Point[]) =>
  points.map((from, k) => ({ from, to: points[(k + 1) % points.length]!, kind: 'border' as const }));

export function flatSquareScene(): FoldScene {
  const corners = [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];
  return {
    schema_version: 3,
    flipped: false,
    sheet: 1,
    faces: [{ outline: corners, points: [0, 1, 2, 3], front_up: true, edges: ring(corners) }],
    subfaces: [{ polygon: corners, faces_top_to_bottom: [0] }],
    aux_lines: [],
    sheet_points: corners,
    fold_schema: 1,
    view: { flipped: false, rotation: 0 },
    view_transform: IDENTITY,
    face_transforms: [IDENTITY],
    creases: [
      crease(0, [0, 1], corners[0]!, corners[1]!, 'border'),
      crease(1, [1, 2], corners[1]!, corners[2]!, 'border'),
      crease(2, [2, 3], corners[2]!, corners[3]!, 'border'),
      crease(3, [3, 0], corners[3]!, corners[0]!, 'border'),
    ],
    lineage: [{ id: 0, parent: null, born: 0 }],
  };
}

/** The book: face id 1 the left half where it lies, face id 2 the right half over it, mirrored. */
export function bookScene(): FoldScene {
  const sheet = [p(0, 0), p(0.5, 0), p(1, 0), p(1, 1), p(0.5, 1), p(0, 1)];
  const left = [p(0, 0), p(0.5, 0), p(0.5, 1), p(0, 1)];
  const right = [p(0.5, 0), p(0, 0), p(0, 1), p(0.5, 1)];
  return {
    schema_version: 3,
    flipped: false,
    sheet: 1,
    faces: [
      { outline: left, points: [0, 1, 4, 5], front_up: true, edges: ring(left) },
      { outline: right, points: [1, 2, 3, 4], front_up: false, edges: ring(right) },
    ],
    subfaces: [{ polygon: left, faces_top_to_bottom: [1, 0] }],
    aux_lines: [],
    sheet_points: sheet,
    fold_schema: 1,
    view: { flipped: false, rotation: 0 },
    view_transform: IDENTITY,
    face_transforms: [IDENTITY, MIRROR_HALF],
    creases: [
      crease(0, [0, 1], sheet[0]!, sheet[1]!, 'border'),
      crease(1, [1, 2], sheet[1]!, sheet[2]!, 'border'),
      crease(2, [2, 3], sheet[2]!, sheet[3]!, 'border'),
      crease(3, [3, 4], sheet[3]!, sheet[4]!, 'border'),
      crease(4, [4, 5], sheet[4]!, sheet[5]!, 'border'),
      crease(5, [5, 0], sheet[5]!, sheet[0]!, 'border'),
      crease(6, [1, 4], sheet[1]!, sheet[4]!, 'fold', 'valley', 1),
    ],
    lineage: [
      { id: 1, parent: 0, born: 1 },
      { id: 2, parent: 0, born: 1 },
    ],
  };
}

/** The flat square's landmarks, as the engine names them: its corners and its edges. */
export function flatSquareLandmarks(): FoldLandmarks {
  const corners: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  return {
    points: corners.map((at, vertex) => ({
      at,
      sources: [{ kind: 'vertex', vertex, sheet: at, visible: true }],
      visible: true,
    })),
    lines: corners.map((_, k) => ({ line: { n: [0, 1], d: 0 }, segments: [k], visible: true })),
    segments: corners.map((a, k) => {
      const b = corners[(k + 1) % 4]!;
      return { edge: k, kind: 'raw_edge', sheet: { a, b }, at: [a, b], line: k, visible: [[0, 1]] };
    }),
  };
}
