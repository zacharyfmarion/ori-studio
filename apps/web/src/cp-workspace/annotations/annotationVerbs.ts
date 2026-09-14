import type { TFunction } from 'i18next';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { AnnotationKind } from './annotationBase';
import type { AnnotationUpdate } from './annotation';
import { annotationGesture } from './annotationGesture';

/**
 * The annotation layer's one-entry edits as React-free functions over the
 * layer's bracket, so the canvas hooks, the context menu and the Properties
 * pane share one implementation without mounting `useCpAnnotations` (which
 * needs the panel's overlay view and viewport ref).
 *
 * Every function is `annotationGesture.run('verb', label, …)`: it lands as one
 * undo entry, and is refused — does nothing — while another owner holds the
 * layer, which is what keeps a click mid-drag from recording against a
 * baseline that is still moving.
 */

export interface AnnotationVerbLabels {
  bringToFront: string;
  sendToBack: string;
  delete: string;
}

/**
 * History labels per kind. Literal keys so the extractor sees them; exhaustive
 * so a new annotation kind adds one row here rather than editing three verbs
 * (and stops recording "Bring image to front" for a text box, as every kind
 * used to).
 */
export function annotationVerbLabels(kind: AnnotationKind, t: TFunction): AnnotationVerbLabels {
  switch (kind) {
    case 'image':
      return {
        bringToFront: t('panels:creasePattern.bringImageToFront', 'Bring image to front'),
        sendToBack: t('panels:creasePattern.sendImageToBack', 'Send image to back'),
        delete: t('panels:creasePattern.deleteImage', 'Delete image'),
      };
    case 'text':
      return {
        bringToFront: t('panels:creasePattern.bringTextToFront', 'Bring text to front'),
        sendToBack: t('panels:creasePattern.sendTextToBack', 'Send text to back'),
        delete: t('panels:textAnnotation.deleteText', 'Delete text'),
      };
    case 'suppressionRegion':
      return {
        bringToFront: t('panels:cpRegion.bringToFront', 'Bring region to front'),
        sendToBack: t('panels:cpRegion.sendToBack', 'Send region to back'),
        delete: t('panels:cpRegion.delete', 'Delete region'),
      };
  }
}

function annotationKindOf(id: string): AnnotationKind | null {
  return (
    useWorkspaceStore.getState().oristudioCpAnnotations.find((annotation) => annotation.id === id)
      ?.kind ?? null
  );
}

/** One discrete property edit as one undo entry. */
export function updateAnnotationAsEntry(id: string, patch: AnnotationUpdate, label: string): void {
  void annotationGesture.run('verb', label, () =>
    useWorkspaceStore.getState().updateAnnotation(id, patch)
  );
}

export function bringAnnotationToFront(id: string, t: TFunction): void {
  const kind = annotationKindOf(id);
  if (!kind) return;
  const annotations = useWorkspaceStore.getState().oristudioCpAnnotations;
  const maxZ = annotations.reduce((max, annotation) => Math.max(max, annotation.z), 0);
  updateAnnotationAsEntry(id, { z: maxZ + 1 }, annotationVerbLabels(kind, t).bringToFront);
}

export function sendAnnotationToBack(id: string, t: TFunction): void {
  const kind = annotationKindOf(id);
  if (!kind) return;
  const annotations = useWorkspaceStore.getState().oristudioCpAnnotations;
  const minZ = annotations.reduce((min, annotation) => Math.min(min, annotation.z), 0);
  updateAnnotationAsEntry(id, { z: minZ - 1 }, annotationVerbLabels(kind, t).sendToBack);
}

/**
 * Delete an image or a text box. A region's delete is `useCpRegionActions.removeRegion`,
 * which also removes the owned reference image and clears the pins inside it;
 * this refuses a region rather than doing half of that.
 */
export function deleteAnnotation(id: string, t: TFunction): void {
  const kind = annotationKindOf(id);
  if (!kind || kind === 'suppressionRegion') return;
  void annotationGesture.run('verb', annotationVerbLabels(kind, t).delete, () =>
    useWorkspaceStore.getState().removeAnnotation(id)
  );
}
