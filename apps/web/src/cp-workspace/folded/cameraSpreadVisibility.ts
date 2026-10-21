/**
 * Lift the existing diagram paint plan, including its local woven patches.
 * Camera depth is deliberately subordinate to that plan: an approximate height
 * fit must not let a buried face (or its ink) punch through its covering face.
 * The two cached plans reverse the supplied stacks when viewed from below.
 */
import earcut from 'earcut';
import type { Vec3 } from '@treemaker/origami-simulator';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { ScenePoint } from '../../lib/paper/paperScene';
import { foldedFlatPaperScene } from './foldedFlatScene';
import type { CameraSpreadLift } from './cameraSpreadLift';

export interface CameraPaintPiece {
  kind: 'face' | 'line';
  points: Vec3[];
  face: number;
  /** One slot per diagram item, with geometric depth only within a slot. */
  rank: number;
  role?: 'edge' | 'aux';
  patch: boolean;
}
export interface CameraPaintPlan {
  pieces: CameraPaintPiece[];
  slots: number;
}
export interface CameraPaintPlans {
  front: CameraPaintPlan;
  back: CameraPaintPlan;
}
const cache = new WeakMap<CameraSpreadLift, CameraPaintPlans>();
const cross = (a: readonly number[], b: readonly number[], c: readonly number[]) =>
  (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);

/** Clip a convex polygon to a triangle; the output carries interpolated height. */
function clip(polygon: Vec3[], triangle: Vec3[]): Vec3[] {
  const sign = Math.sign(cross(triangle[0]!, triangle[1]!, triangle[2]!));
  let out = polygon;
  for (let i = 0; i < 3 && out.length; i++) {
    const input = out;
    out = [];
    const side = (p: Vec3) => sign * cross(triangle[i]!, triangle[(i + 1) % 3]!, p);
    for (let j = 0; j < input.length; j++) {
      const a = input[j]!;
      const b = input[(j + 1) % input.length]!;
      const da = side(a),
        db = side(b);
      if (da >= 0) out.push(a);
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db);
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), 0]);
      }
    }
  }
  return out;
}

function height(point: Vec3, triangle: Vec3[]): Vec3 {
  const [a, b, c] = triangle as [Vec3, Vec3, Vec3];
  const area = cross(a, b, c);
  const u = cross(b, c, point) / area;
  const v = cross(c, a, point) / area;
  return [point[0], point[1], u * a[2] + v * b[2] + (1 - u - v) * c[2]];
}

/** Split ink wherever the bending mesh changes slope. Never draw patch seams. */
function clipLine(a: Vec3, b: Vec3, triangle: Vec3[]): Vec3[] | null {
  const area = cross(triangle[0]!, triangle[1]!, triangle[2]!);
  if (Math.abs(area) < 1e-18) return null;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 3; i++) {
    const u = triangle[i]!,
      v = triangle[(i + 1) % 3]!;
    // Barycentric tolerance, not an absolute cross-product tolerance: the
    // latter accepts distant ink on near-degenerate triangles and extrapolates
    // its height far outside the mesh (long spikes on real aux-heavy models).
    const sa = cross(u, v, a) / area,
      eb = cross(u, v, b) / area;
    const s = Math.abs(sa) < 1e-9 ? 0 : sa,
      e = Math.abs(eb) < 1e-9 ? 0 : eb;
    if (s < 0 && e < 0) return null;
    if (s < 0 && e >= 0) lo = Math.max(lo, s / (s - e));
    if (e < 0 && s >= 0) hi = Math.min(hi, s / (s - e));
  }
  if (hi - lo < 1e-9) return null;
  return [lo, hi].map((t) => height([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), 0], triangle));
}

export function cameraPaintPlans(
  mesh: CameraSpreadLift,
  kernel: OristudioCpFoldedPaperScene
): CameraPaintPlans {
  const held = cache.get(mesh);
  if (held) return held;
  const point = (v: number): Vec3 => [mesh.xy[v]!.x, mesh.xy[v]!.y, mesh.heights[v]!];
  const triangles = mesh.triangles.map((t) => t.vertices.map(point));
  const normalized = (p: ScenePoint): Vec3 => [
    (p[0] - mesh.origin.x) / mesh.size,
    (p[1] - mesh.origin.y) / mesh.size,
    0,
  ];
  const prepare = (back: boolean): CameraPaintPlan => {
    const scene = foldedFlatPaperScene(
      back
        ? {
            ...kernel,
            subfaces: kernel.subfaces.map((s) => ({
              ...s,
              faces_top_to_bottom: [...s.faces_top_to_bottom].reverse(),
            })),
          }
        : kernel,
      { markHidden: false, scale: 1, toScenePx: (p) => [p.x, p.y] }
    );
    const pieces: CameraPaintPiece[] = [];
    scene.items.forEach((item, rank) => {
      if ((item.kind !== 'face' && item.kind !== 'line') || item.face === undefined) return;
      const face = item.face;
      const patch = !!item.group;
      const source = mesh.faceTriangles[face]!.map((i) => triangles[i]!).filter(
        (t) => Math.abs(cross(t[0]!, t[1]!, t[2]!)) >= 1e-18
      );
      const addLine = (a: ScenePoint, b: ScenePoint, role: 'edge' | 'aux') => {
        for (const triangle of source) {
          const points = clipLine(normalized(a), normalized(b), triangle);
          if (points) pieces.push({ kind: 'line', points, face, rank, role, patch });
        }
      };
      if (item.kind === 'line') {
        addLine(item.a, item.b, item.role === 'aux' ? 'aux' : 'edge');
      } else {
        if (!patch) {
          for (const points of source) pieces.push({ kind: 'face', points, face, rank, patch });
        } else {
          for (const ring of item.rings) {
            const vertices = ring.map(normalized);
            const indices = earcut(vertices.flatMap((p) => p.slice(0, 2)));
            for (let i = 0; i < indices.length; i += 3) {
              const cut = indices.slice(i, i + 3).map((v) => vertices[v]!);
              for (const triangle of source) {
                const polygon = clip(cut, triangle).map((p) => height(p, triangle));
                for (let j = 1; j + 1 < polygon.length; j++) {
                  const points = [polygon[0]!, polygon[j]!, polygon[j + 1]!];
                  if (Math.abs(cross(...(points as [Vec3, Vec3, Vec3]))) > 1e-16)
                    pieces.push({ kind: 'face', points, face, rank, patch });
                }
              }
            }
          }
        }
        if (item.outline)
          for (const ring of item.rings)
            ring.forEach((a, i) =>
              addLine(a, ring[(i + 1) % ring.length]!, item.outline === 'aux' ? 'aux' : 'edge')
            );
      }
    });
    return { pieces, slots: scene.items.length };
  };
  const result = { front: prepare(false), back: prepare(true) };
  cache.set(mesh, result);
  return result;
}
