import type { TFunction } from 'i18next';
import { defaultCaptureCamera } from '../capture/captureFolded';
import type { DiagramCpRender } from '../document/diagramDocument';

/**
 * The verbs that pose a linked step (D5), for the step detail's toolbar: how
 * the step shows its pattern — the crease pattern, or the folded form — and,
 * for each, what can be done to it. React-free and store-free, as
 * `diagramPoseActions.ts` is for an upload.
 *
 * - **Crease pattern:** turn it.
 * - **Folded, flat:** turn it over, turn it, and step to another layer order.
 * - **Folded, in 3D:** look from the other side, or from straight above, the
 *   front or the corner; the view itself is dragged in the picture.
 */
export type DiagramLinkedPoseActionId =
  | 'show-crease-pattern'
  | 'show-folded'
  | 'rotate-left'
  | 'rotate-right'
  | 'turn-over'
  | 'next-solution'
  | 'view-top'
  | 'view-front'
  | 'view-iso'
  | 'reset';

export interface DiagramLinkedPoseAction {
  id: DiagramLinkedPoseActionId;
  label: string;
  disabled: boolean;
  hint?: string;
  /** For the two ways to show the pattern: which one is showing. */
  pressed?: boolean;
  run: () => void;
}

export interface DiagramLinkedPoseState {
  render: DiagramCpRender;
  readOnly: boolean;
  /** A capture of the step is running: every verb waits for it. */
  busy: boolean;
  /** Another layer order can be searched for (a held flat fold says so); null when not known yet. */
  hasNextSolution: boolean | null;
}

/** How far one press turns the picture. */
export const POSE_ROTATION_STEP_DEG = 15;

export function buildDiagramLinkedPoseActions(
  state: DiagramLinkedPoseState,
  deps: { t: TFunction; pose: (verb: DiagramLinkedPoseActionId) => void }
): DiagramLinkedPoseAction[] {
  const { t } = deps;
  const { render } = state;
  const hint = state.readOnly
    ? t(
        'panels:diagram.actions.readOnlyHint',
        'This diagram was made with a newer Ori Studio and opens read-only'
      )
    : state.busy
      ? t('panels:diagram.actions.capturingHint', 'Its picture is being captured')
      : undefined;
  const blocked = hint !== undefined;
  const action = (
    id: DiagramLinkedPoseActionId,
    label: string,
    options: { disabled?: boolean; hint?: string; pressed?: boolean } = {}
  ): DiagramLinkedPoseAction => ({
    id,
    label,
    disabled: blocked || (options.disabled ?? false),
    hint: hint ?? (options.disabled ? options.hint : undefined),
    ...(options.pressed === undefined ? {} : { pressed: options.pressed }),
    run: () => deps.pose(id),
  });

  const folded = render.mode !== 'crease-pattern';
  const modes = [
    action('show-crease-pattern', t('panels:diagram.pose.showCreasePattern', 'Crease Pattern'), {
      pressed: !folded,
    }),
    action('show-folded', t('panels:diagram.pose.showFolded', 'Folded'), { pressed: folded }),
  ];
  const turn = [
    action('rotate-left', t('panels:diagram.pose.rotateLeft', 'Rotate Left')),
    action('rotate-right', t('panels:diagram.pose.rotateRight', 'Rotate Right')),
  ];
  const reset = action('reset', t('panels:diagram.pose.reset', 'Reset Pose'), {
    disabled: isDefaultRender(render),
    hint: t('panels:diagram.pose.resetHint', 'Already in its starting pose'),
  });

  switch (render.mode) {
    case 'crease-pattern':
      return [...modes, ...turn, reset];
    case 'folded-flat':
      return [
        ...modes,
        action('turn-over', t('panels:diagram.pose.turnOver', 'Turn Over')),
        ...turn,
        action(
          'next-solution',
          t('panels:diagram.pose.nextSolution', 'Next Layer Order (now {{number}})', {
            number: render.foldCase,
          }),
          {
            disabled: state.hasNextSolution === false && render.foldCase === 1,
            hint: t('panels:diagram.pose.onlySolution', 'This fold has one layer order'),
          }
        ),
        reset,
      ];
    case 'folded-3d':
      return [
        ...modes,
        action('turn-over', t('panels:diagram.pose.otherSide', 'View From the Other Side')),
        action('view-top', t('panels:diagram.pose.viewTop', 'View From Above')),
        action('view-front', t('panels:diagram.pose.viewFront', 'View From the Front')),
        action('view-iso', t('panels:diagram.pose.viewIso', 'View From the Corner')),
        reset,
      ];
  }
}

/** The pose a render starts in: upright, from the front, the first layer order, Edit's camera. */
export function isDefaultRender(render: DiagramCpRender): boolean {
  switch (render.mode) {
    case 'crease-pattern':
      return render.rotationDeg === 0;
    case 'folded-flat':
      return render.rotationDeg === 0 && render.side === 'front' && render.foldCase === 1;
    case 'folded-3d': {
      const start = defaultCaptureCamera('front');
      const { camera } = render;
      return (
        render.side === 'front' &&
        camera.orient === undefined &&
        Math.abs(camera.yaw - start.yaw) < 1e-9 &&
        Math.abs(camera.pitch - start.pitch) < 1e-9 &&
        Math.abs(camera.zoom - start.zoom) < 1e-9
      );
    }
  }
}
