/// <reference lib="webworker" />
import { createSpreadBitmapRenderer } from '../../layer-spread/bitmapRenderer';
import { prepareFoldRender } from './foldRenderGeometry';
import type { FoldRenderMessage, FoldRenderPayload } from './foldRenderProtocol';
let prepare: ReturnType<typeof prepareFoldRender> | null = null;
let renderer: ReturnType<typeof createSpreadBitmapRenderer> | null = null;
let key: string | null = null;
self.onmessage = ({ data }: MessageEvent<FoldRenderMessage>) => {
  try {
    if (data.kind === 'source') { prepare = prepareFoldRender(data.source); key = null; return; }
    if (!prepare) return;
    renderer ??= createSpreadBitmapRenderer(() => self.postMessage({ kind: 'error', message: 'Spread preview graphics context lost' }));
    const f = data.frame;
    const nextKey = JSON.stringify([f.spread, f.display, f.offset, f.style, f.ink, f.ink.faces ? [...f.ink.faces] : null]);
    let payload: FoldRenderPayload | undefined;
    if (key !== nextKey) {
      const built = prepare(f);
      renderer.setData(built.geometry);
      payload = built.payload;
      key = nextKey;
    }
    const bitmap = renderer.draw(f.width, f.height, f.view, f.widthPx);
    self.postMessage({ kind: 'frame', id: data.id, bitmap, payload }, [bitmap]);
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
