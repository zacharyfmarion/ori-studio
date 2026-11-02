import type { PaperScene } from '../lib/paper/paperScene';
import type { ConnectedPaperScene } from './connectedScene';

/** Explicit capture boundary. A worker keeps polygon clipping off the UI thread. */
export function captureConnected(scene: ConnectedPaperScene, signal?: AbortSignal): Promise<PaperScene> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./capture.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error: Error | null, result?: PaperScene) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else if (result) resolve(result);
    };
    const abort = () => finish(new DOMException('Spread capture cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(null, scene), 12_000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    worker.onmessage = ({
      data,
    }: {
      data: { kind: 'scene'; scene: PaperScene } | { kind: 'error' | 'budget'; message: string };
    }) => {
      if (data.kind === 'scene') finish(null, data.scene);
      else if (data.kind === 'budget') finish(null, scene);
      else finish(new Error(data.message));
    };
    worker.onerror = () => finish(new Error('Spread capture worker failed'));
    try {
      worker.postMessage({ drawing: scene.connected, sheet: scene.sheet });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
