/**
 * A label or a callout just put down asks for its text field (D8: "labels by
 * click, focusing the Step pane's label field"). The canvas and the Step pane
 * are different dock panels, so the request goes through here: the field
 * takes it when it shows that annotation, now or as soon as it mounts.
 */
let pending: string | null = null;
const listeners = new Set<(annotationId: string) => void>();

export function requestLabelFocus(annotationId: string): void {
  pending = annotationId;
  for (const listener of listeners) listener(annotationId);
}

/** Take a request for `annotationId`, if one is waiting: true once, then false. */
export function takeLabelFocus(annotationId: string): boolean {
  if (pending !== annotationId) return false;
  pending = null;
  return true;
}

/** The label a request waits for, if one does. */
export function pendingLabelFocus(): string | null {
  return pending;
}

/** Drop a waiting request: its label is no longer the one selected, or Annotate closed. */
export function cancelLabelFocus(): void {
  pending = null;
}

/** Hear every request; returns the unsubscribe. */
export function onLabelFocusRequest(listener: (annotationId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
