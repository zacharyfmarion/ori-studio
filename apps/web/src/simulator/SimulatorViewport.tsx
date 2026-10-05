import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import type { CameraUniforms, RenderSettings } from "@treemaker/origami-simulator";
import {
  drawFrame,
  drawnCameraOf,
  holdSurfaceFraming,
  invalidateSimulatorSurface,
  pickDrawnFrame,
  type SimulatorHighlights,
  EMPTY_HIGHLIGHTS,
} from "./canvas2dFrame";
import { readHeldModifiers, subscribeHeldModifiers } from "../keyboard/heldModifiers";
import { createTouchArbiter, type TouchArbiter } from "../lib/gestures/touchArbiter";
import { isApplePlatform } from "../platform/runtime";
import type { SimulatorPickQuery } from "./pickQuery";
import { simulatorCanvasCursor } from "./tools/cursor";
import { routeSimulatorPress } from "./tools/pressRoute";
import type {
  CssRect,
  CssSize,
  SimulatorGesture,
  SimulatorGestureEngine,
  SimulatorInputMode,
  SimulatorPointerInput,
  SimulatorToolCursor,
} from "./tools/types";
import styles from "./SimulatorViewport.module.css";
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
  nextSimulatorRollView,
  setUprightView,
  simulatorViewLookingFrom,
  simulatorWheelZoomFactor,
  type SimulatorOrbitDrag,
  type SimulatorOrbitGesture,
  type SimulatorOrbitMode,
  type SimulatorOrbitView as SimulatorView,
  type SimulatorViewDirection,
} from "../lib/simulatorOrbit";
import type { SimulatorSettings as SimulatorViewSettings } from "../lib/simulatorSettings";
import type { PaperStyle } from "../lib/paper/paperStyle";
import {
  SimulatorViewCube,
  type SimulatorViewCubeHandle,
} from "./viewCube/SimulatorViewCube";
import { viewCubeSnapAt, viewCubeSnapDurationMs } from "./viewCube/viewCubeTween";
import { simulatorDevicePixelRatio } from "./simulatorDevicePixelRatio";

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
  /**
   * Abandon a tool gesture in flight — a box half drawn — and say whether there
   * was one. An orbit is not a tool gesture and is left alone.
   */
  cancelToolGesture: () => boolean;
  /**
   * The canvas-2D path's half of a pick: the faces under a point or a box in
   * the frame this surface last drew. Null on the GPU path, whose frames the
   * worker draws and picks from, and before anything has been drawn.
   */
  pickDrawnFaces: (query: SimulatorPickQuery) => number[] | null;
  /**
   * The camera of the frame this surface last drew, for the worker to measure a
   * pull against on the canvas-2D path. Null on the GPU path, whose camera the
   * worker already has, and before anything has been drawn.
   */
  drawnCamera: () => CameraUniforms | null;
}

/**
 * The tool in hand, for a surface that has tools.
 *
 * Absent, every press orbits, with any button, exactly as before there were
 * tools: an inline simulation window and a folded figure have none.
 */
export interface SimulatorViewportToolInput {
  mode: SimulatorInputMode;
  cursor: SimulatorToolCursor;
  /** Whether a press may start a tool gesture at all. */
  enabled: boolean;
  /**
   * The tool would refuse a press — Pull with nothing pinned — which the cursor
   * says before anyone presses. The press still reaches the tool, to be refused.
   */
  refused?: boolean;
  /**
   * A gesture for the tool to act on, with the canvas's CSS size it is measured
   * against: a box or a click when it finishes, every step of a pull.
   */
  onGesture: (gesture: SimulatorGesture, surface: CssSize) => void;
}

/** A press the canvas is following, and what it is doing with it. */
type CanvasDrag =
  | { kind: "orbit"; pointerId: number }
  | {
      kind: "gesture";
      pointerId: number;
      engine: SimulatorGestureEngine<unknown>;
      state: unknown;
      /** The canvas's box when the press landed; it does not move under a drag. */
      box: { left: number; top: number; width: number; height: number };
      touch: boolean;
      /** The camera is held still while this gesture moves the paper. */
      holdsCamera: boolean;
    };

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
   * How the paper is drawn — colours, pens, light. The app's display style for
   * the Simulate workspace, an object's effective style for a window on the
   * Edit canvas. Ignored when {@link renderSettings} is given, which already
   * carries a resolved style.
   */
  paperStyle: PaperStyle;
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
  /** Creases/faces a sequence step is emphasising, and the pinned faces. CPU path only. */
  highlights?: SimulatorHighlights;
  /** The tool in hand; see {@link SimulatorViewportToolInput}. */
  toolInput?: SimulatorViewportToolInput;
  /**
   * Hand the orbit camera to the runtime, which forwards it to the worker in
   * GPU mode and only remembers it in CPU mode.
   */
  pushCamera: (view: SimulatorView, width: number, height: number) => void;
  /** Hand render settings to the runtime, on the same terms as {@link pushCamera}. */
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
  paperStyle,
  viewCube = false,
  initialView,
  renderSettings,
  highlights = EMPTY_HIGHLIGHTS,
  toolInput,
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
  // The rAF of a canvas-2D redraw while the camera is still arriving, or null.
  // See `drawCurrentFrame`.
  const framingRef = useRef<number | null>(null);
  // Which pointer the canvas is following, and what for. The angles an orbit
  // drags from live on the gesture below, which the view cube drives too.
  const dragRef = useRef<CanvasDrag | null>(null);
  // Tool input only: who owns the surface when fingers are on it. A surface
  // without tools keeps the single-pointer handling it always had.
  const arbiterRef = useRef<TouchArbiter | null>(null);
  const toolInputRef = useRef(toolInput);
  // The box being dragged, drawn as a DOM layer because on the GPU path the
  // canvas is the worker's.
  const marqueeRef = useRef<HTMLDivElement | null>(null);
  const orbitOriginRef = useRef<SimulatorOrbitDrag | null>(null);
  // Fixed when the drag begins, so letting the modifier go halfway through does
  // not turn a roll into an orbit under the user's hand.
  const orbitModeRef = useRef<SimulatorOrbitMode>('orbit');
  // Read synchronously by the pointer and draw handlers, which must not see a
  // stale closure mid-gesture.
  const gpuActiveRef = useRef(gpuActive);
  const viewSettingsRef = useRef(viewSettings);
  const paperStyleRef = useRef(paperStyle);
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
  // it rasterises the latest frame on this thread — and again on the next
  // animation frame while the camera is still easing to the shape, because the
  // frames stop coming once the model settles and the camera may not have.
  const drawCurrentFrame = useCallback(() => {
    if (framingRef.current !== null) window.cancelAnimationFrame(framingRef.current);
    framingRef.current = null;
    function draw() {
      framingRef.current = null;
      if (gpuActiveRef.current) return;
      const canvas = canvasRef.current;
      const model = modelRef.current;
      const frame = frameRef.current;
      const paint = paintRef.current;
      if (!canvas || !model || !frame || !frame.positions || !paint) return;
      const arrived = drawFrame(canvas, model, frame, viewRef.current, paint, highlightsRef.current);
      if (!arrived) framingRef.current = window.requestAnimationFrame(draw);
    }
    draw();
  }, []);

  useEffect(
    () => () => {
      if (framingRef.current !== null) window.cancelAnimationFrame(framingRef.current);
      framingRef.current = null;
    },
    []
  );

  /**
   * Re-resolve the palette and push it wherever it is needed.
   *
   * Called on a settings change and on a theme change — the two things that can
   * move a colour. `paint.render` is handed to the runtime on both paths: the
   * GPU path forwards it to the worker and redraws there; the canvas-2D path
   * redraws here from the same bundle, and the runtime only records it — so an
   * export, which the worker builds, draws the palette on screen rather than
   * the worker's defaults.
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
      paperStyleRef.current,
      surfaceOptionsRef.current
    );
    paintRef.current = paint;
    pushRenderSettings(paint.render);
    if (!gpuActiveRef.current) drawCurrentFrame();
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
    const dpr = simulatorDevicePixelRatio();
    return {
      width: Math.max(minDeviceSize, Math.floor((rect?.width || 720) * dpr)),
      height: Math.max(minDeviceSize, Math.floor((rect?.height || 720) * dpr)),
    };
  }, [minDeviceSize]);

  /**
   * Apply the current orbit view: forward it to the worker (GPU) or redraw here
   * (CPU). This is what makes orbit cheap in GPU mode — one small message and a
   * texture-fed redraw, with no solver work at any model size.
   *
   * The camera is handed to the runtime on both paths. On the canvas-2D path
   * the runtime records it without a worker message — the frame is drawn here
   * — so that an export, which the worker builds, is taken from the view on
   * screen rather than from the opening one.
   */
  const pushView = useCallback(() => {
    // Before the frame, and by a style write rather than a layout read: the
    // measure below is already the one forced layout an orbit frame is allowed.
    viewCubeRef.current?.setView(viewRef.current);
    const { width, height } = deviceSize();
    pushCamera(viewRef.current, width, height);
    if (!gpuActiveRef.current) drawCurrentFrame();
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
   * Move the camera to `to` over about a quarter second.
   *
   * The animation is the camera's, not the cube's: it moves `viewRef` on every
   * frame, so the fold, the cube and the readouts all follow one motion rather
   * than the cube animating and the model jumping.
   */
  const tweenView = useCallback(
    (to: SimulatorView) => {
      const from = viewRef.current;
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

  /**
   * Turn to look at the model from `direction`, and stand the picture back up.
   *
   * The roll goes with it. A named viewpoint should be one view rather than a
   * family of them, and a Top that came back at whatever angle the last roll
   * left would give the cube no way home — the ring can only be reached square
   * on to a face, so a view rolled from a corner would otherwise be stuck.
   */
  const snapToDirection = useCallback(
    (direction: SimulatorViewDirection) => {
      tweenView({ ...simulatorViewLookingFrom(viewRef.current, direction), roll: 0 });
    },
    [tweenView]
  );

  /**
   * Spin the picture about the line of sight, to an absolute angle.
   *
   * The eye does not move — see the package's `viewRotationFor` for why that is
   * exact — so this is the one control that changes which way up the model is
   * drawn without changing what you are looking at. Applied rather than tweened:
   * it is driven by a drag, and a drag has to answer the hand at once.
   */
  const setRoll = useCallback(
    (roll: number) => {
      applyView({ ...viewRef.current, roll });
    },
    [applyView]
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
    paperStyleRef.current = paperStyle;
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
    paperStyle,
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
  // Only the first session needs this: every later one — a reload, a rebuild
  // after the fold went away — opens on what the runtime last forwarded, which
  // is why a session replaced while `gpuActive` stays true is not covered here
  // and does not have to be.
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
      cancelToolGesture: () => (dragRef.current?.kind === "gesture" ? abandonDrag() : false),
      pickDrawnFaces: (query: SimulatorPickQuery) => {
        const canvas = canvasRef.current;
        const model = modelRef.current;
        if (gpuActiveRef.current || !canvas || !model) return null;
        return pickDrawnFrame(canvas, model, query);
      },
      drawnCamera: () => {
        const canvas = canvasRef.current;
        if (gpuActiveRef.current || !canvas) return null;
        return drawnCameraOf(canvas);
      },
    }),
    // `abandonDrag` reads only refs, so it is the same function every render
    // in all but identity; listing it would rebuild the handle each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      begin: (point, mode = 'orbit') => {
        // Before the angles below are read, not after: a drag that began
        // mid-snap must start from where the model is now and own it from there.
        cancelSnap();
        // A drag is the unit the orbit readout reports on; see
        // `beginOrbitGesture`.
        beginOrbitGesture(perfSurface);
        orbitModeRef.current = mode;
        orbitOriginRef.current = {
          x: point.x,
          y: point.y,
          yaw: viewRef.current.yaw,
          pitch: viewRef.current.pitch,
          roll: viewRef.current.roll ?? 0,
        };
      },
      move: (point) => {
        const origin = orbitOriginRef.current;
        if (!origin) return;
        // Counted before the push, so the log compares pointer input against
        // messages sent rather than against itself. They are equal today —
        // nothing coalesces — which is the baseline any fix has to move.
        recordOrbitMove();
        applyView(
          orbitModeRef.current === 'roll'
            ? nextSimulatorRollView(viewRef.current, origin, point)
            : nextSimulatorOrbitView(viewRef.current, origin, point)
        );
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

  /**
   * The canvas's cursor, when it has tools: what a press here would do. Set
   * inline, as Edit's is, so the global `.simulator-canvas` rule is left alone;
   * a surface without tools keeps that rule's grab hand.
   */
  const updateCursor = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const input = toolInputRef.current;
    const drag = dragRef.current;
    canvas.style.cursor = input
      ? simulatorCanvasCursor({
          tool: input.cursor,
          orbiting: drag?.kind === "orbit",
          pulling: drag?.kind === "gesture" && drag.holdsCamera,
          refused: input.refused ?? false,
          navigateModifierHeld: readHeldModifiers().meta,
        })
      : "";
  }, []);

  useEffect(() => {
    toolInputRef.current = toolInput;
    updateCursor();
  });

  useEffect(() => subscribeHeldModifiers(updateCursor), [updateCursor]);

  useEffect(
    () => () => {
      arbiterRef.current?.reset();
    },
    []
  );

  const showMarquee = (rect: CssRect | null, box?: { left: number; top: number }) => {
    const marquee = marqueeRef.current;
    const canvas = canvasRef.current;
    if (!marquee) return;
    if (!rect || !canvas || !box) {
      marquee.hidden = true;
      return;
    }
    // Relative to the canvas, which need not sit at the corner of the box this
    // layer is positioned in.
    marquee.hidden = false;
    marquee.style.left = `${canvas.offsetLeft + rect.left}px`;
    marquee.style.top = `${canvas.offsetTop + rect.top}px`;
    marquee.style.width = `${rect.right - rect.left}px`;
    marquee.style.height = `${rect.bottom - rect.top}px`;
  };

  /** A pointer sample in canvas CSS pixels, against the box the press measured. */
  const sampleOf = (
    kind: SimulatorPointerInput["kind"],
    event: { clientX: number; clientY: number; shiftKey: boolean },
    drag: Extract<CanvasDrag, { kind: "gesture" }>
  ): SimulatorPointerInput => ({
    kind,
    point: { x: event.clientX - drag.box.left, y: event.clientY - drag.box.top },
    shift: event.shiftKey,
    touch: drag.touch,
  });

  const releaseCapture = (pointerId: number) => {
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
  };

  /**
   * Hold the canvas-2D camera for a gesture that moves the paper under the
   * cursor. The GPU path's camera is the worker's, which holds it itself.
   */
  const holdCamera = (held: boolean) => {
    const canvas = canvasRef.current;
    if (canvas && !gpuActiveRef.current) holdSurfaceFraming(canvas, held);
  };

  /** Hand a gesture to the tool, measured against the canvas box its press landed in. */
  const deliver = (out: { gesture: SimulatorGesture | null }, drag: Extract<CanvasDrag, { kind: "gesture" }>) => {
    if (out.gesture) toolInputRef.current?.onGesture(out.gesture, { width: drag.box.width, height: drag.box.height });
  };

  /** Drop whatever the canvas is following, with nothing to show for it. */
  function abandonDrag(): boolean {
    const drag = dragRef.current;
    if (!drag) return false;
    dragRef.current = null;
    releaseCapture(drag.pointerId);
    if (drag.kind === "orbit") {
      orbit.end();
    } else {
      // Said to the tool: a pull has to put the paper back.
      deliver(
        drag.engine.reduce(drag.state, {
          kind: "cancel",
          point: { x: 0, y: 0 },
          shift: false,
          touch: drag.touch,
        }),
        drag
      );
      showMarquee(null);
      if (drag.holdsCamera) holdCamera(false);
    }
    updateCursor();
    return true;
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactiveRef.current) return;
    const input = toolInputRef.current;
    if (!input) {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { kind: "orbit", pointerId: event.pointerId };
      orbit.begin({ x: event.clientX, y: event.clientY }, event.shiftKey ? "roll" : "orbit");
      return;
    }

    arbiterRef.current ??= createTouchArbiter();
    const verdict = arbiterRef.current.down(event.nativeEvent);
    // A second finger turns the press into a pinch: whatever the first one
    // started — a box, an orbit — goes, and nothing of it is applied.
    if (verdict.abort.includes("canvas")) abandonDrag();
    if (verdict.action !== "forward") {
      if (verdict.action === "transform") event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    const route = routeSimulatorPress(
      {
        button: event.button,
        contextClick: event.button === 0 && event.ctrlKey && isApplePlatform(),
        meta: event.metaKey,
        shift: event.shiftKey,
      },
      input.mode
    );
    switch (route.kind) {
      case "menu":
      case "ignore":
        return;
      case "orbit":
        // The middle button would otherwise start the browser's autoscroll.
        if (event.button === 1) event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { kind: "orbit", pointerId: event.pointerId };
        orbit.begin({ x: event.clientX, y: event.clientY }, route.mode);
        updateCursor();
        return;
      case "gesture": {
        if (!input.enabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const rect = event.currentTarget.getBoundingClientRect();
        const drag: Extract<CanvasDrag, { kind: "gesture" }> = {
          kind: "gesture",
          pointerId: event.pointerId,
          engine: route.engine,
          state: route.engine.initialState,
          box: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          touch: event.pointerType === "touch",
          holdsCamera: route.holdsCamera ?? false,
        };
        const out = drag.engine.reduce(drag.state, sampleOf("down", event, drag));
        drag.state = out.state;
        dragRef.current = drag;
        if (drag.holdsCamera) holdCamera(true);
        showMarquee(out.preview?.marquee ?? null, drag.box);
        deliver(out, drag);
        updateCursor();
        return;
      }
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (toolInputRef.current && arbiterRef.current) {
      const verdict = arbiterRef.current.move(event.nativeEvent);
      if (verdict.action === "transform") {
        // A pinch zooms, as the wheel does. The orbit camera has no pan.
        applyView({
          ...viewRef.current,
          zoom: clampSimulatorZoom(viewRef.current.zoom * verdict.transform.scale),
        });
        return;
      }
      if (verdict.action === "ignore") return;
    }
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    if (drag.kind === "orbit") {
      orbit.move({ x: event.clientX, y: event.clientY });
      return;
    }
    const out = drag.engine.reduce(drag.state, sampleOf("move", event, drag));
    drag.state = out.state;
    showMarquee(out.preview?.marquee ?? null, drag.box);
    deliver(out, drag);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const input = toolInputRef.current;
    if (input && arbiterRef.current) {
      const verdict = arbiterRef.current.up(event.nativeEvent);
      if (verdict.action === "ignore") {
        releaseCapture(event.pointerId);
        return;
      }
    }
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    releaseCapture(event.pointerId);
    dragRef.current = null;
    if (drag.kind === "orbit") {
      orbit.end();
      updateCursor();
      return;
    }
    const kind = event.type === "pointercancel" ? "cancel" : "up";
    const out = drag.engine.reduce(drag.state, sampleOf(kind, event, drag));
    showMarquee(null);
    if (drag.holdsCamera) holdCamera(false);
    deliver(out, drag);
    updateCursor();
  };

  // A double click resets the view under Orbit. Under a tool it is two clicks,
  // each of which the tool has already answered.
  const handleDoubleClick = () => {
    const input = toolInputRef.current;
    if (input && input.mode !== "orbit") return;
    resetView();
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
        data-lighting={paperStyle.light.enabled || undefined}
        aria-label={ariaLabel}
        title={title}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onDoubleClick={handleDoubleClick}
      />
      {toolInput && <div ref={marqueeRef} className={styles.marquee} hidden aria-hidden="true" />}
      {viewCube && (
        <SimulatorViewCube
          ref={attachViewCube}
          interactive={interactive}
          onSnap={snapToDirection}
          onRoll={setRoll}
          orbit={orbit}
        />
      )}
    </>
  );
}
