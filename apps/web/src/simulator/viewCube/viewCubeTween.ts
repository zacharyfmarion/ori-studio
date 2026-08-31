import { viewDepthAxis, viewRotationFor } from '@treemaker/origami-simulator';
import { normalizeAngle, type SimulatorOrbitView } from '../../lib/simulatorOrbit';

/**
 * The snap animation: how long a turn takes, and where it is partway through.
 *
 * Pure, so the timing rule can be asserted without a clock. The rAF loop that
 * drives it lives in the viewport, which is what owns the camera.
 */

/**
 * Radians per second, matching drei's `GizmoHelper` — the cube this one follows.
 * A half turn therefore takes half a second and a quarter turn a quarter, which
 * is the whole of the timing rule.
 */
const TURN_RATE = 2 * Math.PI;

/** Floor and ceiling on a snap, so a tiny correction is not instant and a full
 * reversal does not outstay its welcome. The ceiling is the natural π turn. */
const MIN_DURATION_MS = 120;
const MAX_DURATION_MS = 500;

function eyeDirection(view: SimulatorOrbitView): readonly [number, number, number] {
  return viewDepthAxis(viewRotationFor(view));
}

/**
 * How long the turn from one view to another should take.
 *
 * Measured on the angle between the two eye directions rather than on the change
 * in yaw and pitch: near the poles a large yaw change moves the eye barely at
 * all, and timing it by the angles would spend half a second going nowhere.
 */
export function viewCubeSnapDurationMs(from: SimulatorOrbitView, to: SimulatorOrbitView): number {
  const a = eyeDirection(from);
  const b = eyeDirection(to);
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  // The larger of the two turns, because a roll moves the eye not at all: timed
  // on the eye alone, a quarter roll would take the floor and flick round.
  const swept = Math.max(
    Math.acos(dot),
    Math.abs(normalizeAngle((to.roll ?? 0) - (from.roll ?? 0)))
  );
  return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, (swept / TURN_RATE) * 1000));
}

/** Ease in and out, so the turn starts and stops rather than jerking. */
function ease(t: number): number {
  return 0.5 - Math.cos(Math.PI * t) / 2;
}

/**
 * The view a fraction `progress` of the way from `from` to `to`.
 *
 * All three angles take the short way round: yaw wraps, a pitch dragged past ±π
 * would otherwise unwind the long way, and a roll of −170° to 170° is a 20° step
 * rather than a 340° one. At `progress >= 1` this is `to` itself,
 * exactly — the tween must land on the view that was asked for and not near it,
 * or a snap would leave the camera a rounding error off every named viewpoint.
 */
export function viewCubeSnapAt(
  from: SimulatorOrbitView,
  to: SimulatorOrbitView,
  progress: number
): SimulatorOrbitView {
  if (progress >= 1) return to;
  const t = ease(Math.max(0, progress));
  const fromRoll = from.roll ?? 0;
  const toRoll = to.roll ?? 0;
  return {
    ...to,
    yaw: from.yaw + normalizeAngle(to.yaw - from.yaw) * t,
    pitch: from.pitch + normalizeAngle(to.pitch - from.pitch) * t,
    roll: fromRoll + normalizeAngle(toRoll - fromRoll) * t,
  };
}
