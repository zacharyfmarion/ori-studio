import type { ModelPoint, ViewTransform, Viewport } from './types';

/** Zoom clamps (device px per user unit). */
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 400;

/**
 * Owned 2D camera over SVG *user* coordinates (Phase 2 — replaces the SVG /
 * react-zoom-pan-pinch transform the bridge used to sample). `zoom` is device
 * pixels per user unit; `center` is the user point at the viewport centre.
 *
 * The full mapping is
 *
 * ```
 * device = viewportCentre + R(rotation) · (user − centre) · zoom
 * ```
 *
 * {@link userCameraToView} is the only place that turns `rotation` into a
 * basis, and {@link deviceDeltaToUser} the only place that inverts it — keep it
 * that way, so there is exactly one pair of sin/cos in the view pipeline.
 */
export interface UserCamera {
  centerX: number;
  centerY: number;
  zoom: number;
  /**
   * View rotation in radians. Positive turns the *content* clockwise on screen
   * (screen y points down, so the usual CCW rotation matrix reads as clockwise).
   *
   * Required rather than optional on purpose: several call sites build a whole
   * new camera object, and an optional field would let them silently reset the
   * view to 0.
   */
  rotation: number;
}

function cameraTrig(rotation: number): { cos: number; sin: number } {
  return { cos: Math.cos(rotation), sin: Math.sin(rotation) };
}

/**
 * Wrap an angle to `(-PI, PI]`, snapping near-zero to exactly zero so repeated
 * step-and-reverse rotation lands back on an unrotated view rather than a
 * floating-point speck of one.
 */
export function normalizeCameraRotation(radians: number): number {
  const turn = Math.PI * 2;
  let value = radians % turn;
  if (value > Math.PI) value -= turn;
  if (value <= -Math.PI) value += turn;
  return Math.abs(value) < 1e-9 ? 0 : value;
}

/** user -> device transform for the camera (folded figures draw with this). */
export function userCameraToView(cam: UserCamera, viewport: Viewport): ViewTransform {
  const { cos, sin } = cameraTrig(cam.rotation);
  const ex: [number, number] = [cam.zoom * cos, cam.zoom * sin];
  const ey: [number, number] = [-cam.zoom * sin, cam.zoom * cos];
  return {
    origin: [
      viewport.width / 2 - (cam.centerX * ex[0] + cam.centerY * ey[0]),
      viewport.height / 2 - (cam.centerX * ex[1] + cam.centerY * ey[1]),
    ],
    ex,
    ey,
  };
}

/**
 * Device-pixel delta -> user-space delta: undo the view rotation, then the zoom.
 * The inverse of the linear part of {@link userCameraToView}.
 */
function deviceDeltaToUser(
  cam: UserCamera,
  dxDevice: number,
  dyDevice: number,
): { x: number; y: number } {
  const { cos, sin } = cameraTrig(cam.rotation);
  return {
    x: (cos * dxDevice + sin * dyDevice) / cam.zoom,
    y: (-sin * dxDevice + cos * dyDevice) / cam.zoom,
  };
}

/**
 * model -> device transform: model → user (via `modelToSvg`) → device (camera).
 * Sampled at three model points since `modelToSvg` is affine.
 */
export function modelViewFromCamera(
  cam: UserCamera,
  viewport: Viewport,
  modelToSvg: (point: ModelPoint) => ModelPoint,
): ViewTransform {
  const u2d = userCameraToView(cam, viewport);
  const toDevice = (mx: number, my: number): ModelPoint => {
    const u = modelToSvg({ x: mx, y: my });
    return projectModelPoint(u2d, u.x, u.y);
  };
  return viewTransformFromSamples(toDevice(0, 0), toDevice(1, 0), toDevice(0, 1));
}

/** Axis-aligned bounds in SVG user coordinates. */
export interface UserBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Fit user-coordinate bounds into the viewport (centered), with padding, for a
 * view held at `rotation`.
 *
 * The bounds are axis-aligned in user space, but the viewport measures them
 * along the *rotated* screen axes, so the span used here is the extent of the
 * rotated rectangle. Fitting the raw width/height instead would overshoot by up
 * to a factor of sqrt(2) at 45 degrees.
 */
export function fitUserCamera(
  bounds: UserBounds,
  viewport: Viewport,
  padding = 0.7,
  rotation = 0,
): UserCamera {
  const { cos, sin } = cameraTrig(rotation);
  const halfW = Math.max(1e-6, (bounds.maxX - bounds.minX) / 2);
  const halfH = Math.max(1e-6, (bounds.maxY - bounds.minY) / 2);
  const spanX = 2 * (Math.abs(cos) * halfW + Math.abs(sin) * halfH);
  const spanY = 2 * (Math.abs(sin) * halfW + Math.abs(cos) * halfH);
  const zoom = Math.min(viewport.width / spanX, viewport.height / spanY) * padding;
  return {
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
    zoom,
    rotation,
  };
}

/** How tightly {@link frameUserCameraOnBounds} packs its target into the viewport. */
const FRAME_PADDING = 0.5;
/**
 * Ceiling on a framing jump, as a multiple of the whole-document fit. Without it,
 * a diagnostic reported on a single point has zero span and would fit to an
 * arbitrarily large zoom.
 */
const FRAME_MAX_ZOOM_OVER_DOCUMENT_FIT = 4;

/**
 * Point the camera at `bounds` — the framing behind "jump to this diagnostic".
 *
 * Two rules make this a jump rather than a fit. It never zooms *out*: arriving at
 * an issue should not undo a magnification the user chose, so the zoom only ever
 * increases. And it never blows past {@link FRAME_MAX_ZOOM_OVER_DOCUMENT_FIT}
 * times the document fit, which is what keeps a zero-span target (a single
 * reported vertex) from filling the viewport with nothing.
 *
 * Rotation is carried through untouched: jumping to a diagnostic must not also
 * straighten a view the user deliberately turned.
 */
export function frameUserCameraOnBounds(
  bounds: UserBounds,
  viewport: Viewport,
  camera: UserCamera,
  documentBounds: UserBounds | null,
): UserCamera {
  const target = fitUserCamera(bounds, viewport, FRAME_PADDING, camera.rotation);
  const documentFitZoom = documentBounds
    ? fitUserCamera(documentBounds, viewport, undefined, camera.rotation).zoom
    : target.zoom;
  return {
    centerX: target.centerX,
    centerY: target.centerY,
    zoom: Math.max(
      camera.zoom,
      Math.min(target.zoom, documentFitZoom * FRAME_MAX_ZOOM_OVER_DOCUMENT_FIT),
    ),
    rotation: camera.rotation,
  };
}

/**
 * Camera zoom for a toolbar zoom percentage, where 100% means one user unit per
 * CSS pixel. `deviceRatio` is device pixels per CSS pixel, which is what carries
 * a CSS-space percentage into the camera's device-space zoom.
 *
 * Deliberately unclamped, matching the behaviour this replaced — unlike
 * {@link zoomUserCameraAt}, a typed or preset percentage is taken at its word.
 */
export function cameraZoomForPercent(percent: number, deviceRatio: number): number {
  return deviceRatio * (percent / 100);
}

/** Pan the camera by a device-pixel delta (drag). */
export function panUserCamera(cam: UserCamera, dxDevice: number, dyDevice: number): void {
  const delta = deviceDeltaToUser(cam, dxDevice, dyDevice);
  cam.centerX -= delta.x;
  cam.centerY -= delta.y;
}

/** Zoom the camera by `factor`, keeping the user point under the cursor fixed. */
export function zoomUserCameraAt(
  cam: UserCamera,
  viewport: Viewport,
  deviceX: number,
  deviceY: number,
  factor: number,
): void {
  const offX = deviceX - viewport.width / 2;
  const offY = deviceY - viewport.height / 2;
  // The user point under the cursor, before and after the zoom change; the
  // centre shifts by the difference so that point stays put.
  const before = deviceDeltaToUser(cam, offX, offY);
  const userX = cam.centerX + before.x;
  const userY = cam.centerY + before.y;
  cam.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * factor));
  const after = deviceDeltaToUser(cam, offX, offY);
  cam.centerX = userX - after.x;
  cam.centerY = userY - after.y;
}

/**
 * Build a {@link ViewTransform} from three sampled reference points: the device
 * positions of model coordinates (0,0), (1,0), and (0,1). Because a model→device
 * mapping composed of translate/scale/flip/rotation is affine, three points fully
 * determine it.
 */
export function viewTransformFromSamples(
  originSample: ModelPoint,
  unitXSample: ModelPoint,
  unitYSample: ModelPoint,
): ViewTransform {
  return {
    origin: [originSample.x, originSample.y],
    ex: [unitXSample.x - originSample.x, unitXSample.y - originSample.y],
    ey: [unitYSample.x - originSample.x, unitYSample.y - originSample.y],
  };
}

/** Apply a {@link ViewTransform} to a model point, yielding device pixels. */
export function projectModelPoint(view: ViewTransform, x: number, y: number): ModelPoint {
  return {
    x: view.origin[0] + x * view.ex[0] + y * view.ey[0],
    y: view.origin[1] + x * view.ex[1] + y * view.ey[1],
  };
}

/**
 * Invert a {@link ViewTransform}: map a device-pixel point back to model coords.
 * Returns `null` if the transform is degenerate (zero-area basis).
 */
export function unprojectDevicePoint(
  view: ViewTransform,
  dx: number,
  dy: number,
): ModelPoint | null {
  const [ax, ay] = view.ex;
  const [bx, by] = view.ey;
  const det = ax * by - ay * bx;
  if (Math.abs(det) < 1e-9) return null;
  const px = dx - view.origin[0];
  const py = dy - view.origin[1];
  // solve [ex ey] * [x y]^T = [px py]^T
  return {
    x: (px * by - py * bx) / det,
    y: (ax * py - ay * px) / det,
  };
}

/**
 * Uniform scale magnitude (device px per model unit) implied by the transform.
 * For a rotation/flip-free transform this is just |ex|; the geometric mean of the
 * two basis lengths keeps it sensible under mild anisotropy.
 */
export function viewTransformScale(view: ViewTransform): number {
  const sx = Math.hypot(view.ex[0], view.ex[1]);
  const sy = Math.hypot(view.ey[0], view.ey[1]);
  return Math.sqrt(sx * sy);
}

/** Whether two transforms are equal within a small epsilon (skip redundant redraws). */
export function viewTransformsEqual(a: ViewTransform, b: ViewTransform, epsilon = 1e-4): boolean {
  return (
    Math.abs(a.origin[0] - b.origin[0]) < epsilon &&
    Math.abs(a.origin[1] - b.origin[1]) < epsilon &&
    Math.abs(a.ex[0] - b.ex[0]) < epsilon &&
    Math.abs(a.ex[1] - b.ex[1]) < epsilon &&
    Math.abs(a.ey[0] - b.ey[0]) < epsilon &&
    Math.abs(a.ey[1] - b.ey[1]) < epsilon
  );
}

/** Whether two cameras are equal within a small epsilon. */
export function userCamerasEqual(a: UserCamera, b: UserCamera, epsilon = 1e-6): boolean {
  return (
    Math.abs(a.centerX - b.centerX) < epsilon &&
    Math.abs(a.centerY - b.centerY) < epsilon &&
    Math.abs(a.zoom - b.zoom) < epsilon &&
    Math.abs(a.rotation - b.rotation) < epsilon
  );
}

/**
 * Validate a camera read from a project file. All four fields are required and
 * finite, and `zoom` must be positive and in range — a saved camera is a view,
 * so a malformed one must fall back to the auto-fit rather than blank the
 * canvas or divide by zero. Returns null for anything it cannot vouch for.
 */
export function validateUserCamera(value: unknown): UserCamera | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const centerX = finiteNumber(record.centerX);
  const centerY = finiteNumber(record.centerY);
  const zoom = finiteNumber(record.zoom);
  const rotation = finiteNumber(record.rotation);
  if (centerX === null || centerY === null || zoom === null || rotation === null) return null;
  if (zoom < MIN_ZOOM || zoom > MAX_ZOOM) return null;
  return { centerX, centerY, zoom, rotation: normalizeCameraRotation(rotation) };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
