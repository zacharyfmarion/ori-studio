/** Vector counterpart of per-overlap layer protection with spatially indexed candidate coverage. */
import type { Vec3 } from '@treemaker/origami-simulator';
import type { CameraPaintPiece } from './cameraSpreadVisibility';
import { cameraLayerCovers, type CameraLayerRelations } from './cameraSpreadRelations';

type Point = [number, number];
type Bounds = [number, number, number, number];
interface Cover {
  bounds: Bounds;
  planes: Array<(p: Vec3) => number>;
  inkPlanes: Array<(p: Vec3) => number>;
  rank: number;
  face: number;
  piece: CameraPaintPiece;
}
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => a.map((v, i) => v + t * (b[i]! - v)) as Vec3;

function bounds(points: Point[]): Bounds {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
function overlaps(a: Bounds, b: Bounds): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
function split(points: Vec3[], side: (p: Vec3) => number, line: boolean): [Vec3[], Vec3[]] {
  const positive: Vec3[] = [],
    negative: Vec3[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      da = side(a);
    (da >= 0 ? positive : negative).push(a);
    if (line && i === points.length - 1) break;
    const b = points[(i + 1) % points.length]!,
      db = side(b);
    if (da >= 0 !== db >= 0) {
      const p = lerp(a, b, da / (da - db));
      positive.push(p);
      negative.push(p);
    }
  }
  return [positive, negative];
}

/**
 * Remove authoritative coverage within one facing group before geometric depth
 * compares the surviving unrelated and opposite-facing surfaces. Clips in homogeneous screen
 * coordinates, so intersections interpolate correctly in perspective too.
 * Unrelated surfaces survive to the depth comparison, regardless of paint rank.
 */
export function maskCameraPaintGroup(
  pieces: CameraPaintPiece[],
  homogeneous: (p: Vec3) => Vec3,
  relations: CameraLayerRelations,
  back: boolean
): CameraPaintPiece[] {
  return maskPieces(pieces, homogeneous, (cover, piece) =>
    cameraLayerCovers(relations, cover, piece, back) ? [] : null
  );
}

/** After layer protection, geometric depth resolves the surviving overlaps. */
export function maskCameraDepth(
  pieces: CameraPaintPiece[],
  homogeneous: (p: Vec3) => Vec3,
  clipDepth: (p: Vec3) => number
): CameraPaintPiece[] {
  const planes = new WeakMap<CameraPaintPiece, (p: Vec3) => number>();
  return maskPieces(
    pieces,
    homogeneous,
    (cover, piece) => {
      if (cover.face === piece.face) return null;
      let plane = planes.get(cover.piece);
      if (!plane) {
        // Recover three non-collinear points on the original source plane.
        // Clipped polygons can begin with collinear points, so do not use those.
        const normal = cover.piece.plane;
        const axis = [0, 1, 2].sort((a, b) => Math.abs(normal[b]!) - Math.abs(normal[a]!))[0]!;
        if (Math.abs(normal[axis]!) < 1e-16) return null;
        const others = [0, 1, 2].filter((i) => i !== axis);
        const source = [
          [0, 0],
          [1, 0],
          [0, 1],
        ].map(([u, v]) => {
          const p: Vec3 = [0, 0, 0];
          p[others[0]!] = u!;
          p[others[1]!] = v!;
          p[axis] = -(normal[3] + normal[others[0]!]! * u! + normal[others[1]!]! * v!) / normal[axis]!;
          const [x, y, w] = homogeneous(p);
          return [x / w, y / w, clipDepth(p) / w];
        });
        const [p, q, r] = source as [number[], number[], number[]];
        const dx = q[0]! - p[0]!,
          dy = q[1]! - p[1]!,
          ex = r[0]! - p[0]!,
          ey = r[1]! - p[1]!;
        const det = dx * ey - dy * ex;
        if (Math.abs(det) < 1e-16) return null;
        const a = ((q[2]! - p[2]!) * ey - (r[2]! - p[2]!) * dy) / det;
        const b = (dx * (r[2]! - p[2]!) - ex * (q[2]! - p[2]!)) / det;
        const c = p[2]! - a * p[0]! - b * p[1]!;
        plane = (point) => {
          const [x, y, w] = homogeneous(point);
          return clipDepth(point) - a * x - b * y - c * w;
        };
        planes.set(cover.piece, plane);
      }
      // The GPU lifts ink by this NDC depth bias to prevent a near-coplanar
      // face from burying a crease. Use the same bias in vector exports.
      const surfacePlane = plane;
      const behind = (p: Vec3) => surfacePlane(p) - (piece.kind === 'line' ? 0.00005 * homogeneous(p)[2] : 0);
      const depths = piece.points.map(behind);
      if (depths.every((v) => Math.abs(v) < 1e-10)) return cover.rank > piece.rank ? [] : null;
      if (depths.every((v) => v <= 1e-10)) return null;
      return [behind];
    },
    true
  );
}

/** Uniform grid bounds the candidate search; all clipping stays in source space. */
function maskPieces(
  pieces: CameraPaintPiece[],
  homogeneous: (p: Vec3) => Vec3,
  occludes: (cover: Cover, piece: CameraPaintPiece) => Array<(p: Vec3) => number> | null,
  preserveBoundaryInk = false
): CameraPaintPiece[] {
  const project = (p: Vec3): Point => {
    const [x, y, w] = homogeneous(p);
    return [x / w, y / w];
  };
  const projected = pieces.map((piece) => piece.points.map(project));
  const boxes = projected.map(bounds);
  const extent: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    extent[0] = Math.min(extent[0], box[0]);
    extent[1] = Math.min(extent[1], box[1]);
    extent[2] = Math.max(extent[2], box[2]);
    extent[3] = Math.max(extent[3], box[3]);
  }
  const gridSize = Math.max(1, Math.min(128, Math.ceil(Math.sqrt(pieces.length / 8))));
  const cells = Array.from({ length: gridSize * gridSize }, () => [] as Cover[]);
  const cellRange = (box: Bounds) =>
    box.map((v, i) =>
      Math.max(
        0,
        Math.min(
          gridSize - 1,
          Math.floor(((v - extent[i % 2]!) / Math.max(1e-12, extent[(i % 2) + 2]! - extent[i % 2]!)) * gridSize)
        )
      )
    ) as Bounds;
  for (let at = 0; at < pieces.length; at++) {
    const piece = pieces[at]!;
    if (piece.kind !== 'face') continue;
    const points = projected[at]!;
    const area = points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length]!;
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0);
    if (Math.abs(area) < 1e-14) continue;
    const sign = Math.sign(area);
    const edgePlanes = (inset: number) =>
      points.map((a, i) => {
        const b = points[(i + 1) % points.length]!;
        const dx = b[0] - a[0],
          dy = b[1] - a[1];
        const offset = inset * Math.hypot(dx, dy);
        return (p: Vec3) => {
          const [x, y, w] = homogeneous(p);
          return sign * (dx * (y - a[1] * w) - dy * (x - a[0] * w)) - offset * w;
        };
      });
    const cover: Cover = {
      bounds: boxes[at]!,
      rank: piece.rank,
      face: piece.face,
      piece,
      planes: edgePlanes(0),
      // A stroke on a geometric occluder's exact boundary remains partly
      // exposed in the GPU's finite-width ribbon. Do not erase its centreline
      // because roundoff puts it an ulp inside a clipped triangle. Authored
      // stack protection still includes boundaries, so buried ink stays hidden.
      inkPlanes: edgePlanes(preserveBoundaryInk ? 1e-10 : 0),
    };
    const [x0, y0, x1, y1] = cellRange(cover.bounds);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[y * gridSize + x]!.push(cover);
  }
  const visible: CameraPaintPiece[] = [];
  let work = 0;
  for (let at = 0; at < pieces.length; at++) {
    const piece = pieces[at]!;
    const box = boxes[at]!;
    const [x0, y0, x1, y1] = cellRange(box);
    const candidates = new Set<Cover>();
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) for (const cover of cells[y * gridSize + x]!) candidates.add(cover);
    let fragments = [piece.points];
    for (const cover of candidates) {
      if (!overlaps(box, cover.bounds)) continue;
      const extraPlanes = occludes(cover, piece);
      if (extraPlanes === null) continue;
      const outside: Vec3[][] = [];
      const planes = [...(piece.kind === 'line' ? cover.inkPlanes : cover.planes), ...extraPlanes];
      for (const fragment of fragments) {
        // A disjoint polygon must stay whole. Cutting it by every supporting
        // line before discovering the disjoint edge creates artificial pieces
        // that each later cover cuts again (especially dense crease grids).
        if (planes.some((plane) => fragment.every((point) => plane(point) < 0))) {
          outside.push(fragment);
          continue;
        }
        let inside = fragment;
        for (const plane of planes) {
          if (++work > 30_000_000) throw new Error('Camera vector capture exceeds its clipping work budget');
          const [pos, neg] = split(inside, plane, piece.kind === 'line');
          if (neg.length >= (piece.kind === 'line' ? 2 : 3)) outside.push(neg);
          inside = pos;
          if (!inside.length) break;
        }
      }
      fragments = outside;
      if (!fragments.length) break;
      if (fragments.length + visible.length > 250_000)
        throw new Error('Camera vector capture exceeds its fragment budget');
    }
    for (const points of fragments) {
      if (piece.kind === 'line') {
        const a = project(points[0]!),
          b = project(points[1]!);
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-10) continue;
      }
      visible.push({ ...piece, points });
    }
  }
  return visible.sort((a, b) => a.rank - b.rank);
}
