import type { PaperStyle } from '../lib/paper/paperStyle';
import type { ConnectedPaperScene } from './connectedScene';
export interface SpreadRaster {
  png: ArrayBuffer;
  width: number;
  height: number;
  scale: number;
}

export function rasterConnected(
  scene: ConnectedPaperScene,
  style: PaperStyle,
  mm = 80,
  signal?: AbortSignal,
): Promise<SpreadRaster> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./raster.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error: Error | null, result?: SpreadRaster) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else if (result) resolve(result);
    };
    const abort = () => finish(new DOMException('Spread capture cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Spread raster exceeded its time budget')), 12_000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    worker.onmessage = ({ data }: { data: ({ kind: 'png' } & SpreadRaster) | { kind: 'error'; message: string } }) => {
      if (data.kind === 'png') finish(null, data);
      else finish(new Error(data.message));
    };
    worker.onerror = () => finish(new Error('Spread raster worker failed'));
    try {
      worker.postMessage({ scene, style, mm });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
