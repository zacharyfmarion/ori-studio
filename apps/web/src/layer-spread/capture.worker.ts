import { SpreadComplexityError } from '@oristudio/layer-spread';
/// <reference lib="webworker" />
import { connectedPaperScene, type ConnectedDrawing } from './connectedScene';

// Vector clipping has a different lifetime from a height solve: it runs only
// for a committed picture, and can be interrupted without evicting that solve.
self.onmessage = ({ data }: MessageEvent<{ drawing: ConnectedDrawing; sheet: number }>) => {
  try {
    self.postMessage({ kind: 'scene', scene: connectedPaperScene(data.drawing, data.sheet, true) });
  } catch (error) {
    self.postMessage({
      kind: error instanceof SpreadComplexityError ? 'budget' : 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
