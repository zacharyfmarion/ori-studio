import { contactCentroid, pinchTransform, type GesturePoint } from '../../lib/gestures/pinchTransform';
import { resolveWheelGesture, type WheelGesturePreference } from '../../lib/wheelGesture';
import { cpDpr } from '../cpDpr';
import { applyPinchToCamera } from '../gestures/pinchCamera';
import { panUserCamera, zoomUserCameraAt, type UserCamera } from '../renderer/camera';
import type { Viewport } from '../renderer/types';

/**
 * Pointer and wheel input on a {@link useCpSurface} canvas, React-free.
 *
 * Wheel and drag pan, wheel and two-finger zoom through a local pointer map,
 * and a click (under {@link CP_SURFACE_CLICK_SLOP_CSS} of travel) that
 * hit-tests **on release only**. The same hit test runs under a passing
 * pointer, once a frame, so the surface can mark what a click would take.
 *
 * Not the Edit canvas's input: that one arbitrates contacts with the layers
 * over it through the `cpSurfaceGestures` singleton and drives ~80 tool props.
 * A surface here owns its canvas alone and has one verb, the pick.
 */

/** The movement below which a press-and-release counts as a click, CSS px. */
export const CP_SURFACE_CLICK_SLOP_CSS = 4;

/** Whether a pointer that went down at `press` and came up at `release` clicked. */
export function isClick(
  press: { x: number; y: number },
  release: { x: number; y: number },
  threshold = CP_SURFACE_CLICK_SLOP_CSS
): boolean {
  return Math.hypot(release.x - press.x, release.y - press.y) < threshold;
}

/** The canvas's drawing buffer as the camera sees it, at device-pixel `ratio`. */
export function cpCanvasViewport(canvas: HTMLCanvasElement, ratio: number): Viewport {
  return { width: canvas.width, height: canvas.height, dpr: ratio };
}

/** What the input asks of the surface it is bound to. Read live, on every event. */
export interface CpSurfaceInputHost<Hit> {
  /** The live camera, moved in place by a pan or a pinch; null before the first frame. */
  camera: () => UserCamera | null;
  /** Draw a frame with the camera as it now stands. */
  render: () => void;
  wheelGesture: () => WheelGesturePreference;
  /** What a press at this client point would take, or null for bare paper. */
  hitAt: (clientX: number, clientY: number) => Hit | null;
  /** What the pointer is over now; null when nothing is, or when it has left. */
  hover: (hit: Hit | null) => void;
  /** A contact is down, so the cursor is a grab rather than a hover. */
  setDragging: (dragging: boolean) => void;
  /** A click landed: what it hit, or null for a click on bare paper. */
  pick: (hit: Hit | null) => void;
}

/** Bind the input to `canvas`; the returned function unbinds it and clears the hover. */
export function bindCpSurfaceInput<Hit>(
  canvas: HTMLCanvasElement,
  host: CpSurfaceInputHost<Hit>
): () => void {
  // A local map of the contacts on this canvas, in press order. Two or more
  // is a pinch; the transform is differenced frame to frame, so each
  // `pointermove` (one contact at a time) is a valid sample.
  const pointers = new Map<number, GesturePoint>();
  let press: { pointerId: number; x: number; y: number } | null = null;
  let moved = false;

  // Hover, for the cursor and the hover mark. Coalesced to a frame because
  // `LineHitIndex` falls back to a linear scan at fit zoom (~2 ms at 50k
  // segments), which is fine once per frame and not fine once per
  // pointermove sample.
  let hoverProbe = 0;
  let hoverAt: { x: number; y: number } | null = null;
  const probeHover = (clientX: number, clientY: number) => {
    hoverAt = { x: clientX, y: clientY };
    if (hoverProbe !== 0) return;
    hoverProbe = requestAnimationFrame(() => {
      hoverProbe = 0;
      const at = hoverAt;
      if (!at) return;
      host.hover(host.hitAt(at.x, at.y));
    });
  };
  const cancelHover = () => {
    hoverAt = null;
    if (hoverProbe !== 0) {
      cancelAnimationFrame(hoverProbe);
      hoverProbe = 0;
    }
    host.hover(null);
  };

  const onPointerDown = (e: PointerEvent) => {
    // The right button is the panel's context menu; nothing to do here.
    if (e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      press = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      moved = false;
      host.setDragging(true);
      cancelHover();
      // No hover on touch, so the mark shows under the finger from the
      // press, and follows it while the press is still a tap: what a
      // release will pick is visible before it is picked.
      if (e.pointerType === 'touch') host.hover(host.hitAt(e.clientX, e.clientY));
    } else {
      // A second finger turns the gesture into a camera gesture; no click
      // can come out of it.
      press = null;
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    // No contact down: the pointer is only passing over, so all this does is
    // decide the cursor. `pointers` is empty then, which is why the hover
    // probe sits above the guard the gesture handling starts with.
    if (!pointers.has(e.pointerId)) {
      if (pointers.size === 0) probeHover(e.clientX, e.clientY);
      return;
    }
    const cam = host.camera();
    const prev = [...pointers.values()];
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const next = [...pointers.values()];
    if (!cam) return;
    const ratio = cpDpr();
    if (pointers.size >= 2) {
      const anchor = contactCentroid(prev);
      if (!anchor) return;
      const rect = canvas.getBoundingClientRect();
      applyPinchToCamera(
        cam,
        cpCanvasViewport(canvas, ratio),
        pinchTransform(prev, next),
        { x: anchor.x - rect.left, y: anchor.y - rect.top },
        ratio
      );
      host.render();
      return;
    }
    const from = prev[0];
    if (press && !moved && !isClick(press, { x: e.clientX, y: e.clientY })) {
      moved = true;
      // A pan, not a tap: nothing will be picked, so nothing is marked.
      if (e.pointerType === 'touch') host.hover(null);
    } else if (press && !moved && e.pointerType === 'touch') {
      host.hover(host.hitAt(e.clientX, e.clientY));
    }
    // A drag pans from the first pixel; the click test on release is what
    // says whether it was one. The few pixels a click wobbles by are a pan
    // nobody sees.
    panUserCamera(cam, (e.clientX - from.x) * ratio, (e.clientY - from.y) * ratio);
    host.render();
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Already released, or never captured under this browser's rules.
    }
    const wasPress = press !== null && press.pointerId === e.pointerId;
    if (wasPress && !moved && pointers.size === 0) {
      host.pick(host.hitAt(e.clientX, e.clientY));
    }
    if (wasPress) press = null;
    if (pointers.size === 0) {
      host.setDragging(false);
      // The pointer has not moved, but what is under it may have: a click
      // that picked a crease leaves the cursor where the press left it. A
      // finger has left; nothing is under it.
      if (e.pointerType === 'touch') host.hover(null);
      else probeHover(e.clientX, e.clientY);
    }
  };

  const onPointerCancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (press?.pointerId === e.pointerId) press = null;
    if (pointers.size === 0) host.setDragging(false);
  };

  const onPointerLeave = () => cancelHover();

  // A tap's pick is taken from its pointer events, and the click the browser
  // sends after the touch ends is aimed at whatever is under the finger by
  // then: a tool window or a chooser the pick has just opened there. The
  // surface wants no click from a touch, so the touch's end is cancelled,
  // which is what stops that click (pointer events cannot). A pan or a pinch
  // makes no click either way.
  const onTouchEnd = (e: TouchEvent) => {
    if (e.cancelable) e.preventDefault();
  };

  const onWheel = (e: WheelEvent) => {
    const cam = host.camera();
    if (!cam) return;
    e.preventDefault();
    const ratio = cpDpr();
    const gesture = resolveWheelGesture(e, host.wheelGesture());
    if (gesture.kind === 'pan') {
      // Negated: `panUserCamera` takes a *drag* delta, and a scroll moves
      // the content the other way — so the paper follows the fingers.
      panUserCamera(cam, -gesture.dx * ratio, -gesture.dy * ratio);
    } else {
      if (gesture.factor === 1) return;
      const rect = canvas.getBoundingClientRect();
      zoomUserCameraAt(
        cam,
        cpCanvasViewport(canvas, ratio),
        (e.clientX - rect.left) * ratio,
        (e.clientY - rect.top) * ratio,
        gesture.factor
      );
    }
    host.render();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('touchend', onTouchEnd);
    cancelHover();
  };
}
