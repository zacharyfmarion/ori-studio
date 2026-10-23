/** Vector counterpart of per-overlap layer protection (research export only). */
import type { Vec3 } from '@treemaker/origami-simulator';
import type { CameraPaintPiece } from './cameraSpreadVisibility';
import { cameraLayerCovers, type CameraLayerRelations } from './cameraSpreadRelations';

type Point = [number, number];
type Bounds = [number, number, number, number];
interface Cover {
  bounds: Bounds;
  planes: Array<(p: Vec3) => number>;
  rank: number;
  face: number;
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
  const project = (p: Vec3): Point => {
    const [x, y, w] = homogeneous(p);
    return [x / w, y / w];
  };
  const covers: Cover[] = [];
  const visible: CameraPaintPiece[] = [];
  for (const piece of [...pieces].reverse()) {
    const projected = piece.points.map(project);
    const box = bounds(projected);
    let fragments = [piece.points];
    for (const cover of covers) {
      // Fill and outline may share one item. Neither hides its own ink.
      if (!cameraLayerCovers(relations, cover, piece, back) || !overlaps(box, cover.bounds)) continue;
      const outside: Vec3[][] = [];
      for (const fragment of fragments) {
        let inside = fragment;
        for (const plane of cover.planes) {
          const [pos, neg] = split(inside, plane, piece.kind === 'line');
          if (neg.length >= (piece.kind === 'line' ? 2 : 3)) outside.push(neg);
          inside = pos;
          if (!inside.length) break;
        }
      }
      fragments = outside;
      if (!fragments.length) break;
      if (fragments.length + visible.length > 50000)
        throw new Error('Experimental camera vector masking exceeds its 50,000-fragment budget');
    }
    for (const points of fragments) {
      if (piece.kind === 'line') {
        const a = project(points[0]!),
          b = project(points[1]!);
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-10) continue;
      }
      visible.push({ ...piece, points });
    }
    if (piece.kind !== 'face') continue;
    const [a, b, c] = projected as [Point, Point, Point];
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-14) continue;
    const sign = Math.sign(area);
    covers.push({
      bounds: box,
      rank: piece.rank,
      face: piece.face,
      planes: projected.map((a, i) => {
        const b = projected[(i + 1) % 3]!;
        const dx = b[0] - a[0],
          dy = b[1] - a[1];
        return (p: Vec3) => {
          const [x, y, w] = homogeneous(p);
          return sign * (dx * (y - a[1] * w) - dy * (x - a[0] * w));
        };
      }),
    });
  }
  return visible.sort((a, b) => a.rank - b.rank);
}
