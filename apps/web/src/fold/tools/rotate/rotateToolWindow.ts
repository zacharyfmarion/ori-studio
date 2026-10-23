/**
 * The Rotate tool's window, as the plain descriptor the one Fold window
 * renderer draws (`components/fold/FoldToolWindow`).
 *
 * Rotate locates nothing: from the moment it is in hand the folded pane shows
 * the model turned as it will be, so its window opens previewing —
 *
 * - **the amount**: 1/8, 1/4 or 1/2 of a turn, a segmented control, none of
 *   them chosen while an exact angle is;
 * - **the exact angle**, in degrees: what a preset turns by, or what was
 *   typed, normalised as every rotation is (`turnRotationOfDegrees`) — a
 *   number that names no turn (0, a whole turn) leaves the field as it was;
 * - **the direction**: clockwise or counterclockwise, as the viewer sees it;
 * - and Cancel, which puts Rotate down, and Rotate, which adds the turn.
 *
 * React-free and store-free.
 */
import type { TFunction } from 'i18next';
import {
  TURN_DIRECTIONS,
  TURN_FRACTION,
  TURN_PRESET_DEGREES,
  TURN_ROTATION_PRESETS,
  turnRotationDegrees,
  withTurnDirection,
  withTurnPreset,
  type TurnDirection,
  type TurnRotation,
  type TurnRotationPreset,
} from '../../../lib/steps/turn';
import { foldToolLabel } from '../foldToolCatalog';
import {
  queuedNote,
  settingsMeta,
  type FoldToolHost,
  type FoldToolWindowModel,
  type FoldToolWindowVerbs,
  type FoldToolWindowView,
} from '../foldToolWindow';
import { acceptsRotationDegrees, FOLD_ROTATE_DEGREES_STEP, rotationWithDegrees } from './rotateTool';

/** What the Rotate tool's window is drawn from, beside every tool's view. */
export interface FoldRotateWindowView {
  /** How far and which way the model turns: what the folded pane shows, and a commit adds. */
  rotation: TurnRotation;
}

/** Rotate's own controls in the window. */
export interface FoldRotateControls {
  amount: {
    label: string;
    /** The preset chosen; null while an exact angle is. */
    value: TurnRotationPreset | null;
    options: readonly { value: TurnRotationPreset; label: string; tooltip: string }[];
    set: (amount: TurnRotationPreset) => void;
  };
  /** The angle, in degrees: what the field shows, and what it takes. */
  degrees: {
    label: string;
    value: number;
    step: number;
    suffix: string;
    /** Whether the field takes a number: one that names a turn. Any other leaves it as it was. */
    accepts: (typed: number) => boolean;
    set: (typed: number) => void;
  };
  direction: {
    label: string;
    value: TurnDirection;
    options: readonly { value: TurnDirection; label: string }[];
    set: (direction: TurnDirection) => void;
  };
  disabled: boolean;
}

/** The words for a direction, as the Diagram's rotate glyph and turn name them. */
function directionLabel(t: TFunction, direction: TurnDirection): string {
  return direction === 'cw'
    ? t('panels:diagram.annotations.clockwise', 'Clockwise')
    : t('panels:diagram.annotations.counterclockwise', 'Counterclockwise');
}

/** Rotate's controls, bound to the tools' rotation. */
export function rotateControls(
  t: TFunction,
  rotation: TurnRotation,
  setRotation: (rotation: TurnRotation) => void,
  disabled: boolean
): FoldRotateControls {
  return {
    amount: {
      label: t('tools:fold.rotate.amount', 'Amount'),
      value: rotation.amount === 'degrees' ? null : rotation.amount,
      options: TURN_ROTATION_PRESETS.map((value) => ({
        value,
        label: TURN_FRACTION[value],
        tooltip: t('tools:fold.rotate.presetTooltip', '{{fraction}} turn, {{degrees}}°', {
          fraction: TURN_FRACTION[value],
          degrees: TURN_PRESET_DEGREES[value],
        }),
      })),
      set: (amount) => setRotation(withTurnPreset(rotation, amount)),
    },
    degrees: {
      label: t('tools:fold.rotate.degrees', 'Exact angle'),
      value: turnRotationDegrees(rotation),
      step: FOLD_ROTATE_DEGREES_STEP,
      suffix: '°',
      accepts: acceptsRotationDegrees,
      set: (typed) => {
        const next = rotationWithDegrees(rotation, typed);
        if (next) setRotation(next);
      },
    },
    direction: {
      label: t('tools:fold.rotate.direction', 'Direction'),
      value: rotation.direction,
      options: TURN_DIRECTIONS.map((value) => ({ value, label: directionLabel(t, value) })),
      set: (direction) => setRotation(withTurnDirection(rotation, direction)),
    },
    disabled,
  };
}

/** The Rotate tool's window: its controls, previewing from the start, and Cancel and Rotate. */
export function rotateToolWindow(
  t: TFunction,
  view: FoldToolWindowView,
  rotate: FoldRotateWindowView,
  verbs: FoldToolWindowVerbs,
  host: FoldToolHost
): FoldToolWindowModel {
  const readOnly = view.readOnly !== null;
  const title = foldToolLabel(t, 'rotate');
  const preview = view.preview;
  const landing = preview?.landing ?? true;
  const refused = preview?.refused ?? null;
  const setRotation = verbs.setRotation ?? (() => {});
  return {
    phase: 'preview',
    title,
    meta: settingsMeta(t, 3),
    instructions: {
      heading: t('tools:fold.window.instructions', 'Instructions'),
      items: [
        t('tools:fold.steps.rotateHowFar', 'Choose how far to turn the model.'),
        t('tools:fold.steps.rotateDirection', 'Choose which way it turns.'),
        host.coarse
          ? t('tools:fold.steps.rotateCommitTouch', 'Tap {{action}} to add the turn.', { action: title })
          : t('tools:fold.steps.rotateCommit', 'Press Enter to add the turn.'),
      ],
      // Every choice is optional: the model is shown turned from the start.
      current: 0,
      notes: [
        t('tools:fold.note.rotatePreview', 'The folded pane shows the model turned as it will be.'),
        ...(host.coarse ? [] : [t('tools:fold.note.rotateCancel', 'Esc puts Rotate down without adding the turn.')]),
        ...(refused ? [t('tools:fold.note.rotateRefused', 'This turn cannot be added here.')] : []),
        ...(preview ? queuedNote(t, preview) : []),
      ],
    },
    lineMode: null,
    kind: null,
    movingSide: null,
    layers: null,
    refusal: null,
    divide: null,
    rotate: rotateControls(t, rotate.rotation, setRotation, readOnly),
    footer: {
      cancel: {
        label: t('tools:fold.window.cancel', 'Cancel'),
        shortcut: 'viewport.cancel',
        disabled: false,
        run: verbs.cancel,
      },
      commit: {
        label: title,
        shortcut: 'fold.commit',
        disabled: readOnly || landing || refused !== null,
        run: verbs.commit,
      },
    },
  };
}
