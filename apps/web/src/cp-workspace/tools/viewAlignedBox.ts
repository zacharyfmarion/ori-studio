/**
 * The rectangle a rubber-band drag spans, built so it is axis-aligned *on
 * screen* rather than in model space.
 *
 * This is Oriedita's construction, not an addition to it. `BoxSelectStepNode`
 * forms the four corners as an axis-aligned rect in TV (screen) coordinates and
 * maps each one back through `Camera.TV2object`, which applies the camera's
 * rotation and mirror; `getBox()` then hands all four to the operation as a
 * `Rectangle extends Polygon`. Upstream's marquee and upstream's selection are
 * therefore both screen-aligned and agree with each other.
 *
 * The kernel takes this without any change: `required_selection_polygon` reads
 * two points as "AABB from this diagonal" and three or more as a polygon
 * verbatim, which is the same path the lasso tools already use.
 */
import { projectModelPoint, unprojectDevicePoint } from '../renderer/camera';
import type { ModelPoint, ViewTransform } from '../renderer/types';
import type { ToolPreviewSegment } from './types';

/**
 * The four corners of a drag box in model space, in perimeter order — so
 * consecutive entries share an edge, and corner 0 and corner 2 are the drag's
 * diagonal. Order matches upstream's `Rectangle(p19_a, p19_b, p19_c, p19_d)`.
 */
export type BoxCorners = readonly [ModelPoint, ModelPoint, ModelPoint, ModelPoint];

/** Model-space corners of the rect spanned by `a`–`b`, axis-aligned in model space. */
function modelAlignedCorners(a: ModelPoint, b: ModelPoint): BoxCorners {
  return [
    { x: a.x, y: a.y },
    { x: a.x, y: b.y },
    { x: b.x, y: b.y },
    { x: b.x, y: a.y },
  ];
}

/**
 * The model-space corners of the rectangle that spans `a`–`b` diagonally and is
 * axis-aligned in *view* space.
 *
 * `view === null` falls back to a model-axis-aligned box, which is what a tool
 * whose kernel handler reads the points positionally needs (see the operation
 * frame). A degenerate view falls back the same way rather than dropping the
 * gesture — a box the user can see is better than no box.
 */
export function viewAlignedBoxCorners(
  a: ModelPoint,
  b: ModelPoint,
  view: ViewTransform | null
): BoxCorners {
  if (!view) return modelAlignedCorners(a, b);
  const da = projectModelPoint(view, a.x, a.y);
  const db = projectModelPoint(view, b.x, b.y);
  // The same four screen corners upstream builds, in the same order.
  const corners = [
    unprojectDevicePoint(view, da.x, da.y),
    unprojectDevicePoint(view, da.x, db.y),
    unprojectDevicePoint(view, db.x, db.y),
    unprojectDevicePoint(view, db.x, da.y),
  ];
  if (corners.some((corner) => corner === null)) return modelAlignedCorners(a, b);
  return corners as unknown as BoxCorners;
}

/** The four edges of a corner quad, in perimeter order. */
export function boxCornerEdges(corners: BoxCorners): ToolPreviewSegment[] {
  return [
    { a: corners[0], b: corners[1] },
    { a: corners[1], b: corners[2] },
    { a: corners[2], b: corners[3] },
    { a: corners[3], b: corners[0] },
  ];
}
