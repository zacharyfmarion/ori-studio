/**
 * The shared substrate for canvas *annotations* — objects placed on the
 * crease-pattern canvas that behave alike (select, drag, resize, rotate,
 * z-order, opacity, lock/hide) regardless of what they draw. Reference images
 * and rich-text boxes are both annotations.
 *
 * This is a **leaf** module: pure types with no DOM/GPU/store dependencies, so
 * the payload types (`CpImage`, the text annotation) can extend it without a
 * circular import, and the persistence/render/store layers can all share it.
 *
 * Annotations live in a web-side layer, never in the `oristudio-cp` kernel;
 * Oriedita-format export flattens what it can (text → `{x,y,text}`) and omits
 * the rest (images).
 */

/** Discriminant tag identifying an annotation's payload kind. */
export type AnnotationKind = 'image' | 'text';

/**
 * Fields every annotation carries. A concrete annotation extends this with a
 * `kind` discriminant and kind-specific payload fields.
 */
export interface AnnotationBase {
  /** Stable unique id. */
  id: string;
  /** Placement center in crease-pattern *model* coordinates. */
  center: { x: number; y: number };
  /** Displayed size in model units (pre-rotation box extent). */
  width: number;
  height: number;
  /** Rotation about {@link center}, radians, counter-clockwise. */
  rotation: number;
  /** Unified stacking order across all annotation kinds (higher = in front). */
  z: number;
  /** 0..1. */
  opacity: number;
  /** When locked, the annotation ignores hit-testing and edits. */
  locked: boolean;
  /** When hidden, the annotation is not drawn. */
  hidden: boolean;
}
