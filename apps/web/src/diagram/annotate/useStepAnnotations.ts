import { useMemo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { isDiagramAnnotating } from '../../store/workspaceStore/diagramState';
import {
  annotationsOutOfStep,
  isKnownAnnotation,
  isLockedStep,
  type DiagramRotation,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { flipAnnotationArc } from './annotationModel';

const NO_ANNOTATIONS: readonly KnownDiagramAnnotation[] = [];

/**
 * The Step pane's annotations (D13): what the selected step carries, which
 * one is selected, the tool in hand, and the verbs on the selected one — its
 * text, its arc, its turn, its axis — each one undo step through the store.
 */
export function useStepAnnotations(step: DiagramStep | null) {
  const annotating = useWorkspaceStore(isDiagramAnnotating);
  const tool = useWorkspaceStore((state) => state.diagramAnnotateTool);
  const selectedId = useWorkspaceStore((state) => state.diagramSelectedAnnotationId);
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const loadId = useWorkspaceStore((state) => state.diagramLoadId);
  const known = useMemo(
    () => (step ? step.annotations.filter(isKnownAnnotation) : NO_ANNOTATIONS),
    [step]
  );
  const stepId = step?.id ?? null;
  const editable = step !== null && !readOnly && !isLockedStep(step) && step.picture !== null;

  const verbs = useMemo(() => {
    const store = () => useWorkspaceStore.getState();
    /** One annotation changed, as one undo step called `label`; `session` makes a sitting at a field one. */
    const change = (id: string, label: string, edit: (annotation: KnownDiagramAnnotation) => KnownDiagramAnnotation, session?: number) => {
      if (stepId === null) return;
      store().editDiagramAnnotations(
        stepId,
        label,
        (list) => list.map((annotation) => (annotation.id === id ? edit(annotation) : annotation)),
        { loadId, session }
      );
    };
    return {
      select: (id: string | null) => store().selectDiagramAnnotation(id),
      annotate: () => {
        if (stepId !== null) store().openDiagramStep(stepId, 'annotate');
      },
      keep: () => {
        if (stepId !== null) store().keepDiagramAnnotations(stepId);
      },
      setText: (id: string, text: string, session: number) =>
        change(id, 'Edit label', (annotation) => ({ ...annotation, text }), session),
      flip: (id: string) => change(id, 'Flip arc', flipAnnotationArc),
      setRotation: (id: string, rotate: DiagramRotation) => change(id, 'Change rotation', (annotation) => ({ ...annotation, rotate })),
      setAxis: (id: string, axis: 'vertical' | 'horizontal') =>
        change(id, 'Change turn-over', (annotation) => ({ ...annotation, axis })),
      remove: (id: string) => {
        if (stepId === null) return;
        store().editDiagramAnnotations(stepId, 'Delete annotation', (list) => list.filter((annotation) => annotation.id !== id), {
          select: null,
          loadId,
        });
      },
    };
  }, [stepId, loadId]);

  return {
    annotating,
    tool,
    known,
    /** Annotations a newer build made, which this one keeps but cannot show. */
    unknownCount: step ? step.annotations.length - known.length : 0,
    /** They were drawn on another picture (D8): Annotate says so until they are touched. */
    outOfStep: step !== null && step.picture !== null && annotationsOutOfStep(step),
    selected: known.find((annotation) => annotation.id === selectedId) ?? null,
    editable,
    ...verbs,
  };
}
