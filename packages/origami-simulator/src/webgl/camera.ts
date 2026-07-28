// Orbit camera for the mesh renderer.
//
// Centre on the model centroid, rotate by yaw about Y then pitch, scale by a fit
// radius times the zoom -- then a mild one-point *perspective* divide (the
// canvas-2D renderer was orthographic, which reads as reverse perspective:
// receding parallels appear to diverge). The projection itself lives in the
// vertex shader (meshRenderer.ts); this module computes the uniforms.

export interface OrbitView {
  yaw: number;
  pitch: number;
  zoom: number;
}

export interface CameraUniforms {
  center: [number, number, number];
  cosYaw: number;
  sinYaw: number;
  cosPitch: number;
  sinPitch: number;
  /** World-units-to-pixels, before the NDC divide. */
  scale: number;
  /** Drawing-buffer size in device pixels. */
  width: number;
  height: number;
  /** Half-range used to normalise depth into NDC z. */
  depthRange: number;
  /**
   * Distance from the eye to the model centre, in the same view-depth units. The
   * vertex shader scales x/y by camDist/(camDist - depth): points nearer the eye
   * grow, farther ones shrink, so receding parallels converge. A larger multiple
   * of the radius is gentler perspective.
   */
  camDist: number;
}

const PADDING_FRACTION = 0.08;
// Eye distance as a multiple of the model radius. ~3.2 gives a gentle,
// architectural one-point perspective without fisheye distortion.
const CAM_DISTANCE_FACTOR = 3.2;

/**
 * Device pixels the model's diameter is fitted to, given a drawing buffer — the
 * fit rule shared with the canvas-2D renderer, so a machine without WebGL2
 * frames a model identically.
 *
 * Deliberately a pure fraction of the short edge, which makes the fit
 * scale-invariant: halve the frame and the model halves with it. The padding
 * used to be `max(28px, 8% of edge)`, and that floor is only inert above 350
 * device pixels. Below it the constant 28px is an ever-larger share of the
 * frame, so the model shrinks faster than its own viewport — 56% of the frame
 * at 128px against 84% at 512px, reaching nothing at 56px. A Simulate-workspace
 * panel is never that small; an inline simulation window is sized by the
 * crease-pattern zoom and routinely renders at 64-200px, where the model
 * visibly shrank away as you zoomed out.
 */
export function fitExtent(width: number, height: number): number {
  return Math.max(1, Math.min(width, height) * (1 - 2 * PADDING_FRACTION));
}

export function cameraUniforms(
  view: OrbitView,
  center: [number, number, number],
  radius: number,
  width: number,
  height: number
): CameraUniforms {
  const safeRadius = Math.max(1e-3, radius);
  const scale = (fitExtent(width, height) / (2 * safeRadius)) * view.zoom;
  return {
    center,
    cosYaw: Math.cos(view.yaw),
    sinYaw: Math.sin(view.yaw),
    cosPitch: Math.cos(view.pitch),
    sinPitch: Math.sin(view.pitch),
    scale,
    width,
    height,
    // Depth only has to preserve ordering for the depth test; a generous range
    // keeps the whole model inside NDC z without clipping.
    depthRange: safeRadius * 2,
    camDist: safeRadius * CAM_DISTANCE_FACTOR,
  };
}

/** Centroid (mean of vertex positions), matching SimulatorPanel's boundsCenter. */
export function centroid(positions: Float32Array): [number, number, number] {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  const count = positions.length / 3;
  for (let i = 0; i < positions.length; i += 3) {
    sx += positions[i]!;
    sy += positions[i + 1]!;
    sz += positions[i + 2]!;
  }
  if (count === 0) return [0, 0, 0];
  return [sx / count, sy / count, sz / count];
}

/** Max distance from the centroid, matching SimulatorPanel's boundsRadius. */
export function boundingRadius(positions: Float32Array, center: [number, number, number]): number {
  let radius = 0;
  for (let i = 0; i < positions.length; i += 3) {
    radius = Math.max(
      radius,
      Math.hypot(positions[i]! - center[0], positions[i + 1]! - center[1], positions[i + 2]! - center[2])
    );
  }
  return Math.max(1e-3, radius);
}
