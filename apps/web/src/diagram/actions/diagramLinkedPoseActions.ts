import type { TFunction } from 'i18next';
import type { SpreadDirection, SpreadKeep, SpreadKind } from '../../cp-workspace/folded/foldedLayerSpread';
import {
  layerSpreadControls,
  type LayerSpreadChoice,
  type LayerSpreadControls,
} from '../../cp-workspace/folded/layerSpreadControls';
import type { LayerOrderSolutionPlace } from '../../layer-order/host/hostEngineGateway';
import { solutionPlaceEnds, solutionsHeldForReview, type SolutionPlace } from '../../layer-order/host/solutionCursorTable';
import { layerOrderCount, solutionPlaceCount, type LayerOrderSolutions } from '../../lib/layerOrderPlace';
import { defaultCaptureCamera } from '../capture/captureFolded';
import type { LayerOrderSummary } from '../capture/captureLayerOrder';
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
 * - **Folded, flat:** turn it over, turn it — by steps, or to stand upright on
 *   a mirror axis — step to another layer order, and spread its layers apart
 *   (Phase 13) — on or off here; its kind (by depth or affine) and settings
 *   are the Step pane's ({@link buildDiagramSpreadControls}).
 * - **Folded, in 3D:** look from the other side, or from straight above, and
 *   set which way is up; the view itself is dragged in the picture. Spread
 *   Layers is there too, held, saying it needs a flat fold.
 * - **Simulated:** set which way is up; the simulator's transport folds it,
 *   and the view is dragged as the 3D one is.
 *
 * Set Upright is no pose verb: as in Edit's 3D window and in Simulate, it
 * takes the direction pointing up on screen as the model's up, in the live
 * view, which then brings the step's camera to rest as a drag does.
 */
export type DiagramLinkedPoseActionId =
  | 'show-crease-pattern'
  | 'show-folded'
  | 'show-simulated'
  | 'rotate-left'
  | 'rotate-right'
  | 'upright'
  | 'turn-over'
  | 'previous-solution'
  | 'next-solution'
  | 'view-top'
  | 'set-upright'
  | 'spread-layers'
  | 'reset';

/** The verbs a pose of the step runs (`linkedPose.ts`): every action but Set Upright, which the live view runs. */
export type DiagramLinkedPoseVerb = Exclude<DiagramLinkedPoseActionId, 'set-upright'>;

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
  /** A capture of the step is running: every verb waits for it, but a turn Pose draws itself (`turnsLive`). */
  busy: boolean;
  /**
   * The held flat fold's layer orders: how many found, whether there may be
   * more, and whether it has none at all; null when not known yet.
   */
  solutions: LayerOrderSolutions | null;
  /**
   * The step's flat fold is its see-through development, which the kernel
   * draws when it finds no layer order: no layers to spread.
   */
  seeThrough?: boolean;
  /**
   * The held flat fold's mirror axes, unturned; null or absent when not
   * known yet — Upright then folds it to find out — and empty for a fold with
   * no symmetry, which has no upright.
   */
  mirrorAxes?: readonly number[] | null;
  /** A live view of the step shows — 3D, or the simulator — which Set Upright turns. */
  liveView?: boolean;
  /**
   * The step keeps a layer order chosen in the Layer order dialog (H7), from
   * its saved source: its ‹ › step through the solutions that fit its
   * record (H9, D9), not the kernel's orders.
   */
  constrained?: boolean;
  /**
   * Where a constrained step's order stands among the solutions that fit,
   * and a way a step proved to end (E9), once a press has asked
   * (`stepSolutionCursor.ts`); null or absent before, when both are offered,
   * from saved data alone.
   */
  place?: SolutionPlace | null;
  /**
   * What a constrained step's record says at rest, from saved data: how many
   * constraints it holds, and its summary (D10, D14) — any summary holds ‹ ›
   * until it is reviewed (`solutionsHeldForReview`).
   */
  record?: LayerOrderSummary | null;
  /**
   * A constrained step's pattern changed since it was captured (its link is
   * `stale`): the solutions of the fold it shows are not its creases', so its
   * ‹ › wait for a Refresh, as a stale figure's wait for a Refold in Edit.
   */
  stale?: boolean;
}

/**
 * Why a step's layers cannot be spread, or nothing when they can: only a flat
 * fold drawn from its layers has them — not one folded in 3D, nor one shown
 * see-through for want of a layer order.
 */
function spreadBlocker(state: DiagramLinkedPoseState, t: TFunction): string | undefined {
  if (state.render.mode !== 'folded-flat' && state.render.mode !== 'folded-3d') {
    return t('panels:diagram.pose.spreadNeedsFlat', 'Only a flat folded picture has layers to spread');
  }
  if (state.seeThrough || state.solutions?.none) {
    return t('panels:diagram.pose.spreadNeedsOrder', 'This fold has no layer order, so it has no layers to spread');
  }
  return undefined;
}

/**
 * Why a constrained step's ‹ › both wait, or null when they can step, by
 * Edit's rules for a constrained figure (`foldedFigureActions.ts`), from
 * saved data alone:
 *
 * - its record needs a look since an edit (D14), as when its constraints
 *   clash: nothing to step through until it is reviewed;
 * - its pattern changed since it was captured: the solutions of the fold it
 *   shows are not its creases', until a Refresh captures them again.
 */
function constrainedSolutionsHeld(state: DiagramLinkedPoseState, t: TFunction): string | null {
  if (solutionsHeldForReview(state.record?.attention)) {
    // An order chosen with no constraint has none to review: the order itself (D16).
    return (state.record?.constraints ?? 0) === 0
      ? t('panels:foldedFigureActions.layerOrderReviewChosenFirst', 'Review the chosen layer order first')
      : t('panels:foldedFigureActions.layerOrderReviewFirst', 'Review the layer constraints that need attention first');
  }
  if (state.stale) {
    return t('panels:diagram.pose.layerOrderPatternChanged', 'Its pattern changed since it was captured');
  }
  return null;
}

/**
 * Where a flat fold stands among its layer orders, for the Step pane's pager
 * between ‹ and ›, under its row's own "Layer order": "2 of 5" when the
 * search has found them all, "2 of 5+" while it may find more, the number
 * alone before it has looked, "None" for a fold whose layers could not be
 * ordered. The Pose toolbar's ‹ › have no readout (Round 4, H8). Null for any
 * other render.
 */
export function layerOrderLabel(
  render: DiagramCpRender,
  solutions: DiagramLinkedPoseState['solutions'],
  t: TFunction
): { count: string } | null {
  if (render.mode !== 'folded-flat') return null;
  // The readout Edit's Properties pane shows too (`layerOrderPlace.ts`).
  return { count: layerOrderCount(render.foldCase, solutions, t) };
}

/**
 * Where a constrained flat step stands among the solutions that fit its
 * record (H9), for the Step pane's pager: what its solutions cursor last
 * answered, in the words Edit's Properties pane reads too ("2 of 3" once the
 * count is final, "Solution 2" until then, `solutionPlaceCount`). Null at
 * rest, before a press has asked: the host never counts (D11), and the pane
 * keeps the readout's width. Null for any other render.
 */
export function solutionPlaceLabel(
  render: DiagramCpRender,
  place: LayerOrderSolutionPlace | null,
  t: TFunction
): { count: string } | null {
  return render.mode === 'folded-flat' && place ? { count: solutionPlaceCount(place, t) } : null;
}

/** The verb that shows a linked step each way (D19): the one map every surface reads. */
export const SHOW_AS_ACTION = {
  'crease-pattern': 'show-crease-pattern',
  folded: 'show-folded',
  simulated: 'show-simulated',
} as const satisfies Record<DiagramShowAs, DiagramLinkedPoseActionId>;

/** How far one press turns the picture. */
export const POSE_ROTATION_STEP_DEG = 15;

/**
 * Whether Pose draws a turn of `render` itself, before its picture is
 * captured: a flat fold spread by Default in the diagram's view (a
 * perspective one turns by its camera), whose live view turns the spread it
 * holds. Its turns then wait for no capture, which runs behind the view
 * (`PoseController.turn`); any other picture is drawn by its capture.
 */
export function turnsLive(render: DiagramCpRender): render is Extract<DiagramCpRender, { mode: 'folded-flat' }> {
  return render.mode === 'folded-flat' && render.spread?.kind === 'connected' && render.presentation?.kind !== 'perspective';
}

export function buildDiagramLinkedPoseActions(
  state: DiagramLinkedPoseState,
  deps: {
    t: TFunction;
    pose: (verb: DiagramLinkedPoseVerb) => void;
    /** Set Upright, in the live view: what pointed up on screen is the model's up. */
    setUpright?: () => void;
  },
  {
    stopsAtLast = false,
  }: {
    /**
     * For a pager with no readout — the Pose toolbar's (Round 4, H8): Next
     * Layer Order holds at the last order once the search has run out,
     * rather than wrapping round to the first, which nothing there would
     * show. The Step pane's, which reads "5 of 5", wraps.
     */
    stopsAtLast?: boolean;
  } = {}
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
    options: {
      disabled?: boolean;
      hint?: string;
      pressed?: boolean;
      toggle?: boolean;
      /** Shown by the live view before its picture is captured (`turnsLive`): it never waits for a capture. */
      live?: boolean;
      /** What it does, when it is not a pose of the step. */
      run?: () => void;
    } = {}
  ): DiagramLinkedPoseAction => {
    const disabled = readOnly !== undefined || (options.disabled ?? false);
    const held = waiting && !options.live;
    return {
      id,
      label,
      disabled,
      waiting: held && !disabled,
      hint: readOnly ?? (options.disabled ? options.hint : held ? capturing : undefined),
      ...(options.pressed === undefined ? {} : { pressed: options.pressed }),
      run: () => {
        // The way already shown is no verb: pressed again it would capture a
        // Simulated step back at 0%, which only Pose's live solver can hold.
        // A toggle pressed again turns off. A verb that cannot act refuses
        // here too: a surface may keep it focusable rather than disable it.
        if (held || (!options.toggle && options.pressed) || disabled) return;
        if (options.run) options.run();
        else if (id !== 'set-upright') deps.pose(id);
      },
    };
  };

  const shown = showAsOf(render);
  const modes = [
    action(SHOW_AS_ACTION['crease-pattern'], t('panels:diagram.pose.showCreasePattern', 'Crease Pattern'), {
      pressed: shown === 'crease-pattern',
    }),
    action(SHOW_AS_ACTION.folded, t('panels:diagram.pose.showFolded', 'Folded'), {
      pressed: shown === 'folded' && render.mode !== 'defox',
    }),
    action(SHOW_AS_ACTION.simulated, t('panels:diagram.pose.showSimulated', 'Simulated'), {
      pressed: shown === 'simulated',
    }),
  ];
  const live = turnsLive(render);
  const turn = [
    action('rotate-left', t('panels:diagram.pose.rotateLeft', 'Rotate Left'), { live }),
    action('rotate-right', t('panels:diagram.pose.rotateRight', 'Rotate Right'), { live }),
  ];
  const reset = action('reset', t('panels:diagram.pose.reset', 'Reset Pose'), {
    disabled: isDefaultRender(render),
    hint: t('panels:diagram.pose.resetHint', 'Already in its starting pose'),
  });
  // Held from turning on, never from turning off: a fold that lost its layer
  // order keeps a spread it cannot show, and taking it off changes nothing seen.
  const spreadOn = (render.mode === 'folded-flat' || render.mode === 'folded-3d') && render.spread !== undefined;
  const spreadHeld = spreadOn ? undefined : spreadBlocker(state, t);
  // The live view's own, as Edit's 3D window and Simulate offer it: held while none shows.
  const setUpright = action('set-upright', t('panels:diagram.pose.setUpright', 'Set Upright'), {
    disabled: !state.liveView || !deps.setUpright,
    hint: t('panels:diagram.pose.setUprightNeedsView', 'Its live view isn’t showing, so there is no up to set'),
    run: deps.setUpright,
  });
  const spreadLayers = action('spread-layers', t('panels:diagram.pose.spreadLayers', 'Spread Layers'), {
    disabled: spreadHeld !== undefined,
    hint: spreadHeld,
    pressed: spreadOn,
    toggle: true,
  });

  const { solutions } = state;
  const foldCase = render.mode === 'folded-flat' ? render.foldCase : 1;
  // Nowhere to go: no layer order, or one only; with `stopsAtLast`, the last of several once the search ran out.
  const single = solutions !== null && !solutions.hasNext && solutions.discovered <= 1;
  const last = stopsAtLast && solutions !== null && !solutions.hasNext && foldCase >= solutions.discovered;
  const nextHeld = solutions?.none === true || (single && foldCase === 1) || last;
  const nextHint = solutions?.none
    ? t('panels:diagram.pose.noSolution', 'This fold has no layer order')
    : single
      ? t('panels:diagram.pose.onlySolution', 'This fold has one layer order')
      : t('panels:diagram.pose.lastSolution', 'This is its last layer order');
  // A layer order chosen in the dialog is the record's (H9, D9): ‹ › step through the solutions that fit it,
  // in a fixed order with ends, which every pager waits at — the Step pane's too — once a press has found
  // them, a way a step proved to end (E9) among them; before one has, both are offered, from saved data
  // alone. Said in the cursor's words, which Edit's ‹ › use too: its place is among the solutions that fit,
  // counted by the pictures of a side, never the fold's layer orders.
  const held = state.constrained ? constrainedSolutionsHeld(state, t) : null;
  const ends = state.constrained && state.place ? solutionPlaceEnds(state.place) : null;
  const previousHeld = state.constrained
    ? held !== null || ends?.first === true
    : render.mode === 'folded-flat' && render.foldCase <= 1;
  const previousHint = !state.constrained
    ? t('panels:diagram.pose.firstSolution', 'This is its first layer order')
    : (held ?? t('panels:foldedFigureActions.firstSolutionShown', 'This is its first solution'));
  const solutionNextHeld = state.constrained ? held !== null || ends?.last === true : nextHeld;
  const solutionNextHint = !state.constrained
    ? nextHint
    : (held ?? t('panels:foldedFigureActions.lastSolutionShown', 'This is its last solution'));

  switch (render.mode) {
    case 'defox': return modes;
    case 'crease-pattern':
      return [...modes, ...turn, reset];
    case 'folded-flat':
      if(render.spread?.kind==='connected' && render.presentation?.kind==='perspective')return [
        ...modes,
        action('turn-over',t('panels:diagram.pose.otherSide','View From the Other Side')),
        action('view-top',t('panels:diagram.pose.viewTop','View From Above')),
        setUpright,spreadLayers,reset,
      ];
      return [
        ...modes,
        action('turn-over', t('panels:diagram.pose.turnOver', 'Turn Over')),
        ...turn,
        // A mirror axis vertical (Zach, 2026-10-05), the nearer way; pressed again, the other way up.
        action('upright', t('panels:diagram.pose.upright', 'Upright'), {
          disabled: state.mirrorAxes?.length === 0,
          hint: t('panels:diagram.pose.uprightNone', 'This fold has no mirror axis to stand on'),
        }),
        // Any layer order found, in either direction (D23): back to the one
        // before, on to the next — the search's next when none is found past
        // this one — the last wrapping round to the first, as Edit's does,
        // unless the pager has no readout to show it (`stopsAtLast`). A
        // constrained step's, through the solutions that fit, never wrap.
        action('previous-solution', t('panels:diagram.pose.previousSolution', 'Previous Layer Order'), {
          disabled: previousHeld,
          hint: previousHint,
        }),
        action('next-solution', t('panels:diagram.pose.nextLayerOrder', 'Next Layer Order'), {
          disabled: solutionNextHeld,
          hint: solutionNextHint,
        }),
        spreadLayers,
        reset,
      ];
    case 'folded-3d':
      return [
        ...modes,
        action('turn-over', t('panels:diagram.pose.otherSide', 'View From the Other Side')),
        action('view-top', t('panels:diagram.pose.viewTop', 'View From Above')),
        setUpright,
        spreadLayers,
        reset,
      ];
    case 'simulated':
      return [...modes, setUpright, reset];
  }
}

/**
 * One of a spread's choices, as the Step pane offers it: a kind, a direction
 * a depth spread's deeper layers step, or the layer an affine one holds still
 * — every flat picture's (`layerSpreadControls.ts`).
 */
export type DiagramSpreadChoice<T extends string> = LayerSpreadChoice<T>;

/** One of the eight ways a depth spread's deeper layers can step. */
export type DiagramSpreadDirectionAction = DiagramSpreadChoice<SpreadDirection>;

/** A flat fold's spread, for the Step pane while it is on (Phase 13). */
export type DiagramSpreadControls = LayerSpreadControls;

/**
 * The spread's kind and settings (Phase 13), while a flat fold's layers are
 * spread; null otherwise. Spread Layers itself is one of the pose verbs.
 * `shown` is the spread the picture shows now: a drag's, while it previews —
 * the step's own spread with the dragged slider moved, never another kind.
 */
export function buildDiagramSpreadControls(
  state: DiagramLinkedPoseState,
  shown: DiagramLayerSpread | null,
  deps: {
    t: TFunction;
    kind: (kind: SpreadKind) => void;
    direction: (toward: SpreadDirection) => void;
    keep: (keep: SpreadKeep) => void;
  }
): DiagramSpreadControls | null {
  const { t } = deps;
  const stored = state.render.mode === 'folded-flat' ? state.render.spread : undefined;
  if (!stored) return null;
  const hint = state.readOnly
    ? t('panels:diagram.actions.readOnlyHint', 'This diagram was made with a newer Ori Studio and opens read-only')
    : spreadBlocker(state, t);
  return layerSpreadControls(shown?.kind === stored.kind ? shown : stored, { hint, busy: state.busy, ...deps });
}

/** The pose a render starts in: upright, from the front, the first layer order, Edit's camera. */
export function isDefaultRender(render: DiagramCpRender): boolean {
  switch (render.mode) {
    case 'defox': return true;
    case 'crease-pattern':
      // Its side is the Step pane's Front | Back, kept by Reset as a spread is.
      return render.rotationDeg === 0;
    case 'folded-flat':
      if(render.spread?.kind==='connected'&&render.presentation?.kind==='perspective') {
        const start=defaultCaptureCamera('front'),camera=render.presentation.camera;
        return !camera.orient && Math.abs(camera.yaw-start.yaw)<1e-9 && Math.abs(camera.pitch-start.pitch)<1e-9 && Math.abs(camera.zoom-start.zoom)<1e-9;
      }
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
