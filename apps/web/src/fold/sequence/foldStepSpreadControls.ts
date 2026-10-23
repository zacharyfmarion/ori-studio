/**
 * A Fold step's layer spread as its controls offer it (Wave 5): Spread Layers
 * on or off — the Step pane's switch and the canvas bar's toggle — and while
 * on, its kind and values, laid out by the rows the Diagram's Pose section
 * uses (`LayerSpreadRows`). Each control sets the step's own setting
 * (`setFoldStepSpread`), which later steps take until one says otherwise.
 *
 * - **On** takes the look of the steps before it: the nearest earlier spread,
 *   else the default (`foldSpreadStarts`), as a Diagram step's does.
 * - **A kind** starts from the nearest earlier spread of that kind.
 * - **A slider's drag** writes as it moves, in one sitting — one undo step —
 *   and is counted once, as it ends. The picture follows it live: drawing a
 *   spread asks nothing of the engine.
 *
 * React-free and store-free: the edit, the counting and where a drag's
 * sitting is kept are passed in.
 */
import type { TFunction } from 'i18next';
import type { LayerSpreadOptions, SpreadKind } from '../../cp-workspace/folded/foldedLayerSpread';
import {
  layerSpreadControls,
  spreadSliderEdit,
  type LayerSpreadDrag,
  type LayerSpreadToggle,
  type SpreadSlider,
} from '../../cp-workspace/folded/layerSpreadControls';
import {
  withSpreadField,
  type LayerSpreadEdit,
  type LayerSpreadStarts,
} from '../../cp-workspace/folded/layerSpreadSettings';
import type { FoldSpreadSetting } from '../document/foldSequenceDocument';
import type { FoldEffectiveSpread } from '../document/foldStepSpread';

/** What a spread control did, as `fold spread changed` names it. */
export type FoldSpreadChange =
  | 'spread_on'
  | 'spread_off'
  | 'spread_kind'
  | 'spread_amount'
  | 'spread_direction'
  | 'spread_keep'
  | 'spread_skew'
  | 'spread_axis';

/** What the controls are of. */
export interface FoldStepSpreadState {
  /** The spread the step shows, and where it comes from. */
  effective: FoldEffectiveSpread;
  /** What it starts from when turned on, or switched to a kind. */
  starts: LayerSpreadStarts;
  /** Why it cannot be changed — a newer build's sequence, a locked step — or undefined. */
  hint: string | undefined;
}

/**
 * A slider's drag while it lasts: its undo sitting, the slider moved, and the
 * spread its newest move left. Kept by the surface across the renders the
 * drag's own edits cause, since the controls are rebuilt with each.
 */
export interface FoldSpreadSitting {
  session: number;
  slider: SpreadSlider | null;
  /** The spread the newest move that changed anything left; null while none has. */
  left: LayerSpreadOptions | null;
}

export interface FoldStepSpreadDeps {
  t: TFunction;
  /**
   * Set the step's own spread, in `session` when a drag's — one undo step for
   * the sitting. Whether it changed.
   */
  set: (setting: FoldSpreadSetting, session?: number) => boolean;
  /** Count a change that landed, with the spread it left (null for none). */
  changed: (change: FoldSpreadChange, spread: LayerSpreadOptions | null) => void;
  /** A new sitting's number, for a drag. */
  newSession: () => number;
  /** Where the drag in progress is kept. */
  sitting: { current: FoldSpreadSitting | null };
}

export interface FoldStepSpreadControls {
  /** Spread Layers. */
  toggle: LayerSpreadToggle;
  /** Its kind and values while the step's layers are spread; null while they are not. */
  spread: LayerSpreadDrag | null;
  /** Where the spread the step shows comes from: its own setting, an earlier step's, or the default. */
  origin: FoldEffectiveSpread['origin'];
}

const SLIDER_CHANGE: Record<SpreadSlider, FoldSpreadChange> = {
  amount: 'spread_amount',
  skew: 'spread_skew',
  axis: 'spread_axis',
};

/**
 * The controls of a step's spread. A drag is a sitting: `start` opens it,
 * each `preview` writes the slider's value in it, and `commit` counts it.
 */
export function foldStepSpreadControls(state: FoldStepSpreadState, deps: FoldStepSpreadDeps): FoldStepSpreadControls {
  const { effective, starts, hint } = state;
  const shown = effective.spread;
  const disabled = hint !== undefined;
  const apply = (setting: FoldSpreadSetting, change: FoldSpreadChange): void => {
    if (disabled) return;
    if (deps.set(setting)) deps.changed(change, setting === 'off' ? null : setting);
  };
  const edit = (current: LayerSpreadOptions, value: LayerSpreadEdit, change: FoldSpreadChange) =>
    apply(withSpreadField(current, value), change);

  const toggle: LayerSpreadToggle = {
    pressed: shown !== null,
    disabled,
    ...(hint ? { hint } : {}),
    run: () => (shown ? apply('off', 'spread_off') : apply(starts.any, 'spread_on')),
  };
  if (!shown) return { toggle, spread: null, origin: effective.origin };

  const open = (): FoldSpreadSitting => {
    deps.sitting.current = { session: deps.newSession(), slider: null, left: null };
    return deps.sitting.current;
  };
  const controls = layerSpreadControls(shown, {
    hint,
    busy: false,
    t: deps.t,
    kind: (kind: SpreadKind) => apply(starts[kind], 'spread_kind'),
    direction: (toward) => edit(shown, { verb: 'spread-direction', toward }, 'spread_direction'),
    keep: (keep) => edit(shown, { verb: 'spread-keep', keep }, 'spread_keep'),
  });
  return {
    toggle,
    origin: effective.origin,
    spread: {
      ...controls,
      start: () => {
        if (disabled) return false;
        open();
        return true;
      },
      preview: (slider, value) => {
        if (disabled) return;
        // A key's step comes with no drag before it: a sitting of its own.
        const sitting = deps.sitting.current ?? open();
        sitting.slider = slider;
        const next = withSpreadField(shown, spreadSliderEdit(slider, shown.kind, value));
        if (deps.set(next, sitting.session)) sitting.left = next;
      },
      commit: () => {
        const done = deps.sitting.current;
        deps.sitting.current = null;
        if (done?.slider && done.left) deps.changed(SLIDER_CHANGE[done.slider], done.left);
      },
    },
  };
}
