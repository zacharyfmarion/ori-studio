import type { ModelPoint, ViewTransform, Viewport } from './types';

/** Zoom clamps (device px per user unit). */
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 400;

/**
 * Owned 2D camera over SVG *user* coordinates (Phase 2 — replaces the SVG /
 * react-zoom-pan-pinch transform the bridge used to sample). `zoom` is device
 * pixels per user unit; `center` is the user point at the viewport centre.
 */
export interface UserCamera {
  centerX: number;
  centerY: number;
  zoom: number;
}

/** user -> device transform for the camera (folded figures draw with this). */
export function userCameraToView(cam: UserCamera, viewport: Viewport): ViewTransform {
  return {
    origin: [viewport.width / 2 - cam.centerX * cam.zoom, viewport.height / 2 - cam.centerY * cam.zoom],
    ex: [cam.zoom, 0],
    ey: [0, cam.zoom],
  };
}

/**
 * model -> device transform: model → user (via `modelToSvg`) → device (camera).
 * Sampled at three model points since `modelToSvg` is affine.
 */
export function modelViewFromCamera(
  cam: UserCamera,
  viewport: Viewport,
  modelToSvg: (point: ModelPoint) => ModelPoint
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

/** Fit user-coordinate bounds into the viewport (centered), with padding. */
export function fitUserCamera(
  bounds: UserBounds,
  viewport: Viewport,
  padding = 0.9
): UserCamera {
  const w = Math.max(1e-6, bounds.maxX - bounds.minX);
  const h = Math.max(1e-6, bounds.maxY - bounds.minY);
  const zoom = Math.min(viewport.width / w, viewport.height / h) * padding;
  return {
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
    zoom,
  };
}

/** Seed a camera from an existing user→device transform (e.g. the SVG's fit). */
export function seedUserCamera(userView: ViewTransform, viewport: Viewport): UserCamera | null {
  const ex = userView.ex[0];
  const ey = userView.ey[1];
  if (Math.abs(ex) < 1e-9 || Math.abs(ey) < 1e-9) return null;
  return {
    centerX: (viewport.width / 2 - userView.origin[0]) / ex,
    centerY: (viewport.height / 2 - userView.origin[1]) / ey,
    zoom: Math.hypot(userView.ex[0], userView.ex[1]),
  };
}

/** Pan the camera by a device-pixel delta (drag). */
export function panUserCamera(cam: UserCamera, dxDevice: number, dyDevice: number): void {
  cam.centerX -= dxDevice / cam.zoom;
  cam.centerY -= dyDevice / cam.zoom;
}

/** Zoom the camera by `factor`, keeping the user point under the cursor fixed. */
export function zoomUserCameraAt(
  cam: UserCamera,
  viewport: Viewport,
  deviceX: number,
  deviceY: number,
  factor: number
): void {
  const offX = deviceX - viewport.width / 2;
  const offY = deviceY - viewport.height / 2;
  const userX = cam.centerX + offX / cam.zoom;
  const userY = cam.centerY + offY / cam.zoom;
  cam.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * factor));
  cam.centerX = userX - offX / cam.zoom;
  cam.centerY = userY - offY / cam.zoom;
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
  unitYSample: ModelPoint
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
export function unprojectDevicePoint(view: ViewTransform, dx: number, dy: number): ModelPoint | null {
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
