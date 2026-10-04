// Which crease-pattern faces of a drawn model lie under a point or a rectangle.
//
// Everything here projects through `projectVertices`, the vertex shader's own
// matrix (reflection included) applied on the CPU, so a pick answers for the
// picture on screen rather than for a second transcription of it. Depth is
// interpolated linearly across the screen, which is what the GPU does too: the
// vertex shader writes `w = 1` with a depth linear in view space.
//
// Faces are the source faces of the crease pattern — triangles joined across
// the triangulation's diagonals (`sourceFaceGroups`) — and are named by their
// group id.
import { projectVertices, type CameraUniforms } from './webgl/camera.js';

export interface PickTopology {
  /** Triangles, three vertex indices each. */
  indices: Uint32Array;
  /** The source face each triangle belongs to (`sourceFaceGroups`). */
  faceGroups: Int32Array;
}

/** A rectangle in drawing-buffer pixels, top-left origin. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface PickOptions {
  /**
   * Whether the picture was drawn with the perspective divide. The GPU path
   * draws in perspective; the canvas-2D fallback is orthographic, and a pick
   * has to project the way the screen it answers for did.
   */
  perspective: boolean;
}

/**
 * Every face whose projected centre lies inside `rect`, at any depth.
 *
 * The centre is the face's area-weighted centroid in 3D, projected — so a big
 * face that only passes under the rectangle is not picked, while every layer of
 * a stacked flap centred inside it is, hidden ones included.
 */
export function facesWithCentreIn(
  positions: Float32Array,
  topology: PickTopology,
  camera: CameraUniforms,
  rect: ScreenRect,
  options: PickOptions
): number[] {
  const centres = faceCentroids(positions, topology);
  const projected = projectVertices(centres.points, camera, { perspective: options.perspective });
  const picked: number[] = [];
  for (let i = 0; i < centres.faces.length; i += 1) {
    const x = projected.screen[i * 2]!;
    const y = projected.screen[i * 2 + 1]!;
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) picked.push(centres.faces[i]!);
  }
  return picked;
}

/**
 * Every face with a visible part inside `rect`: a depth buffer over the
 * rectangle, sampled once per `sampleStep` pixels at sample centres.
 *
 * Sample at screen resolution. Coarser sampling misses the slivers a folded
 * model is full of (a 256×256 cap found 434 of the 808 faces full resolution
 * finds on a dense model). Ties go to the later triangle, as the GPU's `LEQUAL`
 * depth test does — coincident layers of a flat-folded model are ambiguous
 * either way, exactly as the display z-fights between them.
 */
export function facesVisibleIn(
  positions: Float32Array,
  topology: PickTopology,
  camera: CameraUniforms,
  rect: ScreenRect,
  options: PickOptions & { sampleStep: number }
): number[] {
  const step = Math.max(1e-6, options.sampleStep);
  const columns = Math.max(1, Math.floor((rect.right - rect.left) / step));
  const rows = Math.max(1, Math.floor((rect.bottom - rect.top) / step));
  const winners = rasterizeFrontmost(positions, topology, camera, options, {
    originX: rect.left,
    originY: rect.top,
    step,
    columns,
    rows,
  });
  const picked = new Set<number>();
  for (const face of winners) if (face >= 0) picked.add(face);
  return [...picked];
}

/** The face drawn frontmost at `point`, or null where the model is not. */
export function frontmostFaceAt(
  positions: Float32Array,
  topology: PickTopology,
  camera: CameraUniforms,
  point: ScreenPoint,
  options: PickOptions
): number | null {
  const [face] = rasterizeFrontmost(positions, topology, camera, options, {
    // One sample, centred on the point.
    originX: point.x - 0.5,
    originY: point.y - 0.5,
    step: 1,
    columns: 1,
    rows: 1,
  });
  return face !== undefined && face >= 0 ? face : null;
}

/**
 * Scale a rectangle between two pixel spaces of the same picture — a drag
 * measured in CSS pixels to the drawing buffer the camera is sized in — and
 * normalise it, so a drag up and to the left gives the same rectangle as one
 * down and to the right.
 */
export function scaleRect(
  rect: ScreenRect,
  from: { width: number; height: number },
  to: { width: number; height: number }
): ScreenRect {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return {
    left: Math.min(rect.left, rect.right) * sx,
    right: Math.max(rect.left, rect.right) * sx,
    top: Math.min(rect.top, rect.bottom) * sy,
    bottom: Math.max(rect.top, rect.bottom) * sy,
  };
}

interface SampleGrid {
  originX: number;
  originY: number;
  step: number;
  columns: number;
  rows: number;
}

/**
 * The frontmost face at each sample of `grid`, -1 where nothing is drawn.
 * Samples sit at cell centres, `origin + (i + 0.5) · step`.
 */
function rasterizeFrontmost(
  positions: Float32Array,
  topology: PickTopology,
  camera: CameraUniforms,
  options: PickOptions,
  grid: SampleGrid
): Int32Array {
  const projected = projectVertices(positions, camera, { perspective: options.perspective });
  const screen = projected.screen;
  const view = projected.view;
  const { indices, faceGroups } = topology;
  const depth = new Float32Array(grid.columns * grid.rows).fill(Number.NEGATIVE_INFINITY);
  const winner = new Int32Array(grid.columns * grid.rows).fill(-1);
  const gridRight = grid.originX + grid.columns * grid.step;
  const gridBottom = grid.originY + grid.rows * grid.step;

  for (let t = 0; t < faceGroups.length; t += 1) {
    const a = indices[t * 3]!;
    const b = indices[t * 3 + 1]!;
    const c = indices[t * 3 + 2]!;
    const ax = screen[a * 2]!;
    const ay = screen[a * 2 + 1]!;
    const bx = screen[b * 2]!;
    const by = screen[b * 2 + 1]!;
    const cx = screen[c * 2]!;
    const cy = screen[c * 2 + 1]!;
    const minX = Math.max(grid.originX, Math.min(ax, bx, cx));
    const maxX = Math.min(gridRight, Math.max(ax, bx, cx));
    const minY = Math.max(grid.originY, Math.min(ay, by, cy));
    const maxY = Math.min(gridBottom, Math.max(ay, by, cy));
    if (minX > maxX || minY > maxY) continue;
    const area = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    // A triangle seen edge-on covers no pixel.
    if (Math.abs(area) < 1e-12) continue;
    const za = view[a * 3 + 2]!;
    const zb = view[b * 3 + 2]!;
    const zc = view[c * 3 + 2]!;

    const firstColumn = Math.max(0, Math.floor((minX - grid.originX) / grid.step - 0.5));
    const lastColumn = Math.min(grid.columns - 1, Math.ceil((maxX - grid.originX) / grid.step - 0.5));
    const firstRow = Math.max(0, Math.floor((minY - grid.originY) / grid.step - 0.5));
    const lastRow = Math.min(grid.rows - 1, Math.ceil((maxY - grid.originY) / grid.step - 0.5));
    for (let row = firstRow; row <= lastRow; row += 1) {
      const py = grid.originY + (row + 0.5) * grid.step;
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const px = grid.originX + (column + 0.5) * grid.step;
        const w1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / area;
        const w2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / area;
        const w3 = 1 - w1 - w2;
        if (w1 < 0 || w2 < 0 || w3 < 0) continue;
        // Larger depth is nearer the eye (see `toViewSpace`).
        const z = w1 * za + w2 * zb + w3 * zc;
        const sample = row * grid.columns + column;
        if (z >= depth[sample]!) {
          depth[sample] = z;
          winner[sample] = faceGroups[t]!;
        }
      }
    }
  }
  return winner;
}

/** Each face's area-weighted centroid, as a flat point list beside the face ids. */
function faceCentroids(
  positions: Float32Array,
  topology: PickTopology
): { points: Float32Array; faces: number[] } {
  const sums = new Map<number, [number, number, number, number]>();
  const { indices, faceGroups } = topology;
  for (let t = 0; t < faceGroups.length; t += 1) {
    const a = indices[t * 3]! * 3;
    const b = indices[t * 3 + 1]! * 3;
    const c = indices[t * 3 + 2]! * 3;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    // A degenerate triangle still has a position; weigh it by a sliver so a
    // face made only of slivers keeps one.
    const area = Math.max(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2, 1e-12);
    const sum = sums.get(faceGroups[t]!) ?? [0, 0, 0, 0];
    sum[0] += ((positions[a]! + positions[b]! + positions[c]!) / 3) * area;
    sum[1] += ((positions[a + 1]! + positions[b + 1]! + positions[c + 1]!) / 3) * area;
    sum[2] += ((positions[a + 2]! + positions[b + 2]! + positions[c + 2]!) / 3) * area;
    sum[3] += area;
    sums.set(faceGroups[t]!, sum);
  }
  const points = new Float32Array(sums.size * 3);
  const faces: number[] = [];
  let i = 0;
  for (const [face, [x, y, z, weight]] of sums) {
    points[i * 3] = x / weight;
    points[i * 3 + 1] = y / weight;
    points[i * 3 + 2] = z / weight;
    faces.push(face);
    i += 1;
  }
  return { points, faces };
}
