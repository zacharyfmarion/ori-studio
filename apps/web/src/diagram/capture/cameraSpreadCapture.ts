import { cameraSpreadLift } from '../../cp-workspace/folded/cameraSpreadLift';
import { cameraPaintPlans } from '../../cp-workspace/folded/cameraSpreadVisibility';
import { cameraLayerRelations } from '../../cp-workspace/folded/cameraSpreadRelations';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { CameraLayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { foldedSpreadScene } from './foldedSpreadScene';
import type { ScenePoint } from '../../lib/paper/paperScene';
import { cameraPaperFaces } from './cameraPaperFaces';
import { CAPTURE_PX_PER_UNIT, turnClockwise } from './captureGeometry';

/** Pure worker body, also usable by headless capture. */
export function captureCameraSpread(
  kernel: OristudioCpFoldedPaperScene,
  spread: CameraLayerSpreadOptions,
  rotationDeg: number
) {
  const turn = turnClockwise(rotationDeg);
  const toScenePx = (point: { x: number; y: number }): ScenePoint => {
    const p = turn(point);
    return [p.x * CAPTURE_PX_PER_UNIT, p.y * CAPTURE_PX_PER_UNIT];
  };
  return {
    scene: foldedSpreadScene(kernel, { markHidden: false, scale: CAPTURE_PX_PER_UNIT, toScenePx, spread }),
    paperFaces: cameraPaperFaces(kernel, spread, toScenePx, CAPTURE_PX_PER_UNIT),
    paperScale: spread.projection === 'diagram' ? CAPTURE_PX_PER_UNIT : null,
  };
}

/** Bounded topology cache, shared by repeated captures within an open pose. */
export function createCameraSpreadCaptureSession() {
  const scenes = new Map<number, OristudioCpFoldedPaperScene>();
  return {
    load(key: number, scene: OristudioCpFoldedPaperScene) {
      if (scenes.has(key)) return;
      cameraPaintPlans(cameraSpreadLift(scene), scene);
      cameraLayerRelations(scene);
      scenes.delete(key);
      scenes.set(key, scene);
      while (scenes.size > 3) scenes.delete(scenes.keys().next().value!);
    },
    capture(key: number, spread: CameraLayerSpreadOptions, rotationDeg: number) {
      const scene = scenes.get(key);
      if (!scene) return null;
      scenes.delete(key);
      scenes.set(key, scene);
      return captureCameraSpread(scene, spread, rotationDeg);
    },
  };
}
export type CameraSpreadCaptureApi = ReturnType<typeof createCameraSpreadCaptureSession>;
