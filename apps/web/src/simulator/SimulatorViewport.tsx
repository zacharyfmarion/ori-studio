import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { RenderSettings } from "@treemaker/origami-simulator";
import {
  drawFrame,
  invalidateSimulatorSurface,
  toRenderSettings,
  type SimulatorHighlights,
  EMPTY_HIGHLIGHTS,
} from "./canvas2dFrame";
import type { SimulatorFrameView } from "./useSimulatorRuntime";
import type { SimulatorRenderModel } from "./renderModel";
import {
  nextSimulatorOrbitView,
  type SimulatorOrbitView as SimulatorView,
} from "../lib/simulatorOrbit";
import type { SimulatorSettings as SimulatorViewSettings } from "../lib/simulatorSettings";

/**
 * The simulator's drawing surface: a canvas, an orbit camera, and whatever it
 * takes to get a solver frame onto it.
 *
 * Purely presentational — it holds no store subscriptions and knows nothing
 * about documents, segments or sequences. That is what lets the Simulate
 * workspace panel and an inline simulation window on the Edit canvas share one
 * implementation of orbit, zoom, resize, theme re-read and the two render paths,
 * instead of the second one being a copy of the first that slowly drifts.
 *
 * Two render paths, chosen by the caller's `gpuActive`:
 *   - GPU: the worker owns this canvas and draws to it. Orbit is a `setCamera`
 *     message; nothing is drawn on this thread.
 *   - CPU: the worker returns positions and {@link drawFrame} rasterises them
 *     here.
 *
 * Frames arrive through the imperative handle rather than as a prop. A solver
 * running at 60fps would otherwise re-render this component — and everything
 * above it — once per frame, which is exactly the cost the worker split existed
 * to remove.
 */

/** Isometric "lying on a table" view, matching upstream Origami Simulator's
 * initial camera (eye on the (1,1,1) diagonal looking at the origin). The paper
 * is flat in the XZ plane: 45deg yaw gives the diamond orientation and ~0.955
 * rad pitch (35.26deg elevation) the iso foreshortening. Pitch is NEGATIVE so
 * the near edge is at the bottom and folds rise up (a positive pitch tilts the
 * far edge down, reading as the top facing toward you); cosPitch is unchanged by
 * the sign, so the lit yellow front still faces the camera. */
export const DEFAULT_SIMULATOR_VIEW: SimulatorView = {
  yaw: Math.PI / 4,
  pitch: -0.955,
  zoom: 1.4,
};

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 4;

export interface SimulatorViewportHandle {
  /** Return the orbit camera to {@link DEFAULT_SIMULATOR_VIEW}. */
  resetView: () => void;
  /** Multiply the orbit zoom, clamped to the same range the wheel uses. */
  zoomBy: (factor: number) => void;
  /** Publish a solver frame. In GPU mode the worker has already drawn it. */
  showFrame: (frame: SimulatorFrameView) => void;
  /** Swap the topology the CPU path rasterises. */
  setModel: (model: SimulatorRenderModel | null) => void;
}

export interface SimulatorViewportProps {
  ref?: Ref<SimulatorViewportHandle>;
  /**
   * The mounted canvas, reported up so the caller's runtime can transfer it to
   * the worker. A canvas can only be transferred once, so the caller changes
   * {@link canvasKey} to obtain a fresh element when the render path changes.
   */
  onCanvasChange: (canvas: HTMLCanvasElement | null) => void;
  canvasKey: string;
  /** Whether orbit/zoom gestures are accepted (false while loading or errored). */
  interactive: boolean;
  /** True when the worker owns this canvas and draws on the GPU. */
  gpuActive: boolean;
  /**
   * Present frames handed back as ImageBitmaps rather than drawn by the worker
   * into this canvas. The canvas then takes a `bitmaprenderer` context, which is
   * not a WebGL context — the property that lets many simulations share one.
   */
  bitmapPresent?: boolean;
  /**
   * Floor on the drawing-buffer edge, in device pixels. The panel keeps a large
   * floor so a narrow pane still renders a usable image; an inline window is
   * deliberately small and would otherwise over-render by several times its own
   * area.
   */
  minDeviceSize?: number;
  viewSettings: SimulatorViewSettings;
  /** Creases/faces a sequence step is emphasising. CPU path only. */
  highlights?: SimulatorHighlights;
  /** Forward the orbit camera to the worker (GPU mode). */
  pushCamera: (view: SimulatorView, width: number, height: number) => void;
  /** Forward render settings to the worker (GPU mode). */
  pushRenderSettings: (settings: RenderSettings) => void;
  className?: string;
  ariaLabel: string;
  title?: string;
}

export function SimulatorViewport({
  ref,
  onCanvasChange,
  canvasKey,
  interactive,
  gpuActive,
  bitmapPresent = false,
  minDeviceSize = 360,
  viewSettings,
  highlights = EMPTY_HIGHLIGHTS,
  pushCamera,
  pushRenderSettings,
  className,
  ariaLabel,
  title,
}: SimulatorViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<SimulatorRenderModel | null>(null);
  const frameRef = useRef<SimulatorFrameView | null>(null);
  const viewRef = useRef<SimulatorView>({ ...DEFAULT_SIMULATOR_VIEW });
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    yaw: number;
    pitch: number;
  } | null>(null);
  // Read synchronously by the pointer and draw handlers, which must not see a
  // stale closure mid-gesture.
  const gpuActiveRef = useRef(gpuActive);
  const viewSettingsRef = useRef(viewSettings);
  const highlightsRef = useRef(highlights);
  const interactiveRef = useRef(interactive);

  // The bitmaprenderer context, acquired once per canvas element. Acquiring it
  // is exclusive — a canvas that has one can never take a 2D or WebGL context —
  // so it is only taken when the caller has asked for bitmap presentation.
  const bitmapContextRef = useRef<ImageBitmapRenderingContext | null>(null);

  const setCanvas = useCallback(
    (element: HTMLCanvasElement | null) => {
      canvasRef.current = element;
      bitmapContextRef.current =
        element && bitmapPresent ? element.getContext('bitmaprenderer') : null;
      onCanvasChange(element);
    },
    [onCanvasChange, bitmapPresent]
  );

  /**
   * Present a rendered frame. Ownership of the bitmap transfers to the canvas,
   * so it must not be retained or closed afterwards.
   */
  const presentBitmap = useCallback((bitmap: ImageBitmap) => {
    const context = bitmapContextRef.current;
    if (!context) {
      bitmap.close();
      return;
    }
    context.transferFromImageBitmap(bitmap);
  }, []);

  // In GPU mode the worker owns the canvas and draws; this no-ops. In CPU mode
  // it rasterises the latest frame on this thread.
  const drawCurrentFrame = useCallback(() => {
    if (gpuActiveRef.current) return;
    const canvas = canvasRef.current;
    const model = modelRef.current;
    const frame = frameRef.current;
    if (!canvas || !model || !frame || !frame.positions) return;
    drawFrame(
      canvas,
      model,
      frame,
      viewRef.current,
      viewSettingsRef.current,
      highlightsRef.current
    );
  }, []);

  /**
   * Device-pixel drawing-buffer size. Read from the element's box, which still
   * exists once control has been transferred to the worker.
   */
  const deviceSize = useCallback(() => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    return {
      width: Math.max(minDeviceSize, Math.floor((rect?.width || 720) * dpr)),
      height: Math.max(minDeviceSize, Math.floor((rect?.height || 720) * dpr)),
    };
  }, [minDeviceSize]);

  /**
   * Apply the current orbit view: forward it to the worker (GPU) or redraw here
   * (CPU). This is what makes orbit cheap in GPU mode — one small message and a
   * texture-fed redraw, with no solver work at any model size.
   */
  const pushView = useCallback(() => {
    if (gpuActiveRef.current) {
      const { width, height } = deviceSize();
      pushCamera(viewRef.current, width, height);
    } else {
      drawCurrentFrame();
    }
  }, [deviceSize, drawCurrentFrame, pushCamera]);

  useEffect(() => {
    gpuActiveRef.current = gpuActive;
  }, [gpuActive]);

  useEffect(() => {
    interactiveRef.current = interactive;
  }, [interactive]);

  useEffect(() => {
    viewSettingsRef.current = viewSettings;
    if (gpuActiveRef.current) {
      const canvas = canvasRef.current;
      if (canvas) pushRenderSettings(toRenderSettings(canvas, viewSettings));
    } else {
      drawCurrentFrame();
    }
  }, [drawCurrentFrame, pushRenderSettings, viewSettings]);

  useEffect(() => {
    highlightsRef.current = highlights;
    drawCurrentFrame();
  }, [highlights, drawCurrentFrame]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      // Size is cached, so the cache is what has to notice a resize. The
      // observer also fires once on observe, which is how the worker first
      // learns the canvas's real (post-layout) size in GPU mode — a transferred
      // canvas starts at the default 300x150 otherwise.
      invalidateSimulatorSurface(canvas);
      pushView();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasKey, pushView]);

  // The palette is read from CSS custom properties, so it has to be re-read when
  // the theme flips. Watching the documentElement's class/data attributes covers
  // both the app's own toggle and an OS-level change.
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      invalidateSimulatorSurface(canvasRef.current);
      const canvas = canvasRef.current;
      if (gpuActiveRef.current) {
        if (canvas) pushRenderSettings(toRenderSettings(canvas, viewSettingsRef.current));
      } else {
        drawCurrentFrame();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => observer.disconnect();
  }, [drawCurrentFrame, pushRenderSettings]);

  // When the GPU path becomes active (first load, or after a path switch), send
  // the worker the current camera and settings so it does not draw with defaults.
  useEffect(() => {
    if (!gpuActive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    pushRenderSettings(toRenderSettings(canvas, viewSettingsRef.current));
    pushView();
  }, [gpuActive, pushRenderSettings, pushView]);

  const resetView = useCallback(() => {
    viewRef.current = { ...DEFAULT_SIMULATOR_VIEW };
    pushView();
  }, [pushView]);

  const zoomBy = useCallback(
    (factor: number) => {
      viewRef.current = {
        ...viewRef.current,
        zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewRef.current.zoom * factor)),
      };
      pushView();
    },
    [pushView]
  );

  useImperativeHandle(
    ref,
    () => ({
      resetView,
      zoomBy,
      showFrame: (frame: SimulatorFrameView) => {
        frameRef.current = frame;
        if (frame.bitmap) presentBitmap(frame.bitmap);
        else drawCurrentFrame();
      },
      setModel: (model: SimulatorRenderModel | null) => {
        modelRef.current = model;
        invalidateSimulatorSurface(canvasRef.current);
        drawCurrentFrame();
      },
    }),
    [resetView, zoomBy, drawCurrentFrame, presentBitmap]
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactiveRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: viewRef.current.yaw,
      pitch: viewRef.current.pitch,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    viewRef.current = nextSimulatorOrbitView(viewRef.current, drag, {
      x: event.clientX,
      y: event.clientY,
    });
    pushView();
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    if (!interactiveRef.current) return;
    event.preventDefault();
    viewRef.current = {
      ...viewRef.current,
      zoom: Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, viewRef.current.zoom * Math.exp(-event.deltaY * 0.001))
      ),
    };
    pushView();
  };

  return (
    <canvas
      // Keyed on the render path: a fold profile switches to the canvas-2D path,
      // and a canvas whose control was transferred to the worker can never take a
      // 2D context, so it must be a fresh element.
      key={canvasKey}
      ref={setCanvas}
      className={className}
      data-lighting={viewSettings.lighting || undefined}
      aria-label={ariaLabel}
      title={title}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onDoubleClick={resetView}
      onWheel={handleWheel}
    />
  );
}
