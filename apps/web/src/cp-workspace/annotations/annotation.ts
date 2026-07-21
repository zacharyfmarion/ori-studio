/**
 * The unified canvas-annotation model. An annotation is any object placed on the
 * crease-pattern canvas that shares the {@link AnnotationBase} behaviors
 * (select/drag/resize/rotate, unified z-order, opacity, lock/hide). Today the
 * variants are reference images ({@link CpImage}); the rich-text box lands in a
 * later phase and joins {@link CanvasAnnotation} then.
 *
 * A single `CanvasAnnotation[]` array (see the store's `oristudioCpAnnotations`)
 * is the source of truth so z-order and selection are shared across kinds.
 * `.osf` persists the full model; Oriedita export flattens each variant to what
 * the format supports (text → `{x,y,text}`) and omits the rest (images).
 */

import type { CpImage, CpImageUpdate } from '../images/cpImage';

export type { AnnotationBase, AnnotationKind } from './annotationBase';

/** The `'image'` annotation variant. */
export type ImageAnnotation = CpImage;

/**
 * Every annotation kind. A discriminated union on `kind`; widens as new variants
 * (text) are added.
 */
export type CanvasAnnotation = ImageAnnotation;

/** A partial update to an annotation, discriminated per kind. */
export type AnnotationUpdate = CpImageUpdate;

/** Narrow a {@link CanvasAnnotation} to the image variant. */
export function isImageAnnotation(annotation: CanvasAnnotation): annotation is ImageAnnotation {
  return annotation.kind === 'image';
}

/** The highest `z` across the annotations, or 0 for an empty layer. */
export function topAnnotationZ(annotations: readonly CanvasAnnotation[]): number {
  return annotations.reduce((max, annotation) => Math.max(max, annotation.z), 0);
}

/** The lowest `z` across the annotations, or 0 for an empty layer. */
export function bottomAnnotationZ(annotations: readonly CanvasAnnotation[]): number {
  return annotations.reduce((min, annotation) => Math.min(min, annotation.z), 0);
}
