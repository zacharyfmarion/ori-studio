import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { FoldDocument as SimulatorFoldDocument } from '@treemaker/origami-simulator';
import { useCpOverlayView } from './cpOverlayViewStore';
import { resolveCpViewportCanvas } from './cpViewportCanvas';
import { useWheelPassthrough } from '../hooks/useWheelPassthrough';
import { claimWheelBurst } from '../lib/wheelBurst';
import { overlayCssPerModel, overlayModelToCss } from './annotations/annotationTransform';
import type { InlineSimulation } from './inlineSimulation/inlineSimulation';
import {
  canvasWindowPlacement,
  windowScreenAngle,
} from './canvasObjects/canvasWindowPlacement';
import { useSettledScale } from './canvasObjects/useSettledScale';
import {
  getInlineSimulationFoldPercent,
  getInlineSimulationSource,
  publishInlineSimulationFold,
  registerInlineSimulationExporter,
  subscribeInlineSimulationSources,
  subscribeInlineSimulationFoldTarget,
} from './inlineSimulation/inlineSimulationRuntime';
import { useSimulatorViewExport } from '../simulator/useSimulatorViewExport';
import {
  SimulatorViewport,
  type SimulatorViewportHandle,
} from '../simulator/SimulatorViewport';
import {
  useSimulatorRuntime,
  type SimulatorFrameView,
} from '../simulator/useSimulatorRuntime';
import { useWorkerGpuSupport } from '../simulator/workerGpuSupport';
import { foldNeedsTriangulation } from '../simulator/canvas2dFrame';
import { useSimulatorShortcuts } from '../simulator/useSimulatorShortcuts';
import { registerSimulatorView } from '../simulator/simulatorViewRegistry';
import { FoldPlayhead } from '../simulator/foldPlayhead';
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
 * Frame edge, in device pixels, the crease width is calibrated for.
 *
 * A window is not a viewport — it is a picture on the crease pattern, sized by
 * the CP camera — and the model is fitted to its frame while a crease of fixed
 * screen weight is not. At full size that gap is invisible; on a thumbnail the
 * creases were 25x their proper share of the paper and buried it. Above this
 * edge nothing changes, so the sizes that already read correctly are untouched;
 * below it the crease shrinks with the frame and the fold reads identically at
 * every size.
 *
 * ~256 CSS px on a 2x display, which is around where a window stops being
 * something you are looking *at* and becomes something you are looking *past*.
 * Both of these are calibration, not physics — turn them up to thin the
 * linework sooner, down to keep it heavy for longer.
 */
const CREASE_REFERENCE_EDGE = 512;

/**
 * How fast the crease thins below {@link CREASE_REFERENCE_EDGE}. 1 = lockstep
 * with the frame, so a crease keeps the same share of the paper at any size.
 * Below 1 it grows relative to the paper as the window shrinks, which is the
 * failure this exists to fix; the crease-pattern canvas landed on 1 for its
 * vertices after the same argument (`VERTEX_SHRINK_EXPONENT`).
 */
const CREASE_SHRINK_EXPONENT = 1;

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
        const angle = windowScreenAngle(view, simulation.box.center, simulation.box.rotation);
        const placement = canvasWindowPlacement({
          box: simulation.box,
          center,
          angle,
          pxPerModel,
          renderedPxPerModel,
        });
        const style: CSSProperties = {
          position: 'absolute',
          // Everything the camera moves lives in the transform, position as well
          // as scale — see `canvasWindowPlacement`.
          left: 0,
          top: 0,
          width: placement.width,
          height: placement.height,
          transform: placement.transform,
          transformOrigin: '0 0',
          // Camera-dependent, so it cannot live in the stylesheet — see
          // `canvasWindowPlacement`. Clips the canvas too, via `overflow`.
          borderRadius: placement.cornerRadius,
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
            badgeStyle={placement.badge}
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
  badgeStyle,
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
  /**
   * How the badges sit under the current camera, or null once the window is too
   * small to hold one. See `canvasWindowPlacement`.
   */
  badgeStyle: CSSProperties | null;
  viewSettings: SimulatorSettings;
  onFocus: (id: string) => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  const { t } = useTranslation();
  const viewportRef = useRef<SimulatorViewportHandle | null>(null);
  // Also this window's identity in a wheel gesture — the element an owner
  // elsewhere hands the event back to. See the passthrough below.
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  // State rather than a ref: the wheel listener below has to re-attach when this
  // element arrives, which a ref would not tell anyone about.
  const [windowEl, setWindowEl] = useState<HTMLDivElement | null>(null);
  // Subscribed, not read: a window restored from a file gets its fold rebuilt
  // *after* the descriptors reach the store, and that rebuild deliberately does
  // not write to the store. A plain read found nothing and never looked again.
  const source = useSyncExternalStore(
    subscribeInlineSimulationSources,
    useCallback(() => getInlineSimulationSource(simulation.id), [simulation.id])
  );

  /**
   * Inline windows are GPU-only. Bitmap presentation is what lets them share one
   * GL context, and the canvas-2D fallback cannot draw into a canvas that holds a
   * `bitmaprenderer` context — so without WebGL2 a window would show an empty box
   * with no explanation. Say so, and point at the workspace that can still run it.
   *
   * Asked of the worker, not the main thread: this window renders from a worker
   * GL context, and on WebKitGTK the main thread reports WebGL2 that the worker
   * does not have. Reading the main-thread answer is what made these windows
   * open blank on Linux instead of showing the badge below.
   *
   * `null` means the probe has not replied yet, which is not the same as "no" —
   * treating it as no would flash the badge at every user on every machine.
   */
  const gpuSupport = useWorkerGpuSupport();
  const gpuAvailable = gpuSupport === true;

  // Where this window's fold sits. Held in a ref so a 60fps frame stream does
  // not re-render this component; the store copy is throttled below purely so
  // the toolbar's readout and slider track it. Seeded from the stored value so a
  // window reloaded on refocus resumes where it was.
  //
  // A playhead rather than a bare number because the playback loop and the
  // solver both report a position and disagree at a restart -- see
  // `FoldPlayhead`, which is where that rule lives and is tested.
  const playheadRef = useRef(new FoldPlayhead(getInlineSimulationFoldPercent(simulation.id)));
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
      playheadRef.current.report(frame.foldPercent);
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

  /**
   * Whether this window's interior takes gestures of its own — drags orbit the
   * fold, and the wheel zooms it.
   */
  const interactive = focused && runtime.status === 'ready';

  /**
   * Who this window's wheel gesture belongs to, and where it goes if not here.
   *
   * A window takes pointer events while focused *and* while the shared selection
   * overlay is inert — which is any time a drawing tool is armed — and that also
   * makes it swallow the wheel: the crease-pattern canvas listens on the canvas
   * element, which is no ancestor of this one, so a gesture crossing a window
   * never reached it. Unfocused, that was a silent stall; focused, the pan turned
   * into a zoom of a window the user was only passing over.
   *
   * Both are the same question — whose gesture is this — and it is settled by the
   * first event of the burst rather than by what the cursor happens to be over
   * now. `claimWheelBurst` holds that answer; the same call in
   * {@link SimulatorViewport}'s own listener is what stops the fold zooming for a
   * gesture that belongs to the pattern.
   *
   * An unfocused window offers the crease pattern as the candidate rather than
   * itself: it has no zoom to give a gesture, so one starting here belongs to the
   * pattern from its first event. Forwarding is the shared hook every other
   * overlay over this canvas uses — see `CpTextAnnotationLayer`, which sits at
   * this exact spot in the tree — and it forwards to whichever surface owns the
   * burst, so a zoom begun on a *different* window survives the cursor crossing
   * this one.
   */
  useWheelPassthrough(windowEl, () => {
    const candidate = interactive && canvasEl ? canvasEl : resolveCpViewportCanvas();
    if (!candidate) return null;
    const { owner } = claimWheelBurst(candidate);
    // Nothing to forward when this window owns it: the viewport below already
    // zoomed on the event's way through.
    return owner === canvasEl ? null : owner;
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
      playheadRef.current.set(percent);
      setFoldPercent(percent);
    });
  }, [focused, playing, runtimeStatus, simulation.id, setFoldPercent]);

  // Advance the fold over time. The solver does the work in the worker, so this
  // only ever computes a number and hands it over.
  useEffect(() => {
    if (!focused || !playing || runtimeStatus !== 'ready') return;
    const playhead = playheadRef.current;
    // Playing from a complete fold starts over. The playhead rewinds its own
    // number and tells us to put the paper back to match.
    if (playhead.begin().rewound) runtime.reset();
    let previous: number | null = null;
    let raf = 0;
    const tick = (time: number) => {
      if (previous === null) previous = time;
      const elapsedSeconds = Math.min(0.08, (time - previous) / 1000);
      previous = time;
      const next = playhead.advance(
        elapsedSeconds,
        viewSettings.foldPlayPercentPerSecond
      );
      setFoldPercent(next);
      if (next >= 100) {
        onPlayingChange(false);
        return;
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      playhead.end();
    };
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

  // Publish this window's viewpoint verbs while it has focus, so the toolbar
  // hovering over it reaches the right one. Scoped exactly like the shortcuts
  // below and for the same reason: many windows can be mounted, only the focused
  // one is being driven, and the registry holds a single handle.
  useEffect(() => {
    if (!interactive) return;
    return registerSimulatorView({
      setUpright: () => viewportRef.current?.setUpright(),
    });
  }, [interactive]);

  // The same keymap the Simulate workspace uses, bound only while this window has
  // focus. The `simulator` scope it pushes sits ahead of `crease-pattern`, so
  // Space plays the fold here and still pans the canvas everywhere else.
  useSimulatorShortcuts({
    active: interactive,
    foldStepPercent: FOLD_STEP_PERCENT,
    handlers: {
      playPause: () => onPlayingChange(!playing),
      nudgeFold: (delta) => {
        onPlayingChange(false);
        // Read back rather than reusing the sum: the playhead is what clamps to
        // 0..100, so nudging past either end must not report past it either.
        playheadRef.current.set(playheadRef.current.value + delta);
        const next = playheadRef.current.value;
        setFoldPercent(next);
        publishInlineSimulationFold(simulation.id, next);
      },
      setFoldPercent: (percent) => {
        onPlayingChange(false);
        playheadRef.current.set(percent);
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
      playheadRef.current.set(0);
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

  /**
   * Offer this window's view to its floating toolbar, which is a sibling and
   * cannot reach the runtime directly.
   *
   * Registered while mounted rather than only while focused: an unfocused window
   * keeps its model loaded, so its view is still exportable.
   */
  const exportView = useSimulatorViewExport(runtime.exportSvg);
  useEffect(
    () => registerInlineSimulationExporter(simulation.id, exportView),
    [exportView, simulation.id]
  );

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
      ref={setWindowEl}
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
        interactive={interactive}
        claimsWheel={() => canvasEl !== null && claimWheelBurst(canvasEl).owner === canvasEl}
        gpuActive={runtime.gpuActive}
        bitmapPresent
        minDeviceSize={64}
        transparentBackground
        creaseWidthReferenceEdge={CREASE_REFERENCE_EDGE}
        creaseWidthShrinkExponent={CREASE_SHRINK_EXPONENT}
        viewSettings={viewSettings}
        pushCamera={pushCamera}
        pushRenderSettings={runtime.setRenderSettings}
        perfSurface="inline-window"
        className="cp-inline-simulation__canvas"
        ariaLabel={t(
          'panels:creasePattern.inlineSimulation.canvasAriaLabel',
          'Inline simulation. Drag to rotate.'
        )}
      />
      {badgeStyle && gpuSupport === false && (
        <span className="cp-inline-simulation__badge" style={badgeStyle}>
          {t(
            'panels:creasePattern.inlineSimulation.gpuUnavailable',
            'Needs WebGL2 — open in the Simulate workspace'
          )}
        </span>
      )}
      {badgeStyle && gpuAvailable && stale && (
        <span className="cp-inline-simulation__badge" style={badgeStyle}>
          {t('panels:creasePattern.inlineSimulation.outOfDate', 'Out of date')}
        </span>
      )}
      {badgeStyle && runtime.status === 'error' && (
        <span
          className="cp-inline-simulation__badge cp-inline-simulation__badge--error"
          style={badgeStyle}
        >
          {runtime.error ??
            t('panels:creasePattern.inlineSimulation.failed', 'Simulation failed')}
        </span>
      )}
    </div>
  );
}
