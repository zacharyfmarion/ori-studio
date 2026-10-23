/**
 * A flat picture's layer spread as controls offer it (Phase 13): Spread
 * Layers on or off, and while on, its kind and each of its values — the
 * descriptors every surface that sets a spread lays out the same way
 * (`components/paper/LayerSpreadRows`), the Diagram's Step pane and Fold's
 * alike. What the controls do — a capture of a diagram step, an edit of a
 * Fold step — is the surface's, passed in.
 *
 * React-free and store-free, as `foldedFigureActions.ts` is.
 */
import type { TFunction } from 'i18next';
import {
  SPREAD_DIRECTIONS,
  SPREAD_KEEPS,
  SPREAD_KINDS,
  type LayerSpreadOptions,
  type SpreadDirection,
  type SpreadKeep,
  type SpreadKind,
} from './foldedLayerSpread';
import { clampSpreadAmount, clampSpreadAxis, clampSpreadSkew, type LayerSpreadEdit } from './layerSpreadSettings';

/** The sliders a spread is dragged by: its amount, and an affine one's skew and axis. */
export type SpreadSlider = 'amount' | 'skew' | 'axis';

/**
 * Spread Layers, the switch: on or off, and why it cannot be turned now.
 * A pose verb is one (`DiagramLinkedPoseAction`), and so is Fold's.
 */
export interface LayerSpreadToggle {
  /** Whether the layers are spread. */
  pressed?: boolean;
  disabled: boolean;
  hint?: string;
  /** Turn it the other way; refuses while it cannot. */
  run: () => void;
}

/**
 * One of a spread's choices, as a control offers it: a kind, a direction a
 * depth spread's deeper layers step, or the layer an affine one holds still.
 */
export interface LayerSpreadChoice<T extends string> {
  value: T;
  label: string;
  /** The one chosen now. */
  pressed: boolean;
  /** Held as the other verbs are: a read-only document, a picture with no layers, a capture running. */
  disabled: boolean;
  waiting: boolean;
  hint?: string;
  run: () => void;
}

/** A spread's kind and values, while the layers are spread. */
export interface LayerSpreadControls {
  /** The spread the picture shows — a drag's, while it is previewed. */
  spread: LayerSpreadOptions;
  /** Whether the spread can be changed, and if not, why. */
  disabled: boolean;
  hint?: string;
  /** Depth or affine (13g). */
  kinds: LayerSpreadChoice<SpreadKind>[];
  /** A depth spread's eight directions; none for an affine one. */
  directions: LayerSpreadChoice<SpreadDirection>[];
  /** The layer an affine spread holds still, top or bottom; none for a depth one. */
  keeps: LayerSpreadChoice<SpreadKeep>[];
}

/** A spread's controls with its sliders' drags: what `LayerSpreadRows` lays out under Spread Layers. */
export interface LayerSpreadDrag extends LayerSpreadControls {
  /**
   * Show the picture with a slider at this value — an amount as a fraction,
   * a skew from 0 to 1, an axis in degrees — before it is committed: each
   * move of a drag, or a key.
   */
  preview: (slider: SpreadSlider, value: number) => void;
  /** Commit the slide previewed, as one undo step: the end of a drag, or a key. */
  commit: () => void;
  /** Whether a drag may start: not on a document that cannot change, nor a picture with no layers. */
  start: () => boolean;
}

/**
 * The controls of `spread`, the spread the picture shows. `hint` says why it
 * cannot be changed, when it cannot; `busy`, that the picture is being made
 * again and every choice waits for it. A choice already made does nothing.
 */
export function layerSpreadControls(
  spread: LayerSpreadOptions,
  {
    hint,
    busy,
    t,
    kind,
    direction,
    keep,
  }: {
    hint: string | undefined;
    busy: boolean;
    t: TFunction;
    kind: (kind: SpreadKind) => void;
    direction: (toward: SpreadDirection) => void;
    keep: (keep: SpreadKeep) => void;
  }
): LayerSpreadControls {
  const disabled = hint !== undefined;
  const waiting = !disabled && busy;
  const choice = <T extends string>(value: T, label: string, pressed: boolean, choose: (value: T) => void) => ({
    value,
    label,
    pressed,
    disabled,
    waiting,
    hint: hint ?? (waiting ? t('panels:diagram.actions.capturingHint', 'Its picture is being captured') : undefined),
    run: () => {
      if (!disabled && !waiting && !pressed) choose(value);
    },
  });
  return {
    spread,
    disabled,
    hint,
    kinds: SPREAD_KINDS.map((each) => choice(each, spreadKindLabel(each, t), each === spread.kind, kind)),
    directions:
      spread.kind === 'depth'
        ? SPREAD_DIRECTIONS.map((toward) => choice(toward, spreadDirectionLabel(toward, t), toward === spread.toward, direction))
        : [],
    keeps:
      spread.kind === 'affine'
        ? SPREAD_KEEPS.map((each) => choice(each, spreadKeepLabel(each, t), each === spread.keep, keep))
        : [],
  };
}

/**
 * The edit a slider at `value` makes of a spread of `kind`, within its range:
 * an amount as a fraction — of the kind it was dragged on, so it is dropped
 * on a spread switched to the other kind meanwhile — a skew, or an axis.
 */
export function spreadSliderEdit(slider: SpreadSlider, kind: SpreadKind, value: number): LayerSpreadEdit {
  switch (slider) {
    case 'amount':
      return { verb: 'spread-amount', amount: clampSpreadAmount(kind, value), kind };
    case 'skew':
      return { verb: 'spread-skew', skew: clampSpreadSkew(value) };
    case 'axis':
      return { verb: 'spread-axis', axisDeg: clampSpreadAxis(value) };
  }
}

/** A kind's name, as its segment says it. */
export function spreadKindLabel(kind: SpreadKind, t: TFunction): string {
  return kind === 'depth'
    ? t('panels:diagram.pose.spreadKindDepth', 'Depth')
    : t('panels:diagram.pose.spreadKindAffine', 'Affine');
}

/** A layer held still, as its segment says it. */
export function spreadKeepLabel(keep: SpreadKeep, t: TFunction): string {
  return keep === 'top'
    ? t('panels:diagram.pose.spreadKeepTop', 'Top')
    : t('panels:diagram.pose.spreadKeepBottom', 'Bottom');
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
