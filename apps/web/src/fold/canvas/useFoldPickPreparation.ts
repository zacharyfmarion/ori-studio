import { useEffect, useState } from 'react';
import { reportError } from '../../monitoring';
import type { FoldLandmarks, FoldScene } from '../engine/foldEngineWire';
import { hydrateFoldPick, type FoldPickData, type FoldPickIndex, type FoldMarkPoint } from './foldPicking';
import type { FoldSheetBindings } from './foldPickPreparation';

export interface FoldPickingRequest {
  scene: FoldScene;
  landmarks: FoldLandmarks | null;
  marks: readonly FoldMarkPoint[];
}
export interface FoldPickPreparation { index: FoldPickIndex; bindings: FoldSheetBindings }

/** Scene/landmark work is cancellable and never runs in a React render. */
export function useFoldPickPreparation(scene: FoldScene | null, landmarks: FoldLandmarks | null, marks: readonly FoldMarkPoint[]) {
  const [result, setResult] = useState<{ scene: FoldScene; landmarks: FoldLandmarks | null; marks: readonly FoldMarkPoint[]; value: FoldPickPreparation | null; error: boolean } | null>(null);
  useEffect(() => {
    if (!scene) return;
    let worker: Worker | null = null, live = true;
    const fail = (error: unknown) => {
      if (!live) return;
      live = false;
      worker?.terminate();
      reportError(error, { surface: 'fold:pick-preparation' });
      setResult({ scene, landmarks, marks, value: null, error: true });
    };
    const timer = setTimeout(() => fail(new Error('Fold picking preparation timed out')), 30_000);
    try {
      worker = new Worker(new URL('./picking.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }: MessageEvent<{ kind: 'ready'; index: FoldPickData; bindings: FoldSheetBindings } | { kind: 'error'; message: string }>) => {
        if (!live) return;
        clearTimeout(timer);
        if (data.kind === 'error') { fail(new Error(data.message)); return; }
        try {
          const index = hydrateFoldPick(scene, data.index);
          live = false;
          setResult({ scene, landmarks, marks, value: { index, bindings: data.bindings }, error: false });
          worker?.terminate();
        } catch (error) { fail(error); }
      };
      worker.onerror = event => { clearTimeout(timer); fail(new Error(event.message)); };
      worker.postMessage({ scene, landmarks, marks } satisfies FoldPickingRequest);
    } catch (error) { clearTimeout(timer); fail(error); }
    return () => { live = false; clearTimeout(timer); worker?.terminate(); };
  }, [scene, landmarks, marks]);
  const current = result?.scene === scene && result.landmarks === landmarks && result.marks === marks ? result : null;
  return { prepared: current?.value ?? null, status: !scene ? 'idle' as const : current?.error ? 'error' as const : current?.value ? 'ready' as const : 'preparing' as const };
}
