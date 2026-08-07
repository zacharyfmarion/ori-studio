/**
 * What a wheel event should do to a 2D camera.
 *
 * A `wheel` event carries `deltaX/Y/Z` and `deltaMode`, and nothing that
 * identifies the device: a two-finger trackpad scroll and a mouse wheel notch
 * are the same event shape. So "scroll pans" necessarily applies to the mouse
 * wheel too, and the escape hatches are explicit rather than inferred — the
 * accel key always zooms, and the whole mapping is a user preference.
 *
 * Device-guessing heuristics are deliberately absent. Delta magnitude fails on
 * free-spinning and high-resolution mice, which emit small fractional deltas
 * just like a trackpad; `deltaX` presence fails on tilt-wheel mice; and the
 * `wheelDelta === -3 * deltaY` trick is non-standard, Chrome-only, and already
 * inconsistent across Windows precision-touchpad drivers. Each fails on a real
 * device class, and the failure mode — a viewport that behaves differently
 * depending on which mouse is plugged in — is worse than the thing it fixes.
 */

/** Which behaviour an *unmodified* scroll gets. Pinch and accel always zoom. */
export type WheelGesturePreference = 'pan' | 'zoom';

export type WheelGesture =
  | { kind: 'zoom'; factor: number }
  | { kind: 'pan'; dx: number; dy: number };

/** The fields of a `WheelEvent` this needs; a plain object in tests. */
export interface WheelGestureInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * `deltaMode` units in CSS pixels. Firefox reports `DOM_DELTA_LINE`, so a
 * handler that treats the number as pixels runs ~16x too small there.
 */
const LINE_DELTA_PX = 16;
const PAGE_DELTA_PX = 800;

/**
 * Zoom per pixel of wheel delta, as `factor = exp(-delta * sensitivity)`.
 *
 * The wheel figure is `ln(1.0015)` because that reproduces the canvas'
 * historical `Math.pow(1.0015, -deltaY)` exactly: a mouse notch (`deltaY` 100)
 * is 16% per notch, close to upstream Oriedita's x1.1 per notch
 * (`CameraModel.getScaleForZoomBy`, `zoomBase = 1 + zoomSpeed/10`). Nothing
 * about the wheel curve should move -- it is what the classic preference has to
 * restore.
 *
 * The pinch figure is ~15x that, because a pinch step is a `deltaY` of single
 * digits rather than 100. Running a pinch on the wheel constant is why the
 * gesture felt dead: 0.45% per event, against a comfortable ~11%.
 */
export const WHEEL_ZOOM_SENSITIVITY = Math.log(1.0015);
export const PINCH_ZOOM_SENSITIVITY = 0.022;

/**
 * Ceiling on one event's zoom exponent, so a single coarse event cannot jump
 * several octaves.
 *
 * The value is not arbitrary. A browser-synthesised pinch and a real Ctrl+wheel
 * are *the same event* on Windows, so they cannot be told apart and cannot take
 * different sensitivities there. Clamping at `WHEEL_ZOOM_SENSITIVITY * 100`
 * makes that collision harmless: a coarse Ctrl+wheel notch lands on x1.16, the
 * per-notch step the canvas has always had, while a fine-grained pinch stays
 * well under the clamp and keeps the fast curve. No device sniffing required.
 */
export const MAX_ZOOM_EXPONENT = WHEEL_ZOOM_SENSITIVITY * 100;

function toPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * LINE_DELTA_PX;
  if (deltaMode === 2) return delta * PAGE_DELTA_PX;
  return delta;
}

function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

/**
 * Decide what a wheel event means.
 *
 * Two modifier asymmetries here are deliberate:
 *
 * - The *zoom* modifier is Cmd **or** Ctrl -- the platform accel, matching
 *   Figma and the browser's own zoom, and reachable with a mouse.
 * - Ctrl alone selects the pinch curve, because that is what the browser
 *   synthesises for a pinch gesture. Cmd+wheel is a deliberate mouse gesture
 *   and keeps the wheel curve.
 */
export function resolveWheelGesture(
  event: WheelGestureInput,
  preference: WheelGesturePreference
): WheelGesture {
  const zooms = preference === 'zoom' || event.ctrlKey || event.metaKey;

  if (zooms) {
    // Ctrl without Cmd is the pinch gesture; everything else is a wheel.
    const sensitivity =
      event.ctrlKey && !event.metaKey ? PINCH_ZOOM_SENSITIVITY : WHEEL_ZOOM_SENSITIVITY;
    const exponent = clamp(-toPixels(event.deltaY, event.deltaMode) * sensitivity, MAX_ZOOM_EXPONENT);
    return { kind: 'zoom', factor: Math.exp(exponent) };
  }

  const dx = toPixels(event.deltaX, event.deltaMode);
  const dy = toPixels(event.deltaY, event.deltaMode);
  // Shift+scroll pans horizontally, so a wheel-only mouse can still move
  // sideways. Some platforms already fold Shift into `deltaX`; when they have,
  // that value is authoritative and this leaves it alone.
  if (event.shiftKey && dx === 0) return { kind: 'pan', dx: dy, dy: 0 };
  return { kind: 'pan', dx, dy };
}
