import type { DiagramPaperProjection } from '../document/diagramDocument';
import type { ScenePoint } from '../../lib/paper/paperScene';

const indexed = new WeakMap<DiagramPaperProjection, Map<number, number[][]>>();

/** Map an anchor on its own face, including faces currently hidden by clipping. */
export function projectPaperAnchor(
  projection: DiagramPaperProjection,
  face: number,
  point: ScenePoint,
  inverse = false
): ScenePoint | null {
  let faces = indexed.get(projection);
  if (!faces) {
    faces = new Map();
    for (const [face, a, b, c] of projection.triangles) {
      let list = faces.get(face);
      if (!list) {
        list = [];
        faces.set(face, list);
      }
      list.push([a, b, c]);
    }
    indexed.set(projection, faces);
  }
  const offset = inverse ? 2 : 0;
  let nearest: { ids: number[]; weights: number[]; outside: number } | null = null;
  for (const ids of faces.get(face) ?? []) {
    const a = projection.points[ids[0]!]!,
      b = projection.points[ids[1]!]!,
      c = projection.points[ids[2]!]!;
    const ax = a[offset]!,
      ay = a[offset + 1]!,
      bx = b[offset]!,
      by = b[offset + 1]!,
      cx = c[offset]!,
      cy = c[offset + 1]!;
    const determinant = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(determinant) < 1e-16) continue;
    const u = ((by - cy) * (point[0] - cx) + (cx - bx) * (point[1] - cy)) / determinant;
    const v = ((cy - ay) * (point[0] - cx) + (ax - cx) * (point[1] - cy)) / determinant;
    const weights = [u, v, 1 - u - v];
    const outside = -Math.min(...weights, 0);
    if (!nearest || outside < nearest.outside) nearest = { ids, weights, outside };
    if (outside < 1e-9) break;
  }
  if (!nearest) return null;
  const weights = nearest.weights.map((w, i) => {
    const denominator = projection.points[nearest!.ids[i]!]![4];
    return inverse ? w / denominator : w * denominator;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (Math.abs(total) < 1e-14) return null;
  const target = inverse ? 0 : 2;
  return [0, 1].map(
    (axis) => weights.reduce((sum, w, i) => sum + w * projection.points[nearest!.ids[i]!]![target + axis]!, 0) / total
  ) as ScenePoint;
}
