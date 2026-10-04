/**
 * Layers stepped apart by depth: the flat folded picture with each layer
 * beneath the nearest moved a little further in one direction on the screen,
 * so the edges a stack hides peek out (Phase 13 of the diagram workspace,
 * `implementation-plans/diagram-distortion.md`). It is Akitaya's depth shift,
 * `D(v) = V(v) + p · z(v) / z_max · d`, which the *Affine Distortions* paper
 * (Morisue) sets aside. It is a choice about the picture: the fold and its
 * layer order are what the kernel said, and the painter's order that
 * `foldedFlatPaperScene` draws in is not touched.
 *
 * # Depth is the layer count from the viewer
 *
 * A face's level is the longest chain of faces stacked over it as seen,
 * read from consecutive pairs of every subface's stack: a face nothing lies
 * on is 0 and every layer is one below the one on it, so symmetric parts of a
 * model step alike. A woven component has no such chain, so there the painter's
 * order decides: a pair whose upper face is not drawn after its lower one is
 * the pair that order broke, and is left out.
 *
 * # Vertices keep creases joined
 *
 * A sheet vertex steps by the mean level of the faces round it — the faces
 * whose outline names it (`OristudioCpFoldedPaperFace.points`) — so the two
 * faces of a crease move its ends alike and the crease kinks between their
 * depths, while the corners a fold lays on one place part. A point inside a
 * face, or along its edge, moves by mean value coordinates over the face's
 * vertex steps: linear along each edge, so a line ending on a crease stays on
 * it. A face whose outline the kernel could not name steps whole, by its own
 * level.
 *
 * # In scene px, on the screen
 *
 * The direction is a diagram convention — "the peeking edges are the layers
 * beneath" — so it is taken on the screen, after the pose's turn and side,
 * and a step is a vector in scene px added to the turned point. Its length is
 * a fraction of the model: the longest side of the folded faces' bounds in
 * the kernel's units, before any turn, so rotating does not change it.
 *
 * Pure.
 */

import type {
  OristudioCpFoldedPaperScene,
  OristudioCpFoldedPaperSubface,
} from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import type { ScenePoint } from '../../lib/paper/paperScene';

/** Where deeper layers step to, on the screen. */
export type SpreadDirection =
  | 'up-left'
  | 'up'
  | 'up-right'
  | 'right'
  | 'down-right'
  | 'down'
  | 'down-left'
  | 'left';

export const SPREAD_DIRECTIONS: readonly SpreadDirection[] = [
  'up-left',
  'up',
  'up-right',
  'right',
  'down-right',
  'down',
  'down-left',
  'left',
];

/** A step's spread: how far the deepest layer moves, and which way. */
export interface LayerSpreadOptions {
  /** The deepest layer's step as a fraction of the model's size. */
  amount: number;
  toward: SpreadDirection;
}

/** The spread of one picture. */
export interface LayerSpread {
  /** Per face, the longest chain of faces over it as seen: 0 for a face nothing lies on. */
  readonly levels: Int32Array;
  /** The deepest level; 0 when nothing is stacked, and then nothing moves. */
  readonly zMax: number;
  /**
   * The step, in scene px, of a point on a face — given in the kernel's
   * coordinates, as the face's outline is — to add to where the picture
   * places it.
   */
  offset(face: number, point: Point): ScenePoint;
}

const DIAGONAL = Math.SQRT1_2;

/** The unit step toward a direction, in scene px (y grows down the screen). */
export function spreadUnit(toward: SpreadDirection): ScenePoint {
  switch (toward) {
    case 'up-left':
      return [-DIAGONAL, -DIAGONAL];
    case 'up':
      return [0, -1];
    case 'up-right':
      return [DIAGONAL, -DIAGONAL];
    case 'right':
      return [1, 0];
    case 'down-right':
      return [DIAGONAL, DIAGONAL];
    case 'down':
      return [0, 1];
    case 'down-left':
      return [-DIAGONAL, DIAGONAL];
    case 'left':
      return [-1, 0];
  }
}

/** What a spread needs of the picture besides the kernel's scene. */
export interface LayerSpreadFrame {
  /** Scene px per kernel unit. */
  scale: number;
  /** Within this of a corner or an edge a point is on it, in kernel units (`foldedSceneEpsilon`). */
  epsilon: number;
}

/**
 * The spread of a kernel scene drawn in `order` — the faces back to front, as
 * `foldedFlatPaperScene` paints them.
 */
export function layerSpread(
  kernel: OristudioCpFoldedPaperScene,
  order: readonly number[],
  { amount, toward }: LayerSpreadOptions,
  { scale, epsilon }: LayerSpreadFrame
): LayerSpread {
  const { levels, zMax } = layerLevels(kernel.faces.length, kernel.subfaces, order);
  if (zMax === 0) return { levels, zMax, offset: () => [0, 0] };
  const [ux, uy] = spreadUnit(toward);
  const reach = (amount * foldedModelSize(kernel) * scale) / zMax;
  const step = (level: number): ScenePoint => [reach * level * ux, reach * level * uy];
  const isNamed = namedFaces(kernel);
  const vertexLevel = meanVertexLevels(kernel, levels, isNamed);
  const offset = (face: number, point: Point): ScenePoint => {
    const source = kernel.faces[face];
    if (!source) return [0, 0];
    if (!isNamed[face]) return step(levels[face]!);
    const weights = meanValueWeights(source.outline, point, epsilon);
    let level = 0;
    if (weights) {
      weights.forEach((weight, corner) => {
        level += weight * vertexLevel[source.points[corner]!]!;
      });
    } else {
      // A ring with no inside to speak of: its corners' mean.
      for (const vertex of source.points) level += vertexLevel[vertex]!;
      level /= source.points.length;
    }
    return step(level);
  };
  return { levels, zMax, offset };
}

/**
 * Per face, the longest chain of faces stacked over it as seen, and the
 * deepest of those. A pair whose upper face is not later in `order` than its
 * lower one is the pair a woven component's order broke, and is left out —
 * which leaves every pair pointing forward in `order`, so one pass from the
 * front settles each face after everything over it. Exported for the tests.
 */
export function layerLevels(
  faceCount: number,
  subfaces: readonly OristudioCpFoldedPaperSubface[],
  order: readonly number[]
): { levels: Int32Array; zMax: number } {
  const position = new Int32Array(faceCount).fill(-1);
  order.forEach((face, at) => {
    if (face >= 0 && face < faceCount) position[face] = at;
  });
  const over: number[][] = Array.from({ length: faceCount }, () => []);
  for (const { faces_top_to_bottom: stack } of subfaces) {
    for (let i = 0; i + 1 < stack.length; i += 1) {
      const upper = stack[i]!;
      const lower = stack[i + 1]!;
      if (upper >= faceCount || lower >= faceCount) continue;
      if (position[lower]! < 0 || position[upper]! <= position[lower]!) continue;
      over[lower]!.push(upper);
    }
  }
  const levels = new Int32Array(faceCount);
  let zMax = 0;
  for (let at = order.length - 1; at >= 0; at -= 1) {
    const face = order[at]!;
    if (face < 0 || face >= faceCount) continue;
    let level = 0;
    for (const upper of over[face]!) level = Math.max(level, levels[upper]! + 1);
    levels[face] = level;
    zMax = Math.max(zMax, level);
  }
  return { levels, zMax };
}

/**
 * Per face, whether its outline is named point for point (schema 2), so its
 * corners step by their vertices; a face that is not steps whole.
 */
function namedFaces(kernel: OristudioCpFoldedPaperScene): boolean[] {
  return kernel.faces.map(
    ({ points, outline }) =>
      points.length > 0 &&
      points.length === outline.length &&
      points.every((vertex) => Number.isInteger(vertex) && vertex >= 0)
  );
}

/**
 * Per wireframe point, the mean level of the named faces whose outline names
 * it; 0 for a point none names. A face names a point once, however its ring
 * runs.
 */
function meanVertexLevels(
  kernel: OristudioCpFoldedPaperScene,
  levels: Int32Array,
  isNamed: readonly boolean[]
): Float64Array {
  let count = 0;
  kernel.faces.forEach(({ points }, face) => {
    if (isNamed[face]) for (const vertex of points) count = Math.max(count, vertex + 1);
  });
  const sum = new Float64Array(count);
  const faces = new Int32Array(count);
  kernel.faces.forEach(({ points }, face) => {
    if (!isNamed[face]) return;
    for (const vertex of new Set(points)) {
      sum[vertex] += levels[face]!;
      faces[vertex] += 1;
    }
  });
  return sum.map((total, vertex) => (faces[vertex]! > 0 ? total / faces[vertex]! : 0));
}

/**
 * The model's size, for the amount: the longest side of the folded faces'
 * bounds in the kernel's units — the picture before the pose turns it. Zero
 * for a scene with no outline.
 */
export function foldedModelSize(kernel: Pick<OristudioCpFoldedPaperScene, 'faces'>): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { outline } of kernel.faces) {
    for (const { x, y } of outline) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return minX === Infinity ? 0 : Math.max(maxX - minX, maxY - minY);
}

/**
 * Mean value coordinates of `point` over `ring` (Floater 2003; Hormann and
 * Floater 2006 for any simple polygon, convex or not): weights that sum to 1
 * and reproduce linear functions. Within `epsilon` of a corner the weight is
 * all that corner's — the nearest one's — and within `epsilon` of an edge it
 * is shared linearly between the edge's ends, where the formula itself is
 * 0/0. Null for a ring whose weights do not add up to anything: no points, or
 * a ring with no area seen from the point. Exported for the tests.
 */
export function meanValueWeights(
  ring: readonly Point[],
  point: Point,
  epsilon: number
): number[] | null {
  const n = ring.length;
  if (n === 0) return null;
  const weights = new Array<number>(n).fill(0);
  const sx = ring.map((corner) => corner.x - point.x);
  const sy = ring.map((corner) => corner.y - point.y);
  const r = sx.map((x, i) => Math.hypot(x, sy[i]!));

  let nearest = -1;
  for (let i = 0; i < n; i += 1) {
    if (r[i]! <= epsilon && (nearest < 0 || r[i]! < r[nearest]!)) nearest = i;
  }
  if (nearest >= 0) {
    weights[nearest] = 1;
    return weights;
  }

  // tan(αᵢ / 2) of the angle the edge i → i + 1 spans from the point, signed.
  const tanHalf = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const cross = sx[i]! * sy[j]! - sy[i]! * sx[j]!;
    const dot = sx[i]! * sx[j]! + sy[i]! * sy[j]!;
    const length = Math.hypot(sx[j]! - sx[i]!, sy[j]! - sy[i]!);
    if (dot < 0 && Math.abs(cross) <= epsilon * length) {
      // On the edge: its ends share the weight by distance.
      weights[i] = r[j]! / (r[i]! + r[j]!);
      weights[j] = r[i]! / (r[i]! + r[j]!);
      return weights;
    }
    tanHalf[i] = cross / (r[i]! * r[j]! + dot);
  }
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const weight = (tanHalf[(i + n - 1) % n]! + tanHalf[i]!) / r[i]!;
    weights[i] = weight;
    total += weight;
  }
  if (!Number.isFinite(total) || Math.abs(total) < Number.EPSILON) return null;
  return weights.map((weight) => weight / total);
}
