import { spreadFrame } from './spreadFrame';
import { pagePtPerPx } from '../lib/paper/paperSvg';
import { DEFAULT_PAPER_SIZE_MM } from '../lib/paper/paperPage';
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
let geometryKey: string | null = null;
let pointsPerUnit = 1;
self.onmessage = ({ data }: MessageEvent<SpreadRenderMessage>) => {
  try {
    if (data.kind === 'source') {
      view = data.view;
      geometryKey = null;
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
    // Zoom/resize only change the frame. Keep the geometry already resident in
    // the renderer instead of reprojecting, rebuilding ink and uploading it.
    // Perspective camera.zoom IS geometry (perspective projection), so keep
    // the entire presentation in the key. A new source invalidates it above.
    const key = JSON.stringify([f.spread, f.presentation, f.rotationDeg, f.style]);
    if (key !== geometryKey) {
      const scene = posedSpreadScene(view, f.rotationDeg, f.spread, 1, f.presentation);
      if (!hasConnectedDrawing(scene)) throw new Error('Spread geometry unavailable');
      renderer!.setData(spreadGeometry(scene, f.style, { policy: PAPER_STYLE_POLICIES.fold }));
      pointsPerUnit = pagePtPerPx(scene,
        { sheet: { mm: DEFAULT_PAPER_SIZE_MM }, paddingMm: 0, background: null, keepHiddenFaces: false }, 'figure');
      geometryKey = key;
    }
    const frame = spreadFrame(view, f.rotationDeg, f.presentation?.kind === 'perspective', f.width, f.height, f.zoom, f.style, f.pixelRatio);
    regl.clear({ color: [0, 0, 0, 0], depth: 1, stencil: 0 });
    renderer!.draw({
      view: { origin: [frame.x, frame.y], ex: [frame.scale, 0], ey: [0, frame.scale] },
      viewport: { width: f.width, height: f.height, dpr: 1 },
      widthPx: frame.scale / pointsPerUnit,
    });
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ kind: 'frame', bitmap }, [bitmap]);
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
