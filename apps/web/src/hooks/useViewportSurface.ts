import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { getViewportFitScale } from '../lib/designViewport';
import type { PlotRect } from '../lib/geometry';
import { isPointerDown, trackPointerGestures } from '../lib/pointerGesture';
import { viewportSizeFromElement } from '../lib/treeViewportPrimitives';
import {
  registerViewportShortcutExecutor,
  type ViewportSurface as ViewportSurfaceId,
} from '../keyboard/shortcutRuntime';
import type { ViewportShortcutId } from '../keyboard/shortcuts';
import { isViewportInteractiveTarget } from '../components/panels/ViewportToolbar';

/**
 * The two zoom paths in react-zoom-pan-pinch scale differently, so their steps
 * are not comparable numbers:
 *
 * - Buttons and shortcuts run through `handleCalculateButtonZoom`, which with
 *   `smooth` (its default) is **multiplicative**: `scale * exp(delta * step)`.
 *   A step of 1.1 is roughly ×3 per press, at any zoom.
 * - Wheel and trackpad pinch run through `handleCalculateWheelZoom`, which is
 *   **additive**: `scale + delta * step`. A fixed increment, so the same step
 *   feels coarse when zoomed out and sluggish when zoomed in. That asymmetry is
 *   why the number below is so much larger.
 */
const ZOOM_STEP = 0.6;
const ZOOM_ANIMATION_MS = 90;

/**
 * Zoom rates for the continuous gestures, shared so the two BP panes cannot
 * drift apart. `wheelDisabled` keeps a plain wheel panning; the step applies to
 * a trackpad pinch, which the browser reports as ctrl+wheel.
 */
export const VIEWPORT_WHEEL_ZOOM = {
  // Plain wheel keeps panning; trackpad pinch is handled below, multiplicatively.
  wheelDisabled: true,
  touchPadDisabled: true,
} as const;
export const VIEWPORT_PINCH_ZOOM = { step: 2.2 } as const;

/**
 * Zoom per unit of trackpad-pinch delta, applied as `scale * exp(delta * k)`.
 * Multiplicative, so a pinch covers the same proportion of zoom whether you are
 * at 50% or 800% — which the library's additive wheel path cannot do.
 */
const PINCH_ZOOM_SENSITIVITY = 0.02;
const CENTER_ANIMATION_MS = 160;
const FIT_ANIMATION_MS = 180;

export interface UseViewportSurfaceOptions {
  /** Which surface owns the viewport keyboard shortcuts while it is focused. */
  surface: ViewportSurfaceId;
  /** The world bounds the camera frames. */
  worldRect: PlotRect;
  /**
   * Identity of what is on screen. The camera fits once per distinct key, so a
   * newly opened document is framed but ordinary edits never move the camera.
   */
  fitKey: string;
  /**
   * Upper bound on the fit scale. Panes that want a fixed readable scale (the
   * tree wants a unit edge to be a predictable size) pass it here and only zoom
   * out when the content no longer fits. Defaults to 1 — never magnify.
   */
  maxFitScale?: number;
}

export interface ViewportSurface {
  /** Attach to the scrolling/panning container; also the keyboard focus target. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Pass to `<TransformWrapper ref={...}>`. */
  transformRef: React.RefObject<ReactZoomPanPinchRef | null>;
  /** Current zoom for display, as a whole percentage. */
  zoomPercent: number;
  /** True while space is held: the pane should switch to pan-on-left-drag. */
  spacePressed: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: (animationTime?: number) => void;
  setActualSize: () => void;
  setZoomLevel: (scale: number) => void;
  /** Wire to `<TransformWrapper onInit>` and `onTransformed`. */
  onInit: (ref: ReactZoomPanPinchRef) => void;
  onTransformed: (ref: ReactZoomPanPinchRef, state: { scale: number }) => void;
}

/**
 * The camera and its keyboard for a pan/zoom editing pane.
 *
 * The BP tree and BP packing panes are different editors over the same
 * viewport: fit-on-open, refit-while-unfitted-on-resize, zoom/fit/actual-size
 * shortcuts, and space-to-pan. Those behaviours were implemented twice, so a
 * camera fix landed in one pane and not the other. This hook is the single
 * implementation; a pane supplies only what is genuinely its own — the world
 * bounds, what counts as a new document, and how large it likes to open.
 *
 * The pane keeps ownership of its own domain keys (nudge, delete, Escape); this
 * hook only claims space.
 */
export function useViewportSurface({
  surface,
  worldRect,
  fitKey,
  maxFitScale,
}: UseViewportSurfaceOptions): ViewportSurface {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [spacePressed, setSpacePressed] = useState(false);

  // Attach the pointer counter before the pane can be clicked, so the very first
  // gesture is already visible to the fit guard below.
  useEffect(() => {
    trackPointerGestures();
  }, []);

  const computeFitScale = useCallback(() => {
    const viewport = viewportSizeFromElement(containerRef.current);
    if (!viewport) return 1;
    return getViewportFitScale(viewport, worldRect, undefined, maxFitScale);
  }, [worldRect, maxFitScale]);

  const fitToView = useCallback(
    (animationTime = FIT_ANIMATION_MS) => {
      transformRef.current?.centerView(computeFitScale(), animationTime);
    },
    [computeFitScale]
  );

  const setActualSize = useCallback(() => {
    transformRef.current?.centerView(1, CENTER_ANIMATION_MS);
  }, []);

  const setZoomLevel = useCallback((scale: number) => {
    transformRef.current?.centerView(scale, CENTER_ANIMATION_MS);
  }, []);

  const zoomIn = useCallback(() => {
    transformRef.current?.zoomIn(ZOOM_STEP, ZOOM_ANIMATION_MS);
  }, []);

  const zoomOut = useCallback(() => {
    transformRef.current?.zoomOut(ZOOM_STEP, ZOOM_ANIMATION_MS);
  }, []);

  const handleViewportShortcut = useCallback(
    (id: ViewportShortcutId) => {
      switch (id) {
        case 'viewport.zoomIn':
          zoomIn();
          break;
        case 'viewport.zoomOut':
          zoomOut();
          break;
        case 'viewport.fit':
          fitToView();
          break;
        case 'viewport.actualSize':
          setActualSize();
          break;
      }
    },
    [zoomIn, zoomOut, fitToView, setActualSize]
  );

  useEffect(
    () => registerViewportShortcutExecutor(surface, handleViewportShortcut),
    [surface, handleViewportShortcut]
  );

  // Fit once per document. Held in a ref rather than state so a pending frame
  // callback always sees the latest attempt, and so re-fitting can't be
  // triggered by an ordinary re-render.
  const lastFittedKeyRef = useRef<string | null>(null);
  const fitLoadedDocument = useCallback(
    (animationTime = 0) => {
      if (lastFittedKeyRef.current === fitKey) return true;
      // Never move the camera under a gesture in progress. A pane that mounts at
      // zero size only gets its first fit once something gives it a size — and
      // the thing that does that is often the user's own first click, whose
      // reflow would land the fit in the middle of the drag they just started,
      // leaving the drag running against a camera that moved beneath it. Stay
      // unfitted; the release below retries.
      if (isPointerDown()) return false;
      const container = containerRef.current;
      if (
        !container ||
        !transformRef.current ||
        container.clientWidth <= 0 ||
        container.clientHeight <= 0
      ) {
        return false;
      }
      transformRef.current.centerView(computeFitScale(), animationTime);
      lastFittedKeyRef.current = fitKey;
      return true;
    },
    [computeFitScale, fitKey]
  );
  const fitLoadedDocumentRef = useRef(fitLoadedDocument);
  useEffect(() => {
    fitLoadedDocumentRef.current = fitLoadedDocument;
  }, [fitLoadedDocument]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => fitLoadedDocumentRef.current(0));
    return () => cancelAnimationFrame(frame);
  }, [fitKey]);

  // Retry a fit that was skipped because the user was mid-gesture.
  useEffect(() => {
    const retry = () => {
      if (lastFittedKeyRef.current === fitKey) return;
      requestAnimationFrame(() => fitLoadedDocumentRef.current(0));
    };
    window.addEventListener('pointerup', retry);
    window.addEventListener('pointercancel', retry);
    return () => {
      window.removeEventListener('pointerup', retry);
      window.removeEventListener('pointercancel', retry);
    };
  }, [fitKey]);

  // A pane can mount at zero size (a hidden Dockview tab). Keep retrying the
  // initial fit until it lands, then stop watching — resizing a fitted pane must
  // not yank the camera back from wherever the user panned it.
  useEffect(() => {
    const container = containerRef.current;
    let frame = requestAnimationFrame(() => fitLoadedDocumentRef.current(0));
    const observer =
      typeof ResizeObserver === 'undefined' || !container
        ? null
        : new ResizeObserver(() => {
            if (lastFittedKeyRef.current !== fitKey) {
              cancelAnimationFrame(frame);
              frame = requestAnimationFrame(() => fitLoadedDocumentRef.current(0));
            }
          });

    if (observer && container) observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [fitKey]);

  // Space-to-pan. Released on window keyup and blur too, so tabbing away
  // mid-hold can't leave the pane stuck in pan mode.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === ' ' && !isViewportInteractiveTarget(event.target)) {
        event.preventDefault();
        setSpacePressed(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') setSpacePressed(false);
    };
    const clearSpace = () => setSpacePressed(false);

    container.addEventListener('keydown', onKeyDown);
    container.addEventListener('keyup', onKeyUp);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearSpace);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      container.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearSpace);
    };
  }, []);

  // Trackpad pinch, taken over from the library.
  //
  // Its wheel path is additive — `scale + delta * step` — so one pinch moves you
  // a fixed amount regardless of where you are: coarse when zoomed out, and
  // barely perceptible when zoomed in. Zoom is inherently multiplicative, so
  // handle the gesture here and scale by a factor instead, anchored on the
  // pointer so the paper stays under your fingers.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const onWheel = (event: WheelEvent) => {
      // Only the pinch gesture: the browser reports it as ctrl+wheel. A plain
      // wheel still belongs to panning.
      if (!event.ctrlKey) return;
      const api = transformRef.current;
      if (!api) return;
      event.preventDefault();

      const { scale, positionX, positionY } = api.instance.transformState;
      const { minScale, maxScale } = api.instance.setup;
      const next = Math.min(
        maxScale,
        Math.max(minScale, scale * Math.exp(-event.deltaY * PINCH_ZOOM_SENSITIVITY))
      );
      if (next === scale) return;

      // Keep the point under the pointer fixed.
      const rect = container.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const worldX = (pointerX - positionX) / scale;
      const worldY = (pointerY - positionY) / scale;
      api.setTransform(pointerX - worldX * next, pointerY - worldY * next, next, 0);
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  const onInit = useCallback((ref: ReactZoomPanPinchRef) => {
    transformRef.current = ref;
    requestAnimationFrame(() => fitLoadedDocumentRef.current(0));
  }, []);

  const onTransformed = useCallback((_ref: ReactZoomPanPinchRef, state: { scale: number }) => {
    setZoomPercent(Math.round(state.scale * 100));
  }, []);

  return {
    containerRef,
    transformRef,
    zoomPercent,
    spacePressed,
    zoomIn,
    zoomOut,
    fitToView,
    setActualSize,
    setZoomLevel,
    onInit,
    onTransformed,
  };
}
