import type { ConnectedSpread } from '@oristudio/layer-spread';
import type { PaperStyle } from '../lib/paper/paperStyle';
import type { SpreadPresentation } from './presentation';
import type { ConnectedSpreadView } from './view';
export interface SpreadFrame {
  spread: ConnectedSpread;
  presentation?: SpreadPresentation;
  rotationDeg: number;
  width: number;
  height: number;
  zoom: number;
  pixelRatio?: number;
  style: PaperStyle;
}
export type SpreadRenderMessage = { kind: 'source'; view: ConnectedSpreadView } | { kind: 'frame'; frame: SpreadFrame };
