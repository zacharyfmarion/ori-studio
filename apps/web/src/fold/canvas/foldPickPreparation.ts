import { faceWeights } from '@oristudio/layer-spread';
import { sourcePoint } from '../../cp-workspace/folded/connectedSpreadSource';
import type { PreparedConnectedSpread } from '../../layer-spread/connectedScene';
import type { Point } from '../../lib/geometry';
import type { SheetPoint } from '../document/foldSequenceDocument';
import type { FoldLandmarks, FoldScene } from '../engine/foldEngineWire';
import { applyIsometry, boundsOf, insideConvex, toPoint } from './foldCanvasGeometry';

export interface FoldSheetBinding {
  face: number;
  point: Point;
  sample?: ReturnType<typeof faceWeights>;
}
/** Model-lifetime associations. Keys use the exact sheet coordinates, without quantization. */
export type FoldSheetBindings = Map<string, FoldSheetBinding | null>;
export const sheetBindingKey = (point: SheetPoint): string => `${point[0]},${point[1]}`;

export function prepareFoldSheetBindings(scene: FoldScene, landmarks: FoldLandmarks | null, connected?: PreparedConnectedSpread): FoldSheetBindings {
  const rings = scene.faces.map(({ points }) => {
    const ring = points.map(vertex => scene.sheet_points[vertex]).filter((p): p is Point => p !== undefined);
    return { ring, box: boundsOf(ring) };
  });
  const bindings: FoldSheetBindings = new Map();
  const add = (sheet: SheetPoint) => {
    const key = sheetBindingKey(sheet);
    if (bindings.has(key)) return;
    const point = toPoint(sheet);
    let binding: FoldSheetBinding | null = null;
    for (const [face, { ring, box }] of rings.entries()) {
      if (!box || point.x < box.minX - 1e-7 || point.x > box.maxX + 1e-7 || point.y < box.minY - 1e-7 || point.y > box.maxY + 1e-7) continue;
      if (!insideConvex(ring, point, 1e-7)) continue;
      const transform = scene.face_transforms[face];
      if (!transform) continue;
      const at = applyIsometry(transform, point);
      binding = { face, point: at, ...(connected ? { sample: faceWeights(connected.source.input, face, sourcePoint(connected.source, at)) } : {}) };
      break;
    }
    bindings.set(key, binding);
  };
  for (const point of landmarks?.points ?? []) for (const source of point.sources) add(source.sheet);
  for (const segment of [...landmarks?.segments ?? [], ...landmarks?.crease_marks ?? []]) {
    add(segment.sheet.a); add(segment.sheet.b);
  }
  return bindings;
}
