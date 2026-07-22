import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import { overlayModelToCss, type Vec2 } from '../images/cpImagePlacement';
import type { FloatingAnchorRect } from '../../components/ui/FloatingToolbar';

/**
 * Anchoring geometry for floating chrome (toolbars, badges) attached to a
 * canvas object. Pure and DOM-free so it is unit-testable; callers supply the
 * overlay container's viewport offset from `getBoundingClientRect()`.
 *
 * `CpOverlayView` maps model space to CSS pixels *relative to the canvas box*
 * (`css = origin + model.x*ex + model.y*ey`). A body-portaled toolbar needs
 * viewport coordinates, so we add the container's viewport-space top-left.
 */

/**
 * The four corners of an axis-aligned box centered at `center` with the given
 * model-space `width`/`height`, rotated `rotation` radians CCW. Order TL, TR,
 * BR, BL (in the box's local frame, before rotation).
 */
export function quadCornersModel(
  center: Vec2,
  width: number,
  height: number,
  rotation: number
): [Vec2, Vec2, Vec2, Vec2] {
  const hw = width / 2;
  const hh = height / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const corner = (dx: number, dy: number): Vec2 => ({
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  });
  return [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
}

/**
 * Axis-aligned bounding rectangle (viewport CSS px) of a set of model-space
 * corners projected through the camera. Returns null for an empty corner set.
 */
export function boundingScreenRect(
  view: CpOverlayView,
  container: { left: number; top: number },
  cornersModel: readonly Vec2[]
): FloatingAnchorRect | null {
  if (cornersModel.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of cornersModel) {
    const css = overlayModelToCss(view, corner);
    const x = container.left + css.x;
    const y = container.top + css.y;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Viewport-space anchor rect for a box-shaped annotation (center + size +
 * rotation). Convenience wrapper over {@link quadCornersModel} +
 * {@link boundingScreenRect}.
 */
export function annotationScreenRect(
  view: CpOverlayView,
  container: { left: number; top: number },
  box: { center: Vec2; width: number; height: number; rotation: number }
): FloatingAnchorRect | null {
  const corners = quadCornersModel(box.center, box.width, box.height, box.rotation);
  return boundingScreenRect(view, container, corners);
}
