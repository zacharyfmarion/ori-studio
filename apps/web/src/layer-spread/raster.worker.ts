/// <reference lib="webworker" />
import createREGL from 'regl';
import { createSpreadProgram } from '../cp-workspace/renderer/programs/spreadProgram';
import { PAPER_STYLE_POLICIES } from '../lib/paper/paperStyleResolve';
import type { PaperStyle } from '../lib/paper/paperStyle';
import type { ConnectedPaperScene } from './connectedScene';
import { spreadGeometry } from './spreadGeometry';

/** A capture which exceeds vector complexity still uses exactly the live
 * visibility policy. Never flatten an unresolved scene in painter order. */
self.onmessage = async ({ data }: MessageEvent<{ scene: ConnectedPaperScene; style: PaperStyle; mm: number }>) => {
  let regl: ReturnType<typeof createREGL> | undefined;
  try {
    const { scene, style, mm } = data,
      b = scene.bounds;
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    if (!(span > 0)) throw new Error('Empty spread capture');
    const pixelsPerMm = 300 / 25.4,
      pad = pixelsPerMm;
    const scale = (mm * pixelsPerMm) / span;
    const width = Math.ceil((b.maxX - b.minX) * scale + 2 * pad),
      height = Math.ceil((b.maxY - b.minY) * scale + 2 * pad);
    const canvas = new OffscreenCanvas(width, height);
    const gl = canvas.getContext('webgl', { alpha: true, stencil: true, antialias: true, premultipliedAlpha: true });
    if (!gl) throw new Error('Spread capture graphics unavailable');
    regl = createREGL({ gl: gl as WebGLRenderingContext, extensions: ['ANGLE_instanced_arrays'] });
    const renderer = createSpreadProgram(regl);
    renderer.setData(spreadGeometry(scene, style, { policy: PAPER_STYLE_POLICIES.fold }));
    regl.clear({ color: [0, 0, 0, 0], depth: 1, stencil: 0 });
    renderer.draw({
      view: { origin: [pad - b.minX * scale, pad - b.minY * scale], ex: [scale, 0], ey: [0, scale] },
      viewport: { width, height, dpr: 1 },
      widthPx: 300 / 72,
    });
    const png = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
    self.postMessage({ kind: 'png', png, width, height, scale }, [png]);
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    regl?.destroy();
  }
};
