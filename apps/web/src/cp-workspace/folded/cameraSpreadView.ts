/** Basis boundary between XY/depth paper and the shared Y-up camera. */
import {
  multiplyMat3,
  transposeMat3,
  viewRotation,
  viewRotationFor,
  type Mat3,
  type OrbitView,
} from '@treemaker/origami-simulator';
import { cameraSpreadRotation, type CameraSpreadPose } from './cameraSpreadCamera';
import type { CameraLayerSpreadOptions } from './foldedLayerSpread';
import type { CameraSpreadOptions } from './cameraSpreadScene';
import { persistedCameraView } from '../../lib/viewport3dCamera';

const PAPER_TO_WORLD: Mat3 = [1, 0, 0, 0, 0, 1, 0, -1, 0];
const SCREEN_DOWN: Mat3 = [1, 0, 0, 0, -1, 0, 0, 0, 1];

/** New camera data must be a rotation, never an arbitrary shear or reflection. */
export function isCameraOrientation(value: unknown): value is Mat3 {
  if (
    !Array.isArray(value) ||
    value.length !== 9 ||
    !value.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
    return false;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let dot = 0;
      for (let k = 0; k < 3; k++) dot += value[i * 3 + k] * value[j * 3 + k];
      if (Math.abs(dot - Number(i === j)) > 1e-6) return false;
    }
  const [a, b, c, d, e, f, g, h, i] = value as unknown as Mat3;
  return Math.abs(a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g) - 1) < 1e-6;
}

export function cameraSpreadViewFrame(camera: OrbitView): Mat3 {
  return multiplyMat3(SCREEN_DOWN, multiplyMat3(viewRotationFor(camera), PAPER_TO_WORLD));
}

/** The pose's page rotation is part of what the user sees as screen-up. */
export function cameraSpreadViewportView(camera: OrbitView, rotationDeg: number): OrbitView {
  return persistedCameraView({
    ...camera,
    roll: (camera.roll ?? 0) + (rotationDeg * Math.PI) / 180,
  });
}

/** Remove the page turn before storing: capture and rendering apply it separately. */
export function cameraSpreadStoredView(camera: OrbitView, rotationDeg: number): OrbitView {
  return persistedCameraView({
    ...camera,
    roll: (camera.roll ?? 0) - (rotationDeg * Math.PI) / 180,
  });
}

/** Preserve the diagram's eye and screen orientation on entry to 3D. */
export function cameraSpreadInitialView(pose: CameraSpreadPose): OrbitView {
  const frame = cameraSpreadRotation(pose);
  const rotation = multiplyMat3(SCREEN_DOWN, multiplyMat3(frame, transposeMat3(PAPER_TO_WORLD)));
  return {
    yaw: 0,
    pitch: 0,
    zoom: 1,
    orient: multiplyMat3(transposeMat3(viewRotation(0, 0)), rotation),
  };
}

export function cameraSpreadRenderOptions(spread: CameraLayerSpreadOptions): CameraSpreadOptions {
  return {
    amount: spread.amount,
    projection: spread.projection,
    directionDeg: spread.directionDeg,
    inclinationDeg: spread.inclinationDeg,
    ...(spread.projection === 'diagram' ? {} : { frame: cameraSpreadViewFrame(spread.camera) }),
  };
}
