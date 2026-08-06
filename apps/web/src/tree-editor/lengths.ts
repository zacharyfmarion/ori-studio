import { formatNumber } from '../lib/geometry';
import type { EditableTreeEdge } from './model';

/**
 * What an edge length means on a surface: what values are admissible, how a
 * dragged distance becomes one of them, and how it reads.
 *
 * The single axis on which the tree editors differ. Box-pleat lengths are whole
 * numbers of grid cells; a search query's are whatever the drawing says. Every
 * other difference between the two surfaces turned out to be the same editor.
 */

/**
 * Per-gesture snapping state.
 *
 * Rounding a live cursor distance flickers at the midpoint — hover near 1.5 and
 * the flap alternates between 1 and 2 on every pointer sample. The quantizer
 * therefore remembers what it last answered and requires the distance to travel
 * a little past the boundary before changing its mind. Owned by the drag
 * session, so it resets with the gesture.
 */
export interface QuantizeState {
  current: number | null;
}

export function createQuantizeState(): QuantizeState {
  return { current: null };
}

export interface TreeLengthRule {
  /** Shortest admissible length. */
  min: number;
  /** Longest admissible length for this edge, or null for unbounded. */
  max(edge: EditableTreeEdge): number | null;
  /**
   * Increment for the field's `step` and its +/− buttons, or null when lengths
   * are continuous — the buttons then nudge proportionally instead.
   */
  step: number | null;
  /** A cursor distance, as an admissible length. */
  quantize(distance: number, state?: QuantizeState): number;
  format(value: number): string;
}

/**
 * How far past the midpoint the cursor must travel before the snapped length
 * changes, in tree units.
 *
 * At the default zoom one tree unit is 56 screen pixels, so this is ≈ 4.5 px —
 * comfortably clear of hand tremor, well short of feeling sticky.
 */
export const SNAP_HYSTERESIS = 0.08;

/** Nearest whole number, with {@link SNAP_HYSTERESIS} against midpoint flicker. */
export function snapToInteger(distance: number, state?: QuantizeState): number {
  const nearest = Math.round(distance);
  const current = state?.current ?? null;
  if (current === null || Math.abs(current - nearest) !== 1) {
    if (state) state.current = nearest;
    return nearest;
  }
  // One step away: only move once the cursor is past the midpoint *and* the
  // deadband. Otherwise hold, which is what stops the flicker.
  const boundary = (current + nearest) / 2;
  const moved = nearest > current ? distance >= boundary + SNAP_HYSTERESIS : distance <= boundary - SNAP_HYSTERESIS;
  const answer = moved ? nearest : current;
  if (state) state.current = answer;
  return answer;
}

/** Whole grid cells, at least one. Box-pleat. */
export const SNAPPED_LENGTHS: TreeLengthRule = {
  min: 1,
  max: (edge) => edge.maxLength,
  step: 1,
  quantize: snapToInteger,
  format: (value) => formatNumber(value, 2),
};

/** Any positive length. Search surfaces, where the drawing *is* the length. */
export const CONTINUOUS_LENGTHS: TreeLengthRule = {
  min: 1e-3,
  max: () => null,
  step: null,
  quantize: (distance) => distance,
  format: (value) => formatNumber(value, 3),
};

/**
 * Clamp a length into the rule's admissible range for this edge.
 *
 * "No ceiling" is `Infinity`, not "the value the caller asked for". The box-pleat
 * field this came from used the latter, which quietly meant that an edge with no
 * `maxLength` accepted anything at all — `min(value, max(1, value))` is `value`
 * for every value below the floor. It never showed there because box-pleat edges
 * always carry a ceiling; on a surface where none do, it is the whole clamp.
 */
export function clampLength(rule: TreeLengthRule, edge: EditableTreeEdge, value: number): number {
  const max = rule.max(edge) ?? Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(rule.min, value));
}

/**
 * The length one press of the +/− buttons should ask for.
 *
 * A fixed ±1 on a continuous length is the wrong shape — it is enormous next to
 * 0.4 and negligible next to 30 — so a stepless rule nudges by a ratio instead.
 */
export function nudgeLength(rule: TreeLengthRule, current: number, direction: 1 | -1): number {
  if (rule.step !== null) return Math.round(current) + direction * rule.step;
  return direction === 1 ? current * 1.1 : current / 1.1;
}
