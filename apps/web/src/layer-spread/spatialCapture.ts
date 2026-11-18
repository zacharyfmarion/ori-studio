import type { CameraUniforms, PaperScene } from '@treemaker/origami-simulator';
import type { Folded3dMesh } from '../cp-workspace/folded/folded3dMesh';
import type { PaperStyle } from '../lib/paper/paperStyle';

export interface SpatialCaptureRequest {
  mesh: Folded3dMesh;
  camera: CameraUniforms;
  style: PaperStyle;
  raster: boolean;
  mm: number;
}

/** Committed pictures have a separate, cancellable worker lifetime from solves.
 * A vector budget/timeout retries through the very same GPU renderer as the view. */
export async function captureSpatialScene(
  mesh: Folded3dMesh,
  camera: CameraUniforms,
  style: PaperStyle,
  signal?: AbortSignal,
  mm = 80
): Promise<PaperScene> {
  const run = (raster: boolean): Promise<PaperScene | null> =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Capture cancelled', 'AbortError'));
        return;
      }
      const worker = new Worker(
        new URL('./spatialCapture.worker.ts', import.meta.url),
        { type: 'module' }
      );
      let settled = false;
      const finish = (error: Error | null, scene: PaperScene | null = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        worker.terminate();
        if (error) reject(error);
        else resolve(scene);
      };
      const abort = () =>
        finish(new DOMException('Capture cancelled', 'AbortError'));
      const timer = setTimeout(
        () => finish(raster ? new Error('Spatial capture timed out') : null),
        12_000
      );
      signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = ({
        data,
      }: MessageEvent<{
        kind: string;
        scene?: PaperScene;
        message?: string;
      }>) => {
        if (data.kind === 'scene' && data.scene) finish(null, data.scene);
        else
          finish(
            data.kind === 'budget' && !raster
              ? null
              : new Error(data.message ?? 'Spatial capture failed')
          );
      };
      worker.onerror = () => finish(new Error('Spatial capture worker failed'));
      try {
        worker.postMessage({
          mesh,
          camera,
          style,
          raster,
          mm,
        } satisfies SpatialCaptureRequest);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  const scene = (await run(false)) ?? (await run(true));
  if (!scene) throw new Error('No spatial picture');
  return scene;
}
