import { trackDiagramArrowShaped } from '../../analytics';
import type { DiagramShapedArrowKind } from '../../analytics/events';
import type { WorkspaceState } from '../../store/workspaceStore/types';
import {
  isKnownAnnotation,
  stepById,
  type DiagramAnnotationKind,
  type DiagramDocument,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import type { AnnotationEdit } from './annotationActions';
import { isShapedArrow } from './annotationModel';

/**
 * Make one of the catalog's edits (`annotationActions.ts`) on a step, as one
 * undo step through the store — the binding every surface shares: the Step
 * pane, the keys, Delete and the canvas's gestures. Here, not in each, it
 * counts an arrow shaped for the first time (`diagram arrow shaped`): once,
 * when the edit makes an arc a path, or a white arrow no longer straight
 * (`isShapedArrow`), never for the edits after. Whether anything changed.
 */
export function applyAnnotationEdit(
  workspace: Pick<WorkspaceState, 'diagram' | 'editDiagramAnnotations'>,
  stepId: string,
  { label, edit, select, selectPathNode, shapes }: AnnotationEdit,
  options: { loadId?: number } = {}
): boolean {
  const before = shapes ? annotationIn(workspace.diagram, stepId, shapes.annotationId) : null;
  const changed = workspace.editDiagramAnnotations(stepId, label, edit, {
    ...(select !== undefined ? { select } : {}),
    ...(selectPathNode !== undefined ? { selectPathNode } : {}),
    ...options,
  });
  if (changed && shapes && before && !isShapedArrow(before)) {
    // The edit is pure: what it made of the arrow, without reading the store back.
    const after = edit([before]).find((annotation) => annotation.id === shapes.annotationId);
    const kind = shapedKind(before.kind);
    if (after && isShapedArrow(after) && kind) trackDiagramArrowShaped(kind, shapes.gesture);
  }
  return changed;
}

function annotationIn(
  diagram: DiagramDocument | null,
  stepId: string,
  annotationId: string
): KnownDiagramAnnotation | null {
  const annotation = diagram ? stepById(diagram, stepId)?.annotations.find((each) => each.id === annotationId) : undefined;
  return annotation && isKnownAnnotation(annotation) ? annotation : null;
}

/** A shaped arrow's kind in the event's spelling; null for a kind that is never shaped. */
function shapedKind(kind: DiagramAnnotationKind): DiagramShapedArrowKind | null {
  switch (kind) {
    case 'valley-arrow':
      return 'valley_arrow';
    case 'mountain-arrow':
      return 'mountain_arrow';
    case 'fold-unfold-arrow':
      return 'fold_unfold_arrow';
    case 'white-arrow':
      return 'white_arrow';
    case 'push-arrow':
    case 'turn-over':
    case 'rotate':
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
    case 'label':
    case 'circle':
    case 'right-angle':
    case 'callout':
    case 'angle-mark':
      return null;
  }
}
