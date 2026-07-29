/**
 * How a non-180 fold angle changes a crease's ink.
 *
 * Hue keeps meaning direction (red mountain, blue valley) and lightness carries
 * magnitude: a full ±180 crease paints exactly as it always has, and shallower
 * angles wash toward the canvas. That keeps Oriedita's colour language intact —
 * a classic pattern is pixel-identical — while making a 90° crease legible at a
 * glance.
 *
 * The wash is **floored**. Fully washing a 0° crease would make it invisible,
 * and a nearly-invisible crease reads as "dimmed/inactive", which is an existing
 * visual meaning on this surface. `MAX_WASH` keeps even a 0° crease clearly
 * drawn.
 *
 * This is a gist channel, not a readout: it cannot distinguish 90° from 100°.
 * That is the numeric badge's job.
 */
import type { Rgba } from '../renderer/types';
import { FOLD_MAGNITUDE_FULL } from '../../lib/foldAngle';

/**
 * Strongest wash applied, at `|ρ| = 0`. Leaves 45% of the ink, which stays well
 * clear of the alpha range the surface uses for dimming.
 */
export const MAX_WASH = 0.55;

/**
 * Blend `ink` toward `canvas` according to a stored fold magnitude.
 *
 * `undefined` is a classic crease and returns `ink` **by identity**, so the
 * common path allocates nothing and a classic document renders byte-identically.
 */
export function applyFoldAngleRamp(
  ink: Rgba,
  magnitudeUnits: number | undefined,
  canvas: Rgba
): Rgba {
  if (magnitudeUnits === undefined || magnitudeUnits >= FOLD_MAGNITUDE_FULL) return ink;
  const t = Math.max(0, Math.min(1, magnitudeUnits / FOLD_MAGNITUDE_FULL));
  const wash = (1 - t) * MAX_WASH;
  return [
    ink[0] + (canvas[0] - ink[0]) * wash,
    ink[1] + (canvas[1] - ink[1]) * wash,
    ink[2] + (canvas[2] - ink[2]) * wash,
    ink[3],
  ];
}
