/**
 * A field of the Layers pane asked for by the canvas: a label's or a callout's
 * text just put down (D8: "labels by click, focusing the Step pane's label
 * field", the Layers pane's since), or new equal divisions' count (Revision 2,
 * ED5). The canvas and the pane are different dock panels, so the request
 * goes through here: the field takes it when it shows that annotation and is
 * in the page — now, as soon as it mounts, or as soon as its tab comes
 * forward (`useFieldFocusRequest`).
 */

/** Which of an annotation's fields: a label's or a callout's text, equal divisions' parts, or an x-ray's depth (Revision 3). */
export type FocusField = 'text' | 'parts' | 'depth';

/** A field asked for: the annotation's, and which. */
export interface FieldFocusRequest {
  annotationId: string;
  field: FocusField;
}

let pending: FieldFocusRequest | null = null;
const listeners = new Set<(request: FieldFocusRequest) => void>();

export function requestFieldFocus(annotationId: string, field: FocusField): void {
  pending = { annotationId, field };
  for (const listener of listeners) listener(pending);
}

/** Take a request for `annotationId`'s `field`, if one is waiting: true once, then false. */
export function takeFieldFocus(annotationId: string, field: FocusField): boolean {
  if (pending?.annotationId !== annotationId || pending.field !== field) return false;
  pending = null;
  return true;
}

/** The field a request waits for, if one does. */
export function pendingFieldFocus(): FieldFocusRequest | null {
  return pending;
}

/** Drop a waiting request: its annotation is no longer the one selected, or Annotate closed. */
export function cancelFieldFocus(): void {
  pending = null;
}

/** Hear every request; returns the unsubscribe. */
export function onFieldFocusRequest(listener: (request: FieldFocusRequest) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
