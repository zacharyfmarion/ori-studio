import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  trackDiagramAnnotationBehind,
  trackDiagramAnnotationRecolored,
  trackDiagramMarkStyled,
  trackDiagramTextStyled,
} from '../../analytics';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { isDiagramAnnotating, selectedDiagramPathNode } from '../../store/workspaceStore/diagramState';
import {
  annotationsOutOfStep,
  isKnownAnnotation,
  isLockedStep,
  stepById,
  type DiagramTicks,
  type DiagramAsset,
  type DiagramPleatKinks,
  type DiagramRotation,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { EDIT_PATH } from './annotateTools';
import { buildAnnotationActions, type AnnotationEdit } from './annotationActions';
import { annotationEventColor, annotationEventKind, starFillName, textSizeName, textToggleName } from './annotationEventKind';
import {
  hasTicks,
  withBehind,
  withBehindLayers,
  withCloseUpScale,
  withColor,
  withDivisionsOffset,
  withNumbered,
  withParts,
  withShortDividers,
  withStarFill,
  withTextStyle,
  withWhiteArrowLook,
  type WhiteArrowLook,
} from './annotationModel';
import { pathNodesOf } from './annotationPath';
import { applyAnnotationEdit } from './applyAnnotationEdit';
import { isLineKind, lineKindOf, type DiagramLineType } from './lineTypes';
import type { DiagramStarFill } from './starFill';
import { boxedMarkOf } from './transformGrips';
import { markGeometry, viewFrame, viewOfStep } from '../zoom/stepView';
import { makeStepMarksEditable } from '../references/makeMarksEditable';
import { editableCardMarks } from '../references/referencesCardMarks';

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

/** One of a label's options, as the Layers pane sets it (17b): Bold or a halo on or off, or its size in pt — null for With the picture. */
export type TextStyleOption = { option: 'bold' | 'halo'; value: boolean } | { option: 'size'; value: number | null };

/** The colour pick last counted (17a): every move of one pick is one recolouring. Picks are numbered app-wide (`DiagramColorSelect`). */
let countedPick: number | null = null;
const NO_ASSETS: Readonly<Record<string, DiagramAsset>> = {};

/**
 * A step's annotations (D13), for the Step pane (the Snap switch, the notice
 * that the picture changed, the notice that a References step's card's marks
 * are part of its picture, with Make Editable) and the Layers pane (the list and the selected
 * one's controls): what the selected step carries, which
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
      /** Annotate's notice's Make Editable (17e), in the Step pane or the Layers pane: the card's marks lifted out of the picture. */
      makeMarksEditable: (via: 'annotate_notice' | 'layers_notice') => {
        if (stepId !== null) makeStepMarksEditable(stepId, via);
      },
      setText: (id: string, text: string, session: number) =>
        change(id, 'Edit label', (annotation) => ({ ...annotation, text }), session),
      setRotation: (id: string, rotate: DiagramRotation) => change(id, 'Change rotation', (annotation) => ({ ...annotation, rotate })),
      setAxis: (id: string, axis: 'vertical' | 'horizontal') =>
        change(id, 'Change turn-over', (annotation) => ({ ...annotation, axis })),
      /** A white arrow's width, tail or fill, or any of them together, as one undo step. */
      setWhiteArrowLook: (id: string, look: WhiteArrowLook) =>
        change(id, 'Change white arrow', (annotation) => withWhiteArrowLook(annotation, look)),
      /** An angle mark's ticks across each half (15b), or equal divisions' on each part (ED7), as one undo step. */
      setTicks: (id: string, ticks: DiagramTicks) =>
        change(id, current(id)?.kind === 'divisions' ? 'Change equal divisions' : 'Change angle mark', (annotation) =>
          hasTicks(annotation.kind) ? { ...annotation, ticks } : annotation
        ),
      /** How many parts equal divisions cut their line into (ED5), held to two to thirty-two, as one undo step. */
      setParts: (id: string, parts: number) =>
        change(id, 'Change equal divisions', (annotation) =>
          annotation.kind === 'divisions' ? withParts(annotation, parts) : annotation
        ),
      /** How far equal divisions' line stands off the line they measure, in mm (ED3), as one undo step. */
      setDivisionsOffset: (id: string, offset: number) =>
        change(id, 'Change equal divisions', (annotation) =>
          annotation.kind === 'divisions' ? withDivisionsOffset(annotation, offset) : annotation
        ),
      /** Whether equal divisions print their count (ED6), as one undo step. */
      setNumbered: (id: string, numbered: boolean) =>
        change(id, 'Change equal divisions', (annotation) =>
          annotation.kind === 'divisions' ? withNumbered(annotation, numbered) : annotation
        ),
      /**
       * Whether equal divisions' dividers between their ends are short
       * strokes across their line (Revision 3, R3-1 A), as one undo step,
       * counted when it changes them.
       */
      setShortDividers: (id: string, short: boolean) => {
        const before = current(id);
        change(id, 'Change equal divisions', (annotation) =>
          annotation.kind === 'divisions' ? withShortDividers(annotation, short) : annotation
        );
        const after = current(id);
        if (!before || !after || before.shortDividers === after.shortDividers) return;
        trackDiagramMarkStyled(annotationEventKind(after), 'short_dividers', after.shortDividers ? 'on' : 'off');
      },
      /** A star filled or an outline (Revision 3, R3-4 C), as one undo step, counted when it changes it. */
      setStarFill: (id: string, fill: DiagramStarFill) => {
        const before = current(id);
        change(id, 'Change star', (annotation) => (annotation.kind === 'star' ? withStarFill(annotation, fill) : annotation));
        const after = current(id);
        if (!before || !after || before.fill === after.fill) return;
        trackDiagramMarkStyled(annotationEventKind(after), 'fill', starFillName(after));
      },
      /**
       * A boxed mark's turn typed in its Rotation row (Revision 3, R3-33 A),
       * in degrees clockwise, written as its kind writes a turn
       * (`boxedMarkOf`), as one undo step — the transform box's own label —
       * counted when it turns it.
       */
      setMarkAngle: (id: string, degrees: number) => {
        const before = current(id);
        change(id, 'Rotate annotation', (annotation) => boxedMarkOf(annotation)?.turned(degrees) ?? annotation);
        const after = current(id);
        if (!before || !after || before.angle === after.angle) return;
        trackDiagramMarkStyled(annotationEventKind(after), 'rotation', 'field');
      },
      /** A pleat arrow's Zs (15c), as one undo step. */
      setKinks: (id: string, kinks: DiagramPleatKinks) =>
        change(id, 'Change pleat arrow', (annotation) => ({ ...annotation, kinks })),
      /** How many times larger a close-up draws its area (15f), held to its range, as one undo step. */
      setCloseUpScale: (id: string, scale: number) =>
        change(id, 'Change close-up', (annotation) => withCloseUpScale(annotation, scale)),
      /**
       * A line made another type (15a): the same line, its ends and id kept,
       * as one undo step. A solid line made another type loses its colour (17a).
       */
      setLineType: (id: string, type: DiagramLineType) =>
        change(id, 'Change line type', (annotation) =>
          isLineKind(annotation.kind) ? withColor({ ...annotation, kind: lineKindOf(type) }, annotation.color ?? null) : annotation
        ),
      /**
       * A solid line's colour (17a), null for the style's ink, as one undo
       * step — every move of one pick in the colour picker (`pick`) the same
       * step — and counted once per pick.
       */
      setColor: (id: string, color: string | null, pick?: number) => {
        const before = current(id);
        change(id, 'Change color', (annotation) => withColor(annotation, color), pick);
        const after = current(id);
        if (!before || !after || before.color === after.color) return;
        if (pick !== undefined && countedPick === pick) return;
        countedPick = pick ?? null;
        const name = annotationEventColor(after);
        if (name) trackDiagramAnnotationRecolored(annotationEventKind(after), name);
      },
      /**
       * A label's Bold, halo or size (17b), as one undo step, counted when it
       * changes what the label is: `size` in pt, or null for With the picture.
       */
      setTextStyle: (id: string, option: TextStyleOption) => {
        const before = current(id);
        const label = option.option === 'size' ? 'Change text size' : option.option === 'bold' ? 'Change bold' : 'Change halo';
        const style = option.option === 'size' ? { sizePt: option.value } : { [option.option]: option.value };
        change(id, label, (annotation) => withTextStyle(annotation, style));
        const after = current(id);
        // Counted once it changed what the label is, not for a choice it already had.
        if (!before || !after || before === after) return;
        if (option.option === 'size') trackDiagramTextStyled('size', textSizeName(after.sizePt));
        else trackDiagramTextStyled(option.option, textToggleName(after[option.option]));
      },
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

  // A References step whose card's marks are part of its picture (17e, RM8): Annotate says so, and offers to lift them.
  const cardMarks = useMemo(() => (step && style ? editableCardMarks(step, style) : null), [step, style]);

  // Only a flat fold knows its layers, and so its flaps (15e).
  const knowsFlaps = useMemo(() => step !== null && markGeometry(step, assets, style).kind === 'flat-fold', [step, assets, style]);

  const selected = known.find((annotation) => annotation.id === selectedId) ?? null;
  const editingPath = tool === EDIT_PATH;
  // The frame the marks are measured in: an enlarged step's window (Revision 2).
  const frame = useMemo(() => (step ? viewFrame(viewOfStep(step), assets) : null) ?? undefined, [step, assets]);
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
    /**
     * What Make Editable would lift from a References step's card whose marks
     * are part of its picture (17e), and whether they fit; null for any other step.
     */
    cardMarks,
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
