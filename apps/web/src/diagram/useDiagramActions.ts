import { useCallback, useMemo } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { trackDiagramStepAdded } from '../analytics';
import { useWorkspaceStore } from '../store/workspaceStore';
import {
  buildDiagramStepActions,
  type DiagramStepAction,
  type DiagramStepActionState,
} from './actions/diagramActions';
import {
  buildDiagramPoseActions,
  type DiagramPoseAction,
} from './actions/diagramPoseActions';
import {
  isLockedStep,
  poseBlocker,
  stepIndex,
  type DiagramStep,
  type UploadPose,
} from './document/diagramDocument';
import { stepPictureSource } from './pictures/paintDiagramStep';
import { exportStepPicture } from './pictures/exportStepPicture';
import { pickStepPictures } from './upload/addStepPictures';

/**
 * Add an empty step after the selected one (or at the end) and select it: the
 * Diagram's own Add step, wherever it is offered. Reports the new step's id, or
 * null when the diagram is read-only.
 */
export function addDiagramStep(): string | null {
  const stepId = useWorkspaceStore.getState().addDiagramStep();
  if (stepId) trackDiagramStepAdded('empty', 'grid');
  return stepId;
}

/** {@link addDiagramStep}, as a stable callback. */
export function useAddDiagramStep(): () => string | null {
  return useCallback(() => addDiagramStep(), []);
}

/**
 * The step verbs for one step as it is in the store right now, bound to it — or
 * none when the step is not in the diagram. For a surface that builds its list
 * at the moment it needs it (a context menu opening).
 *
 * Every callback reads the store when it runs rather than closing over this
 * call's diagram, so a verb on a list built a moment ago still acts on the step
 * where it is now.
 */
export function diagramStepActions(stepId: string, t: TFunction): DiagramStepAction[] {
  const { diagram, diagramReadOnly } = useWorkspaceStore.getState();
  const index = diagram ? stepIndex(diagram, stepId) : -1;
  if (!diagram || index < 0) return [];
  const step = diagram.steps[index];
  return bindStepActions(
    stepId,
    {
      index,
      count: diagram.steps.length,
      locked: isLockedStep(step),
      readOnly: diagramReadOnly,
      hasPicture: hasDrawablePicture(step, diagram.assets),
    },
    t
  );
}

function hasDrawablePicture(step: DiagramStep, assets: Parameters<typeof stepPictureSource>[1]): boolean {
  return stepPictureSource(step, assets) !== null;
}

function bindStepActions(
  stepId: string,
  gate: DiagramStepActionState,
  t: TFunction
): DiagramStepAction[] {
  const store = useWorkspaceStore.getState;
  return buildDiagramStepActions(
    gate,
    {
      t,
      insert: (where) => {
        if (store().insertDiagramStep(stepId, where)) trackDiagramStepAdded('empty', 'grid');
      },
      duplicate: () => {
        store().duplicateDiagramStep(stepId);
      },
      move: (direction) => {
        const current = store().diagram;
        const from = current ? stepIndex(current, stepId) : -1;
        if (from < 0) return;
        store().moveDiagramStep(stepId, direction === 'earlier' ? from - 1 : from + 1);
      },
      // Straight from the click: a browser opens a picker only inside one.
      uploadPicture: () => {
        void pickStepPictures({ replaceStepId: stepId });
      },
      exportPicture: () => {
        const diagram = store().diagram;
        if (diagram) void exportStepPicture(diagram, stepId);
      },
      removePicture: () => {
        store().removeDiagramStepPicture(stepId);
      },
      remove: () => {
        void store().confirmDeleteDiagramSteps([stepId]);
      },
    }
  );
}

/**
 * {@link diagramStepActions} for a surface that shows them all the time (the
 * Step pane), rebuilt whenever what they are gated on changes.
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
  const hasPicture = useWorkspaceStore((state) => {
    const step = index >= 0 ? state.diagram?.steps[index] : undefined;
    return step && state.diagram ? hasDrawablePicture(step, state.diagram.assets) : false;
  });

  return useMemo(
    () =>
      stepId === null || index < 0
        ? []
        : bindStepActions(stepId, { index, count, locked, readOnly, hasPicture }, t),
    [stepId, index, count, locked, readOnly, hasPicture, t]
  );
}

/**
 * The pose verbs for a step's uploaded picture, bound to the store, for the
 * step detail's toolbar and the Step pane.
 */
export function useDiagramPoseActions(stepId: string | null): DiagramPoseAction[] {
  const { t } = useTranslation();
  const step = useWorkspaceStore((state) =>
    state.diagram && stepId !== null
      ? (state.diagram.steps.find((candidate) => candidate.id === stepId) ?? null)
      : null
  );
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  return useMemo(() => {
    if (!step) return [];
    const source = step.source?.kind === 'upload' ? step.source : null;
    const pose: UploadPose | null = source
      ? { rotationQuarterTurns: source.rotationQuarterTurns, mirrored: source.mirrored }
      : null;
    return buildDiagramPoseActions(
      {
        pose: poseBlocker(step) === 'not-upload' ? null : pose,
        carriesUnknownAnnotations: poseBlocker(step) === 'unknown-annotations',
        readOnly,
      },
      {
        t,
        setPose: (next) => {
          useWorkspaceStore.getState().setDiagramStepPose(step.id, next);
        },
      }
    );
  }, [step, readOnly, t]);
}
