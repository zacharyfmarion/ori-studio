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
  /**
   * Model rotation applied before the camera, so yaw spins about the model's own
   * up rather than about the paper's normal. Absent means identity, i.e. the
   * turntable this has always been.
   */
  orient?: Mat3;
}

/**
 * The view rotation, **row-major**: `view = M · (world − centre)`.
 *
 * Row-major because the rows are the view basis vectors, which is the whole
 * reason this is a matrix rather than four trig scalars — row 2 *is* the eye
 * direction, so anything that needs it reads it off instead of re-deriving it.
 * See {@link viewDepthAxis}.
 *
 * GLSL's `mat3` is column-major, so the upload transposes. That is the one place
 * the two conventions meet, and it is done with `uniformMatrix3fv`'s own
 * transpose flag rather than by storing the transpose here.
 */
export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export const IDENTITY_MAT3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Yaw about Y, then pitch — as a matrix, which is the only statement of it.
 *
 * This used to be written out five times: three GLSL shaders, `toViewSpace`
 * here, and the canvas-2D fallback's `projectPositions`. Each was a hand
 * transcription of the same six products, and one of them (`projectDepth`) was
 * a *partial* transcription that skipped the x row — the kind of near-copy that
 * goes stale with nothing failing. Composing it once and shipping the result
 * means the GPU consumes this function's output rather than a restatement of it,
 * so the two cannot disagree.
 *
 * `orient` is an optional model rotation applied **before** the camera, so yaw
 * spins about `orientᵀ · Y` rather than about world Y. Identity by default,
 * which reproduces the original transform exactly.
 */
export function viewRotation(yaw: number, pitch: number, orient: Mat3 = IDENTITY_MAT3): Mat3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Yaw about Y, then pitch, expanded once:
  //   x     =  cy·dx           + sy·dz
  //   y     = -cp·sy·dx - sp·dy + cp·cy·dz
  //   depth = -sp·sy·dx + cp·dy + sp·cy·dz
  const camera: Mat3 = [cy, 0, sy, -cp * sy, -sp, cp * cy, -sp * sy, cp, sp * cy];
  return orient === IDENTITY_MAT3 ? camera : multiplyMat3(camera, orient);
}

/** Row-major `a · b`. */
export function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] =
        a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[3 + col]! + a[row * 3 + 2]! * b[6 + col]!;
    }
  }
  return out as unknown as Mat3;
}

/** Transpose, which for a rotation is also the inverse. */
export function transposeMat3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/**
 * The direction the eye lies in: row 2 of the rotation, unit length.
 *
 * "Which side of a plane is the viewer on" is a question the folded projector
 * asks per stacked cell, and it used to answer it by re-deriving
 * `(−sinP·sinY, cosP, sinP·cosY)` in trigonometry, with a comment warning that a
 * wrong sign "draws the figure near-to-far". It is a row of the matrix, so it is
 * read rather than derived and the sign trap cannot recur.
 */
export function viewDepthAxis(rotation: Mat3): [number, number, number] {
  return [rotation[6], rotation[7], rotation[8]];
}

export interface CameraUniforms {
  center: [number, number, number];
  /** The view rotation. See {@link viewRotation}. */
  rotation: Mat3;
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
    rotation: viewRotation(view.yaw, view.pitch, view.orient),
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

  for (let vertex = 0; vertex < count; vertex += 1) {
    const [x, y, depth] = toViewSpace(
      positions[vertex * 3] ?? 0,
      positions[vertex * 3 + 1] ?? 0,
      positions[vertex * 3 + 2] ?? 0,
      camera
    );
    view[vertex * 3] = x;
    view[vertex * 3 + 1] = y;
    view[vertex * 3 + 2] = depth;
    const [sx, sy] = projectViewPoint([x, y, depth], camera, perspective);
    screen[vertex * 2] = sx;
    screen[vertex * 2 + 1] = sy;
  }

  return { view, screen, count };
}

/**
 * World position to the shader's view space: centred, then rotated. `depth`
 * grows toward the eye.
 *
 * The rotation is {@link CameraUniforms.rotation}, the same nine numbers the
 * shader is handed — so this is no longer a *mirror* of the vertex shader that
 * has to be kept in step with it, it is the same matrix applied on the CPU.
 */
export function toViewSpace(
  x: number,
  y: number,
  z: number,
  camera: CameraUniforms
): [number, number, number] {
  const dx = x - camera.center[0];
  const dy = y - camera.center[1];
  const dz = z - camera.center[2];
  const m = camera.rotation;
  return [
    m[0] * dx + m[1] * dy + m[2] * dz,
    m[3] * dx + m[4] * dy + m[5] * dz,
    m[6] * dx + m[7] * dy + m[8] * dz,
  ];
}

/**
 * View space to pixels — the second half of the vertex shader.
 *
 * Exported because hidden-surface removal creates *new* view-space points by
 * cutting triangles, and those have to reach the page through the same
 * projection as the original vertices rather than a second copy of it.
 */
export function projectViewPoint(
  view: readonly [number, number, number],
  camera: CameraUniforms,
  perspective = true
): [number, number] {
  // Eye at +camDist along the view axis: nearer points (larger depth) magnify
  // and farther ones shrink, so receding parallels converge.
  const persp = perspective ? camera.camDist / Math.max(camera.camDist - view[2], 0.001) : 1;
  // NDC -> pixels. NDC y is up and pixel y is down, hence the subtraction.
  return [
    camera.width / 2 + view[0] * persp * camera.scale,
    camera.height / 2 - view[1] * persp * camera.scale,
  ];
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
