import { useCallback } from 'react';
import type { ConnectedSpreadView } from './view';
import type { SpreadFrame } from './renderProtocol';
import { useBitmapRenderer } from './useBitmapRenderer';
const createWorker = () => new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });

/** Diagram placement over the same renderer and bounded scheduling as Fold. */
export function useSpreadRenderer(view: ConnectedSpreadView, onFrame: (bitmap: ImageBitmap) => void) {
  const paint = useCallback((bitmap: ImageBitmap) => onFrame(bitmap), [onFrame]);
  return useBitmapRenderer<ConnectedSpreadView, SpreadFrame, never>(view, createWorker, paint);
}
