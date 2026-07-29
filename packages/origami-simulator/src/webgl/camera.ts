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

/**
 * Vertices carried through the projection, in the two spaces the renderer uses.
 *
 * Flat typed arrays rather than an array of points: a dense model has tens of
 * thousands of vertices, and this is indexed by triangle, so the objects would
 * be pure allocation.
 */
export interface ProjectedVertices {
  /**
   * View-space `x, y, depth` per vertex, 3 floats each — the fragment shader's
   * `v_view`, *before* the perspective divide. Face normals and lighting are
   * computed from this, and `depth` is the painter's-order key: larger is nearer
   * the eye, because the vertex shader writes `z = -depth/depthRange` under a
   * `LEQUAL` depth test.
   */
  view: Float32Array;
  /** Pixel-space `x, y` per vertex, 2 floats each, origin top-left. */
  screen: Float32Array;
  count: number;
}

export interface ProjectVerticesOptions {
  /**
   * Apply the one-point perspective divide. True (the default) matches the
   * WebGL renderer, which is what a user with WebGL2 sees; false matches the
   * canvas-2D fallback, which is orthographic — so a machine drawing through
   * that path projects the way its own screen does.
   */
  perspective?: boolean;
}

/**
 * The CPU mirror of `meshRenderer`'s vertex shader.
 *
 * Anything that has to reproduce the on-screen view without a GL context — the
 * SVG exporter — must project exactly as the shader does or it is not the view
 * the user composed. Keeping the one JS statement of that math here, beside the
 * uniforms it consumes, is what makes the two testable against each other.
 */
export function projectVertices(
  positions: Float32Array,
  camera: CameraUniforms,
  options: ProjectVerticesOptions = {}
): ProjectedVertices {
  const perspective = options.perspective ?? true;
  const count = Math.floor(positions.length / 3);
  const view = new Float32Array(count * 3);
  const screen = new Float32Array(count * 2);
  const [centerX, centerY, centerZ] = camera.center;
  const halfWidth = camera.width / 2;
  const halfHeight = camera.height / 2;

  for (let vertex = 0; vertex < count; vertex += 1) {
    const dx = (positions[vertex * 3] ?? 0) - centerX;
    const dy = (positions[vertex * 3 + 1] ?? 0) - centerY;
    const dz = (positions[vertex * 3 + 2] ?? 0) - centerZ;
    const yawX = camera.cosYaw * dx + camera.sinYaw * dz;
    const yawZ = -camera.sinYaw * dx + camera.cosYaw * dz;
    const x = yawX;
    const y = camera.cosPitch * yawZ - camera.sinPitch * dy;
    const depth = camera.sinPitch * yawZ + camera.cosPitch * dy;
    view[vertex * 3] = x;
    view[vertex * 3 + 1] = y;
    view[vertex * 3 + 2] = depth;
    // Eye at +camDist along the view axis: nearer points (larger depth) magnify
    // and farther ones shrink, so receding parallels converge.
    const persp = perspective ? camera.camDist / Math.max(camera.camDist - depth, 0.001) : 1;
    // NDC -> pixels. NDC y is up and pixel y is down, hence the subtraction.
    screen[vertex * 2] = halfWidth + x * persp * camera.scale;
    screen[vertex * 2 + 1] = halfHeight - y * persp * camera.scale;
  }

  return { view, screen, count };
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
