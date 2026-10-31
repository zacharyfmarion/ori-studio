import type { LayerSpreadOptions } from '../cp-workspace/folded/foldedLayerSpread';
import { foldedFlatPaperScene } from '../cp-workspace/folded/foldedFlatScene';
import { turnClockwise } from '../lib/geometry';
import type { SpreadPresentation } from './presentation';
import type { ConnectedSpreadView } from './view';

export function posedSpreadScene(
  view: ConnectedSpreadView,
  rotationDeg: number,
  spread: LayerSpreadOptions,
  scale: number,
  presentation?: SpreadPresentation,
) {
  const turn = turnClockwise(rotationDeg);
  return foldedFlatPaperScene(view.scene, {
    markHidden: false,
    live: true,
    connected: view.prepared,
    spread,
    presentation,
    scale,
    toScenePx: (p) => {
      const at = turn(p);
      return [at.x * scale, at.y * scale];
    },
  });
}
