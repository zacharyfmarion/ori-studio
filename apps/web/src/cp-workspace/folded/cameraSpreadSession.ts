/** Static rendering backend. No simulation state or solver ticks. */
import { transfer } from 'comlink';
import { multiplyMat3 } from '@treemaker/origami-simulator';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { CameraLayerSpreadOptions } from './foldedLayerSpread';
import { cameraSpreadLift } from './cameraSpreadLift';
import { cameraPaintPlans } from './cameraSpreadVisibility';
import { cameraSpreadRenderOptions } from './cameraSpreadView';
import { cameraSpreadTransform } from './cameraSpreadCamera';
import { createCameraRenderer, type CameraSpreadSurface } from './cameraSpreadRenderer';

export interface CameraSpreadRenderRequest {
  key: number;
  spread: CameraLayerSpreadOptions;
  rotationDeg: number;
  surface: CameraSpreadSurface;
  /** Picture-frame occupancy, including the diagram page's paper margin. */
  frameScale?: number;
}

export function createCameraSpreadSession() {
  const sessions = new Map<number, { canvas: OffscreenCanvas; renderer: ReturnType<typeof createCameraRenderer> }>();
  const release = (key: number) => {
    sessions.get(key)?.renderer.dispose(true);
    sessions.delete(key);
  };
  return {
    load(key: number, kernel: OristudioCpFoldedPaperScene) {
      if (sessions.has(key)) return;
      // A bitmap session owns a framebuffer and textures; keep two live views
      // at most. A caller whose geometry was evicted reloads it explicitly.
      if (sessions.size >= 2) release(sessions.keys().next().value!);
      const canvas = new OffscreenCanvas(1, 1);
      const mesh = cameraSpreadLift(kernel);
      const renderer = createCameraRenderer(canvas, mesh, kernel, cameraPaintPlans(mesh, kernel));
      sessions.set(key, { canvas, renderer });
    },
    render({ key, spread, rotationDeg, surface, frameScale = 1 }: CameraSpreadRenderRequest): ImageBitmap | null {
      const session = sessions.get(key);
      if (!session) return null;
      sessions.delete(key);
      sessions.set(key, session);
      const options = cameraSpreadRenderOptions(spread);
      const theta = (rotationDeg * Math.PI) / 180,
        c = Math.cos(theta),
        s = Math.sin(theta);
      options.frame = multiplyMat3([c, -s, 0, s, c, 0, 0, 0, 1], cameraSpreadTransform(options));
      const short = Math.min(surface.width, surface.height);
      const zoom = (frameScale * spread.camera.zoom * Math.min(1, surface.width / surface.height)) / (Math.abs(c) + Math.abs(s));
      const pan: [number, number] = [0, 1].map(
        (i) => ((spread.camera.pan?.[i] ?? 0) * 2 * short * frameScale) / surface.height / (1.45 * zoom)
      ) as [number, number];
      session.renderer.draw(
        options,
        zoom,
        false,
        pan,
        surface.style
          ? { ...surface, style: { ...surface.style, erode: (surface.style.erode ?? 0) / spread.camera.zoom } }
          : surface
      );
      const bitmap = session.canvas.transferToImageBitmap();
      return transfer(bitmap, [bitmap]);
    },
    release,
  };
}

export type CameraSpreadRenderApi = ReturnType<typeof createCameraSpreadSession>;
