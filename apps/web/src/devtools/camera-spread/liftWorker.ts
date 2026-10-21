import { cameraSpreadLift } from '../../cp-workspace/folded/cameraSpreadLift';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { cameraPaintPlans } from '../../cp-workspace/folded/cameraSpreadVisibility';
self.onmessage = (event: MessageEvent<OristudioCpFoldedPaperScene>) => {
  try {
    const mesh = cameraSpreadLift(event.data);
    const start = performance.now();
    const plans = cameraPaintPlans(mesh, event.data);
    self.postMessage({ mesh, plans, visibilityMs: performance.now() - start });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
