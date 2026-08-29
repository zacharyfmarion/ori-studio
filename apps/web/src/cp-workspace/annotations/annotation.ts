/**
 * The unified canvas-annotation model. An annotation is any object placed on the
 * crease-pattern canvas that shares the {@link AnnotationBase} behaviors
 * (select/drag/resize/rotate, unified z-order, opacity, lock/hide). The variants
 * are reference images ({@link CpImage}), rich-text boxes, and check-suppression
 * regions.
 *
 * A single `CanvasAnnotation[]` array (see the store's `oristudioCpAnnotations`)
 * is the source of truth so z-order and selection are shared across kinds — and
 * because that array is a field of the CP history snapshot, joining this union
 * is also what buys a kind undo for free.
 *
 * `.osf` persists the full model; Oriedita export flattens each variant to what
 * the format supports (text → `{x,y,text}`) and omits the rest (images,
 * regions).
 */

import type { CpImage, CpImageUpdate } from '../images/cpImage';
import type { AspectLockPolicy } from './annotationTransform';
import type {
  CpSuppressionRegion,
  CpSuppressionRegionUpdate,
} from './suppressionRegion';
import {
  serializedStateToPlainText,
  type TextAnnotation,
  type TextAnnotationUpdate,
} from './textAnnotation';

export type { AnnotationBase, AnnotationKind } from './annotationBase';

/** The `'image'` annotation variant. */
export type ImageAnnotation = CpImage;

/** Every annotation kind. A discriminated union on `kind`. */
export type CanvasAnnotation = ImageAnnotation | TextAnnotation | CpSuppressionRegion;

/** A partial update to an annotation, discriminated per kind. */
export type AnnotationUpdate =
  | CpImageUpdate
  | TextAnnotationUpdate
  | CpSuppressionRegionUpdate;

/** Narrow a {@link CanvasAnnotation} to the image variant. */
export function isImageAnnotation(annotation: CanvasAnnotation): annotation is ImageAnnotation {
  return annotation.kind === 'image';
}

/** Narrow a {@link CanvasAnnotation} to the text variant. */
export function isTextAnnotation(annotation: CanvasAnnotation): annotation is TextAnnotation {
  return annotation.kind === 'text';
}

/** Narrow a {@link CanvasAnnotation} to the check-suppression region variant. */
export function isSuppressionRegionAnnotation(
  annotation: CanvasAnnotation
): annotation is CpSuppressionRegion {
  return annotation.kind === 'suppressionRegion';
}

/**
 * How each annotation kind treats aspect ratio when resized. An image keeps its
 * proportions unless Shift frees it; a text box reflows to its width, so free
 * resize is the normal intent and Shift is what locks it. A suppression region
 * is a bare extent with nothing inside it to distort, so free resize is what it
 * wants too.
 *
 * An exhaustive `switch`, not the ternary this used to be. The ternary gave a
 * new kind `'default-off'` silently — which is the answer a region happens to
 * want, so it would have looked correct by accident and the next kind would have
 * inherited the same non-decision with no type error to show for it.
 */
export function annotationAspectLockPolicy(annotation: CanvasAnnotation): AspectLockPolicy {
  switch (annotation.kind) {
    case 'image':
      return 'default-on';
    case 'text':
      return 'default-off';
    case 'suppressionRegion':
      return 'default-off';
  }
}

/**
 * Whether this kind may be hidden at all.
 *
 * False for a suppression region and true for everything else: a region hides
 * findings, and a suppressor you cannot see is a footgun with no counterpart in
 * the other kinds. The type already refuses `hidden: true` on the region, and
 * both its factory and its `.osf` validator enforce it; this is the same rule
 * for the paths that carry an update as data — the store's `updateAnnotation`
 * and any inspector offering a hide control — where the union's `hidden` is
 * still `boolean`.
 */
export function annotationCanHide(annotation: CanvasAnnotation): boolean {
  return !isSuppressionRegionAnnotation(annotation);
}

/**
 * The part of `patch` this annotation is allowed to take.
 *
 * Today that means dropping `hidden` from an update aimed at a suppression
 * region. {@link AnnotationUpdate} is a *union*, so `{ hidden: true }` typechecks
 * against the image member and the compiler has nothing to say about which
 * annotation the id resolves to — the store is where the two finally meet, and
 * so the only place the rule can be enforced on data.
 *
 * Dropping the field rather than rejecting the whole update, because a patch
 * usually carries other fields that are perfectly legal, and losing a legitimate
 * move because it travelled next to an illegal `hidden` would be the worse
 * failure. Silently hiding a suppressor is the one that is not recoverable by
 * looking at the screen.
 */
export function allowedAnnotationUpdate(
  annotation: CanvasAnnotation,
  patch: AnnotationUpdate
): AnnotationUpdate {
  if (!('hidden' in patch) || annotationCanHide(annotation)) return patch;
  const { hidden: _dropped, ...rest } = patch as AnnotationUpdate & { hidden?: boolean };
  return rest as AnnotationUpdate;
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
