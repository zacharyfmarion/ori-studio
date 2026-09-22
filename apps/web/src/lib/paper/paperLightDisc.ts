/**
 * The disc the light is aimed with: a flat picture of a hemisphere, where the
 * centre is a light straight at the paper and the rim is one grazing it.
 *
 * Two angles are two numbers, and nobody reads "322°, 43°" as *over the left
 * shoulder* — so the pair is one point instead. The map is the obvious one:
 * the bearing around the disc is the azimuth, clockwise from straight up the
 * way {@link PaperLight} counts it, and the distance out from the centre is
 * the elevation falling from 90° to 0°.
 *
 * Geometry only, no React: the component turns a point into a gradient centre
 * and a handle, and a pointer into a light.
 */
import { wrapDegrees, type PaperLight } from './paperStyle';

/** The disc's diameter in CSS px — the design's, and what the stylesheet draws. */
export const LIGHT_DISC_SIZE = 104;

/**
 * How far from the centre the rim sits, in disc px. Short of the disc's own
 * radius by the handle's half-width, so a light on the horizon still has its
 * handle inside the circle rather than half outside it.
 */
export const LIGHT_DISC_RADIUS = 46;

/** What one arrow press moves the light by, in degrees. */
export const LIGHT_DISC_STEP_DEGREES = 5;

/**
 * The elevations the disc can express: the hemisphere in front of the paper.
 *
 * Narrower than the range a style may hold, which runs to −90°, and
 * deliberately so — the disc is the only light editor in the app, so below the
 * horizon is no longer settable anywhere. A light behind the paper shades the
 * figure flat, which is a state nobody has ever asked for on purpose, and a
 * control that could reach it would have to draw a hemisphere it cannot show.
 */
const ELEVATION_MAX = 90;

export interface LightDiscPoint {
  /** Disc px from the left edge. */
  x: number;
  /** Disc px from the top edge. */
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Where `light` sits on the disc, in disc px from its top-left corner.
 *
 * A light below the horizon — which the disc cannot show, and which now only a
 * stored style or an imported preset can carry — sits on the rim with the one
 * that grazes it.
 */
export function lightDiscPoint(light: PaperLight): LightDiscPoint {
  const centre = LIGHT_DISC_SIZE / 2;
  const radius =
    (1 - clamp(light.elevation, 0, ELEVATION_MAX) / ELEVATION_MAX) * LIGHT_DISC_RADIUS;
  const bearing = (light.azimuth * Math.PI) / 180;
  return {
    x: centre + radius * Math.sin(bearing),
    y: centre - radius * Math.cos(bearing),
  };
}

/**
 * The light a point on the disc means. `dx` / `dy` are px from the centre,
 * positive right and down; past the rim is the horizon rather than nothing, so
 * a drag that leaves the circle keeps steering the bearing.
 */
export function lightAtDiscOffset(dx: number, dy: number): { azimuth: number; elevation: number } {
  const azimuth = wrapDegrees((Math.atan2(dx, -dy) * 180) / Math.PI);
  const reach = Math.min(1, Math.hypot(dx, dy) / LIGHT_DISC_RADIUS);
  return { azimuth, elevation: ELEVATION_MAX * (1 - reach) };
}

/**
 * The light `steps` of arrow key away: the bearing wraps, the elevation stops
 * at the horizon and at the view axis.
 *
 * A stored elevation under the horizon — one a preset file carries, since no
 * control in the app sets one — is pulled into the disc's own range by the
 * first press rather than stepped further down, because the disc has no way to
 * show where it would go.
 */
export function stepLight(
  light: PaperLight,
  azimuthSteps: number,
  elevationSteps: number
): PaperLight {
  return {
    ...light,
    azimuth: wrapDegrees(light.azimuth + azimuthSteps * LIGHT_DISC_STEP_DEGREES),
    elevation: clamp(
      clamp(light.elevation, 0, ELEVATION_MAX) + elevationSteps * LIGHT_DISC_STEP_DEGREES,
      0,
      ELEVATION_MAX
    ),
  };
}
