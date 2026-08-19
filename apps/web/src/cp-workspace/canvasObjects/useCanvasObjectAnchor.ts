import { useCpOverlayViews } from '../cpOverlayViewStore';
import { annotationScreenRect } from '../annotations/annotationAnchor';
import type { AnnotationBox } from '../annotations/annotationTransform';
import type { FloatingAnchorRect } from '../../components/ui/FloatingToolbar';

/**
 * Viewport-space anchor rect for a canvas object's floating toolbar, tracking
 * the camera **live**.
 *
 * The panel also keeps a debounced copy of the camera affine, deliberately: it
 * is a huge component and re-rendering it on every frame of a pan would be far
 * too expensive. But anchoring a toolbar to that copy means the toolbar only
 * moves once the camera settles — dragging the *object* looks fine, because the
 * object itself changes every frame and re-runs the anchor, while zooming or
 * panning leaves the toolbar behind until the debounce fires.
 *
 * So the subscription lives here instead, in the small components that actually
 * render a toolbar. They re-render per frame, the panel does not, and the
 * toolbar stays glued to its object — the same split the selection overlay uses.
 *
 * `container` supplies the overlay's viewport offset, since `CpOverlayView` maps
 * to CSS pixels relative to the canvas box while a body-portaled toolbar needs
 * viewport coordinates. Pass the element the canvas is positioned against.
 */
export function useCanvasObjectAnchor(
  box: AnnotationBox | null,
  space: 'model' | 'user',
  container: HTMLElement | null,
): FloatingAnchorRect | null {
  const views = useCpOverlayViews();
  if (!box || !views || !container) return null;
  return annotationScreenRect(views[space], container.getBoundingClientRect(), box);
}
