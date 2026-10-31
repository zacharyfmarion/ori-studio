import type { OristudioCpFoldedPaperScene } from '../engine/oristudioCpTypes';
import type { PreparedConnectedSpread } from './connectedScene';

export interface ConnectedSpreadView {
  scene: OristudioCpFoldedPaperScene;
  prepared: PreparedConnectedSpread;
}
