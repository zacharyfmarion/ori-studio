import { createSharedWorkerClient } from '../../lib/sharedWorkerClient';
import type { CameraSpreadRenderApi } from './cameraSpreadSession';
import type { CameraSpreadCaptureApi } from '../../diagram/capture/cameraSpreadCapture';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { CameraLayerSpreadOptions } from './foldedLayerSpread';

export const cameraSpreadRenderClient = createSharedWorkerClient<CameraSpreadRenderApi>(
  () => new Worker(new URL('../../workers/cameraSpreadWorker.ts', import.meta.url), { type: 'module' })
);
export const cameraSpreadCaptureClient = createSharedWorkerClient<CameraSpreadCaptureApi>(
  () => new Worker(new URL('../../workers/cameraSpreadCaptureWorker.ts', import.meta.url), { type: 'module' })
);

const keys = new WeakMap<OristudioCpFoldedPaperScene, number>();
let nextKey = 0;
export function cameraSpreadGeometryKey(scene: OristudioCpFoldedPaperScene): number {
  let key = keys.get(scene);
  if (key === undefined) {
    key = ++nextKey;
    keys.set(scene, key);
  }
  return key;
}

export async function captureCameraSpreadInWorker(
  scene: OristudioCpFoldedPaperScene,
  spread: CameraLayerSpreadOptions,
  rotationDeg: number
) {
  if (typeof Worker === 'undefined') {
    const { captureCameraSpread } = await import('../../diagram/capture/cameraSpreadCapture');
    return captureCameraSpread(scene, spread, rotationDeg);
  }
  cameraSpreadCaptureClient.retain();
  const key = cameraSpreadGeometryKey(scene);
  try {
    let result = await cameraSpreadCaptureClient.call((client) => client.capture(key, spread, rotationDeg));
    if (!result) {
      await cameraSpreadCaptureClient.call((client) => client.load(key, scene));
      result = await cameraSpreadCaptureClient.call((client) => client.capture(key, spread, rotationDeg));
    }
    if (!result) throw new Error('Camera spread geometry was evicted before capture');
    return result;
  } finally {
    cameraSpreadCaptureClient.release();
  }
}
