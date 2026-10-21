import { cameraSpreadLift } from '../../cp-workspace/folded/cameraSpreadLift';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
self.onmessage = (event: MessageEvent<OristudioCpFoldedPaperScene>) => {
  try {
    self.postMessage({ mesh: cameraSpreadLift(event.data) });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
