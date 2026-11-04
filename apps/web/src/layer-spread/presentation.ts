import { orderSide } from '@oristudio/layer-spread';
import { viewDepthAxis, viewRotationFor } from '@treemaker/origami-simulator';
import {
  FOLDED_FIGURE_CAMERA_KEYS,
  readFoldedFigureCamera,
  type FoldedFigureCamera,
} from '../cp-workspace/folded/folded3dCamera';
import { hasNewerKey, isRecord, NEWER } from '../lib/documentFile';

/** Kept beside a flat-fold recipe, never confused with a non-flat engine fold.
 * Retaining the camera while in diagram mode makes switching reversible.
 */
export interface SpreadPresentation {
  kind: 'diagram' | 'perspective';
  camera: FoldedFigureCamera;
  orderSide: 'front' | 'back';
}
const FIELDS = new Set(['kind', 'camera', 'orderSide']);
export function readSpreadPresentation(value: unknown): SpreadPresentation | undefined | null | typeof NEWER {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  if (hasNewerKey(value, FIELDS)) return NEWER;
  if (typeof value.kind !== 'string' || typeof value.orderSide !== 'string') return null;
  if (!['diagram', 'perspective'].includes(value.kind) || !['front', 'back'].includes(value.orderSide)) return NEWER;
  if (isRecord(value.camera) && hasNewerKey(value.camera, FOLDED_FIGURE_CAMERA_KEYS)) return NEWER;
  const camera = readFoldedFigureCamera(value.camera);
  if (!camera) return null;
  return {
    kind: value.kind as SpreadPresentation['kind'],
    orderSide: value.orderSide as SpreadPresentation['orderSide'],
    camera,
  };
}

/** Hysteresis at edge-on views is retained in the recipe and during a drag. */
export function spreadCameraSide(
  camera: FoldedFigureCamera,
  previous: SpreadPresentation['orderSide'],
): SpreadPresentation['orderSide'] {
  return orderSide(viewDepthAxis(viewRotationFor(camera))[1], previous);
}
export function withSpreadCamera(presentation: SpreadPresentation, camera: FoldedFigureCamera): SpreadPresentation {
  return { ...presentation, camera, orderSide: spreadCameraSide(camera, presentation.orderSide) };
}
