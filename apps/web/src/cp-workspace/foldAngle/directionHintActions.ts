/**
 * Fold-direction-hint verbs, as plain descriptors.
 *
 * React-free and store-free by design (AGENTS.md > "Panel components"), the same
 * shape as {@link foldAngleActions} beside it — so the two controls in the CP
 * context panel are built the same way and can be tested without mounting.
 *
 * Copy is translated here rather than at the render site because these are
 * *words* ("Mountain", "Valley"), unlike the fold-angle presets whose labels are
 * numerals. `t` is passed in, the way `propagationScope` takes it, which keeps
 * the module React-free without leaving English in the descriptors.
 */
import type { TFunction } from 'i18next';

import type { OristudioCpFoldDirectionHint } from '../../engine/oristudioCpTypes';

/**
 * What a hint chip does. Mirrors the kernel's `DirectionHintChange` — the three
 * intents are deliberate, and `'Clear'` is a value rather than an omission so
 * "forget the hint" cannot be confused with "no field sent".
 */
export type DirectionHintChange = OristudioCpFoldDirectionHint | 'Clear';

export interface DirectionHintOption {
  /** Stable id, used as a React key and in tests. */
  id: string;
  change: DirectionHintChange;
  /** Short chip label. */
  label: string;
  /** Longer description for tooltips and screen readers. */
  description: string;
}

/**
 * The three chips, in the order they read: the two directions, then "forget it".
 *
 * Mountain before valley to match every other mountain/valley pairing in the
 * app (the line-colour palette, the M/V toggle, the FOLD spec's own ordering),
 * so the control is not the one place the convention flips.
 */
export function directionHintOptions(t: TFunction): readonly DirectionHintOption[] {
  return [
    {
      id: 'mountain',
      change: 'Mountain',
      label: t('tools:cpContext.foldDirectionMountain', 'Mountain'),
      description: t(
        'tools:cpContext.foldDirectionMountainDescription',
        'Remember that these undecided creases folded as mountains'
      ),
    },
    {
      id: 'valley',
      change: 'Valley',
      label: t('tools:cpContext.foldDirectionValley', 'Valley'),
      description: t(
        'tools:cpContext.foldDirectionValleyDescription',
        'Remember that these undecided creases folded as valleys'
      ),
    },
    {
      id: 'clear',
      change: 'Clear',
      label: t('tools:cpContext.foldDirectionNone', 'None'),
      description: t(
        'tools:cpContext.foldDirectionNoneDescription',
        'Forget which way these undecided creases folded'
      ),
    },
  ];
}

/**
 * Shape of the direction hints across a selection, for a mixed-state control.
 *
 * Deliberately the same shape as `FoldAngleSelectionSummary`, including the
 * `null`-means-mixed convention: `hint` is the shared value, and `mixed` is what
 * separates "they all agree on *no hint*" from "they disagree". Without both,
 * an all-cleared selection and a half-mountain one would look identical and the
 * "None" chip would show as pressed for both.
 */
export interface DirectionHintSelectionSummary {
  /** The shared hint, `null` when every crease is unhinted **or** when mixed. */
  hint: OristudioCpFoldDirectionHint | null;
  /** How many selected lines are unassigned creases (the ones a hint can reach). */
  unassignedCount: number;
  /** How many selected lines cannot carry a hint (decided, border, auxiliary). */
  otherCount: number;
  /** True when at least two unassigned creases disagree. */
  mixed: boolean;
}

export function summariseDirectionHints(
  hints: readonly (OristudioCpFoldDirectionHint | null)[],
  otherCount: number
): DirectionHintSelectionSummary {
  if (hints.length === 0) {
    return { hint: null, unassignedCount: 0, otherCount, mixed: false };
  }
  const first = hints[0]!;
  const mixed = hints.some((value) => value !== first);
  return {
    hint: mixed ? null : first,
    unassignedCount: hints.length,
    otherCount,
    mixed,
  };
}

/** Whether `option` is the state the whole selection is already in. */
export function isDirectionHintActive(
  summary: DirectionHintSelectionSummary,
  change: DirectionHintChange
): boolean {
  if (summary.unassignedCount === 0 || summary.mixed) return false;
  return change === 'Clear' ? summary.hint === null : summary.hint === change;
}

/**
 * How many creases a hint would actually reach, for the result message.
 *
 * The count is the point: a hint silently skips every decided crease in the
 * selection, so a user who selected twelve lines and hinted needs to see that
 * it landed on three.
 */
export function describeDirectionHintAffected(
  t: TFunction,
  summary: DirectionHintSelectionSummary
): string {
  const { unassignedCount, otherCount } = summary;
  if (otherCount > 0) {
    return t(
      'tools:cpContext.foldDirectionAffectedSome',
      '{{creases}} of {{lines}} selected lines',
      { creases: unassignedCount, lines: unassignedCount + otherCount }
    );
  }
  return unassignedCount === 1
    ? t('tools:cpContext.foldDirectionAffectedOne', '{{creases}} undecided crease', {
        creases: unassignedCount,
      })
    : t('tools:cpContext.foldDirectionAffectedOther', '{{creases}} undecided creases', {
        creases: unassignedCount,
      });
}
