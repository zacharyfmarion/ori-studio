import { useCallback, useMemo } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  trackDiagramPictureExported,
  trackDiagramPicturePosed,
  trackDiagramPictureRemoved,
  trackDiagramStepAdded,
  trackDiagramStepOpened,
  type DiagramPictureKind,
  type DiagramPoseAction as TrackedPoseAction,
  type DiagramStepOpenedVia,
} from '../analytics';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { DiagramDetailMode } from '../store/workspaceStore/types';
import {
  buildDiagramStepActions,
  type DiagramStepAction,
  type DiagramStepActionState,
} from './actions/diagramActions';
import {
  buildDiagramPoseActions,
  buildDiagramReferencesPoseActions,
  type DiagramPoseAction,
  type DiagramPoseActionId,
} from './actions/diagramPoseActions';
import {
  isLockedStep,
  poseBlocker,
  stepAsset,
  stepHasPicture,
  stepIndex,
  type DiagramDocument,
  type DiagramStep,
  type UploadPose,
} from './document/diagramDocument';
import {
  captureKind,
  openDiagramPatternPicker,
  openDiagramStepInEdit,
  refreshDiagramStep,
} from './capture/stepCaptureActions';
import { askReferencesForStep, openDiagramStepInReferences } from './capture/referencesStepActions';
import { linkStatusNow, useDiagramLinkStatuses } from './capture/useLinkStatus';
import { stepPictureSource } from './pictures/paintDiagramStep';
import { exportStepPicture } from './pictures/exportStepPicture';
import { pickStepPictures } from './upload/addStepPictures';
import { lightingChanged } from './pictures/lighting';

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

/**
 * Add an empty step at the end and select it: the Steps grid's trailing tile,
 * which sits after the last card. Null when the diagram is read-only.
 */
export function appendDiagramStep(): string | null {
  const store = useWorkspaceStore.getState();
  const last = store.diagram?.steps.at(-1);
  const stepId = last ? store.insertDiagramStep(last.id, 'after') : store.addDiagramStep();
  if (stepId) trackDiagramStepAdded('empty', 'grid');
  return stepId;
}

/** {@link addDiagramStep}, as a stable callback. */
export function useAddDiagramStep(): () => string | null {
  return useCallback(() => addDiagramStep(), []);
}

/** Open a step in detail, in Pose or Annotate, counting how it was opened. Whether it opened. */
export function openDiagramStep(
  stepId: string,
  via: DiagramStepOpenedVia,
  mode: DiagramDetailMode = 'pose'
): boolean {
  const opened = useWorkspaceStore.getState().openDiagramStep(stepId, mode);
  if (opened) trackDiagramStepOpened(via, mode);
  return opened;
}

const TRACKED_POSE_ACTIONS: Record<DiagramPoseActionId, TrackedPoseAction> = {
  'rotate-left': 'rotate_left',
  'rotate-right': 'rotate_right',
  flip: 'flip',
  'turn-over': 'turn_over',
  reset: 'reset',
};

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
  const { diagram, diagramReadOnly, diagramCaptures, oristudioCpDocument } = useWorkspaceStore.getState();
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
      hasSource: stepHasPicture(step),
      link: linkStatusNow(step),
      linkKind: linkKindOf(step),
      breakBefore: step.breakBefore,
      lightingChanged: lightingChanged(step, diagram.style),
      capturing: Object.hasOwn(diagramCaptures, stepId),
      patternOpen: oristudioCpDocument !== null,
    },
    t
  );
}

/** What a step is linked to, for the verbs that follow a link. */
function linkKindOf(step: DiagramStep | undefined): DiagramStepActionState['linkKind'] {
  if (!step || isLockedStep(step)) return null;
  if (step.source?.kind === 'cp') return 'cp';
  return step.source?.kind === 'references-step' ? 'references' : null;
}

function hasDrawablePicture(step: DiagramStep, assets: Parameters<typeof stepPictureSource>[1]): boolean {
  return stepPictureSource(step, assets) !== null;
}

/** What a step's picture is, for analytics: an upload by its asset, a link by how it shows its pattern. */
function pictureKind(diagram: DiagramDocument, step: DiagramStep): DiagramPictureKind | null {
  if (step.source?.kind === 'cp') return captureKind(step.source.render);
  if (step.source?.kind === 'references-step') return 'references';
  return stepAsset(diagram, step)?.kind ?? null;
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
      toggleBreak: () => {
        const current = store().diagram;
        const step = current?.steps[stepIndex(current, stepId)];
        if (step) store().setDiagramStepBreakBefore(stepId, !step.breakBefore);
      },
      // Straight from the click: a browser opens a picker only inside one.
      uploadPicture: () => {
        void pickStepPictures({ replaceStepId: stepId });
      },
      linkPattern: () => openDiagramPatternPicker(stepId),
      refreshPicture: () => {
        void refreshDiagramStep(stepId);
      },
      openInEdit: () => openDiagramStepInEdit(stepId),
      openInReferences: () => openDiagramStepInReferences(stepId),
      fromReferences: () => askReferencesForStep(stepId),
      adjustPose: () => {
        openDiagramStep(stepId, 'command');
      },
      annotate: () => {
        openDiagramStep(stepId, 'command', 'annotate');
      },
      exportPicture: () => {
        const diagram = store().diagram;
        if (!diagram) return;
        void exportStepPicture(diagram, stepId).then((format) => {
          if (format) trackDiagramPictureExported(format);
        });
      },
      removePicture: () => {
        const diagram = store().diagram;
        const step = diagram?.steps.find((candidate) => candidate.id === stepId);
        const kind = diagram && step ? pictureKind(diagram, step) : null;
        if (store().removeDiagramStepPicture(stepId) && kind) trackDiagramPictureRemoved(kind);
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
  const step = useWorkspaceStore((state) => (index >= 0 ? state.diagram?.steps[index] : undefined));
  const hasPicture = useWorkspaceStore((state) => {
    const current = index >= 0 ? state.diagram?.steps[index] : undefined;
    return current && state.diagram ? hasDrawablePicture(current, state.diagram.assets) : false;
  });
  const hasSource = step ? stepHasPicture(step) : false;
  const statuses = useDiagramLinkStatuses(step ? [step] : NO_STEPS);
  const link = (step && statuses.get(step.id)) ?? null;
  const linkKind = linkKindOf(step);
  const capturing = useWorkspaceStore((state) =>
    stepId === null ? false : Object.hasOwn(state.diagramCaptures, stepId)
  );
  const patternOpen = useWorkspaceStore((state) => state.oristudioCpDocument !== null);
  const breakBefore = step?.breakBefore ?? false;
  const relight = useWorkspaceStore((state) =>
    step && state.diagram ? lightingChanged(step, state.diagram.style) : false
  );

  return useMemo(
    () =>
      stepId === null || index < 0
        ? []
        : bindStepActions(
            stepId,
            {
              index,
              count,
              locked,
              readOnly,
              hasPicture,
              hasSource,
              link,
              linkKind,
              breakBefore,
              lightingChanged: relight,
              capturing,
              patternOpen,
            },
            t
          ),
    [
      stepId,
      index,
      count,
      locked,
      readOnly,
      hasPicture,
      hasSource,
      link,
      linkKind,
      breakBefore,
      relight,
      capturing,
      patternOpen,
      t,
    ]
  );
}

const NO_STEPS: readonly DiagramStep[] = [];

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
    if (!isLockedStep(step) && step.source?.kind === 'references-step' && step.picture?.kind === 'step-diagram') {
      return buildDiagramReferencesPoseActions(
        {
          mirrored: step.picture.mirrored,
          sentMirrored: step.source.side === 'back',
          carriesUnknownAnnotations: step.annotations.some((annotation) => annotation.unknown !== undefined),
          readOnly,
        },
        {
          t,
          setSide: (mirrored, verb) => {
            if (useWorkspaceStore.getState().setDiagramReferencesSide(step.id, mirrored)) {
              trackDiagramPicturePosed(TRACKED_POSE_ACTIONS[verb], 'references');
            }
          },
        }
      );
    }
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
        setPose: (next, verb) => {
          const store = useWorkspaceStore.getState();
          const kind = store.diagram ? stepAsset(store.diagram, step)?.kind : undefined;
          if (store.setDiagramStepPose(step.id, next) && kind) {
            trackDiagramPicturePosed(TRACKED_POSE_ACTIONS[verb], kind);
          }
        },
      }
    );
  }, [step, readOnly, t]);
}
