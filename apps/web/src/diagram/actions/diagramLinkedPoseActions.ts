import type { TFunction } from 'i18next';
import { SPREAD_DIRECTIONS, type SpreadDirection } from '../../cp-workspace/folded/foldedLayerSpread';
import { defaultCaptureCamera } from '../capture/captureFolded';
import {
  DEFAULT_SIMULATED_VIEW,
  showAsOf,
  type DiagramCpRender,
  type DiagramLayerSpread,
  type DiagramShowAs,
} from '../document/diagramDocument';

/**
 * The verbs that pose a linked step (D5), for the step detail's toolbar: how
 * the step shows its pattern — the crease pattern, or the folded form — and,
 * for each, what can be done to it. React-free and store-free, as
 * `diagramPoseActions.ts` is for an upload.
 *
 * - **Crease pattern:** turn it.
 * - **Folded, flat:** turn it over, turn it, step to another layer order,
 *   and spread its layers apart by depth (Phase 13) — on or off here; its
 *   amount and direction are the Step pane's ({@link buildDiagramSpreadControls}).
 * - **Folded, in 3D:** look from the other side, or from straight above, the
 *   front or the corner; the view itself is dragged in the picture. Spread
 *   Layers is there too, held, saying it needs a flat fold.
 */
export type DiagramLinkedPoseActionId =
  | 'show-crease-pattern'
  | 'show-folded'
  | 'show-simulated'
  | 'rotate-left'
  | 'rotate-right'
  | 'turn-over'
  | 'previous-solution'
  | 'next-solution'
  | 'view-top'
  | 'view-front'
  | 'view-iso'
  | 'spread-layers'
  | 'reset';

export interface DiagramLinkedPoseAction {
  id: DiagramLinkedPoseActionId;
  label: string;
  disabled: boolean;
  /**
   * A capture of the step is running: the verb does nothing until it lands,
   * and says so, but stays focusable — a control disabled under the focus
   * drops it on the page, and every verb starts a capture.
   */
  waiting: boolean;
  hint?: string;
  /**
   * For a way to show the pattern, whether it is the one showing — pressed
   * again it does nothing; for Spread Layers, a toggle, whether it is on.
   */
  pressed?: boolean;
  run: () => void;
}

export interface DiagramLinkedPoseState {
  render: DiagramCpRender;
  readOnly: boolean;
  /** A capture of the step is running: every verb waits for it. */
  busy: boolean;
  /**
   * The held flat fold's layer orders: how many found, whether there may be
   * more, and whether it has none at all; null when not known yet.
   */
  solutions: { discovered: number; hasNext: boolean; none?: boolean } | null;
  /**
   * The step's flat fold is its see-through development, which the kernel
   * draws when it finds no layer order: no layers to spread.
   */
  seeThrough?: boolean;
}

/**
 * Why a step's layers cannot be spread, or nothing when they can: only a flat
 * fold drawn from its layers has them — not one folded in 3D, nor one shown
 * see-through for want of a layer order.
 */
function spreadBlocker(state: DiagramLinkedPoseState, t: TFunction): string | undefined {
  if (state.render.mode !== 'folded-flat') {
    return t('panels:diagram.pose.spreadNeedsFlat', 'Only a flat folded picture has layers to spread');
  }
  if (state.seeThrough || state.solutions?.none) {
    return t('panels:diagram.pose.spreadNeedsOrder', 'This fold has no layer order, so it has no layers to spread');
  }
  return undefined;
}

/**
 * Where a flat fold stands among its layer orders, for the pager between ‹
 * and ›: "2 of 5" when the search has found them all, "2 of 5+" while it may
 * find more, the number alone before it has looked, "None" for a fold whose
 * layers could not be ordered — as `count`, under a row's own "Layer order",
 * and as `label`, standing alone in a toolbar. Null for any other render.
 */
export function layerOrderLabel(
  render: DiagramCpRender,
  solutions: DiagramLinkedPoseState['solutions'],
  t: TFunction
): { count: string; label: string } | null {
  if (render.mode !== 'folded-flat') return null;
  if (solutions?.none) {
    return {
      count: t('panels:diagram.pose.layerOrderNone', 'None'),
      label: t('panels:diagram.pose.noLayerOrder', 'No layer order'),
    };
  }
  const number = render.foldCase;
  const total = solutions ? Math.max(solutions.discovered, number) : null;
  const count =
    total === null
      ? String(number)
      : solutions!.hasNext
        ? t('panels:diagram.pose.layerOrderOfMore', '{{number}} of {{total}}+', { number, total })
        : t('panels:diagram.pose.layerOrderOf', '{{number}} of {{total}}', { number, total });
  return { count, label: t('panels:diagram.pose.layerOrderLabel', 'Layer order {{place}}', { place: count }) };
}

/** The verb that shows a linked step each way (D19): the one map every surface reads. */
export const SHOW_AS_ACTION = {
  'crease-pattern': 'show-crease-pattern',
  folded: 'show-folded',
  simulated: 'show-simulated',
} as const satisfies Record<DiagramShowAs, DiagramLinkedPoseActionId>;

/** How far one press turns the picture. */
export const POSE_ROTATION_STEP_DEG = 15;

export function buildDiagramLinkedPoseActions(
  state: DiagramLinkedPoseState,
  deps: { t: TFunction; pose: (verb: DiagramLinkedPoseActionId) => void }
): DiagramLinkedPoseAction[] {
  const { t } = deps;
  const { render } = state;
  const readOnly = state.readOnly
    ? t(
        'panels:diagram.actions.readOnlyHint',
        'This diagram was made with a newer Ori Studio and opens read-only'
      )
    : undefined;
  const waiting = !state.readOnly && state.busy;
  const capturing = t('panels:diagram.actions.capturingHint', 'Its picture is being captured');
  const action = (
    id: DiagramLinkedPoseActionId,
    label: string,
    options: { disabled?: boolean; hint?: string; pressed?: boolean; toggle?: boolean } = {}
  ): DiagramLinkedPoseAction => {
    const disabled = readOnly !== undefined || (options.disabled ?? false);
    return {
      id,
      label,
      disabled,
      waiting: waiting && !disabled,
      hint: readOnly ?? (options.disabled ? options.hint : waiting ? capturing : undefined),
      ...(options.pressed === undefined ? {} : { pressed: options.pressed }),
      run: () => {
        // The way already shown is no verb: pressed again it would capture a
        // Simulated step back at 0%, which only Pose's live solver can hold.
        // A toggle pressed again turns off. A verb that cannot act refuses
        // here too: a surface may keep it focusable rather than disable it.
        if (!waiting && (options.toggle || !options.pressed) && !disabled) deps.pose(id);
      },
    };
  };

  const shown = showAsOf(render);
  const modes = [
    action(SHOW_AS_ACTION['crease-pattern'], t('panels:diagram.pose.showCreasePattern', 'Crease Pattern'), {
      pressed: shown === 'crease-pattern',
    }),
    action(SHOW_AS_ACTION.folded, t('panels:diagram.pose.showFolded', 'Folded'), {
      pressed: shown === 'folded',
    }),
    action(SHOW_AS_ACTION.simulated, t('panels:diagram.pose.showSimulated', 'Simulated'), {
      pressed: shown === 'simulated',
    }),
  ];
  const turn = [
    action('rotate-left', t('panels:diagram.pose.rotateLeft', 'Rotate Left')),
    action('rotate-right', t('panels:diagram.pose.rotateRight', 'Rotate Right')),
  ];
  const reset = action('reset', t('panels:diagram.pose.reset', 'Reset Pose'), {
    disabled: isDefaultRender(render),
    hint: t('panels:diagram.pose.resetHint', 'Already in its starting pose'),
  });
  const spreadHeld = spreadBlocker(state, t);
  const spreadLayers = action('spread-layers', t('panels:diagram.pose.spreadLayers', 'Spread Layers'), {
    disabled: spreadHeld !== undefined,
    hint: spreadHeld,
    pressed: render.mode === 'folded-flat' && render.spread !== undefined,
    toggle: true,
  });

  switch (render.mode) {
    case 'crease-pattern':
      return [...modes, ...turn, reset];
    case 'folded-flat':
      return [
        ...modes,
        action('turn-over', t('panels:diagram.pose.turnOver', 'Turn Over')),
        ...turn,
        // Any layer order found, in either direction (D23): back to the one
        // before, on to the next — the search's next when none is found past
        // this one — the last wrapping round to the first, as Edit's does.
        action('previous-solution', t('panels:diagram.pose.previousSolution', 'Previous Layer Order'), {
          disabled: render.foldCase <= 1,
          hint: t('panels:diagram.pose.firstSolution', 'This is its first layer order'),
        }),
        action('next-solution', t('panels:diagram.pose.nextLayerOrder', 'Next Layer Order'), {
          disabled:
            state.solutions !== null &&
            (state.solutions.none === true ||
              (!state.solutions.hasNext && state.solutions.discovered <= 1 && render.foldCase === 1)),
          hint: state.solutions?.none
            ? t('panels:diagram.pose.noSolution', 'This fold has no layer order')
            : t('panels:diagram.pose.onlySolution', 'This fold has one layer order'),
        }),
        spreadLayers,
        reset,
      ];
    case 'folded-3d':
      return [
        ...modes,
        action('turn-over', t('panels:diagram.pose.otherSide', 'View From the Other Side')),
        action('view-top', t('panels:diagram.pose.viewTop', 'View From Above')),
        action('view-front', t('panels:diagram.pose.viewFront', 'View From the Front')),
        action('view-iso', t('panels:diagram.pose.viewIso', 'View From the Corner')),
        spreadLayers,
        reset,
      ];
    case 'simulated':
      return [...modes, reset];
  }
}

/** One of the eight ways a spread's deeper layers can step, as the Step pane offers it. */
export interface DiagramSpreadDirectionAction {
  toward: SpreadDirection;
  label: string;
  /** The direction the layers step now. */
  pressed: boolean;
  /** Held as the other verbs are: a read-only diagram, a picture with no layers, a capture running. */
  disabled: boolean;
  waiting: boolean;
  hint?: string;
  run: () => void;
}

/** A flat fold's spread, for the Step pane while it is on (Phase 13). */
export interface DiagramSpreadControls {
  /** The spread the picture shows — a drag's, while it is previewed. */
  spread: DiagramLayerSpread;
  /** Whether the amount and the direction can be changed, and if not, why. */
  disabled: boolean;
  hint?: string;
  directions: DiagramSpreadDirectionAction[];
}

/**
 * The spread's amount and direction (Phase 13), while a flat fold's layers
 * are spread; null otherwise. Spread Layers itself is one of the pose verbs.
 * `shown` is the spread the picture shows now: a drag's, while it previews.
 */
export function buildDiagramSpreadControls(
  state: DiagramLinkedPoseState,
  shown: DiagramLayerSpread | null,
  deps: { t: TFunction; direction: (toward: SpreadDirection) => void }
): DiagramSpreadControls | null {
  const { t } = deps;
  const spread = state.render.mode === 'folded-flat' ? (shown ?? state.render.spread ?? null) : null;
  if (!spread) return null;
  const hint = state.readOnly
    ? t('panels:diagram.actions.readOnlyHint', 'This diagram was made with a newer Ori Studio and opens read-only')
    : spreadBlocker(state, t);
  const disabled = hint !== undefined;
  const waiting = !disabled && state.busy;
  return {
    spread,
    disabled,
    hint,
    directions: SPREAD_DIRECTIONS.map((toward) => {
      const pressed = toward === spread.toward;
      return {
        toward,
        label: spreadDirectionLabel(toward, t),
        pressed,
        disabled,
        waiting,
        hint: hint ?? (waiting ? t('panels:diagram.actions.capturingHint', 'Its picture is being captured') : undefined),
        run: () => {
          if (!disabled && !waiting && !pressed) deps.direction(toward);
        },
      };
    }),
  };
}

/** A direction's name, as its button says it. */
export function spreadDirectionLabel(toward: SpreadDirection, t: TFunction): string {
  switch (toward) {
    case 'up-left':
      return t('panels:diagram.pose.spreadUpLeft', 'Deeper layers up and left');
    case 'up':
      return t('panels:diagram.pose.spreadUp', 'Deeper layers up');
    case 'up-right':
      return t('panels:diagram.pose.spreadUpRight', 'Deeper layers up and right');
    case 'right':
      return t('panels:diagram.pose.spreadRight', 'Deeper layers right');
    case 'down-right':
      return t('panels:diagram.pose.spreadDownRight', 'Deeper layers down and right');
    case 'down':
      return t('panels:diagram.pose.spreadDown', 'Deeper layers down');
    case 'down-left':
      return t('panels:diagram.pose.spreadDownLeft', 'Deeper layers down and left');
    case 'left':
      return t('panels:diagram.pose.spreadLeft', 'Deeper layers left');
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
    case 'simulated': {
      const { view } = render;
      return (
        render.foldPercent === 0 &&
        view.orient === undefined &&
        Math.abs(view.yaw - DEFAULT_SIMULATED_VIEW.yaw) < 1e-9 &&
        Math.abs(view.pitch - DEFAULT_SIMULATED_VIEW.pitch) < 1e-9 &&
        Math.abs(view.zoom - DEFAULT_SIMULATED_VIEW.zoom) < 1e-9
      );
    }
  }
}
