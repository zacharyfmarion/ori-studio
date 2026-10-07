import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramStep } from '../document/diagramDocument';
import { usePrintedZoom } from '../pages/printedFrames';
import {
  buildEnlargedAction,
  enlargedState,
  stepZoomStatus,
  zoomReadout,
  type StepZoomStatus,
  type ZoomAction,
  type ZoomReadout,
} from './zoomActions';

/**
 * An enlarged step's bindings for Pose and the Step pane (Revision 2): Pose's
 * Enlarged toggle (`zoomActions.ts`), bound to the store's verbs — each one
 * undo step — and what the Step pane says of the step: where its frame came
 * from, what it prints at, and its notices. The toggle waits, refusing, while its capture folds
 * the faces it needs.
 */
export function useStepZoom(step: DiagramStep | null): {
  enlarged: ZoomAction | null;
  status: StepZoomStatus | null;
  /** What it prints at against its area, once the pages are laid out (Z4). */
  readout: ZoomReadout | null;
  /** Select the step its area is on (the Step pane's link). */
  goToArea: () => void;
} {
  const { t } = useTranslation();
  const diagram = useWorkspaceStore((state) => state.diagram);
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const stepId = step?.id ?? null;
  const capturing = useWorkspaceStore((state) => stepId !== null && Object.hasOwn(state.diagramCaptures, stepId));
  const [enlarging, setEnlarging] = useState(false);

  const enlarge = useCallback(() => {
    if (stepId === null) return;
    setEnlarging(true);
    void useWorkspaceStore
      .getState()
      .enlargeDiagramStep(stepId)
      .finally(() => setEnlarging(false));
  }, [stepId]);
  const unenlarge = useCallback(() => {
    if (stepId !== null) useWorkspaceStore.getState().unenlargeDiagramStep(stepId);
  }, [stepId]);

  const enlarged = useMemo(() => {
    const state = diagram && stepId !== null ? enlargedState(diagram, stepId, { readOnly, busy: capturing || enlarging }) : null;
    return state ? buildEnlargedAction(state, { t, enlarge, unenlarge }) : null;
  }, [diagram, stepId, readOnly, capturing, enlarging, t, enlarge, unenlarge]);

  const status = useMemo(() => (diagram && stepId !== null ? stepZoomStatus(diagram, stepId) : null), [diagram, stepId]);
  const printed = usePrintedZoom(status ? stepId : null);
  const readout = useMemo(() => zoomReadout(printed), [printed]);

  const areaStepId = status?.areaStep?.id ?? null;
  const goToArea = useCallback(() => {
    if (areaStepId !== null) useWorkspaceStore.getState().selectDiagramStep(areaStepId);
  }, [areaStepId]);

  return { enlarged, status, readout, goToArea };
}
