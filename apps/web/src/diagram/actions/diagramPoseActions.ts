import type { TFunction } from 'i18next';
import {
  mirrorPose,
  rotatePose,
  type UploadPose,
} from '../document/diagramDocument';

/**
 * The verbs that pose an uploaded picture, for every surface that offers them:
 * the step detail's toolbar and the Step pane. React-free and store-free, as
 * `diagramActions.ts` is.
 */
export type DiagramPoseActionId = 'rotate-left' | 'rotate-right' | 'flip' | 'reset';

export interface DiagramPoseAction {
  id: DiagramPoseActionId;
  label: string;
  disabled: boolean;
  hint?: string;
  run: () => void;
}

export interface DiagramPoseActionState {
  /** The upload's pose, or null when the step's picture is not an upload. */
  pose: UploadPose | null;
  /** The step carries annotations a newer build made, which a pose cannot carry. */
  carriesUnknownAnnotations: boolean;
  readOnly: boolean;
}

const UPRIGHT: UploadPose = { rotationQuarterTurns: 0, mirrored: false };

export function buildDiagramPoseActions(
  state: DiagramPoseActionState,
  deps: { t: TFunction; setPose: (pose: UploadPose) => void }
): DiagramPoseAction[] {
  const { t } = deps;
  const pose = state.pose;
  const hint = state.readOnly
    ? t(
        'panels:diagram.actions.readOnlyHint',
        'This diagram was made with a newer Ori Studio and opens read-only'
      )
    : pose === null
      ? t('panels:diagram.pose.noUploadHint', 'Only an uploaded picture can be turned here')
      : state.carriesUnknownAnnotations
        ? t(
            'panels:diagram.pose.annotationsHint',
            'Its annotations were made with a newer Ori Studio, which could not turn with it'
          )
        : undefined;
  const blocked = hint !== undefined;
  const action = (
    id: DiagramPoseActionId,
    label: string,
    next: (current: UploadPose) => UploadPose,
    alsoDisabled = false
  ): DiagramPoseAction => ({
    id,
    label,
    disabled: blocked || alsoDisabled,
    hint,
    run: () => {
      if (pose) deps.setPose(next(pose));
    },
  });
  const upright = pose !== null && pose.rotationQuarterTurns === 0 && !pose.mirrored;
  return [
    action('rotate-left', t('panels:diagram.pose.rotateLeft', 'Rotate Left'), (p) => rotatePose(p, -1)),
    action('rotate-right', t('panels:diagram.pose.rotateRight', 'Rotate Right'), (p) => rotatePose(p, 1)),
    action('flip', t('panels:diagram.pose.flip', 'Flip Horizontally'), mirrorPose),
    action('reset', t('panels:diagram.pose.reset', 'Reset Pose'), () => UPRIGHT, upright),
  ];
}
