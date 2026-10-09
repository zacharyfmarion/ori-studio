import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramStep } from '../document/diagramDocument';
import { usePrintedZoom } from '../pages/printedFrames';
import {
  areaSubtitle,
  buildEnlargedAction,
  buildUpdateAllAction,
  enlargedState,
  outOfDateLine,
  stepAreas,
  stepZoomStatus,
  zoomReadout,
  type StepZoomStatus,
  type ZoomAction,
  type ZoomReadout,
} from './zoomActions';

/**
 * A step that holds areas, as its Enlarged sections say it (review fix 4):
 * where they were enlarged ("Enlarged on steps 23–25"), which of those steps
 * are out of date ("Out of date: steps 23–25"; null with none), and Update
 * All — `offered` while any is, and waiting while it runs.
 */
export interface HeldAreasView {
  subtitle: string;
  stale: string | null;
  updateAll: ZoomAction;
  offered: boolean;
}

/**
 * An enlarged step's bindings for the Step pane (Revision 2): the Enlarged
 * toggle (`zoomActions.ts`), in Annotate's Enlarged section since Zach's
 * review of #436 (2026-10-08), bound to the store's verbs — each one undo
 * step — and what the pane says of the step: where its frame came from, how
 * it stands against its area (review fix 4), what it prints at, and its
 * notices. On a step that holds areas, which steps were enlarged from them,
 * and their Update All. The toggle and Update All wait, refusing, while
 * their captures fold the faces they need.
 */
export function useStepZoom(step: DiagramStep | null): {
  enlarged: ZoomAction | null;
  status: StepZoomStatus | null;
  /** What it prints at against its area, once the pages are laid out (Z4). */
  readout: ZoomReadout | null;
  /** Select the step its area is on (the Step pane's link). */
  goToArea: () => void;
  /** A step that holds areas (review fix 4); null for one that holds none. */
  areas: HeldAreasView | null;
} {
  const { t, i18n } = useTranslation();
  const diagram = useWorkspaceStore((state) => state.diagram);
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const stepId = step?.id ?? null;
  const capturing = useWorkspaceStore((state) => stepId !== null && Object.hasOwn(state.diagramCaptures, stepId));
  const [enlarging, setEnlarging] = useState(false);
  const [updating, setUpdating] = useState(false);

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

  const held = useMemo(() => (diagram && stepId !== null ? stepAreas(diagram, stepId) : null), [diagram, stepId]);
  const areas = useMemo(() => {
    if (!held) return null;
    const update = () => {
      setUpdating(true);
      void useWorkspaceStore
        .getState()
        .updateEnlargedDiagramSteps(held.areaIds)
        .finally(() => setUpdating(false));
    };
    const updateAll = buildUpdateAllAction({ steps: held.steps, outOfDate: held.outOfDate.length, readOnly, updating }, { t, update });
    return {
      subtitle: areaSubtitle(t, held.steps),
      stale: outOfDateLine(t, held.outOfDate, i18n.language),
      updateAll,
      offered: updating || !updateAll.disabled,
    };
  }, [held, readOnly, updating, t, i18n.language]);

  return { enlarged, status, readout, goToArea, areas };
}
