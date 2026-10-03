/**
 * Where a step's simulated capture lies on Pose's live simulator (D8, D19):
 * the box the step's annotations are drawn on, so they can be ghosted over the
 * live view while it shows the pose they were drawn at.
 *
 * Both are one camera about one framing. The capture (`stillFrame` in the
 * simulator's worker) projects the model into a `frame` px square; the view
 * projects it into its own canvas, each centred, each scaled by its
 * `fitExtent`. Once the view's framing has followed the model to rest, the two
 * differ only by the ratio of those extents about their centres, so one scale
 * and a shift carry the one into the other.
 *
 * Pure: no DOM, no store.
 */
import { fitExtent } from '@treemaker/origami-simulator';
import type { SceneBounds } from '../../lib/paper/paperScene';
import type { PictureBox } from './paintDiagramStep';

/**
 * The capture's frame — its scene's bounds, in a `frame` px square — on a
 * `width` × `height` view, in the view's own px; null for an empty view.
 */
export function simulatedCaptureFrame(
  bounds: SceneBounds,
  frame: number,
  width: number,
  height: number
): PictureBox | null {
  if (!(frame > 0) || !(width > 0) || !(height > 0)) return null;
  const k = fitExtent(width, height) / fitExtent(frame, frame);
  return {
    x: width / 2 + (bounds.minX - frame / 2) * k,
    y: height / 2 + (bounds.minY - frame / 2) * k,
    width: (bounds.maxX - bounds.minX) * k,
    height: (bounds.maxY - bounds.minY) * k,
  };
}
