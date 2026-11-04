/**
 * The Export and Share dialogs' folded figure's layer spread as its rows
 * offer it (`components/paper/LayerSpreadRows`), in the same words and order
 * as everywhere else: Spread layers, then, while on, Spread by and its
 * values. Head-on only, so no Presentation row.
 *
 * The setting is the dialog's own (decision 3): nothing reaches the document
 * or its history. A press — the switch, a kind, a direction, the layer held
 * still, a reset, a key — commits at once. A drag — a slider, the reveal pad —
 * shows its value in the rows as it moves (`preview`) and commits once as it
 * ends, so the figure is captured once per gesture, with its last settled
 * picture up meanwhile. The drag's value is kept in a sitting the host holds
 * across the renders its own previews cause, as Fold's is, so the end of a
 * drag commits its last move even when both arrive in one event.
 *
 * Spread layers says, under its label, why the layers are not spread. A fold
 * with no layer order has none to spread, and is held off. Layers a spread
 * could not be made of keep it on, with Spread by open — Affine and Depth need
 * no solve, so another kind may spread what Default could not — and its own
 * values held, as a Diagram step's are. While the figure is still folding it
 * shows the setting and says nothing, since nothing yet speaks against it.
 *
 * React-free and store-free, as `foldedFigureActions.ts` is.
 */
import type { TFunction } from 'i18next';
import type { LayerSpreadOptions } from '../folded/foldedLayerSpread';
import {
  layerSpreadControls,
  spreadFailedReason,
  spreadSliderEdit,
  spreadValuesHold,
  type LayerSpreadDrag,
  type LayerSpreadToggle,
} from '../folded/layerSpreadControls';
import { DEFAULT_CONNECTED_SPREAD, withSpreadField, type LayerSpreadStarts } from '../folded/layerSpreadSettings';

export interface ExportSpreadControlsState {
  /** The dialog's setting, committed; null for none. */
  readonly setting: LayerSpreadOptions | null;
  /**
   * Whether the fold has layers to spread — a flat fold with a layer order —
   * or null while no fold has landed to say: the rows then show the setting,
   * and say nothing against it.
   */
  readonly spreadable: boolean | null;
  /** The setting's layers could not be spread: it stays on, and the figure is drawn unspread. */
  readonly failed: boolean;
  /** What Spread layers turned on, or a kind chosen, starts from. */
  readonly starts: LayerSpreadStarts;
  /**
   * Why nothing can be changed now — the share card is made — or undefined.
   * On hover only: the Layer order row above says it.
   */
  readonly held?: string;
}

export interface ExportSpreadControlsDeps {
  readonly t: TFunction;
  /** Commit a setting: a press, or a drag's end. Null turns the spread off. */
  readonly commit: (next: LayerSpreadOptions | null) => void;
  /** Show a drag's value in the rows before it commits; null once it has. */
  readonly preview: (next: LayerSpreadOptions | null) => void;
  /** The drag in progress, kept across the renders its previews cause. */
  readonly sitting: { current: LayerSpreadOptions | null };
}

export interface ExportSpreadControls {
  /** Spread layers; absent while the figure is not drawn. */
  readonly toggle: LayerSpreadToggle;
  /** Its kind and values while it is on; null while it is off. */
  readonly spread: LayerSpreadDrag | null;
}

/**
 * The rows of a dialog's figure spread. `shown` is the setting, or a drag's
 * value while it lasts.
 */
export function exportSpreadControls(
  state: ExportSpreadControlsState,
  shown: LayerSpreadOptions | null,
  deps: ExportSpreadControlsDeps
): ExportSpreadControls {
  const { setting, spreadable, failed, starts, held } = state;
  const { t } = deps;
  const reason =
    spreadable === false
      ? t('panels:diagram.pose.spreadNeedsOrder', 'This fold has no layer order, so it has no layers to spread')
      : failed
        ? spreadFailedReason(t)
        : undefined;
  const refused = spreadable === false || held !== undefined;
  const hint = reason ?? held;
  const toggle: LayerSpreadToggle = {
    pressed: spreadable !== false && setting !== null,
    disabled: refused,
    ...(hint ? { hint } : {}),
    ...(reason ? { note: reason } : {}),
    run: () => {
      if (refused) return;
      deps.sitting.current = null;
      deps.preview(null);
      deps.commit(setting ? null : starts.any);
    },
  };
  if (spreadable === false || !setting) return { toggle, spread: null };

  const value = shown ?? setting;
  const press = (next: LayerSpreadOptions) => {
    if (held !== undefined) return;
    deps.sitting.current = null;
    deps.preview(null);
    deps.commit(next);
  };
  const controls = layerSpreadControls(value, {
    hint: held,
    // Layers this spread could not be made of: another kind is the way on, and no value of its own changes them.
    ...(failed ? { valuesHeld: spreadFailedReason(t) } : {}),
    // A capture never holds a choice back: a newer setting takes its place.
    busy: false,
    t,
    kind: (kind) => press(starts[kind]),
    direction: (toward) => press(withSpreadField(setting, { verb: 'spread-direction', toward })),
    keep: (keep) => press(withSpreadField(setting, { verb: 'spread-keep', keep })),
  });
  const valuesHeld = spreadValuesHold(controls).disabled;
  const move = (next: LayerSpreadOptions) => {
    if (valuesHeld) return;
    deps.sitting.current = next;
    deps.preview(next);
  };
  return {
    toggle,
    spread: {
      ...controls,
      defaultAmount: DEFAULT_CONNECTED_SPREAD.amount,
      start: () => {
        deps.sitting.current = null;
        return !valuesHeld;
      },
      preview: (slider, at) =>
        move(withSpreadField(deps.sitting.current ?? setting, spreadSliderEdit(slider, setting.kind, at))),
      previewReveal: (reveal) => {
        if (setting.kind !== 'connected') return;
        move(withSpreadField(deps.sitting.current ?? setting, { verb: 'spread-reveal', reveal }));
      },
      commit: () => {
        const moved = deps.sitting.current;
        deps.sitting.current = null;
        deps.preview(null);
        if (moved) deps.commit(moved);
      },
    },
  };
}
