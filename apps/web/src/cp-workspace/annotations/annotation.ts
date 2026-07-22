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
import {
  serializedStateToPlainText,
  type TextAnnotation,
  type TextAnnotationUpdate,
} from './textAnnotation';

export type { AnnotationBase, AnnotationKind } from './annotationBase';

/** The `'image'` annotation variant. */
export type ImageAnnotation = CpImage;

/** Every annotation kind. A discriminated union on `kind`. */
export type CanvasAnnotation = ImageAnnotation | TextAnnotation;

/** A partial update to an annotation, discriminated per kind. */
export type AnnotationUpdate = CpImageUpdate | TextAnnotationUpdate;

/** Narrow a {@link CanvasAnnotation} to the image variant. */
export function isImageAnnotation(annotation: CanvasAnnotation): annotation is ImageAnnotation {
  return annotation.kind === 'image';
}

/** Narrow a {@link CanvasAnnotation} to the text variant. */
export function isTextAnnotation(annotation: CanvasAnnotation): annotation is TextAnnotation {
  return annotation.kind === 'text';
}

/**
 * The topmost annotation whose rotated box contains `model` (crease-pattern model
 * coordinates), skipping hidden and locked ones. Higher `z` wins; ties resolve to
 * the later entry (painted on top). Null when the point hits nothing.
 */
export function annotationAtModelPoint(
  annotations: readonly CanvasAnnotation[],
  model: { x: number; y: number }
): CanvasAnnotation | null {
  let best: CanvasAnnotation | null = null;
  for (const annotation of annotations) {
    if (annotation.hidden || annotation.locked) continue;
    const dx = model.x - annotation.center.x;
    const dy = model.y - annotation.center.y;
    const cos = Math.cos(annotation.rotation);
    const sin = Math.sin(annotation.rotation);
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    if (Math.abs(localX) <= annotation.width / 2 && Math.abs(localY) <= annotation.height / 2) {
      if (!best || annotation.z >= best.z) best = annotation;
    }
  }
  return best;
}

/** The highest `z` across the annotations, or 0 for an empty layer. */
export function topAnnotationZ(annotations: readonly CanvasAnnotation[]): number {
  return annotations.reduce((max, annotation) => Math.max(max, annotation.z), 0);
}

/** The lowest `z` across the annotations, or 0 for an empty layer. */
export function bottomAnnotationZ(annotations: readonly CanvasAnnotation[]): number {
  return annotations.reduce((min, annotation) => Math.min(min, annotation.z), 0);
}

/** A text annotation flattened to the Oriedita `{x, y, text}` interchange shape. */
export interface FlatText {
  x: number;
  y: number;
  text: string;
}

/**
 * Flatten every text annotation to the plain `{x, y, text}` that Oriedita
 * formats support: the box center becomes the text position and the rich content
 * collapses to plain text (marks dropped). This is the export-time projection
 * handed to the kernel before an `.ori`/`.fold` export.
 */
export function flattenTextAnnotations(annotations: readonly CanvasAnnotation[]): FlatText[] {
  return annotations.filter(isTextAnnotation).map((text) => ({
    x: text.center.x,
    y: text.center.y,
    text: serializedStateToPlainText(text.doc),
  }));
}
