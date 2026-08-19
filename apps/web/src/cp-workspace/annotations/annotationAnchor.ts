import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import {
  boxCornersModel,
  overlayModelToCss,
  type AnnotationBox,
  type Vec2,
} from './annotationTransform';
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
 * Axis-aligned bounding rectangle (viewport CSS px) of a set of model-space
 * corners projected through the camera. Returns null for an empty corner set.
 */
export function boundingScreenRect(
  view: CpOverlayView,
  container: { left: number; top: number },
  cornersModel: readonly Vec2[],
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
 * rotation). Convenience wrapper over {@link boxCornersModel} +
 * {@link boundingScreenRect}.
 */
export function annotationScreenRect(
  view: CpOverlayView,
  container: { left: number; top: number },
  box: AnnotationBox,
): FloatingAnchorRect | null {
  return boundingScreenRect(view, container, boxCornersModel(box));
}
