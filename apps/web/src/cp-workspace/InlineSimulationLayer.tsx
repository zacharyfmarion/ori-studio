import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { FoldDocument as SimulatorFoldDocument } from '@treemaker/origami-simulator';
import type { CpOverlayView } from './CreasePatternWebglCanvas';
import { useCpOverlayView } from './cpOverlayViewStore';
import { overlayCssPerModel, overlayModelToCss } from './annotations/annotationTransform';
import type { InlineSimulation } from './inlineSimulation/inlineSimulation';
import { inlineSimulationPlacement } from './inlineSimulation/inlineSimulationPlacement';
import {
  getInlineSimulationFoldPercent,
  getInlineSimulationSource,
  publishInlineSimulationFold,
  subscribeInlineSimulationFoldTarget,
} from './inlineSimulation/inlineSimulationRuntime';
import {
  SimulatorViewport,
  type SimulatorViewportHandle,
} from '../simulator/SimulatorViewport';
import {
  useSimulatorRuntime,
  webglRenderSupported,
  type SimulatorFrameView,
} from '../simulator/useSimulatorRuntime';
import { foldNeedsTriangulation } from '../simulator/canvas2dFrame';
import { useSimulatorShortcuts } from '../simulator/useSimulatorShortcuts';
import {
  simulatorMaterialOptions,
  type SimulatorSettings,
} from '../lib/simulatorSettings';

/**
 * DOM layer that renders inline simulation windows over the WebGL canvas.
 *
 * Each window is a canvas positioned and sized by its model-space box under the
 * live camera, exactly as {@link CpTextAnnotationLayer} places text boxes. Only
 * the focused window holds a solver; the rest simply keep the last frame their
 * canvas received, which costs nothing and is why one worker session is enough.
 *
 * Selection, move, resize and rotate are not handled here — the shared
 * {@link CanvasObjectOverlay} owns those gestures for every kind of canvas
 * object, and this layer keeps `pointer-events: none` except on the focused
 * window, which takes drags so the fold can be orbited.
 */

/** How often the store's fold readout is refreshed while the solver runs. */
const READOUT_INTERVAL_MS = 66;

/** Fold percentage per arrow press, matching the Simulate workspace's default. */
const FOLD_STEP_PERCENT = 5;

/**
 * Render-target edge a window opens at, in device pixels. Replaced by the real
 * size as soon as the viewport's ResizeObserver reports one.
 */
const INITIAL_RENDER_EDGE = 512;

/**
 * How long the camera must hold still before the windows are laid out — and so
 * re-rendered — at its new scale.
 *
 * Short enough that letting go of a zoom feels like it sharpens immediately,
 * long enough that a continuous gesture never crosses it.
 */
const SCALE_SETTLE_MS = 140;

/**
 * How far the transform may stretch a window before waiting for the camera to
 * stop stops being acceptable.
 *
 * Without this, a slow continuous zoom never settles — each frame restarts the
 * timer — and the windows stay soft for as long as it lasts. With it, the worst
 * case is a single octave of upscale, and a fast zoom across the whole range
 * pays a handful of re-layouts instead of one per frame.
 *
 * Asymmetric on purpose: scaling *down* costs no sharpness (the bitmap is
 * supersampled), so only the upscale direction needs bounding.
 */
const MAX_UNSETTLED_UPSCALE = 2;

/**
 * The camera scale the windows are currently laid out at, which lags the live
 * one while the camera is moving.
 *
 * Re-rendering twenty windows on every frame of a zoom is what made this
 * expensive: each is a worker render, an ImageBitmap, a postMessage and a
 * composite, and at peak that measured 640 bitmaps a second. Holding the layout
 * still and scaling by transform costs the compositor nothing extra — it is
 * already compositing these layers — and the windows re-render once, when the
 * camera stops.
 */
function useSettledScale(pxPerModel: number): number {
  const [settled, setSettled] = useState(pxPerModel);
  useEffect(() => {
    if (pxPerModel === settled) return undefined;
    // Past the stretch limit, do not wait for the gesture to end.
    if (pxPerModel / settled > MAX_UNSETTLED_UPSCALE) {
      setSettled(pxPerModel);
      return undefined;
    }
    const id = window.setTimeout(() => setSettled(pxPerModel), SCALE_SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [pxPerModel, settled]);
  return settled;
}

/** Screen-space rotation (radians) of the box's local +x axis under the camera. */
function screenAngle(
  view: CpOverlayView,
  center: { x: number; y: number },
  rotation: number
): number {
  const origin = overlayModelToCss(view, center);
  const tip = overlayModelToCss(view, {
    x: center.x + Math.cos(rotation),
    y: center.y + Math.sin(rotation),
  });
  return Math.atan2(tip.y - origin.y, tip.x - origin.x);
}

export function InlineSimulationLayer({
  simulations,
  focusedId,
  staleIds,
  viewSettings,
  playing,
  overlayInteractive,
  replayRequest,
  onFocus,
  onPlayingChange,
}: {
  simulations: readonly InlineSimulation[];
  focusedId: string | null;
  staleIds: ReadonlySet<string>;
  viewSettings: SimulatorSettings;
  /** Whether the focused window is advancing its fold. */
  playing: boolean;
  /**
   * Whether the shared selection overlay is currently taking pointer events. It
   * goes inert while a drawing tool is mid-gesture, and an unfocused window is
   * inert too — so without this a window would be unreachable exactly then, with
   * clicks landing on nothing.
   */
  overlayInteractive: boolean;
  /**
   * Bumped to return the focused window's fold to flat. The solver lives down
   * here, so this is the only way in from outside the layer.
   */
  replayRequest: number;
  onFocus: (id: string) => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  // Subscribed here rather than in the panel so this layer alone re-renders per
  // camera frame and the windows stay glued to the pattern while panning.
  const view = useCpOverlayView();
  const pxPerModel = view ? overlayCssPerModel(view) : 1;
  const renderedPxPerModel = useSettledScale(pxPerModel);
  if (!view) return null;

  return (
    <div
      className="cp-inline-simulation-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'visible',
        // Above the WebGL canvas (5), grid (6) and text layer (7); the selection
        // overlay (8) sits above so its handles stay grabbable.
        zIndex: 7,
      }}
    >
      {simulations.map((simulation) => {
        const center = overlayModelToCss(view, simulation.box.center);
        const angle = screenAngle(view, simulation.box.center, simulation.box.rotation);
        const placement = inlineSimulationPlacement({
          box: simulation.box,
          center,
          angle,
          pxPerModel,
          renderedPxPerModel,
        });
        const style: CSSProperties = {
          position: 'absolute',
          // Everything the camera moves lives in the transform, position as well
          // as scale — see `inlineSimulationPlacement`.
          left: 0,
          top: 0,
          width: placement.width,
          height: placement.height,
          transform: placement.transform,
          transformOrigin: '0 0',
          // The focused window takes its own gestures (its interior orbits the
          // fold). An unfocused one normally defers to the selection overlay, so
          // a drag there moves it like any other canvas object — except while
          // that overlay is inert, when taking the press here is the only way a
          // window stays clickable at all.
          pointerEvents:
            simulation.id === focusedId || !overlayInteractive ? 'auto' : 'none',
        };
        return (
          <InlineSimulationWindow
            key={simulation.id}
            simulation={simulation}
            focused={simulation.id === focusedId}
            playing={playing && simulation.id === focusedId}
            stale={staleIds.has(simulation.id)}
            overlayInteractive={overlayInteractive}
            replayRequest={replayRequest}
            style={style}
            viewSettings={viewSettings}
            onFocus={onFocus}
            onPlayingChange={onPlayingChange}
          />
        );
      })}
    </div>
  );
}

/**
 * One window. Holds a simulator runtime only while focused, so at most one
 * solver session exists across the whole layer.
 */
function InlineSimulationWindow({
  simulation,
  focused,
  playing,
  stale,
  overlayInteractive,
  replayRequest,
  style,
  viewSettings,
  onFocus,
  onPlayingChange,
}: {
  simulation: InlineSimulation;
  focused: boolean;
  playing: boolean;
  stale: boolean;
  overlayInteractive: boolean;
  replayRequest: number;
  style: CSSProperties;
  viewSettings: SimulatorSettings;
  onFocus: (id: string) => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  const { t } = useTranslation();
  const viewportRef = useRef<SimulatorViewportHandle | null>(null);
  const [, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const source = getInlineSimulationSource(simulation.id);

  /**
   * Inline windows are GPU-only. Bitmap presentation is what lets them share one
   * GL context, and the canvas-2D fallback cannot draw into a canvas that holds a
   * `bitmaprenderer` context — so without WebGL2 a window would show an empty box
   * with no explanation. Say so, and point at the workspace that can still run it.
   */
  const gpuAvailable = useMemo(() => webglRenderSupported(), []);

  // The fold percent the solver last reported. Held in a ref so a 60fps frame
  // stream does not re-render this component; the store copy is throttled below
  // purely so the toolbar's readout and slider track it. Seeded from the stored
  // value so a window reloaded on refocus resumes where it was.
  const solverFoldPercentRef = useRef(getInlineSimulationFoldPercent(simulation.id));
  const lastPublishedRef = useRef(0);

  // Only the *initial* render size. Every later size rides on `setCamera`, which
  // the viewport pushes from its ResizeObserver — so this stays a stable object
  // and a window changing size does not reload its model.
  const bitmapOutput = useMemo(
    () => (gpuAvailable ? { width: INITIAL_RENDER_EDGE, height: INITIAL_RENDER_EDGE } : null),
    [gpuAvailable]
  );

  // Where the fold should be when the solver loads.
  //
  // A window gives up its solver session when focus moves elsewhere — one worker,
  // one live model — so regaining focus is a fresh load. Without seeding it, the
  // fold came back flat and the window appeared to reset itself every time it was
  // clicked away from and back. Read from a ref so this is the value at the
  // moment of loading, without making the solver options change identity on every
  // frame while playing.
  //
  // Safe to put here specifically because `useSimulatorRuntime` deliberately
  // excludes `solverOptions` from its load effect: it is read when a model loads
  // and never re-triggers one, so later scrubbing still goes through
  // `setFoldPercent` rather than reloading.
  const materialOptions = useMemo(
    () => simulatorMaterialOptions(viewSettings),
    [viewSettings]
  );
  // Seeded from the runtime's fold percent, which is where the user left this
  // window, and not from the last frame the solver reported — those are only
  // delivered while the window is focused, so the reported value is stale by
  // definition at the moment a blurred window reloads.
  //
  // Deliberately not memoized: the load effect closes over whatever the render
  // produced, so a memo would freeze this at mount. Recomputing costs an object
  // literal, and `useSimulatorRuntime` reads it only when a model loads, so a
  // fresh identity every render triggers nothing.
  const solverOptions = {
    ...materialOptions,
    foldPercent: getInlineSimulationFoldPercent(simulation.id),
  };

  const handleFrame = useCallback(
    (frame: SimulatorFrameView) => {
      viewportRef.current?.showFrame(frame);
      solverFoldPercentRef.current = frame.foldPercent;
      const now = performance.now();
      // Still throttled, but what it now protects is one floating toolbar rather
      // than the whole crease-pattern panel.
      if (frame.converged || now - lastPublishedRef.current > READOUT_INTERVAL_MS) {
        lastPublishedRef.current = now;
        publishInlineSimulationFold(simulation.id, frame.foldPercent);
      }
    },
    [simulation.id]
  );

  // Every window keeps its model loaded, focused or not.
  //
  // An unfocused one costs a converged clock, which spends no budget, and the
  // tick loop skips entirely once settled — so it is idle rather than running.
  // What it buys is the ability to re-render: the crease-pattern camera keeps
  // resizing these windows underneath us, and a window that cannot draw is stuck
  // showing a bitmap made for the size it used to be, which goes soft zoomed in
  // and threadbare zoomed out.
  const runtime = useSimulatorRuntime({
    fold:
      source && gpuAvailable ? (source.fold as unknown as SimulatorFoldDocument) : null,
    solverOptions,
    triangulate: source ? foldNeedsTriangulation(source.fold as unknown as SimulatorFoldDocument) : true,
    canvas: null,
    bitmapOutput,
    // Frozen unless this window has focus. It still redraws when the camera
    // moves it — that is what keeps it crisp — it simply stops advancing.
    paused: !focused,
    onFrame: handleFrame,
  });

  // A scrub or replay from the toolbar moves the solver's target.
  //
  // Subscribed rather than read from a prop, so a fold advancing does not
  // re-render this component. And subscribed to *requests* only: the solver's own
  // readout never arrives here, which is what removed the "more than 0.5 away
  // from the last reported value" test this used to need to tell the two apart.
  const { setFoldPercent, status: runtimeStatus } = runtime;
  useEffect(() => {
    if (!focused || playing || runtimeStatus !== 'ready') return;
    return subscribeInlineSimulationFoldTarget((id, percent) => {
      if (id !== simulation.id) return;
      solverFoldPercentRef.current = percent;
      setFoldPercent(percent);
    });
  }, [focused, playing, runtimeStatus, simulation.id, setFoldPercent]);

  // Advance the fold over time. The solver does the work in the worker, so this
  // only ever computes a number and hands it over.
  useEffect(() => {
    if (!focused || !playing || runtimeStatus !== 'ready') return;
    if (solverFoldPercentRef.current >= 100) {
      solverFoldPercentRef.current = 0;
      runtime.reset();
    }
    let previous: number | null = null;
    let raf = 0;
    const tick = (time: number) => {
      if (previous === null) previous = time;
      const elapsedSeconds = Math.min(0.08, (time - previous) / 1000);
      previous = time;
      const next = Math.min(
        100,
        solverFoldPercentRef.current + elapsedSeconds * viewSettings.foldPlayPercentPerSecond
      );
      solverFoldPercentRef.current = next;
      setFoldPercent(next);
      if (next >= 100) {
        onPlayingChange(false);
        return;
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
    // `runtime` is intentionally not a dep: it is a fresh object every render and
    // would restart the loop continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    focused,
    playing,
    runtimeStatus,
    setFoldPercent,
    onPlayingChange,
    viewSettings.foldPlayPercentPerSecond,
  ]);

  // The same keymap the Simulate workspace uses, bound only while this window has
  // focus. The `simulator` scope it pushes sits ahead of `crease-pattern`, so
  // Space plays the fold here and still pans the canvas everywhere else.
  useSimulatorShortcuts({
    active: focused && runtimeStatus === 'ready',
    foldStepPercent: FOLD_STEP_PERCENT,
    handlers: {
      playPause: () => onPlayingChange(!playing),
      nudgeFold: (delta) => {
        onPlayingChange(false);
        const next = Math.min(100, Math.max(0, solverFoldPercentRef.current + delta));
        solverFoldPercentRef.current = next;
        setFoldPercent(next);
        publishInlineSimulationFold(simulation.id, next);
      },
      setFoldPercent: (percent) => {
        onPlayingChange(false);
        solverFoldPercentRef.current = percent;
        setFoldPercent(percent);
        publishInlineSimulationFold(simulation.id, percent);
      },
      replay: () => replayRef.current(),
      resetView: () => viewportRef.current?.resetView(),
      zoomBy: (factor) => viewportRef.current?.zoomBy(factor),
      // No toggleSetting: an inline window has no options pane of its own, and
      // silently changing the app-wide render settings from a small window on
      // the Edit canvas would be a surprise.
    },
  });

  /**
   * Back to flat: stop playing, put the solver at rest, and report zero.
   *
   * Held in a ref so the toolbar's nonce effect and the keyboard binding drive
   * one definition rather than two, and so neither has to re-subscribe when the
   * closures around it change.
   */
  const replayRef = useRef(() => {});
  // Assigned in an effect, not during render: a ref written during render can be
  // left stale when React discards that render pass.
  const { reset: resetSolver } = runtime;
  useEffect(() => {
    replayRef.current = () => {
      onPlayingChange(false);
      solverFoldPercentRef.current = 0;
      resetSolver();
      publishInlineSimulationFold(simulation.id, 0);
    };
  });

  // Return the fold to flat on request, for the focused window only. Skips the
  // first run so mounting a window does not count as a reset.
  const seenReplayRef = useRef(replayRequest);
  useEffect(() => {
    if (seenReplayRef.current === replayRequest) return;
    seenReplayRef.current = replayRequest;
    if (!focused) return;
    replayRef.current();
  }, [replayRequest, focused]);

  // Keep the window's stored camera in step, so a refresh comes back where the
  // user was looking rather than at the default view.
  const pushCamera = useCallback(
    (view: Parameters<typeof runtime.setCamera>[0], width: number, height: number) => {
      runtime.setCamera(view, width, height);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <div
      className="cp-inline-simulation"
      data-focused={focused || undefined}
      data-stale={stale || undefined}
      // A window that renders nothing looks the same whether it is still loading,
      // errored, or ready but never handed a frame. Surfaced so that is one
      // glance in the inspector rather than a bisect.
      data-status={runtime.status}
      data-gpu={runtime.gpuActive || undefined}
      style={style}
      onPointerDownCapture={(event) => {
        if (focused) return;
        onFocus(simulation.id);
        // Reached only while the overlay is inert, where this element is the
        // sole thing that can claim the press. Stop it so the tool underneath
        // does not also act on a click that was aimed at the window.
        if (!overlayInteractive) event.stopPropagation();
      }}
    >
      <SimulatorViewport
        ref={viewportRef}
        canvasKey="bitmap"
        onCanvasChange={setCanvasEl}
        interactive={focused && runtime.status === 'ready'}
        gpuActive={runtime.gpuActive}
        bitmapPresent
        minDeviceSize={64}
        transparentBackground
        viewSettings={viewSettings}
        pushCamera={pushCamera}
        pushRenderSettings={runtime.setRenderSettings}
        className="cp-inline-simulation__canvas"
        ariaLabel={t(
          'panels:creasePattern.inlineSimulation.canvasAriaLabel',
          'Inline simulation. Drag to rotate.'
        )}
      />
      {!gpuAvailable && (
        <span className="cp-inline-simulation__badge">
          {t(
            'panels:creasePattern.inlineSimulation.gpuUnavailable',
            'Needs WebGL2 — open in the Simulate workspace'
          )}
        </span>
      )}
      {gpuAvailable && stale && (
        <span className="cp-inline-simulation__badge">
          {t('panels:creasePattern.inlineSimulation.outOfDate', 'Out of date')}
        </span>
      )}
      {runtime.status === 'error' && (
        <span className="cp-inline-simulation__badge cp-inline-simulation__badge--error">
          {runtime.error ??
            t('panels:creasePattern.inlineSimulation.failed', 'Simulation failed')}
        </span>
      )}
    </div>
  );
}
