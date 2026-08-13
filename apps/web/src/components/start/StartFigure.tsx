import { useCallback, useEffect, useRef, useState } from 'react';
import type { RenderSettings } from '@treemaker/origami-simulator';
import { DEFAULT_SIMULATOR_SETTINGS } from '../../lib/simulatorSettings';
import { useThemeStore } from '../../store/themeStore';
import { resolveRenderSettings } from '../../simulator/simulatorPalette';
import { ANALYTICS_EVENTS, track } from '../../analytics';
import { START_FIGURE, loadStartFigureAsset, type StartFigureAsset } from './startFigureAsset';
import { startFigurePaperSettings } from './startFigurePaper';
import {
  advanceStartFigureOrbit,
  beginStartFigureDrag,
  dragStartFigureOrbit,
  endStartFigureDrag,
  initialStartFigureOrbit,
  type StartFigureOrbitConfig,
  type StartFigureOrbitState,
} from './startFigureOrbit';
import type { StartFigureMesh } from './startFigureMesh';

/**
 * The start screen's slowly turning 3D folded figure.
 *
 * Three things keep this from being an expensive decoration:
 *
 * - **The fold is frozen.** `scripts/generate-start-figure.mjs` ran the kernel's
 *   exact fold — the `G` key's own `Fold3dSession` — once, offline. Nothing here
 *   folds, loads wasm, or touches the engine, so the figure is on screen and
 *   moving while the CP engine is still instantiating.
 * - **A frame is a uniform change and a draw.** `MeshRenderer` reads vertices
 *   from a texture written once at load, so nothing is uploaded per frame.
 * - **It starts late and stops often.** The GL module is dynamically imported
 *   when the browser is idle, and the loop does not run while the tab is hidden
 *   or the figure is scrolled out of view.
 *
 * The static image stays mounted underneath the whole time. It is the first
 * paint, and it is the permanent answer on a machine that cannot give us WebGL2
 * — two states, not a third rendering path for something decorative.
 */

/**
 * How long to wait for the browser to go idle before pulling in the renderer.
 *
 * The welcome screen is on screen precisely while the wasm engine is
 * instantiating, which is the worst moment to compete for the main thread; the
 * timeout only bounds how long the figure is missing if idle never comes.
 */
const IDLE_TIMEOUT_MS = 1_500;

/**
 * Frame edge, in device pixels, the crease width is calibrated for.
 *
 * The figure is a small object beside text, not a viewport, so its linework has
 * to shrink with it — `RenderSettings.creaseWidthReferenceEdge` is the knob that
 * exists for exactly this, and an inline simulation window uses it the same way.
 */
const CREASE_WIDTH_REFERENCE_EDGE = 640;

/**
 * One ink for every crease, rather than the editor's mountain/valley red and
 * blue.
 *
 * Colour is the right default in the Simulate workspace, where the reader is
 * studying a fold and the direction of each crease is information. Here the
 * figure is 320px of decoration beside a heading: at that size 246 creases in
 * two saturated colours read as noise over the form, and the form is the whole
 * point. Mono takes its ink from `--text-primary`, so it also stays legible in
 * both themes without a second decision.
 */
const FIGURE_CREASE_STYLE = 'mono' as const;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function StartFigure() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const meshRef = useRef<StartFigureMesh | null>(null);
  const orbitRef = useRef<StartFigureOrbitState | null>(null);
  const configRef = useRef<StartFigureOrbitConfig | null>(null);
  const pitchRef = useRef<number | null>(null);
  // Resolved once per theme change, never inside the frame loop: reading it is a
  // getComputedStyle, and it only moves when the theme does.
  const settingsRef = useRef<RenderSettings | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastFrameMsRef = useRef<number>(0);
  const dragRef = useRef<{ pointerId: number; x: number } | null>(null);
  const [live, setLive] = useState(false);

  /** Re-read the theme tokens and redraw. */
  const refreshPaint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const styles = getComputedStyle(canvas);
    settingsRef.current = resolveRenderSettings(
      styles,
      {
        ...DEFAULT_SIMULATOR_SETTINGS,
        creaseStyle: FIGURE_CREASE_STYLE,
        ...startFigurePaperSettings(styles),
      },
      {
        // The start screen owns the backdrop; the figure composites onto it.
        transparentBackground: true,
        creaseWidthReferenceEdge: CREASE_WIDTH_REFERENCE_EDGE,
      }
    );
  }, []);

  const draw = useCallback(() => {
    const mesh = meshRef.current;
    const orbit = orbitRef.current;
    const settings = settingsRef.current;
    const pitch = pitchRef.current;
    if (!mesh || !orbit || !settings || pitch === null) return;
    // Pitch is read from the asset and never from the orbit, because nothing can
    // change it — see the header of `startFigureOrbit.ts` for why it must be
    // exactly what the asset says.
    mesh.render({ yaw: orbit.yaw, pitch }, settings);
  }, []);

  const stopLoop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const startLoop = useCallback(() => {
    if (frameRef.current !== null || !meshRef.current) return;
    lastFrameMsRef.current = performance.now();
    const tick = (now: number) => {
      frameRef.current = requestAnimationFrame(tick);
      const mesh = meshRef.current;
      const config = configRef.current;
      const orbit = orbitRef.current;
      if (!mesh || !config || !orbit) return;
      // A tab restored after minutes away reports one enormous delta; advancing
      // by it would teleport the figure across its sweep on the first frame back.
      const elapsed = Math.min(100, now - lastFrameMsRef.current);
      lastFrameMsRef.current = now;
      orbitRef.current = advanceStartFigureOrbit(orbit, elapsed, config);
      draw();
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [draw]);

  const teardown = useCallback(() => {
    stopLoop();
    meshRef.current?.dispose();
    meshRef.current = null;
    setLive(false);
  }, [stopLoop]);

  // Load the asset and the renderer, once the browser has a moment.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let idle: number | null = null;

    const begin = async () => {
      let asset: StartFigureAsset | null;
      try {
        asset = await loadStartFigureAsset(START_FIGURE.url, controller.signal);
      } catch {
        asset = null;
      }
      if (cancelled) return;
      if (!asset) {
        track(ANALYTICS_EVENTS.startFigureFallback, { reason: 'asset_failed' });
        return;
      }

      const { StartFigureMesh } = await import('./startFigureMesh');
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;

      const mesh = StartFigureMesh.create(canvas, asset);
      if (!mesh) {
        track(ANALYTICS_EVENTS.startFigureFallback, { reason: 'no_webgl2' });
        return;
      }
      mesh.onContextLost(() => {
        track(ANALYTICS_EVENTS.startFigureFallback, { reason: 'context_lost' });
        teardown();
      });

      configRef.current = { yaw: asset.view.yaw, reducedMotion: prefersReducedMotion() };
      pitchRef.current = asset.view.pitch;
      orbitRef.current = initialStartFigureOrbit(configRef.current);
      meshRef.current = mesh;
      const rect = canvas.getBoundingClientRect();
      mesh.resize(rect.width, rect.height, Math.max(1, window.devicePixelRatio || 1));
      refreshPaint();
      draw();
      setLive(true);
      startLoop();
    };

    // `requestIdleCallback` is typed as always present but is not (Safari only
    // shipped it in 17), so this is a runtime check the types cannot express.
    const idleAvailable = typeof window.requestIdleCallback === 'function';
    idle = idleAvailable
      ? window.requestIdleCallback(() => void begin(), { timeout: IDLE_TIMEOUT_MS })
      : window.setTimeout(() => void begin(), 0);

    return () => {
      cancelled = true;
      controller.abort();
      if (idle !== null) {
        if (idleAvailable) window.cancelIdleCallback(idle);
        else window.clearTimeout(idle);
      }
      teardown();
    };
  }, [draw, refreshPaint, startLoop, teardown]);

  // The palette lives in CSS custom properties, so it has to be re-read whenever
  // the theme moves. Driven off the **store**, not a DOM observer: `applyTheme`
  // writes `root.style` and `data-theme-type` / `data-theme-name`, and never
  // touches `class` or `data-theme` — so the attribute observer this first used
  // (copied from `SimulatorViewport`, which still has it) fired for nothing a
  // real theme switch does. The store is the thing that actually changed.
  //
  // `currentTheme` is a new object per change and `applyTheme` runs inside the
  // store's setter, so by the time this effect re-runs the custom properties are
  // already the new ones.
  const currentTheme = useThemeStore((state) => state.currentTheme);
  useEffect(() => {
    if (!live) return;
    refreshPaint();
    draw();
  }, [live, currentTheme, refreshPaint, draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!live || !canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      const mesh = meshRef.current;
      if (!rect || !mesh) return;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      if (mesh.resize(rect.width, rect.height, dpr)) draw();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [live, draw]);

  // Nothing to look at, nothing to draw: a hidden tab or a scrolled-away figure
  // must not keep a 60fps loop and a GPU busy for a decoration nobody can see.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!live || !canvas) return;
    let visible = document.visibilityState !== 'hidden';
    let onScreen = true;
    const sync = () => (visible && onScreen ? startLoop() : stopLoop());

    const onVisibility = () => {
      visible = document.visibilityState !== 'hidden';
      sync();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            onScreen = entry?.isIntersecting ?? true;
            sync();
          });
    observer?.observe(canvas);
    sync();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
    };
  }, [live, startLoop, stopLoop]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!meshRef.current || !orbitRef.current) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX };
    orbitRef.current = beginStartFigureDrag(orbitRef.current);
    // Capture last, and allowed to fail. It only buys tracking once the pointer
    // leaves the canvas; letting it throw first would abort the handler and lose
    // the drag entirely, which is a much worse trade than a drag that stops at
    // the edge.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* no capture: the drag still works while the pointer is over the canvas */
    }
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      const orbit = orbitRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !orbit) return;
      orbitRef.current = dragStartFigureOrbit(orbit, event.clientX - drag.x);
      drag.x = event.clientX;
      // Drawn here rather than left to the loop: under reduced motion the loop is
      // running but `advance` is a no-op, so a drag would not otherwise repaint.
      draw();
    },
    [draw]
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (orbitRef.current) orbitRef.current = endStartFigureDrag(orbitRef.current);
  }, []);

  return (
    <div className="start-figure" data-live={live || undefined}>
      <img
        className="start-figure__fallback"
        src={START_FIGURE.fallbackUrl}
        alt=""
        decoding="async"
      />
      <canvas
        ref={canvasRef}
        className="start-figure__canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
}
