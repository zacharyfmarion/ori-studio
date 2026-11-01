/// <reference lib="webworker" />
import { foldPickData, foldPickIndex } from './foldPicking';
import { prepareFoldSheetBindings } from './foldPickPreparation';
import type { FoldPickingRequest } from './useFoldPickPreparation';
self.onmessage = ({ data }: MessageEvent<FoldPickingRequest>) => {
  try {
    const index = foldPickData(foldPickIndex(data.scene, data.landmarks, data.marks));
    const bindings = prepareFoldSheetBindings(data.scene, data.landmarks);
    self.postMessage({ kind: 'ready', index, bindings });
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
