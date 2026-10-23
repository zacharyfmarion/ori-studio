import type { TFunction } from 'i18next';
import {
  mirrorPose,
  rotatePose,
  type DiagramCpRender,
  type UploadPose,
} from '../document/diagramDocument';

/**
 * The verbs that pose an uploaded picture, for every surface that offers them:
 * the step detail's toolbar and the Step pane. React-free and store-free, as
 * `diagramActions.ts` is.
 */
export type DiagramPoseActionId = 'rotate-left' | 'rotate-right' | 'flip' | 'turn-over' | 'reset';

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
  deps: { t: TFunction; setPose: (pose: UploadPose, verb: DiagramPoseActionId) => void }
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
      if (pose) deps.setPose(next(pose), id);
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

/** What a Fold step's pose is gated on (fold-workspace plan D17). */
export interface DiagramFoldStepPoseState {
  /** How the step shows its Fold step: a crease pattern, or a flat fold. */
  render: DiagramCpRender;
  carriesUnknownAnnotations: boolean;
  /** Its picture is being captured: a pose waits for it. */
  capturing: boolean;
  readOnly: boolean;
}

/**
 * The verbs that pose a step linked to a Fold step: a quarter turn either
 * way, Turn Over for a flat fold — the model from its other side, every fold
 * named from there — and Reset Pose, upright, a flat fold from the front. Each
 * is a capture from the step's state (`poseDiagramFoldStep`), so nothing here
 * folds. A crease pattern's paper side is the Step pane's Front | Back, which
 * Reset leaves as it is.
 */
export function buildDiagramFoldStepPoseActions(
  state: DiagramFoldStepPoseState,
  deps: { t: TFunction; pose: (verb: Exclude<DiagramPoseActionId, 'flip'>) => void }
): DiagramPoseAction[] {
  const { t } = deps;
  const { render } = state;
  const hint = state.readOnly
    ? t(
        'panels:diagram.actions.readOnlyHint',
        'This diagram was made with a newer Ori Studio and opens read-only'
      )
    : state.carriesUnknownAnnotations
      ? t(
          'panels:diagram.pose.annotationsHint',
          'Its annotations were made with a newer Ori Studio, which could not turn with it'
        )
      : state.capturing
        ? t('panels:diagram.actions.capturingHint', 'Its picture is being captured')
        : undefined;
  const blocked = hint !== undefined;
  const turn = render.mode === 'crease-pattern' || render.mode === 'folded-flat' ? render.rotationDeg : 0;
  const upright = turn === 0 && (render.mode !== 'folded-flat' || render.side === 'front');
  const action = (id: Exclude<DiagramPoseActionId, 'flip'>, label: string, alsoDisabled = false, alsoHint?: string): DiagramPoseAction => ({
    id,
    label,
    disabled: blocked || alsoDisabled,
    hint: hint ?? (alsoDisabled ? alsoHint : undefined),
    run: () => deps.pose(id),
  });
  return [
    action('rotate-left', t('panels:diagram.pose.rotateLeft', 'Rotate Left')),
    action('rotate-right', t('panels:diagram.pose.rotateRight', 'Rotate Right')),
    ...(render.mode === 'folded-flat' ? [action('turn-over', t('panels:diagram.pose.turnOver', 'Turn Over'))] : []),
    action(
      'reset',
      t('panels:diagram.pose.reset', 'Reset Pose'),
      upright,
      t('panels:diagram.pose.resetHint', 'Already in its starting pose')
    ),
  ];
}

/** What a References step's pose is gated on (D5: Turn over). */
export interface DiagramReferencesPoseState {
  /** The side the step shows: true for the paper's back. */
  mirrored: boolean;
  /** The side its card showed in References, which Reset Pose returns to. */
  sentMirrored: boolean;
  carriesUnknownAnnotations: boolean;
  readOnly: boolean;
}

/**
 * The verbs that pose a step sent from References: Turn over — the same step
 * from the paper's other side, every fold named from there — and Reset Pose,
 * back to the side its card showed.
 */
export function buildDiagramReferencesPoseActions(
  state: DiagramReferencesPoseState,
  deps: { t: TFunction; setSide: (mirrored: boolean, verb: DiagramPoseActionId) => void }
): DiagramPoseAction[] {
  const { t } = deps;
  const hint = state.readOnly
    ? t(
        'panels:diagram.actions.readOnlyHint',
        'This diagram was made with a newer Ori Studio and opens read-only'
      )
    : state.carriesUnknownAnnotations
      ? t(
          'panels:diagram.pose.annotationsHint',
          'Its annotations were made with a newer Ori Studio, which could not turn with it'
        )
      : undefined;
  const blocked = hint !== undefined;
  const asSent = state.mirrored === state.sentMirrored;
  return [
    {
      id: 'turn-over',
      label: t('panels:diagram.pose.turnOver', 'Turn Over'),
      disabled: blocked,
      hint,
      run: () => deps.setSide(!state.mirrored, 'turn-over'),
    },
    {
      id: 'reset',
      label: t('panels:diagram.pose.reset', 'Reset Pose'),
      disabled: blocked || asSent,
      hint: hint ?? (asSent ? t('panels:diagram.pose.resetHint', 'Already in its starting pose') : undefined),
      run: () => deps.setSide(state.sentMirrored, 'reset'),
    },
  ];
}
