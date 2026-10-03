import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { trackDiagramStepAdded } from '../analytics';
import { useWorkspaceStore } from '../store/workspaceStore';
import { buildDiagramStepActions, type DiagramStepAction } from './actions/diagramActions';
import { isLockedStep, stepIndex } from './document/diagramDocument';

/**
 * Add an empty step after the selected one (or at the end) and select it: the
 * Diagram's own Add step, wherever it is offered. Reports the new step's id, or
 * null when the diagram is read-only.
 */
export function useAddDiagramStep(): () => string | null {
  return useCallback(() => {
    const stepId = useWorkspaceStore.getState().addDiagramStep();
    if (stepId) trackDiagramStepAdded('empty', 'grid');
    return stepId;
  }, []);
}

/**
 * The step verbs for one step, bound to the store — or none when the step is
 * not in the diagram.
 *
 * Every callback reads the store when it runs rather than closing over this
 * render's diagram, so a verb on a list built a moment ago still acts on the
 * step where it is now.
 */
export function useDiagramStepActions(stepId: string | null): DiagramStepAction[] {
  const { t } = useTranslation();
  const index = useWorkspaceStore((state) =>
    state.diagram && stepId !== null ? stepIndex(state.diagram, stepId) : -1
  );
  const count = useWorkspaceStore((state) => state.diagram?.steps.length ?? 0);
  const locked = useWorkspaceStore((state) => {
    const step = index >= 0 ? state.diagram?.steps[index] : undefined;
    return step ? isLockedStep(step) : false;
  });
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);

  return useMemo(() => {
    if (stepId === null || index < 0) return [];
    const store = useWorkspaceStore.getState;
    return buildDiagramStepActions(
      { index, count, locked, readOnly },
      {
        t,
        insert: (where) => {
          if (store().insertDiagramStep(stepId, where)) trackDiagramStepAdded('empty', 'grid');
        },
        duplicate: () => {
          store().duplicateDiagramStep(stepId);
        },
        move: (direction) => {
          const diagram = store().diagram;
          const from = diagram ? stepIndex(diagram, stepId) : -1;
          if (from < 0) return;
          store().moveDiagramStep(stepId, direction === 'earlier' ? from - 1 : from + 1);
        },
        remove: () => {
          void store().confirmDeleteDiagramSteps([stepId]);
        },
      }
    );
  }, [stepId, index, count, locked, readOnly, t]);
}
