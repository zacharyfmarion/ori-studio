/// <reference lib="webworker" />
import { connectedSpreadSource } from '../cp-workspace/folded/connectedSpreadSource';
import type { OristudioCpFoldedPaperScene } from '../engine/oristudioCpTypes';
self.onmessage = ({ data }: MessageEvent<{ scene: OristudioCpFoldedPaperScene; yUp: boolean }>) => {
  try {
    self.postMessage({ kind: 'ready', source: connectedSpreadSource(data.scene, data.yUp) });
  } catch (error) {
    self.postMessage({ kind: 'unavailable', message: error instanceof Error ? error.message : String(error) });
  }
};
