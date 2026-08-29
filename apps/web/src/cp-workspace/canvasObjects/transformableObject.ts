import { foldedFigureBox } from '../adapters/cpFoldedToScene';
import {
  annotationAspectLockPolicy,
  type CanvasAnnotation,
} from '../annotations/annotation';
import type { AnnotationBox, AspectLockPolicy } from '../annotations/annotationTransform';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';

/**
 * The interaction contract for anything the CP surface lets you select, move,
 * resize and rotate: reference images, text boxes, and folded figures.
 *
 * These kinds do *not* share a data model — annotations live in the web-side
 * annotation layer while folded figures carry a kernel handle and fold status —
 * and forcing them into one would mean either duplicating state or migrating a
 * kernel-backed lifecycle onto the annotation layer. What they genuinely share
 * is the gesture: a rotated box, dragged by its body or its handles. So the
 * overlay consumes this projection of each kind, and the adapters below are the
 * only place that knows how a given kind produces one.
 */
export interface TransformableCanvasObject {
  id: string;
  /**
   * Which affine projects this object's box to CSS pixels.
   *
   * Annotations are placed in crease-pattern *model* space; folded figures are
   * placed in SVG *user* space, the space their render primitives land in. The
   * two coincide only when no native Oriedita camera is active, so the object
   * has to say which one it means rather than the overlay assuming.
   */
  space: 'model' | 'user';
  box: AnnotationBox;
  locked: boolean;
  hidden: boolean;
  /** Whether resize keeps proportions, and whether Shift escapes that. */
  aspectLock: AspectLockPolicy;
  /**
   * Whether the crease pattern is painted *over* this object.
   *
   * Pick order has to follow paint order, or the surface lies about what a click
   * will do. Everything the overlay draws chrome for sits above the creases and
   * rightly takes its own press — except a reference image, which is drawn
   * underneath them precisely so you can trace over it (see
   * `reglRenderer.render`). Leaving that kind to swallow every press inside its
   * box made a crease drawn on top of an image unselectable, which is the bug
   * this flag exists to fix.
   *
   * Only the *body* yields. Resize and rotate handles are chrome — small,
   * deliberate, and drawn on top — and keep their press whatever is beneath, or
   * an image under a dense pattern could not be sized at all. Same body-vs-handle
   * split `inertBodyIds` already draws.
   */
  paintedBehindCreases: boolean;
}

/** An annotation as the overlay sees it: a model-space box. */
export function annotationAsTransformable(
  annotation: CanvasAnnotation
): TransformableCanvasObject {
  return {
    id: annotation.id,
    space: 'model',
    box: {
      center: annotation.center,
      width: annotation.width,
      height: annotation.height,
      rotation: annotation.rotation,
    },
    locked: annotation.locked,
    hidden: annotation.hidden,
    aspectLock: annotationAspectLockPolicy(annotation),
    // Images are drawn into the canvas below the creases; text boxes are their
    // own DOM layer above it. The two annotation variants genuinely differ here.
    paintedBehindCreases: annotation.kind === 'image',
  };
}

/**
 * Which canvas object currently holds the selection, given each kind's own
 * notion of it.
 *
 * The overlay draws chrome — the outline and the resize/rotate handles — for
 * exactly one id, so a kind missing from here has no transform affordance at
 * all however complete the rest of its plumbing is. That is what happened to
 * inline simulations: fully transformable, in `canvasObjects`, wired to write
 * box updates back, and unresizable because the panel never named them here.
 *
 * The three are mutually exclusive by construction — selecting any one clears
 * the others — so the order only settles a transient overlap. The crease
 * selection is in that same rule and does not appear here: it holds the canvas
 * *instead of* an object, so when it is non-empty all three of these are null.
 * `takeCanvasSelection` in the crease-pattern slice is where all four meet.
 */
export function selectedCanvasObjectId(selection: {
  annotationId: string | null;
  foldedFigureId: string | null;
  inlineSimulationId: string | null;
}): string | null {
  return (
    selection.annotationId ?? selection.foldedFigureId ?? selection.inlineSimulationId ?? null
  );
}

/**
 * A folded figure as the overlay sees it: a user-space box derived from its
 * cached local geometry and placement. Null when the figure draws nothing —
 * still loading, errored, or an empty fold — since there is no box to grab.
 *
 * Aspect is `always` locked: a placement carries a single scalar scale, so a
 * non-uniform stretch is not something the model can represent.
 */
export function foldedFigureAsTransformable(
  figure: OristudioCpFoldedFigureEntry
): TransformableCanvasObject | null {
  const box = foldedFigureBox(figure);
  if (!box) return null;
  return {
    id: figure.id,
    space: 'user',
    box,
    // Folded figures have no lock/hide affordance of their own yet; a figure
    // that is mid-fold or errored has no box at all and is filtered out above.
    locked: false,
    hidden: false,
    aspectLock: 'always',
    // Folded figures draw after the creases, so they occlude the pattern they
    // were folded from and keep their press.
    paintedBehindCreases: false,
  };
}
