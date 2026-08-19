import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import {
  overlayModelToCss,
  type AnnotationBox,
  type Vec2,
} from '../annotations/annotationTransform';

/**
 * Where a window sits on screen, split into the part that survives a camera move
 * and the part that does not.
 *
 * The layout box is sized at `renderedPxPerModel` — the scale the window's
 * bitmap was last drawn for — and everything the camera has done since is a
 * transform. That is what keeps a pan or zoom off the layout path: at twenty
 * windows, writing `left`/`top`/`width`/`height` per frame relaid out the whole
 * layer, and because a canvas whose box changes wakes its ResizeObserver, it
 * also made every window re-render. Measured at 640 bitmaps a second.
 *
 * Shared by both window kinds — inline simulations and 3D folded figures — and
 * that sharing is the point rather than a tidiness. Its inputs are already
 * kind-agnostic, and a second copy is how the 640-bitmaps-a-second regression
 * comes back on one kind only.
 */
export interface CanvasWindowPlacement {
  /** Layout size in CSS px. Changes only when the camera settles. */
  width: number;
  height: number;
  /** The whole camera-varying part. Changes every frame; costs no layout. */
  transform: string;
  /**
   * Corner radius in the element's own px — that is, before the transform scales
   * it. See {@link CORNER_RADIUS_CSS}.
   */
  cornerRadius: number;
  /**
   * Style for the window's badges, or null once they have faded out entirely.
   *
   * Transform and opacity only, both compositor properties: a badge must be able
   * to correct itself on every frame of a gesture, and nothing that reaches
   * layout can do that here — a layout write wakes the canvas's ResizeObserver
   * and re-renders the simulation, which is the cost this whole module exists to
   * avoid.
   */
  badge: { transform: string; opacity: number } | null;
}

/** Corner radius of a window at a size where it reads as a panel, in CSS px. */
const CORNER_RADIUS_CSS = 6;

/**
 * Window size, in CSS px, at which {@link CORNER_RADIUS_CSS} is the right
 * radius. Bigger windows keep it; smaller ones shrink it from here.
 */
const CORNER_REFERENCE_EDGE_CSS = 200;

/**
 * How fast the corner shrinks below the reference. 0 keeps a flat 6px, which is
 * a rounded rectangle at 200px and a lozenge at 25px; 1 holds the radius at a
 * constant *share* of the window, which goes sub-pixel and reads as a hard square
 * corner long before you stop zooming out.
 *
 * Neither end is the frame the eye wants, because a window's frame is chrome
 * rather than content — the same reason the crease-pattern canvas gives its
 * markers a partial shrink (`MARKER_SHRINK_EXPONENT`) while its vertices get the
 * full one. This is the chrome number, and it is the same 0.7.
 *
 * Measured against the *painted* size rather than the layout box, so the shape is
 * continuous across a settle: the layout box catching up must sharpen a window,
 * never restyle it.
 */
const CORNER_SHRINK_EXPONENT = 0.7;

/**
 * Inset of a badge from the window's corner, in CSS px. Matches
 * `.cp-inline-simulation__badge` and `.cp-folded-figure-window__badge` —
 * repeated here because the counter-transform has to undo exactly the offset the
 * stylesheet asked for, and both classes therefore have to declare this number.
 */
const BADGE_INSET_CSS = 6;

/**
 * Where a badge is fully legible, and where it has faded out, as the window's
 * painted short edge in CSS px.
 *
 * Generous at both ends. A badge is a fixed-size label inside a box the camera
 * shrinks freely, so it is clipped by the window's own `overflow` well before it
 * becomes unreadable — and the translated strings are longer than the English
 * one, so the size where that starts is not a number worth cutting fine. Nothing
 * is lost by going early: a stale window is also dimmed, which is the signal the
 * badge only names.
 */
const BADGE_FULL_AT_CSS = 150;
const BADGE_GONE_AT_CSS = 96;

/** Hermite ramp between two edges, clamped — the GLSL `smoothstep`. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function canvasWindowPlacement(options: {
  box: AnnotationBox;
  /** Box centre in CSS px under the live camera. */
  center: { x: number; y: number };
  /** Screen-space rotation of the box under the live camera, in radians. */
  angle: number;
  /** Live camera scale. */
  pxPerModel: number;
  /** Camera scale the layout box — and the bitmap in it — were built for. */
  renderedPxPerModel: number;
}): CanvasWindowPlacement {
  const { box, center, angle, pxPerModel, renderedPxPerModel } = options;
  const base = renderedPxPerModel > 0 ? renderedPxPerModel : pxPerModel;
  const scale = base > 0 ? pxPerModel / base : 1;
  const paintedShortEdge = Math.min(box.width, box.height) * pxPerModel;
  // Everything below is sized on screen and then divided back out of the
  // transform, because the element is scaled on its way there: a length declared
  // here arrives multiplied by `scale`.
  const undoScale = scale > 0 ? 1 / scale : 1;
  const shrink = Math.pow(
    Math.min(1, paintedShortEdge / CORNER_REFERENCE_EDGE_CSS),
    CORNER_SHRINK_EXPONENT,
  );
  return {
    width: box.width * base,
    height: box.height * base,
    cornerRadius: CORNER_RADIUS_CSS * shrink * undoScale,
    badge: badgeChrome(paintedShortEdge, undoScale),
    // Right-to-left: centre the box on its own origin, scale and rotate about
    // that centre, then put the centre where the camera says. Paired with
    // `transform-origin: 0 0`.
    transform:
      `translate(${center.x}px, ${center.y}px) ` +
      `rotate(${angle}rad) scale(${scale}) translate(-50%, -50%)`,
  };
}

/**
 * Hold a badge at a fixed on-screen size and inset, whatever the camera is doing
 * to the window around it.
 *
 * A badge inherits the window's transform, so during a gesture it shrank and
 * grew with the fold and then jumped back the moment the layout box caught up —
 * a label that lagged the camera and corrected in steps. Cancelling the scale
 * pins it: `1/scale` about its own anchored corner makes it the size the
 * stylesheet asked for, and the translate puts the inset back, since that was
 * scaled too. Both are transforms, so this is free — see
 * {@link CanvasWindowPlacement.badge}.
 */
function badgeChrome(
  paintedShortEdge: number,
  undoScale: number,
): { transform: string; opacity: number } | null {
  const opacity = smoothstep(BADGE_GONE_AT_CSS, BADGE_FULL_AT_CSS, paintedShortEdge);
  if (opacity <= 0) return null;
  // Screen offset added by the translate is itself scaled, so ask for the
  // shortfall in local units: `inset - inset * scale`, over scale.
  const recover = BADGE_INSET_CSS * (undoScale - 1);
  return {
    transform: `translate(${recover}px, ${-recover}px) scale(${undoScale})`,
    opacity,
  };
}

/**
 * The size a window actually paints at — layout box times the transform's scale.
 *
 * Exists for the test that matters: this must not depend on
 * `renderedPxPerModel`, or settling would move the window rather than just
 * sharpen it.
 */
export function paintedSize(placement: CanvasWindowPlacement): {
  width: number;
  height: number;
} {
  const scale = Number(/scale\(([-\d.e]+)\)/.exec(placement.transform)?.[1] ?? 1);
  return { width: placement.width * scale, height: placement.height * scale };
}

/**
 * Screen-space rotation (radians) of a box's local +x axis under the camera.
 *
 * Derived by mapping a unit step through the affine rather than by reading a
 * camera angle, so it stays right under a flipped or non-conformal view.
 */
export function windowScreenAngle(view: CpOverlayView, center: Vec2, rotation: number): number {
  const origin = overlayModelToCss(view, center);
  const tip = overlayModelToCss(view, {
    x: center.x + Math.cos(rotation),
    y: center.y + Math.sin(rotation),
  });
  return Math.atan2(tip.y - origin.y, tip.x - origin.x);
}
