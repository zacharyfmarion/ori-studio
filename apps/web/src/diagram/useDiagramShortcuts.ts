import { useCallback, useEffect, useRef } from 'react';
import {
  registerArmedMode,
  registerDiagramShortcutExecutor,
  registerViewportShortcutExecutor,
  releaseShortcutViewportSurface,
  setActiveShortcutViewportSurface,
} from '../keyboard/shortcutRuntime';
import type { DiagramShortcutId, ViewportShortcutId } from '../keyboard/shortcuts';
import { useSettingsStore } from '../store/settingsStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { openDiagramStep } from './useDiagramActions';
import type { WorkspaceState } from '../store/workspaceStore/types';
import {
  activeAnchorPick,
  escapePutsPickDown,
  isDiagramAnnotating,
  selectedDiagramAnnotation,
  selectedDiagramPathNode,
} from '../store/workspaceStore/diagramState';
import { flipKeyEdit, nudgePathNodeEdit } from './annotate/annotationActions';
import { xrayStandingNow } from './xray/useXRayStanding';
import { xrayToolHeld } from './annotate/annotateTools';
import { applyAnnotationEdit } from './annotate/applyAnnotationEdit';
import { indexForStepNumber, stepById, stepsOf, type KnownDiagramAnnotation } from './document/diagramDocument';
import {
  focusLeavesEnterToSteps,
  focusOwnsArrowKeys,
  isAnnotateShortcut,
  runDiagramCancel,
  runDiagramShortcut,
  type DiagramKeyActions,
  type DiagramKeyState,
} from './actions/diagramShortcuts';

function keyState(state: WorkspaceState): DiagramKeyState {
  return {
    // The grid walks its steps and the turns between them (D22); the detail, which shows steps, the steps.
    stepIds: !state.diagram
      ? []
      : (state.diagramDetail !== null ? stepsOf(state.diagram) : state.diagram.steps).map((entry) => entry.id),
    selectedStepId: state.diagramSelectedStepId,
    focusedStepId: focusedStepId(),
    readOnly: state.diagramReadOnly,
    detailOpen: state.diagramDetail !== null,
    browserOpen: state.diagramReferencesBrowser !== null,
    anchorPick: activeAnchorPick(state) !== null,
    annotate:
      isDiagramAnnotating(state)
        ? {
            tool: state.diagramAnnotateTool,
            lineType: useSettingsStore.getState().diagramAnnotateLineType,
            selectedAnnotationId: state.diagramSelectedAnnotationId,
            canFlipArc: offersFlipArc(selectedDiagramAnnotation(state)),
            selectedPathNode: selectedDiagramPathNode(state),
            enlarged: state.diagram && state.diagramSelectedStepId !== null
              ? stepById(state.diagram, state.diagramSelectedStepId)?.zoom !== undefined
              : false,
            xrayHeld: xrayHeldOn(state),
          }
        : null,
  };
}

/** Whether the X-Ray tool is held on the step open in Annotate (Revision 3, R3-18a A): its picture has no layers, or needs a Refresh. */
function xrayHeldOn(state: WorkspaceState): boolean {
  const step = state.diagram && state.diagramSelectedStepId !== null ? stepById(state.diagram, state.diagramSelectedStepId) : null;
  return step !== null && xrayToolHeld(xrayStandingNow(step));
}

/** Whether F flips the selected annotation: one with F's verb, which would change it (a straight arrow's key falls through). */
function offersFlipArc(annotation: KnownDiagramAnnotation | null): boolean {
  return annotation !== null && flipKeyEdit(annotation) !== null;
}

/** The step whose card has focus, if one does. */
function focusedStepId(): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active.getAttribute('role') !== 'option') return null;
  return active.dataset.stepId ?? null;
}

function keyActions(state: WorkspaceState): DiagramKeyActions {
  return {
    select: state.selectDiagramStep,
    // The detail walks steps only, so its moves name a step's place among the
    // steps; the document places it among the turns as the number field does.
    move: (stepId, toIndex) =>
      state.diagramDetail !== null && state.diagram
        ? state.moveDiagramStep(stepId, indexForStepNumber(state.diagram, stepId, toIndex + 1))
        : state.moveDiagramStep(stepId, toIndex),
    open: (stepId) => {
      openDiagramStep(stepId, 'keyboard');
    },
    close: state.closeDiagramStep,
    closeBrowser: state.closeDiagramReferencesBrowser,
    setTool: state.setDiagramAnnotateTool,
    setLineType: (type) => useSettingsStore.getState().setDiagramAnnotateLineType(type),
    selectAnnotation: state.selectDiagramAnnotation,
    selectPathNode: state.selectDiagramPathNode,
    flipArc: () => {
      const stepId = state.diagramSelectedStepId;
      const annotation = selectedDiagramAnnotation(state);
      const edit = annotation && flipKeyEdit(annotation);
      if (stepId === null || !edit) return;
      // The Layers pane's Flip Arc — on an eye, its Flip Horizontal — by the same edit (`annotationActions.ts`).
      applyAnnotationEdit(state, stepId, edit);
    },
    nudgePathNode: (delta) => {
      const stepId = state.diagramSelectedStepId;
      const id = state.diagramSelectedAnnotationId;
      const node = selectedDiagramPathNode(state);
      if (stepId === null || id === null || node === null) return;
      // One undo step a press: a held key's repeats are each one too.
      applyAnnotationEdit(state, stepId, nudgePathNodeEdit(id, node, delta));
    },
    cancelGesture: () => gestureCancel?.() ?? false,
    endAnchorPick: () => state.setDiagramAnchorPick(null),
  };
}

/** The Annotate canvas's drag, which Escape's first rung drops. */
let gestureCancel: (() => boolean) | null = null;

/** Hand Escape the canvas's drag: `cancel` drops it and says whether there was one. Returns its release. */
export function registerDiagramGestureCancel(cancel: () => boolean): () => void {
  gestureCancel = cancel;
  return () => {
    if (gestureCancel === cancel) gestureCancel = null;
  };
}

/**
 * The camera of the view on screen — the Pages view's zoom and fit — which the
 * Diagram's viewport executor asks for the verbs its own ladder declines.
 */
let viewCamera: ((id: ViewportShortcutId) => boolean) | null = null;

/** Hand the Diagram's viewport keys a view's camera; returns its release. */
export function registerDiagramViewCamera(camera: (id: ViewportShortcutId) => boolean): () => void {
  viewCamera = camera;
  return () => {
    if (viewCamera === camera) viewCamera = null;
  };
}

/**
 * Bind the Diagram's keys while its panel is mounted.
 *
 * Two registrations, one per kind of verb, both focus-independent (never a
 * `keydown` listener, AGENTS.md › Panel components):
 * - the `diagram` scope's executor — the arrows, Home and End between steps,
 *   Alt+arrows to move one, Enter to open one — which declines while a control
 *   that uses the key has focus;
 * - the `'diagram'` viewport surface's executor — Escape's cancel ladder, and
 *   Shift+F10 for the selected step's menu. It stays the surface's one owner:
 *   a view that brings a camera (Pages) registers it here
 *   ({@link registerDiagramViewCamera}), and the camera answers the zoom and
 *   fit keys the ladder leaves.
 *
 * The panel claims the viewport surface on mount and on every press inside it
 * (`onPointerDownCapture`, returned here), and releases it on unmount so the
 * next workspace's viewport keys do not go to a surface that is gone.
 */
export function useDiagramShortcuts(handlers: {
  /** Open the context menu for a step, from the keyboard. Whether it opened. */
  openStepMenu: (stepId: string) => boolean;
}): { onPointerDownCapture: () => void } {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    setActiveShortcutViewportSurface('diagram');
    const offScope = registerDiagramShortcutExecutor((id: DiagramShortcutId) => {
      // Enter belongs to whatever else has focus (a button clicks on it, a
      // link follows); the arrows only to the controls that use them.
      // Annotate's letters belong to no control that is not a field, and the
      // dispatcher stands down for fields before this runs.
      const declines =
        id === 'diagram.openStep'
          ? !focusLeavesEnterToSteps(document.activeElement)
          : !isAnnotateShortcut(id) && focusOwnsArrowKeys(document.activeElement);
      if (declines) return false;
      const state = useWorkspaceStore.getState();
      return runDiagramShortcut(id, keyState(state), keyActions(state));
    });
    const offViewport = registerViewportShortcutExecutor('diagram', (id: ViewportShortcutId) => {
      const state = useWorkspaceStore.getState();
      switch (id) {
        case 'viewport.cancel':
          return runDiagramCancel(keyState(state), keyActions(state));
        case 'viewport.contextMenu': {
          const stepId = state.diagramSelectedStepId;
          return stepId !== null && handlersRef.current.openStepMenu(stepId);
        }
        default:
          // The view's camera, if it has one; the Steps view has none, and
          // zoom, pan and rotate fall through.
          return viewCamera?.(id) ?? false;
      }
    });
    // The anchor's pick mode is put down by the first Escape, wherever the focus is: a touch sheet holding it leaves the key here.
    const offArmed = registerArmedMode(() => escapePutsPickDown(useWorkspaceStore.getState()));
    return () => {
      offScope();
      offViewport();
      offArmed();
      releaseShortcutViewportSurface('diagram');
    };
  }, []);

  const onPointerDownCapture = useCallback(() => setActiveShortcutViewportSurface('diagram'), []);
  return { onPointerDownCapture };
}
