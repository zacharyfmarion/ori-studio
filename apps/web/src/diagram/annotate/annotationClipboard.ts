/**
 * Annotations on the workspace clipboard (Zach, 2026-10-05): what Copy takes
 * of a step's marks, and what Paste puts on a step — fresh copies, in place
 * on another step, so a mark carried from step to step lands where it was;
 * down and right on the step a copy came from, so it shows beside its
 * original; and each further paste on a step a further step on, so repeats
 * never stack. Cut takes the original away, so its first paste goes back
 * where it was.
 *
 * Pure: no DOM, no store.
 */
import { randomDiagramId, type DiagramIdFactory, type KnownDiagramAnnotation } from '../document/diagramDocument';
import { moveAnnotation } from './annotationModel';

/** Annotations copied from a step, as the clipboard holds them. */
export interface DiagramAnnotationClipboardPayload {
  kind: 'diagram-annotations';
  /** As they were when copied: an edit made since does not reach them. */
  annotations: readonly KnownDiagramAnnotation[];
  /**
   * How many lie where the next paste on each step would: the copies pasted
   * there — and on the step they were copied from, the originals.
   */
  pastes: Readonly<Record<string, number>>;
}

/** How far down and right a paste is put from the one before it on a step, in picture units. */
export const PASTE_OFFSET = 0.03;

/**
 * `annotations` of the step `stepId` on the clipboard: copied, the originals
 * still lie where they are; cut (`cut`), they do not.
 */
export function annotationClipboard(
  annotations: readonly KnownDiagramAnnotation[],
  stepId: string,
  { cut = false }: { cut?: boolean } = {}
): DiagramAnnotationClipboardPayload {
  return { kind: 'diagram-annotations', annotations: [...annotations], pastes: cut ? {} : { [stepId]: 1 } };
}

/**
 * The copies a paste puts on the step `stepId`: each with a fresh id, moved
 * down and right by {@link PASTE_OFFSET} for each that already lies there
 * ({@link DiagramAnnotationClipboardPayload.pastes}). Kept within reach, as a
 * move is.
 */
export function pastedAnnotations(
  clipboard: DiagramAnnotationClipboardPayload,
  stepId: string,
  newId: DiagramIdFactory = randomDiagramId
): KnownDiagramAnnotation[] {
  const offset = PASTE_OFFSET * (clipboard.pastes[stepId] ?? 0);
  return clipboard.annotations.map((annotation) => ({ ...moveAnnotation(annotation, [offset, offset]), id: newId('annotation') }));
}

/** The clipboard once its annotations have been pasted on `stepId` again. */
export function pastedOnto(clipboard: DiagramAnnotationClipboardPayload, stepId: string): DiagramAnnotationClipboardPayload {
  return { ...clipboard, pastes: { ...clipboard.pastes, [stepId]: (clipboard.pastes[stepId] ?? 0) + 1 } };
}
