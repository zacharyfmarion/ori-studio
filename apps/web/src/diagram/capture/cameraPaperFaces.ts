import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import type { ScenePoint } from '../../lib/paper/paperScene';
import type { CameraLayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { cameraSpreadLift } from '../../cp-workspace/folded/cameraSpreadLift';
import { cameraSpreadProjection } from '../../cp-workspace/folded/cameraSpreadProjection';
import { cameraSpreadRenderOptions } from '../../cp-workspace/folded/cameraSpreadView';
import { cameraSpreadPageFrame } from './foldedSpreadScene';
import type { DiagramPaperFaces, DiagramPaperProjection } from '../document/diagramDocument';
import { flatPaperFaces } from './capturePaperFaces';
import { storedSceneStep } from './captureGeometry';

export function cameraPaperFaces(
  kernel: OristudioCpFoldedPaperScene,
  spread: CameraLayerSpreadOptions,
  toScenePx: (p: Point) => ScenePoint,
  scale: number
): DiagramPaperFaces | null {
  const source = flatPaperFaces(kernel, toScenePx, scale);
  if (!source) return null;
  const mesh = cameraSpreadLift(kernel);
  const { project, homogeneous } = cameraSpreadProjection(mesh, cameraSpreadRenderOptions(spread));
  const { map } = cameraSpreadPageFrame(mesh, spread, toScenePx);
  const step = storedSceneStep(kernel.sheet * scale);
  const round = (v: number) => Number((Math.round(v / step) * step).toPrecision(12));
  const points: DiagramPaperProjection['points'] = mesh.xy.map((p, i) => {
    const raw: [number, number, number] = [p.x, p.y, mesh.heights[i]!];
    const unspread = toScenePx({ x: mesh.origin.x + p.x * mesh.size, y: mesh.origin.y + p.y * mesh.size });
    const projected = map(project(raw));
    return [
      round(unspread[0]),
      round(unspread[1]),
      round(projected[0]),
      round(projected[1]),
      Number(homogeneous(raw)[2].toPrecision(12)),
    ];
  });
  return { ...source, projection: { points, triangles: mesh.triangles.map((t) => [t.face, ...t.vertices]) } };
}
