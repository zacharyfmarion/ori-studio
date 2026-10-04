import type { TFunction } from 'i18next';
import type { ShortcutActionId } from '../../keyboard/shortcuts';
import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import { flipAnnotationArc, flipsArc } from './annotationModel';

/**
 * The verbs an annotation offers, for every surface that offers them: the
 * Step pane's buttons under the selected annotation, and Annotate's keys — F,
 * and Delete through `edit.delete`.
 *
 * `foldedFigureActions.ts`'s shape: React-free and store-free, taking the
 * annotation and a bound edit and returning plain data. A verb's gate and its
 * edit are here once, so the pane and the keys cannot drift, and each surface
 * owns only its rendering.
 */
export type AnnotationActionId = 'flip-arc' | 'delete';

/** The verbs in the order a surface shows them: the annotation's own, then Delete. */
const ANNOTATION_ACTION_ORDER: readonly AnnotationActionId[] = ['flip-arc', 'delete'];

/** The key that runs each verb. */
const ANNOTATION_ACTION_SHORTCUTS: Readonly<Record<AnnotationActionId, ShortcutActionId>> = {
  'flip-arc': 'diagram.flipArc',
  delete: 'edit.delete',
};

/** A change to a step's readable annotations, made as one undo step called `label`. */
export interface AnnotationEdit {
  label: string;
  edit: (annotations: readonly KnownDiagramAnnotation[]) => readonly KnownDiagramAnnotation[];
  /** The annotation selected after it; absent, the selection stays. */
  select?: string | null;
}

export interface AnnotationAction {
  id: AnnotationActionId;
  label: string;
  disabled: boolean;
  /**
   * The key that runs the same verb, for a surface that shows chords. Its own
   * path: the key goes through the shortcut runtime, which applies the same
   * edit ({@link annotationActionEdit}).
   */
  shortcutId: ShortcutActionId;
  run: () => void;
}

export interface AnnotationActionDeps {
  t: TFunction;
  /** Make the edit on the step the annotation is drawn on. */
  apply: (edit: AnnotationEdit) => void;
}

/** Whether `annotation` offers a verb at all: Flip arc only an arc to flip; Delete, every one. */
export function offersAnnotationAction(id: AnnotationActionId, annotation: KnownDiagramAnnotation): boolean {
  switch (id) {
    case 'flip-arc':
      return flipsArc(annotation.kind);
    case 'delete':
      return true;
  }
}

/**
 * What a verb does to the annotation `annotationId` names, as an edit of its
 * step's list. Applied to the list as it is when it lands, so an edit made in
 * between is kept.
 */
export function annotationActionEdit(id: AnnotationActionId, annotationId: string): AnnotationEdit {
  switch (id) {
    case 'flip-arc':
      return {
        label: 'Flip arc',
        edit: (annotations) =>
          annotations.map((annotation) => (annotation.id === annotationId ? flipAnnotationArc(annotation) : annotation)),
      };
    case 'delete':
      return {
        label: 'Delete annotation',
        edit: (annotations) => annotations.filter((annotation) => annotation.id !== annotationId),
        select: null,
      };
  }
}

function annotationActionLabel(t: TFunction, id: AnnotationActionId): string {
  switch (id) {
    case 'flip-arc':
      return t('tools:diagram.flipArc', 'Flip Arc');
    case 'delete':
      return t('panels:diagram.annotations.delete', 'Delete');
  }
}

/** The verbs `annotation` offers, in order, each enabled only on a step that can change. */
export function buildAnnotationActions(
  annotation: KnownDiagramAnnotation,
  state: { editable: boolean },
  deps: AnnotationActionDeps
): AnnotationAction[] {
  return ANNOTATION_ACTION_ORDER.filter((id) => offersAnnotationAction(id, annotation)).map((id) => ({
    id,
    label: annotationActionLabel(deps.t, id),
    disabled: !state.editable,
    shortcutId: ANNOTATION_ACTION_SHORTCUTS[id],
    run: () => deps.apply(annotationActionEdit(id, annotation.id)),
  }));
}
