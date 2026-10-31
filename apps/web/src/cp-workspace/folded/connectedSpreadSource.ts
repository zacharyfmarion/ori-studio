import earcut from 'earcut';
import type { Point as Pair, SpreadInput, Triangle } from '@oristudio/layer-spread';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import { foldedDisplayLayers, namedFaces } from './foldedDisplayLayers';

export interface ConnectedSpreadSource {
  input: SpreadInput;
  /** Canonical normalized XY → the kernel scene, before any host placement. */
  frame: { origin: Pair; ex: Pair; ey: Pair };
  /** Canonical vertex index → material vertex name. */
  vertices: number[];
  back: boolean;
}

/** Remove view translation, uniform scale, rotation and the rear reflection.
 * The first material edge defines the frame, never a visible/selected face.
 * It only names coordinates; the reference plane still uses the whole surface.
 */
export function connectedSpreadSource(scene: OristudioCpFoldedPaperScene, yUp = false): ConnectedSpreadSource {
  if (scene.faces.length > 10_000 || scene.subfaces.length > 200_000)
    throw new Error('Layer spread model exceeds its preparation budget');
  if (!scene.faces.length || !namedFaces(scene).every(Boolean))
    throw new Error('Layer spread requires named material faces');
  const first = scene.faces[0]!;
  const a = first.outline[0]!;
  const b = first.outline.find((p) => Math.hypot(p.x - a.x, p.y - a.y) > 1e-10);
  if (!b) throw new Error('Layer spread has no usable frame');
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const sign = (scene.flipped ? -1 : 1) * (yUp ? 1 : -1);
  const ux: Pair = [Math.cos(angle), Math.sin(angle)];
  const uy: Pair = [-sign * ux[1], sign * ux[0]];
  const local = (p: Point): Pair => [
    (p.x - a.x) * ux[0] + (p.y - a.y) * ux[1],
    (p.x - a.x) * uy[0] + (p.y - a.y) * uy[1],
  ];
  const material = new Map<number, Pair>();
  for (const face of scene.faces)
    face.points.forEach((id, k) => {
      const p = local(face.outline[k]!);
      const old = material.get(id);
      if (old && Math.hypot(old[0] - p[0], old[1] - p[1]) > Math.max(1, scene.sheet) * 1e-6)
        throw new Error('Disconnected material crease');
      material.set(id, p);
    });
  const vertices = [...material.keys()].sort((u, v) => u - v);
  const index = new Map(vertices.map((v, k) => [v, k]));
  const min: Pair = [Infinity, Infinity],
    max: Pair = [-Infinity, -Infinity];
  for (const p of material.values())
    for (let axis = 0; axis < 2; axis++) {
      min[axis] = Math.min(min[axis]!, p[axis]!);
      max[axis] = Math.max(max[axis]!, p[axis]!);
    }
  const unit = Math.max(max[0] - min[0], max[1] - min[1]) / 2;
  if (!(unit > 1e-10)) throw new Error('Layer spread has zero extent');
  const center: Pair = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  // Quantization removes camera roundoff from the solve key, far below the
  // Float32 mesh precision used by the numerical preparation.
  const normalize = (p: Pair): Pair => p.map((v, k) => Math.round(((v - center[k]!) / unit) * 1e9) / 1e9) as Pair;
  const xy = vertices.map((v) => normalize(material.get(v)!));
  const faces = scene.faces.map((f) => f.points.map((v) => index.get(v)!));
  const triangles: Triangle[] = [],
    triangleFaces: number[] = [];
  faces.forEach((ids, face) => {
    const flat = ids.flatMap((v) => xy[v]!);
    const corners = earcut(flat);
    if (corners.length < 3) throw new Error('Layer spread could not triangulate a face');
    for (let i = 0; i < corners.length; i += 3) {
      triangles.push([ids[corners[i]!]!, ids[corners[i + 1]!]!, ids[corners[i + 2]!]!]);
      triangleFaces.push(face);
    }
  });
  const orders = new Map<string, Pair>();
  const cells = scene.subfaces.flatMap((cell) => {
    const polygon = cell.polygon.map((p) => normalize(local(p)));
    let twice = 0,
      cx = 0,
      cy = 0;
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i]!,
        q = polygon[(i + 1) % polygon.length]!;
      const cross = p[0] * q[1] - q[0] * p[1];
      twice += cross;
      cx += (p[0] + q[0]) * cross;
      cy += (p[1] + q[1]) * cross;
    }
    if (Math.abs(twice) < 2e-14) return [];
    const stack = scene.flipped ? [...cell.faces_top_to_bottom].reverse() : cell.faces_top_to_bottom;
    for (let i = 0; i < stack.length; i++)
      for (let j = i + 1; j < stack.length; j++) {
        const pair: Pair = [stack[j]!, stack[i]!];
        const key = `${Math.min(...pair)}:${Math.max(...pair)}`;
        const old = orders.get(key);
        if (old && old[0] !== pair[0]) throw new Error('Conflicting material layer order');
        orders.set(key, pair);
      }
    return [{ faces: [...stack], point: [cx / (3 * twice), cy / (3 * twice)] as Pair, area: Math.abs(twice) / 2 }];
  });
  return {
    input: {
      xy,
      faces,
      triangles,
      triangleFaces,
      planeGroups: Array.from(foldedDisplayLayers(scene).layerOf),
      orders: [...orders.values()].sort((p, q) => p[0] - q[0] || p[1] - q[1]),
      cells,
    },
    vertices,
    back: scene.flipped,
    frame: {
      origin: [a.x + ux[0] * center[0] + uy[0] * center[1], a.y + ux[1] * center[0] + uy[1] * center[1]],
      ex: [ux[0] * unit, ux[1] * unit],
      ey: [uy[0] * unit, uy[1] * unit],
    },
  };
}

export function sourcePoint(source: ConnectedSpreadSource, p: Point): Pair {
  const { origin, ex, ey } = source.frame;
  const x = p.x - origin[0],
    y = p.y - origin[1];
  const unit2 = ex[0] * ex[0] + ex[1] * ex[1];
  return [(x * ex[0] + y * ex[1]) / unit2, (x * ey[0] + y * ey[1]) / unit2];
}
export function scenePoint(source: ConnectedSpreadSource, [x, y]: Pair): Point {
  const { origin, ex, ey } = source.frame;
  return { x: origin[0] + ex[0] * x + ey[0] * y, y: origin[1] + ex[1] * x + ey[1] * y };
}
