import type { ConnectedSpread, Point3 } from '@oristudio/layer-spread';
import type { FoldedSceneInk } from '../../cp-workspace/adapters/cpFoldedToScene';
import type { CpSurfacePaperFrame } from '../../cp-workspace/surface/useCpSurface';
import type { UserBounds } from '../../cp-workspace/renderer/camera';
import type { ViewTransform } from '../../cp-workspace/renderer/types';
import type { PreparedConnectedSpread } from '../../layer-spread/connectedScene';
import type { BitmapRequest } from '../../layer-spread/useBitmapRenderer';
import type { Point } from '../../lib/geometry';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import type { FoldScene, FoldLandmarks } from '../engine/foldEngineWire';
import type { FoldPickData, FoldMarkPoint, PanePickData } from './foldPicking';
import type { FoldSheetBindings } from './foldPickPreparation';
import type { FoldPaneDisplay } from './foldPaneScenes';
export interface FoldRenderSource {
  scene: FoldScene;
  prepared: PreparedConnectedSpread;
  landmarks: FoldLandmarks | null;
  marks: readonly FoldMarkPoint[];
  picking: FoldPickData;
}
export interface FoldRenderFrame {
  /** Camera/input metadata returned to the host alongside this bitmap. */
  surfaceFrame?: CpSurfacePaperFrame;
  spread: ConnectedSpread;
  display: FoldPaneDisplay;
  offset: Point;
  style: PaperStyle;
  ink: FoldedSceneInk;
  width: number;
  height: number;
  view: ViewTransform;
  widthPx: number;
}
export interface FoldRenderPayload {
  /** Actual spread outline, in the same user-space frame as the bitmap. */
  bounds: UserBounds;
  /** Normalized to Fold's picking frame: x right, y down, sheet units. */
  positions: Point3[];
  folded: PanePickData;
  /** Sent once per source, never again for camera or parameter changes. */
  bindings?: FoldSheetBindings;
}
export type FoldRenderMessage = BitmapRequest<FoldRenderSource, FoldRenderFrame>;
export interface FoldLiveRenderer {
  source: FoldRenderSource;
  spread: ConnectedSpread;
  present: (payload: FoldRenderPayload) => void;
}
