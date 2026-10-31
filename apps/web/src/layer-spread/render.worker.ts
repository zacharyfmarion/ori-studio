import { spreadFrame } from './spreadFrame';
import { STEP_PICTURE_EDGE_CSS_PX } from '../diagram/pictures/poseLineWeight';
import { PAPER_STYLE_POLICIES } from '../lib/paper/paperStyleResolve';
/// <reference lib="webworker" />
import createREGL from 'regl';
import { createSpreadProgram } from '../cp-workspace/renderer/programs/spreadProgram';
import { hasConnectedDrawing } from './connectedScene';
import { posedSpreadScene } from './posedScene';
import { spreadGeometry } from './spreadGeometry';
import type { ConnectedSpreadView } from './view';
import type { SpreadRenderMessage } from './renderProtocol';

let view: ConnectedSpreadView | null = null;
const canvas = new OffscreenCanvas(1, 1);
let renderer: ReturnType<typeof createSpreadProgram> | null = null;
let regl: ReturnType<typeof createREGL> | null = null;
self.onmessage = ({ data }: MessageEvent<SpreadRenderMessage>) => {
  try {
    if (data.kind === 'source') {
      view = data.view;
      return;
    }
    if (!view) return;
    if (!regl) {
      const gl = canvas.getContext('webgl', { alpha: true, stencil: true, antialias: true, premultipliedAlpha: true });
      if (!gl) throw new Error('Spread preview graphics unavailable');
      regl = createREGL({ gl: gl as WebGLRenderingContext, extensions: ['ANGLE_instanced_arrays'] });
      renderer = createSpreadProgram(regl);
    }
    const f = data.frame;
    if (canvas.width !== f.width) canvas.width = f.width;
    if (canvas.height !== f.height) canvas.height = f.height;
    regl.poll();
    const scene = posedSpreadScene(view, f.rotationDeg, f.spread, 1, f.presentation);
    if (!hasConnectedDrawing(scene)) throw new Error('Spread geometry unavailable');
    const frame = spreadFrame(view, f.rotationDeg, f.presentation?.kind === 'perspective', f.width, f.height, f.zoom);
    renderer!.setData(spreadGeometry(scene, f.style, { policy: PAPER_STYLE_POLICIES.fold }));
    regl.clear({ color: [0, 0, 0, 0], depth: 1, stencil: 0 });
    renderer!.draw({
      view: { origin: [frame.x, frame.y], ex: [frame.scale, 0], ey: [0, frame.scale] },
      viewport: { width: f.width, height: f.height, dpr: 1 },
      widthPx: ((4 / 3) * Math.min(f.width, f.height)) / STEP_PICTURE_EDGE_CSS_PX,
    });
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ kind: 'frame', bitmap }, [bitmap]);
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
