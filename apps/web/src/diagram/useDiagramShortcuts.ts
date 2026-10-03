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
import {
  focusLeavesEnterToSteps,
  focusOwnsArrowKeys,
  runDiagramCancel,
  runDiagramShortcut,
  type DiagramKeyActions,
  type DiagramKeyState,
} from './actions/diagramShortcuts';

function keyState(state: WorkspaceState): DiagramKeyState {
  return {
    stepIds: state.diagram?.steps.map((step) => step.id) ?? [],
    selectedStepId: state.diagramSelectedStepId,
    focusedStepId: focusedStepId(),
    readOnly: state.diagramReadOnly,
    detailOpen: state.diagramDetail !== null,
  };
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
    move: state.moveDiagramStep,
    open: (stepId) => {
      openDiagramStep(stepId, 'keyboard');
    },
    close: state.closeDiagramStep,
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
 *   Shift+F10 for the selected step's menu. One owner at a time: later views
 *   that bring a camera (Pages, Annotate) take the surface over, asking this
 *   ladder before their camera verbs.
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
      const declines =
        id === 'diagram.openStep'
          ? !focusLeavesEnterToSteps(document.activeElement)
          : focusOwnsArrowKeys(document.activeElement);
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
          // No camera in the Steps view: zoom, pan and rotate fall through.
          return false;
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
