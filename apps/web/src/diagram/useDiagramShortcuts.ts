import { useCallback, useEffect, useRef } from 'react';
import {
  registerDiagramShortcutExecutor,
  registerViewportShortcutExecutor,
  releaseShortcutViewportSurface,
  setActiveShortcutViewportSurface,
} from '../keyboard/shortcutRuntime';
import type { DiagramShortcutId, ViewportShortcutId } from '../keyboard/shortcuts';
import { useWorkspaceStore } from '../store/workspaceStore';
import { openDiagramStep } from './useDiagramActions';
import type { WorkspaceState } from '../store/workspaceStore/types';
import { isDiagramAnnotating } from '../store/workspaceStore/diagramState';
import { flipAnnotationArc, isArrowKind } from './annotate/annotationModel';
import {
  indexForStepNumber,
  isKnownAnnotation,
  stepById,
  stepsOf,
  type KnownDiagramAnnotation,
} from './document/diagramDocument';
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
    annotate:
      isDiagramAnnotating(state)
        ? {
            tool: state.diagramAnnotateTool,
            selectedAnnotationId: state.diagramSelectedAnnotationId,
            selectedIsArrow: isArrowAnnotation(selectedAnnotation(state)),
          }
        : null,
  };
}

function isArrowAnnotation(annotation: KnownDiagramAnnotation | null): boolean {
  return annotation !== null && isArrowKind(annotation.kind);
}

/** The selected annotation, when it is one this build reads. */
function selectedAnnotation(state: WorkspaceState): KnownDiagramAnnotation | null {
  const { diagram, diagramSelectedStepId: stepId, diagramSelectedAnnotationId: id } = state;
  if (!diagram || stepId === null || id === null) return null;
  const annotation = stepById(diagram, stepId)?.annotations.find((candidate) => candidate.id === id);
  return annotation && isKnownAnnotation(annotation) ? annotation : null;
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
    selectAnnotation: state.selectDiagramAnnotation,
    flipArc: () => {
      const stepId = state.diagramSelectedStepId;
      const id = state.diagramSelectedAnnotationId;
      if (stepId === null || id === null) return;
      state.editDiagramAnnotations(stepId, 'Flip arc', (annotations) =>
        annotations.map((annotation) => (annotation.id === id ? flipAnnotationArc(annotation) : annotation))
      );
    },
    cancelGesture: () => gestureCancel?.() ?? false,
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
    return () => {
      offScope();
      offViewport();
      releaseShortcutViewportSurface('diagram');
    };
  }, []);

  const onPointerDownCapture = useCallback(() => setActiveShortcutViewportSurface('diagram'), []);
  return { onPointerDownCapture };
}
