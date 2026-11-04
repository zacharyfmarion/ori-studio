import type { PaperStyle } from '../lib/paper/paperStyle';
import type { PaperSurface } from '../lib/paper/paperStyleResolve';
import type { ConnectedPaperScene } from './connectedScene';
export interface SpreadRaster {
  png: ArrayBuffer;
  width: number;
  height: number;
  scale: number;
  /** Image rectangle in the captured scene coordinates, including pixel rounding. */
  sceneFrame: [number, number, number, number];
}

/** What the raster worker is asked: the scene, its style, its size, and the surface whose pens it reads. */
export interface SpreadRasterRequest {
  scene: ConnectedPaperScene;
  style: PaperStyle;
  mm: number;
  /** The policy the style's pens are read through; Fold's when absent, as every bitmap was drawn before it was asked. */
  policy?: PaperSurface;
}

/**
 * A 300 dpi bitmap of an unresolved scene, `mm` across its longer side, its
 * pens read through `policy` — Fold's unless the caller names its own, so the
 * bitmap of a figure drawn in another surface's pens matches its vector.
 */
export function rasterConnected(
  scene: ConnectedPaperScene,
  style: PaperStyle,
  mm = 80,
  signal?: AbortSignal,
  policy: PaperSurface = 'fold'
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
      const request: SpreadRasterRequest = { scene, style, mm, policy };
      worker.postMessage(request);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
