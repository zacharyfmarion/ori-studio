import { barycentric } from '@oristudio/layer-spread';
import { paperSceneToFoldedGeometry, type FoldedSceneInk } from '../cp-workspace/adapters/cpFoldedToScene';
import type { SpreadGeometry } from '../cp-workspace/renderer/programs/spreadProgram';
import type { PaperScene, PaperItem } from '../lib/paper/paperScene';
import type { PaperStyle } from '../lib/paper/paperStyle';
import type { ConnectedPaperScene } from './connectedScene';

/** Reuse the existing paper pens, erode, dash and color conversion. Only depth
 * changes: interpolation follows the rendered triangles, never painter index.
 */
export function spreadGeometry(scene: ConnectedPaperScene, style: PaperStyle, ink: FoldedSceneInk): SpreadGeometry {
  const { mesh, front } = scene.connected;
  let lo = Infinity,
    hi = -Infinity;
  for (const p of mesh.positions) {
    lo = Math.min(lo, p[2]);
    hi = Math.max(hi, p[2]);
  }
  const span = Math.max(hi - lo, 1e-8);
  const items: PaperItem[][] = front.map(() => []);
  for (const item of scene.items)
    if (item.kind !== 'markup' && !item.hidden && item.face !== undefined) items[item.face]!.push(item);
  const triangles: number[][] = front.map(() => []);
  mesh.triangleFaces.forEach((f, t) => triangles[f]!.push(t));
  const depth = (face: number, x: number, y: number): number => {
    for (const t of triangles[face]!) {
      const p = mesh.triangles[t]!.map((v) => mesh.positions[v]!);
      const w = barycentric(p[0]!, p[1]!, p[2]!, [x, y]);
      if (w && Math.min(...w) > -1e-5) return (w.reduce((s, v, k) => s + v * p[k]![2], 0) - lo) / span;
    }
    return 0.5;
  };
  const faces = items.map((items, face) => {
    const plain: PaperScene = { items, sheet: scene.sheet, bounds: scene.bounds };
    const geometry = paperSceneToFoldedGeometry(plain, style, ink);
    const depths = (xy: Float32Array) =>
      Float32Array.from({ length: xy.length / 2 }, (_, v) => depth(face, xy[2 * v]!, xy[2 * v + 1]!));
    geometry.fills.depth = depths(geometry.fills.position);
    geometry.strokes.depth = depths(geometry.strokes.a);
    geometry.strokes.depthEnd = depths(geometry.strokes.b);
    return geometry;
  });
  return { faces, visibility: mesh.visibility };
}
