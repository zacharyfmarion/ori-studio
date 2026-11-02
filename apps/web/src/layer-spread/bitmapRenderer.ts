import createREGL from 'regl';
import { createSpreadProgram, type SpreadGeometry } from '../cp-workspace/renderer/programs/spreadProgram';
import type { ViewTransform } from '../cp-workspace/renderer/types';

/** Shared live paper renderer. Host adapters own placement and pen units;
 * this owns the identical global ordering, buffers and graphics lifecycle. */
export function createSpreadBitmapRenderer(onLost?: () => void) {
  const canvas = new OffscreenCanvas(1, 1);
  const gl = canvas.getContext('webgl', { alpha: true, stencil: true, antialias: true, premultipliedAlpha: true });
  if (!gl) throw new Error('Spread preview graphics unavailable');
  const regl = createREGL({ gl: gl as WebGLRenderingContext, extensions: ['ANGLE_instanced_arrays'] });
  const program = createSpreadProgram(regl);
  let lost = false;
  canvas.addEventListener('webglcontextlost', () => { lost = true; onLost?.(); });
  return {
    setData: (geometry: SpreadGeometry) => program.setData(geometry),
    dispose: () => regl.destroy(),
    draw: (width: number, height: number, view: ViewTransform, widthPx: number) => {
      if (lost || gl.isContextLost()) throw new Error('Spread preview graphics context lost');
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      regl.poll();
      regl.clear({ color: [0, 0, 0, 0], depth: 1, stencil: 0 });
      program.draw({ view, viewport: { width, height, dpr: 1 }, widthPx });
      return canvas.transferToImageBitmap();
    },
  };
}
