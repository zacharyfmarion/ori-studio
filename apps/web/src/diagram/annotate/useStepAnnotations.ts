import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { trackDiagramAnnotationBehind } from '../../analytics';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { isDiagramAnnotating, selectedDiagramPathNode } from '../../store/workspaceStore/diagramState';
import {
  annotationsOutOfStep,
  isKnownAnnotation,
  isLockedStep,
  stepById,
  type DiagramAngleTicks,
  type DiagramAsset,
  type DiagramPleatKinks,
  type DiagramRotation,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { stepPictureFrame } from '../pictures/pictureFrame';
import { EDIT_PATH } from './annotateTools';
import { buildAnnotationActions, type AnnotationEdit } from './annotationActions';
import { annotationEventKind } from './annotationEventKind';
import { withBehind, withBehindLayers, withCloseUpScale, withWhiteArrowLook, type WhiteArrowLook } from './annotationModel';
import { pathNodesOf } from './annotationPath';
import { applyAnnotationEdit } from './applyAnnotationEdit';
import { isLineKind, lineKindOf, type DiagramLineType } from './lineTypes';
import { pictureGeometry } from './pictureGeometry';

/**
 * A mark first put behind a flap, counted (15e): which of its ends — a
 * circle's, its whole ring — and how many layers lie over them.
 */
function trackBehind(annotation: KnownDiagramAnnotation): void {
  const { from, to } = annotation.behind ?? {};
  const ends = annotation.kind === 'circle' ? 'whole' : from !== undefined && to !== undefined ? 'both' : from !== undefined ? 'tail' : 'tip';
  const deep = from ?? to ?? 1;
  trackDiagramAnnotationBehind(annotationEventKind(annotation), ends, deep >= 3 ? '3+' : deep === 2 ? '2' : '1');
}

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
  const style = useWorkspaceStore((state) => state.diagram?.style);
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
    /** The annotation as the store has it now. */
    const current = (id: string) => {
      const diagram = store().diagram;
      const found = diagram && stepId !== null ? stepById(diagram, stepId)?.annotations.find((annotation) => annotation.id === id) : undefined;
      return found && isKnownAnnotation(found) ? found : null;
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
      /** A white arrow's width, tail or fill, or any of them together, as one undo step. */
      setWhiteArrowLook: (id: string, look: WhiteArrowLook) =>
        change(id, 'Change white arrow', (annotation) => withWhiteArrowLook(annotation, look)),
      /** An angle mark's ticks across each half (15b), as one undo step. */
      setTicks: (id: string, ticks: DiagramAngleTicks) =>
        change(id, 'Change angle mark', (annotation) => ({ ...annotation, ticks })),
      /** A pleat arrow's Zs (15c), as one undo step. */
      setKinks: (id: string, kinks: DiagramPleatKinks) =>
        change(id, 'Change pleat arrow', (annotation) => ({ ...annotation, kinks })),
      /** How many times larger a close-up draws its area (15f), held to its range, as one undo step. */
      setCloseUpScale: (id: string, scale: number) =>
        change(id, 'Change close-up', (annotation) => withCloseUpScale(annotation, scale)),
      /** A line made another type (15a): the same line, its ends and id kept, as one undo step. */
      setLineType: (id: string, type: DiagramLineType) =>
        change(id, 'Change line type', (annotation) =>
          isLineKind(annotation.kind) ? { ...annotation, kind: lineKindOf(type) } : annotation
        ),
      /**
       * One end of a mark put behind a flap or brought back in front (15e), as
       * one undo step: behind as deep as an end already is, else one layer
       * down. The first end put behind is counted.
       */
      setBehind: (id: string, end: 'from' | 'to', behind: boolean) => {
        const before = current(id);
        change(id, 'Change behind', (annotation) =>
          withBehind(annotation, end, behind ? (annotation.behind?.from ?? annotation.behind?.to ?? 1) : null)
        );
        const after = current(id);
        if (before && !before.behind && after?.behind) trackBehind(after);
      },
      /** How many layers lie over every end of a mark that is behind (15e), as one undo step. */
      setBehindLayers: (id: string, layers: number) =>
        change(id, 'Change behind', (annotation) => withBehindLayers(annotation, layers)),
      setSnap: (value: boolean) => useSettingsStore.getState().setDiagramAnnotateSnap(value),
    };
  }, [stepId, loadId]);

  // Only a flat fold knows its layers, and so its flaps (15e).
  const knowsFlaps = useMemo(() => step !== null && pictureGeometry(step, assets, style).kind === 'flat-fold', [step, assets, style]);

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
    /** Whether the step's picture knows its flaps, so a mark can be put behind one: a flat fold's (15e). */
    knowsFlaps,
    ...verbs,
  };
}
