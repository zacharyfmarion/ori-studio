import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagramWhiteArrowWidth } from '../../cp-workspace/references/diagram/diagramInk';
import type { WhiteArrowTail } from '../../cp-workspace/references/stepDiagramGeometry';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { isDiagramAnnotating, selectedDiagramPathNode } from '../../store/workspaceStore/diagramState';
import {
  annotationsOutOfStep,
  isKnownAnnotation,
  isLockedStep,
  type DiagramAngleTicks,
  type DiagramAsset,
  type DiagramRotation,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { stepPictureFrame } from '../pictures/pictureFrame';
import { EDIT_PATH } from './annotateTools';
import { buildAnnotationActions, type AnnotationEdit } from './annotationActions';
import { pathNodesOf } from './annotationPath';
import { applyAnnotationEdit } from './applyAnnotationEdit';
import { isLineKind, lineKindOf, type DiagramLineType } from './lineTypes';

const NO_ANNOTATIONS: readonly KnownDiagramAnnotation[] = [];
const NO_ASSETS: Readonly<Record<string, DiagramAsset>> = {};

/**
 * The Step pane's annotations (D13): what the selected step carries, which
 * one is selected, and the verbs on the selected one — its
 * text, its turn, its axis, a white arrow's look, a line's type, and the catalog's (`annotationActions.ts`: Flip
 * arc, Reset, Delete, and with Edit Path in hand the node verbs on the node
 * it has selected) — each one undo step through the store — and the Snap
 * switch, a preference rather than an edit.
 */
export function useStepAnnotations(step: DiagramStep | null) {
  const { t } = useTranslation();
  const annotating = useWorkspaceStore(isDiagramAnnotating);
  const tool = useWorkspaceStore((state) => state.diagramAnnotateTool);
  const selectedId = useWorkspaceStore((state) => state.diagramSelectedAnnotationId);
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const loadId = useWorkspaceStore((state) => state.diagramLoadId);
  const node = useWorkspaceStore(selectedDiagramPathNode);
  const assets = useWorkspaceStore((state) => state.diagram?.assets ?? NO_ASSETS);
  const snap = useSettingsStore((state) => state.diagramAnnotateSnap);
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
    /** A verb of the catalog's, made on this step as one undo step. */
    const apply = (edit: AnnotationEdit) => {
      if (stepId !== null) applyAnnotationEdit(store(), stepId, edit, { loadId });
    };
    return {
      apply,
      selectNode: (next: number | null) => store().selectDiagramPathNode(next),
      /**
       * A row of the list, pressed: its annotation selected, with Select in
       * hand to move it — or Edit Path kept, to shape it.
       */
      select: (id: string | null) => {
        store().selectDiagramAnnotation(id);
        if (id !== null && store().diagramAnnotateTool !== EDIT_PATH) store().setDiagramAnnotateTool(null);
      },
      annotate: () => {
        if (stepId !== null) store().openDiagramStep(stepId, 'annotate');
      },
      keep: () => {
        if (stepId !== null) store().keepDiagramAnnotations(stepId);
      },
      setText: (id: string, text: string, session: number) =>
        change(id, 'Edit label', (annotation) => ({ ...annotation, text }), session),
      setRotation: (id: string, rotate: DiagramRotation) => change(id, 'Change rotation', (annotation) => ({ ...annotation, rotate })),
      setAxis: (id: string, axis: 'vertical' | 'horizontal') =>
        change(id, 'Change turn-over', (annotation) => ({ ...annotation, axis })),
      /** A white arrow's width or tail, or both, as one undo step. */
      setWhiteArrowLook: (id: string, look: { width?: DiagramWhiteArrowWidth; tail?: WhiteArrowTail }) =>
        change(id, 'Change white arrow', (annotation) => ({ ...annotation, ...look })),
      /** An angle mark's ticks across each half (15b), as one undo step. */
      setTicks: (id: string, ticks: DiagramAngleTicks) =>
        change(id, 'Change angle mark', (annotation) => ({ ...annotation, ticks })),
      /** A line made another type (15a): the same line, its ends and id kept, as one undo step. */
      setLineType: (id: string, type: DiagramLineType) =>
        change(id, 'Change line type', (annotation) =>
          isLineKind(annotation.kind) ? { ...annotation, kind: lineKindOf(type) } : annotation
        ),
      setSnap: (value: boolean) => useSettingsStore.getState().setDiagramAnnotateSnap(value),
    };
  }, [stepId, loadId]);

  const selected = known.find((annotation) => annotation.id === selectedId) ?? null;
  const editingPath = tool === EDIT_PATH;
  const frame = useMemo(() => (step ? stepPictureFrame(step, assets) : null) ?? undefined, [step, assets]);
  const { apply, selectNode } = verbs;
  /** The selected annotation's verbs from the catalog, in the pane's order. */
  const actions = useMemo(
    () =>
      selected
        ? buildAnnotationActions(selected, { editable, editingPath, node, frame }, { t, apply, selectNode })
        : [],
    [selected, editable, editingPath, node, frame, t, apply, selectNode]
  );

  return {
    annotating,
    known,
    /** Annotations a newer build made, which this one keeps but cannot show. */
    unknownCount: step ? step.annotations.length - known.length : 0,
    /** They were drawn on another picture (D8): Annotate says so until they are touched. */
    outOfStep: step !== null && step.picture !== null && annotationsOutOfStep(step),
    selected,
    editable,
    actions,
    /** In Edit Path, the node selected on the selected fold arrow, and how many it shows. */
    node,
    nodeCount: selected ? (pathNodesOf(selected)?.length ?? 0) : 0,
    /** Whether circles, right angles, callouts' points and lines' ends snap to the picture (decision 9): Annotate's switch. */
    snap,
    ...verbs,
  };
}
