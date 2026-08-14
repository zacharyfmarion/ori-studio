import type { Mat3 } from '@treemaker/origami-simulator';

export interface SimulatorOrbitView {
  yaw: number;
  pitch: number;
  zoom: number;
  /**
   * Model rotation applied before the camera, so yaw spins about the model's own
   * up rather than about the paper's normal. Absent means identity — the
   * turntable both surfaces have always been.
   */
  orient?: Mat3;
}

export interface SimulatorOrbitDrag {
  x: number;
  y: number;
  yaw: number;
  pitch: number;
}

export interface SimulatorOrbitPoint {
  x: number;
  y: number;
}

export const SIMULATOR_ORBIT_SENSITIVITY = 0.01;

/**
 * How far in and out an orbit camera may be zoomed.
 *
 * Shared rather than repeated, because a 3D folded figure's window is meant to
 * zoom *exactly* as an inline simulation's does: same range, same curve. A
 * second pair of numbers held equal by intent is how "it behaves like the
 * simulator" quietly stops being true.
 */
export const SIMULATOR_MIN_ZOOM = 0.45;
export const SIMULATOR_MAX_ZOOM = 4;

export function clampSimulatorZoom(zoom: number): number {
  return Math.min(SIMULATOR_MAX_ZOOM, Math.max(SIMULATOR_MIN_ZOOM, zoom));
}

/**
 * Zoom multiplier for one wheel event.
 *
 * `deltaY` raw, exactly as the simulator viewport has always taken it —
 * deliberately not normalised for `deltaMode`, because normalising it here would
 * change how an inline simulation zooms on the browsers that report lines rather
 * than pixels. That is a fix for both surfaces at once, and its own change.
 */
export function simulatorWheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.001);
}

export function nextSimulatorOrbitView(
  view: SimulatorOrbitView,
  drag: SimulatorOrbitDrag,
  point: SimulatorOrbitPoint
): SimulatorOrbitView {
  return {
    ...view,
    yaw: normalizeAngle(drag.yaw - (point.x - drag.x) * SIMULATOR_ORBIT_SENSITIVITY),
    pitch: normalizeAngle(drag.pitch + (point.y - drag.y) * SIMULATOR_ORBIT_SENSITIVITY),
  };
}

export function normalizeAngle(value: number): number {
  const fullTurn = Math.PI * 2;
  return ((((value + Math.PI) % fullTurn) + fullTurn) % fullTurn) - Math.PI;
}
