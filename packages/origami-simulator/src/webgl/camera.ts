// Orbit camera for the mesh renderer.
//
// This deliberately reproduces the exact projection the canvas-2D renderer uses
// (SimulatorPanel's projectPositions + map): centre on the model centroid,
// rotate by yaw about Y then pitch, orthographic, scale by a fit radius times
// the zoom. Matching it exactly means the WebGL renderer looks identical to what
// users see today. The projection itself lives only in the vertex shader
// (meshRenderer.ts); this module just computes the uniforms the shader needs.

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
}

const PADDING_FRACTION = 0.08;

export function cameraUniforms(
  view: OrbitView,
  center: [number, number, number],
  radius: number,
  width: number,
  height: number
): CameraUniforms {
  const padding = Math.max(28, Math.min(width, height) * PADDING_FRACTION);
  const available = Math.max(1, Math.min(width, height) - padding * 2);
  const scale = (available / (2 * Math.max(1e-3, radius))) * view.zoom;
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
    depthRange: Math.max(1e-3, radius) * 2,
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
