import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  buildDiagramStepLayerOrderFlag,
  buildDiagramStepLayerOrderRow,
  type DiagramStepLayerOrderFlag,
  type DiagramStepLayerOrderRow,
  type DiagramStepLayerOrderState,
} from '../actions/diagramStepLayerOrderActions';
import { isLockedStep, type DiagramStep } from '../document/diagramDocument';
import { layerOrderSummaryOf } from './captureLayerOrder';
import { openLinkedPoseOf } from './openLinkedPose';
import { openDiagramStepLayerOrder, type DiagramStepLayerOrderVia } from './stepLayerOrderActions';

export interface DiagramStepLayerOrder {
  /** The Step pane's Layer order row's Edit… and note; null for a step with no such row. */
  row: DiagramStepLayerOrderRow | null;
  /** The Picture section's flag, while the step's constraints need a look; null otherwise. */
  flag: DiagramStepLayerOrderFlag | null;
}

const NONE: DiagramStepLayerOrder = { row: null, flag: null };

/**
 * A linked step's way into the Layer order dialog (H7), bound to the store:
 * the Step pane's row and the Picture section's flag
 * (`diagramStepLayerOrderActions.ts`), read from the step's saved source —
 * opening a diagram or selecting a step asks the engine nothing. Edit… and
 * Review… open the dialog (`stepLayerOrderActions.ts`); on the step open in
 * Pose, through Pose's controller, on the fold it holds (H8).
 */
export function useDiagramStepLayerOrder(step: DiagramStep | null): DiagramStepLayerOrder {
  const { t } = useTranslation();
  const source = step && !isLockedStep(step) && step.source?.kind === 'cp' ? step.source : null;
  const stepId = source ? step!.id : null;
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const busy = useWorkspaceStore((state) => stepId !== null && Object.hasOwn(state.diagramCaptures, stepId));
  const record = layerOrderSummaryOf(source);
  const render = source?.render ?? null;
  const seeThrough = render?.mode === 'folded-flat' && step?.picture?.kind === 'fixed';
  return useMemo((): DiagramStepLayerOrder => {
    if (!render || stepId === null) return NONE;
    const state: DiagramStepLayerOrderState = { render, record, readOnly, busy, seeThrough };
    const open = (via: DiagramStepLayerOrderVia) => {
      // Edit… and Review… on the step open in Pose are Pose's own (H8): one session per step, whichever surface
      // asks, so the fold it holds never outlives the order an Apply gives the step.
      const pose = openLinkedPoseOf(stepId);
      // Asked from the Step pane all the same, as the dialog's events count it.
      void (pose ? pose.editLayerOrder(via, 'diagram_step') : openDiagramStepLayerOrder(stepId, via));
    };
    const deps = { t, open };
    return { row: buildDiagramStepLayerOrderRow(state, deps), flag: buildDiagramStepLayerOrderFlag(state, deps) };
  }, [render, record, readOnly, busy, seeThrough, stepId, t]);
}
