import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import type { RenderSettings } from "@treemaker/origami-simulator";
import {
  drawFrame,
  invalidateSimulatorSurface,
  type SimulatorHighlights,
  EMPTY_HIGHLIGHTS,
} from "./canvas2dFrame";
import {
  resolveSimulatorPaint,
  type SimulatorPaint,
  type SimulatorSurfaceOptions,
} from "./simulatorPalette";
import type { SimulatorFrameView } from "./useSimulatorRuntime";
import type { SimulatorRenderModel } from "./renderModel";
import {
  beginOrbitGesture,
  endOrbitGesture,
  recordOrbitMove,
  recordSimulatorProbe,
} from "./simulatorPerfProbe";
import {
  clampSimulatorZoom,
  nextSimulatorOrbitView,
  setUprightView,
  simulatorViewLookingFrom,
  simulatorWheelZoomFactor,
  type SimulatorOrbitDrag,
  type SimulatorOrbitGesture,
  type SimulatorOrbitView as SimulatorView,
  type SimulatorViewDirection,
} from "../lib/simulatorOrbit";
import type { SimulatorSettings as SimulatorViewSettings } from "../lib/simulatorSettings";
import {
  SimulatorViewCube,
  type SimulatorViewCubeHandle,
} from "./viewCube/SimulatorViewCube";
import { viewCubeSnapAt, viewCubeSnapDurationMs } from "./viewCube/viewCubeTween";

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

/**
 * Apply the surface's own framing to caller-supplied paper settings.
 *
 * The split is what the two halves each know: the caller knows how the paper
 * looks, and this component knows what kind of surface it is — whether the frame
 * is painted, and whether the linework shrinks with it. Leaving the framing to
 * the caller would mean every caller repeating the props it already passed.
 */
function withSurfaceFraming(
  settings: RenderSettings,
  surface: SimulatorSurfaceOptions
): RenderSettings {
  return {
    ...settings,
    backgroundAlpha: surface.transparentBackground ? 0 : (settings.backgroundAlpha ?? 1),
    creaseWidthReferenceEdge: surface.creaseWidthReferenceEdge,
    creaseWidthShrinkExponent: surface.creaseWidthShrinkExponent,
  };
}

export interface SimulatorViewportHandle {
  /**
   * Return the orbit camera to {@link SimulatorViewportProps.initialView}.
   *
   * Angles *and* orientation — see the implementation for why this surface
   * discards an upright where a folded figure's reset keeps one.
   */
  resetView: () => void;
  /**
   * Take the direction now pointing up on screen as the model's up, so yaw spins
   * about it rather than about the paper's normal.
   *
   * The picture does not move; only the parametrisation does. See
   * `setUprightView`.
   */
  setUpright: () => void;
  /**
   * Move the orbit camera from outside, and redraw at it.
   *
   * For a surface whose viewpoint is owned elsewhere — a 3D folded figure's
   * camera is document state, changed by undo, by "view from the other side",
   * and by a drag on the crease-pattern canvas. Unused by a simulation, whose
   * camera lives here and nowhere else.
   */
  setView: (view: SimulatorView) => void;
  /** Multiply the orbit zoom, clamped to the same range the wheel uses. */
  zoomBy: (factor: number) => void;
  /** Publish a solver frame. In GPU mode the worker has already drawn it. */
  showFrame: (frame: SimulatorFrameView) => void;
  /**
   * Publish a rendered frame that is *only* a picture.
   *
   * {@link showFrame} carries solver scalars — step, convergence, fold percent,
   * peak strain — which a static folded figure has none of. Synthesising zeros
   * for them would put a lie in the type, so the bitmap branch that already
   * exists inside `showFrame` is offered separately instead. Ownership of the
   * bitmap transfers to the canvas: do not retain or close it.
   */
  presentBitmap: (bitmap: ImageBitmap) => void;
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
  /**
   * Whether the wheel gesture in flight is this surface's to zoom, asked once
   * per event and only when the surface would otherwise act on it.
   *
   * A viewport that fills its own pane has no one to share the wheel with and
   * omits this. One floating over another scrollable surface does: an inline
   * simulation window hands a gesture that began on the crease pattern back to
   * it rather than treating the cursor's arrival as a new zoom. The claim is
   * still made either way, so an unclaimed pinch never reaches the browser.
   */
  claimsWheel?: () => boolean;
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
  /**
   * Leave the frame unpainted so whatever the canvas is mounted over shows
   * through. An inline window sits on the crease pattern, and an opaque backdrop
   * makes it read as a hole punched in the drawing rather than a view onto it.
   */
  transparentBackground?: boolean;
  /**
   * Treat this surface as an object sized by someone else's camera rather than
   * as a viewport: below this frame edge (device px) the crease width shrinks
   * with the frame, so the fold reads the same at every size. Omitted, creases
   * keep a constant on-screen weight, which is what a resizable pane wants.
   */
  creaseWidthReferenceEdge?: number;
  /** Companion to the reference edge; see `RenderSettings.creaseWidthShrinkExponent`. */
  creaseWidthShrinkExponent?: number;
  viewSettings: SimulatorViewSettings;
  /**
   * Offer a view cube in the bottom-left corner.
   *
   * Off by default, and deliberately not on for every surface that has a camera.
   * An inline simulation window renders at 64-200px, where a cube would cover a
   * third of it; a 3D folded figure takes no pointer events at all and its
   * camera is document state that undo reaches, so a cube there would have to
   * write back through the store rather than move `viewRef`.
   *
   * **The caller's container must be positioned.** The cube is rendered as a
   * sibling of the canvas rather than inside a wrapper, so that turning it on
   * cannot change how the canvas is laid out on any of the three surfaces —
   * which means it anchors to whatever the nearest positioned ancestor is.
   * `.simulator-panel__body` already is one.
   */
  viewCube?: boolean;
  /**
   * The camera this surface opens at, and returns to on reset. Defaults to
   * {@link DEFAULT_SIMULATOR_VIEW}, which is what every simulation wants; a
   * folded figure opens at the viewpoint stored on the figure.
   *
   * Read once, at mount. Later changes come through
   * {@link SimulatorViewportHandle.setView}, so a caller rebuilding this object
   * every render does not snap the camera back mid-gesture.
   */
  initialView?: SimulatorView;
  /**
   * Draw with these settings instead of resolving the simulator palette.
   *
   * A folded figure's colours are its own document state — they are on the
   * kernel figure model and are already what the flat figure beside it draws
   * with — so routing them through the app-wide simulator settings would make a
   * figure's appearance follow the Simulate workspace's, which is both wrong for
   * the figure and a change to what those settings mean.
   *
   * The framing fields ({@link transparentBackground} and the crease-width pair)
   * are still applied on top, because they describe the *surface* rather than the
   * paper and this component is what knows them.
   */
  renderSettings?: RenderSettings;
  /** Creases/faces a sequence step is emphasising. CPU path only. */
  highlights?: SimulatorHighlights;
  /** Forward the orbit camera to the worker (GPU mode). */
  pushCamera: (view: SimulatorView, width: number, height: number) => void;
  /** Forward render settings to the worker (GPU mode). */
  pushRenderSettings: (settings: RenderSettings) => void;
  className?: string;
  ariaLabel: string;
  title?: string;
  /**
   * Which surface this is, in the `sim-perf` orbit log.
   *
   * Three surfaces share this component and one worker, so a global readout
   * cannot otherwise say which of them was dragged — and they differ in the way
   * that matters here: the Simulate panel owns a transferred canvas the worker
   * draws straight into, while an inline window and a folded figure are drawn
   * into the shared buffer and cropped out as bitmaps. Debug-only; not a
   * user-visible string, so not localized.
   */
  perfSurface?: string;
}

export function SimulatorViewport({
  ref,
  onCanvasChange,
  canvasKey,
  interactive,
  claimsWheel,
  gpuActive,
  bitmapPresent = false,
  minDeviceSize = 360,
  transparentBackground = false,
  creaseWidthReferenceEdge,
  creaseWidthShrinkExponent,
  viewSettings,
  viewCube = false,
  initialView,
  renderSettings,
  highlights = EMPTY_HIGHLIGHTS,
  pushCamera,
  pushRenderSettings,
  className,
  ariaLabel,
  title,
  perfSurface = 'viewport',
}: SimulatorViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<SimulatorRenderModel | null>(null);
  const frameRef = useRef<SimulatorFrameView | null>(null);
  // Captured once. `resetView` reads it too, so "reset" means the view this
  // surface was given rather than a view nobody chose.
  const openingView = initialView ?? DEFAULT_SIMULATOR_VIEW;
  const openingViewRef = useRef<SimulatorView>({ ...openingView });
  const viewRef = useRef<SimulatorView>({ ...openingView });
  const viewCubeRef = useRef<SimulatorViewCubeHandle | null>(null);
  // The rAF of a view cube snap in flight, or null. See `applyView`.
  const snapRef = useRef<number | null>(null);
  // Which pointer the canvas is following. The angles it drags from live on the
  // gesture below, which the view cube drives too.
  const dragRef = useRef<{ pointerId: number } | null>(null);
  const orbitOriginRef = useRef<SimulatorOrbitDrag | null>(null);
  // Read synchronously by the pointer and draw handlers, which must not see a
  // stale closure mid-gesture.
  const gpuActiveRef = useRef(gpuActive);
  const viewSettingsRef = useRef(viewSettings);
  const highlightsRef = useRef(highlights);
  const interactiveRef = useRef(interactive);
  const claimsWheelRef = useRef(claimsWheel);
  const surfaceOptionsRef = useRef<SimulatorSurfaceOptions>({
    transparentBackground,
    creaseWidthReferenceEdge,
    creaseWidthShrinkExponent,
  });
  // Resolved colours, held rather than recomputed per frame: reading them means a
  // getComputedStyle, and they only change when settings or the theme do. Both
  // render paths draw from this one object, which is what stops them disagreeing.
  const paintRef = useRef<SimulatorPaint | null>(null);
  const renderSettingsRef = useRef(renderSettings);

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
    // Timed: this is where a frame reaches the screen, and a browser that cannot
    // adopt the bitmap as a GPU handle copies it right here. See
    // `simulatorPerfProbe`.
    const started = performance.now();
    context.transferFromImageBitmap(bitmap);
    recordSimulatorProbe('present', performance.now() - started);
  }, []);

  // In GPU mode the worker owns the canvas and draws; this no-ops. In CPU mode
  // it rasterises the latest frame on this thread.
  const drawCurrentFrame = useCallback(() => {
    if (gpuActiveRef.current) return;
    const canvas = canvasRef.current;
    const model = modelRef.current;
    const frame = frameRef.current;
    const paint = paintRef.current;
    if (!canvas || !model || !frame || !frame.positions || !paint) return;
    drawFrame(canvas, model, frame, viewRef.current, paint, highlightsRef.current);
  }, []);

  /**
   * Re-resolve the palette and push it wherever it is needed.
   *
   * Called on a settings change and on a theme change — the two things that can
   * move a colour. The GPU path forwards `paint.render` to the worker; the
   * canvas-2D path redraws from the same bundle.
   */
  const refreshPaint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const override = renderSettingsRef.current;
    if (override) {
      // Nothing here reads a theme token, so the palette resolve — and its
      // `getComputedStyle` — is skipped entirely rather than computed and
      // discarded. The surface framing is still ours to apply.
      pushRenderSettings(withSurfaceFraming(override, surfaceOptionsRef.current));
      return;
    }
    const paint = resolveSimulatorPaint(
      getComputedStyle(canvas),
      viewSettingsRef.current,
      surfaceOptionsRef.current
    );
    paintRef.current = paint;
    if (gpuActiveRef.current) pushRenderSettings(paint.render);
    else drawCurrentFrame();
  }, [drawCurrentFrame, pushRenderSettings]);

  /**
   * Device-pixel drawing-buffer size. Read from the element's box, which still
   * exists once control has been transferred to the worker.
   */
  const deviceSize = useCallback(() => {
    const canvas = canvasRef.current;
    // Timed: this canvas sits inside a transformed overlay tree that the
    // crease-pattern camera rewrites, so reading its box is a forced layout —
    // once per orbit frame, and before `setCamera`'s own timer starts. See
    // `simulatorPerfProbe`.
    const measureStarted = performance.now();
    const rect = canvas?.getBoundingClientRect();
    recordSimulatorProbe('measure', performance.now() - measureStarted);
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
    // Before the frame, and by a style write rather than a layout read: the
    // measure below is already the one forced layout an orbit frame is allowed.
    viewCubeRef.current?.setView(viewRef.current);
    if (gpuActiveRef.current) {
      const { width, height } = deviceSize();
      pushCamera(viewRef.current, width, height);
    } else {
      drawCurrentFrame();
    }
  }, [deviceSize, drawCurrentFrame, pushCamera]);

  /**
   * Move the camera and draw at it.
   *
   * Every path that moves it goes through here rather than assigning `viewRef`
   * and calling {@link pushView} itself, because all of them also have to stop a
   * view cube snap that is in flight — a drag, a wheel, a reset or a zoom during
   * an animation would otherwise be overwritten by the next rAF and read as a
   * dead control. The snap's own steps are the one caller that does not.
   *
   * `pushView` is still called directly from the effects that re-send an
   * *unchanged* camera (a resize, a render-path switch); there is nothing to
   * cancel there.
   */
  const cancelSnap = useCallback(() => {
    if (snapRef.current === null) return;
    cancelAnimationFrame(snapRef.current);
    snapRef.current = null;
  }, []);

  const applyView = useCallback(
    (next: SimulatorView) => {
      cancelSnap();
      viewRef.current = next;
      pushView();
    },
    [cancelSnap, pushView]
  );

  /**
   * Turn to look at the model from `direction`, over about a quarter second.
   *
   * The animation is the camera's, not the cube's: it moves `viewRef` on every
   * frame, so the fold, the cube and the readouts all follow one motion rather
   * than the cube animating and the model jumping.
   */
  const snapToDirection = useCallback(
    (direction: SimulatorViewDirection) => {
      const from = viewRef.current;
      const to = simulatorViewLookingFrom(from, direction);
      const reducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      applyView(reducedMotion ? to : viewCubeSnapAt(from, to, 0));
      if (reducedMotion) return;

      const duration = viewCubeSnapDurationMs(from, to);
      const started = performance.now();
      const step = (now: number) => {
        const progress = (now - started) / duration;
        viewRef.current = viewCubeSnapAt(from, to, progress);
        pushView();
        snapRef.current = progress >= 1 ? null : requestAnimationFrame(step);
      };
      snapRef.current = requestAnimationFrame(step);
    },
    [applyView, pushView]
  );

  // A snap outliving its surface would call into a torn-down worker session.
  useEffect(() => cancelSnap, [cancelSnap]);

  /**
   * Point the cube at the live camera as its handle is attached.
   *
   * A callback ref rather than an `initialView` prop, so the cube has no opening
   * view of its own to disagree with `viewRef` — it can be switched on at any
   * moment and comes up showing where the model actually is. Stable, so it fires
   * on mount and unmount rather than on every render.
   */
  const attachViewCube = useCallback((handle: SimulatorViewCubeHandle | null) => {
    viewCubeRef.current = handle;
    handle?.setView(viewRef.current);
  }, []);

  useEffect(() => {
    gpuActiveRef.current = gpuActive;
  }, [gpuActive]);

  useEffect(() => {
    interactiveRef.current = interactive;
    claimsWheelRef.current = claimsWheel;
  }, [interactive, claimsWheel]);

  // Framing and view settings both end up in one RenderSettings, so a change to
  // either has to be pushed the same way.
  useEffect(() => {
    viewSettingsRef.current = viewSettings;
    renderSettingsRef.current = renderSettings;
    surfaceOptionsRef.current = {
      transparentBackground,
      creaseWidthReferenceEdge,
      creaseWidthShrinkExponent,
    };
    refreshPaint();
  }, [
    refreshPaint,
    viewSettings,
    renderSettings,
    transparentBackground,
    creaseWidthReferenceEdge,
    creaseWidthShrinkExponent,
  ]);

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
      refreshPaint();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => observer.disconnect();
  }, [refreshPaint]);

  // When the GPU path becomes active (first load, or after a path switch), send
  // the worker the current camera and settings so it does not draw with defaults.
  useEffect(() => {
    if (!gpuActive) return;
    if (!canvasRef.current) return;
    refreshPaint();
    pushView();
  }, [gpuActive, refreshPaint, pushView]);

  /**
   * Back to the opening view — angles **and** orientation.
   *
   * A simulation's upright is session-only and takes no undo entry, so this is
   * the only way out of one. Dropping it here is what lets the control be a
   * single button rather than a pair: reset is already the verb for "put the
   * view back", and on this surface it has to mean all of it or a model can get
   * stuck on a pole the user picked by accident.
   *
   * A folded figure's is the other way round — it *is* document state, undo
   * reaches it, and its "Reset view" leaves an upright alone deliberately.
   */
  const resetView = useCallback(() => {
    applyView({ ...openingViewRef.current });
  }, [applyView]);

  // Session-only, on both simulator surfaces: an inline window's descriptor has
  // a `view` slot but no write-back, and the Simulate workspace persists no
  // camera at all. Making either durable is its own change, deliberately not
  // this one — so a reload returns to the paper's normal.
  const setUpright = useCallback(() => {
    applyView(setUprightView(viewRef.current));
  }, [applyView]);

  const zoomBy = useCallback(
    (factor: number) => {
      applyView({
        ...viewRef.current,
        zoom: clampSimulatorZoom(viewRef.current.zoom * factor),
      });
    },
    [applyView]
  );

  useImperativeHandle(
    ref,
    () => ({
      resetView,
      setUpright,
      zoomBy,
      setView: (view: SimulatorView) => {
        applyView({ ...view });
      },
      presentBitmap,
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
    [resetView, setUpright, zoomBy, drawCurrentFrame, presentBitmap, applyView]
  );

  /**
   * The orbit itself, as three verbs rather than three pointer handlers.
   *
   * The canvas and the view cube both turn the model by dragging, and they are
   * not the same gesture in DOM terms — the canvas owns its element outright,
   * while the cube has to tell a drag from a press and keep its own capture on
   * whichever face was grabbed. What they *do* share is all of this: the origin,
   * the sensitivity, the perf counters and where the result goes. Passing the
   * verbs across means the second surface inherits every one of those rather
   * than growing a near-copy that slowly disagrees.
   */
  const orbit = useMemo<SimulatorOrbitGesture>(
    () => ({
      begin: (point) => {
        // Before the angles below are read, not after: a drag that began
        // mid-snap must start from where the model is now and own it from there.
        cancelSnap();
        // A drag is the unit the orbit readout reports on; see
        // `beginOrbitGesture`.
        beginOrbitGesture(perfSurface);
        orbitOriginRef.current = {
          x: point.x,
          y: point.y,
          yaw: viewRef.current.yaw,
          pitch: viewRef.current.pitch,
        };
      },
      move: (point) => {
        const origin = orbitOriginRef.current;
        if (!origin) return;
        // Counted before the push, so the log compares pointer input against
        // messages sent rather than against itself. They are equal today —
        // nothing coalesces — which is the baseline any fix has to move.
        recordOrbitMove();
        applyView(nextSimulatorOrbitView(viewRef.current, origin, point));
      },
      end: () => {
        if (!orbitOriginRef.current) return;
        orbitOriginRef.current = null;
        // The line lands once the backlog drains, which is the measurement: how
        // long the fold keeps moving after the pointer stopped.
        endOrbitGesture();
      },
    }),
    [applyView, cancelSnap, perfSurface]
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactiveRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId };
    orbit.begin({ x: event.clientX, y: event.clientY });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    orbit.move({ x: event.clientX, y: event.clientY });
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    orbit.end();
  };

  // Zoom, as a native listener rather than an `onWheel` prop.
  //
  // React registers `wheel` passively at its root, so `preventDefault()` inside
  // an `onWheel` handler is dropped and a trackpad pinch — which the browser
  // reports as ctrl+wheel — zooms the whole page on top of zooming the fold.
  // Every other zoom surface here attaches its own non-passive listener for the
  // same reason; see `useViewportSurface` and `CreasePatternWebglCanvas`.
  //
  // Keyed on `canvasKey` because that is what replaces the element.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (event: WheelEvent) => {
      // Claimed before the interactive check, not after: a wheel over a window
      // that is loading, errored or merely unfocused still must not reach the
      // browser's own zoom. Nothing is behind this canvas that wants the event.
      event.preventDefault();
      if (!interactiveRef.current) return;
      // Asked after the claim and before the zoom: a surface that shares the
      // wheel with something behind it lets that owner have the gesture, and the
      // event carries on to whatever forwards it.
      if (claimsWheelRef.current?.() === false) return;
      applyView({
        ...viewRef.current,
        zoom: clampSimulatorZoom(viewRef.current.zoom * simulatorWheelZoomFactor(event.deltaY)),
      });
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [canvasKey, applyView]);

  return (
    // A fragment, so the cube's arrival adds no box around the canvas and cannot
    // change how any of the three surfaces lay it out. The cube positions itself
    // against the caller's container; see the `viewCube` prop.
    <>
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
      />
      {viewCube && (
        <SimulatorViewCube
          ref={attachViewCube}
          interactive={interactive}
          onSnap={snapToDirection}
          orbit={orbit}
        />
      )}
    </>
  );
}
