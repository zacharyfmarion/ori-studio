/**
 * Fold-angle verbs, as plain descriptors.
 *
 * React-free and store-free by design (AGENTS.md > "Panel components"): the same
 * catalog feeds the selection toolbar, the context panel, and the context menu,
 * so none of them has to agree on anything by hand.
 */
import { FOLD_MAGNITUDE_FULL, degreesToFoldMagnitude } from '../../lib/foldAngle';

export interface FoldAnglePreset {
  /** Stable id, used as a React key and in tests. */
  id: string;
  /** `|ρ|` in degrees. */
  degrees: number;
  /** Short chip label. */
  label: string;
  /** Longer description for tooltips and screen readers. */
  description: string;
}

/**
 * The quick-pick palette.
 *
 * 90 covers orthogonal work (boxes), 60/120 triangular and hex, 45/135 the 22.5
 * family, and 180 returns to classic. Between them that is nearly every
 * transcription case, which is what keeps typing off the common path.
 */
export const FOLD_ANGLE_PRESETS: readonly FoldAnglePreset[] = [
  { id: 'classic', degrees: 180, label: '180°', description: 'Full fold (classic)' },
  { id: 'deg135', degrees: 135, label: '135°', description: 'Fold 135 degrees' },
  { id: 'deg120', degrees: 120, label: '120°', description: 'Fold 120 degrees' },
  { id: 'deg90', degrees: 90, label: '90°', description: 'Fold 90 degrees (square)' },
  { id: 'deg60', degrees: 60, label: '60°', description: 'Fold 60 degrees' },
  { id: 'deg45', degrees: 45, label: '45°', description: 'Fold 45 degrees' },
];

/** The magnitude a preset resolves to, with 180 normalised to classic (`null`). */
export function presetMagnitude(preset: FoldAnglePreset): number | null {
  const units = degreesToFoldMagnitude(preset.degrees);
  if (units === null || units === FOLD_MAGNITUDE_FULL) return null;
  return units;
}

/**
 * Summary of the fold angles across a selection, for a mixed-state control.
 *
 * `degrees` is `null` when the selection disagrees; `creaseCount` is how many of
 * the selection can actually carry an angle, so the UI can say "4 of 7 creases"
 * rather than silently ignoring the rest.
 */
export interface FoldAngleSelectionSummary {
  /** Shared `|ρ|` in degrees, or `null` when mixed or empty. */
  degrees: number | null;
  /** How many selected lines are folding creases. */
  creaseCount: number;
  /** How many selected lines cannot carry an angle (border, auxiliary). */
  nonCreaseCount: number;
  /** True when at least two creases disagree. */
  mixed: boolean;
}

export function summariseFoldAngles(
  magnitudesDegrees: readonly (number | null)[],
  nonCreaseCount: number,
): FoldAngleSelectionSummary {
  if (magnitudesDegrees.length === 0) {
    return { degrees: null, creaseCount: 0, nonCreaseCount, mixed: false };
  }
  const first = magnitudesDegrees[0]!;
  const mixed = magnitudesDegrees.some((value) => value !== first);
  return {
    degrees: mixed ? null : first,
    creaseCount: magnitudesDegrees.length,
    nonCreaseCount,
    mixed,
  };
}

/** How many creases a "set angle" would actually affect, for the result message. */
export function describeAffected(summary: FoldAngleSelectionSummary): string {
  const { creaseCount, nonCreaseCount } = summary;
  if (nonCreaseCount === 0) return `${creaseCount} crease${creaseCount === 1 ? '' : 's'}`;
  return `${creaseCount} of ${creaseCount + nonCreaseCount} selected lines`;
}
