import { spreadFrame } from './spreadFrame';
import { pagePtPerPx } from '../lib/paper/paperSvg';
import { DEFAULT_PAPER_SIZE_MM } from '../lib/paper/paperPage';
import { PAPER_STYLE_POLICIES } from '../lib/paper/paperStyleResolve';
/// <reference lib="webworker" />
import { createSpreadBitmapRenderer } from './bitmapRenderer';
import { hasConnectedDrawing } from './connectedScene';
import { posedSpreadScene } from './posedScene';
import { spreadGeometry } from './spreadGeometry';
import type { ConnectedSpreadView } from './view';
import type { SpreadRenderMessage } from './renderProtocol';

let view: ConnectedSpreadView | null = null;
let renderer: ReturnType<typeof createSpreadBitmapRenderer> | null = null;
let geometryKey: string | null = null;
let pointsPerUnit = 1;
self.onmessage = ({ data }: MessageEvent<SpreadRenderMessage>) => {
  try {
    if (data.kind === 'source') {
      view = data.source;
      geometryKey = null;
      return;
    }
    if (!view) return;
    renderer ??= createSpreadBitmapRenderer(() => self.postMessage({ kind: 'error', message: 'Spread preview graphics context lost' }));
    const f = data.frame;
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
    const bitmap = renderer.draw(f.width, f.height,
      { origin: [frame.x, frame.y], ex: [frame.scale, 0], ey: [0, frame.scale] }, frame.scale / pointsPerUnit);
    self.postMessage({ kind: 'frame', id: data.id, bitmap }, [bitmap]);
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
