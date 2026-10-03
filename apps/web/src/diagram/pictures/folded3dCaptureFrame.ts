/**
 * Where a step's 3D capture lies on Pose's live view of the same fold (D5,
 * D8): the box the step's annotations are drawn on, so they can be ghosted
 * over the live view while it shows the camera they were drawn at.
 *
 * Both are one camera. The capture (`folded3dFigureScene`, in document space)
 * projects the model into a square box of `folded3dLocalFrameSide` user units
 * centred on `FOLDED_3D_LOCAL_CENTER`; the view projects it into its own
 * canvas, centred, the frame filling the canvas's shorter side
 * (`folded3dFrameFillZoom`). The two projections differ only by that ratio
 * about their centres, so one scale and a shift carry the one into the other.
 *
 * Pure: no DOM, no store.
 */
import { FOLDED_3D_LOCAL_CENTER, folded3dLocalFrameSide } from '../../cp-workspace/adapters/cpFoldedToScene';
import type { SceneBounds } from '../../lib/paper/paperScene';
import type { PictureBox } from './paintDiagramStep';

/**
 * The capture's frame — its scene's bounds — on a `width` × `height` view, in
 * the view's own px; null for an empty frame or view.
 */
export function folded3dCaptureFrame(
  bounds: SceneBounds,
  frameRadius: number,
  width: number,
  height: number
): PictureBox | null {
  const side = folded3dLocalFrameSide(frameRadius);
  if (!(side > 0) || !(width > 0) || !(height > 0)) return null;
  const k = Math.min(width, height) / side;
  return {
    x: width / 2 + (bounds.minX - FOLDED_3D_LOCAL_CENTER.x) * k,
    y: height / 2 + (bounds.minY - FOLDED_3D_LOCAL_CENTER.y) * k,
    width: (bounds.maxX - bounds.minX) * k,
    height: (bounds.maxY - bounds.minY) * k,
  };
}
