/** Production spread boundary: legacy whole-face spreads and connected camera lift. */
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import { foldedFlatPaperScene, type FoldedFlatPaperSceneOptions } from '../../cp-workspace/folded/foldedFlatScene';
import type { LayerSpreadOptions, CameraLayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { cameraSpreadLift, type CameraSpreadLift } from '../../cp-workspace/folded/cameraSpreadLift';
import { cameraSpreadScene } from '../../cp-workspace/folded/cameraSpreadScene';
import { compactCameraScene } from './compactCameraScene';
import { cameraSpreadRenderOptions } from '../../cp-workspace/folded/cameraSpreadView';

export function foldedSpreadScene(
  kernel: OristudioCpFoldedPaperScene,
  options: Omit<FoldedFlatPaperSceneOptions, 'spread'> & { spread?: LayerSpreadOptions }
): PaperScene {
  const spread = options.spread;
  if (spread?.kind !== 'camera') return foldedFlatPaperScene(kernel, { ...options, spread });
  const flat = spread.amount === 0 && spread.projection === 'diagram';
  const projected = cameraSpreadScene(kernel, cameraSpreadRenderOptions(spread));
  // The zero-spread path is a whole-face painter, not pre-clipped triangles.
  // Its later fills must still cover earlier ink; compaction puts ink last.
  const scene = flat ? projected : compactCameraScene(projected);
  const mesh = cameraSpreadLift(kernel);
  const { map, bounds } = cameraSpreadPageFrame(mesh, spread, options.toScenePx);
  return {
    sheet: scene.sheet * options.scale,
    bounds,
    items: scene.items.map((item) =>
      item.kind === 'face'
        ? { ...item, rings: item.rings.map((ring) => ring.map(map)) }
        : item.kind === 'line'
          ? {
              ...item,
              a: map(item.a),
              b: map(item.b),
              ...(item.whole ? { whole: { ...item.whole, a: map(item.whole.a), b: map(item.whole.b) } } : {}),
            }
          : item
    ),
  };
}

/** Fixed framing, with pan applied in screen space after the pose's page turn. */
export function cameraSpreadPageFrame(
  mesh: CameraSpreadLift,
  spread: CameraLayerSpreadOptions,
  toScenePx: FoldedFlatPaperSceneOptions['toScenePx']
) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of mesh.xy) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const cx = mesh.origin.x + (mesh.size * (x0 + x1)) / 2;
  const cy = mesh.origin.y + (mesh.size * (y0 + y1)) / 2;
  const side = (mesh.size * 2) / 1.45;
  const view = spread.camera;
  const corners = [
    [cx - side / 2, cy - side / 2],
    [cx + side / 2, cy - side / 2],
    [cx + side / 2, cy + side / 2],
    [cx - side / 2, cy + side / 2],
  ].map(([x, y]) => toScenePx({ x: x!, y: y! }));
  const bounds = {
    minX: Math.min(...corners.map((p) => p[0])),
    minY: Math.min(...corners.map((p) => p[1])),
    maxX: Math.max(...corners.map((p) => p[0])),
    maxY: Math.max(...corners.map((p) => p[1])),
  };
  const edge = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const center = toScenePx({ x: cx, y: cy });
  const map = ([x, y]: ScenePoint): ScenePoint => {
    const p = toScenePx({ x, y });
    return [
      center[0] + (p[0] - center[0]) * view.zoom + (view.pan?.[0] ?? 0) * edge,
      center[1] + (p[1] - center[1]) * view.zoom + (view.pan?.[1] ?? 0) * edge,
    ];
  };
  return { map, bounds };
}
