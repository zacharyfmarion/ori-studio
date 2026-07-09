import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { createReglRenderer } from './renderer/reglRenderer';
import type { CpRenderer } from './renderer/CpRenderer';
import { readCssVarColor } from './renderer/cssColor';
import { viewTransformsEqual } from './renderer/camera';
import type { ModelPoint, Rgba, ViewTransform } from './renderer/types';
import { cpSnapshotToScene, type CpLineSegmentInput } from './adapters/cpSnapshotToScene';
import { resolveCpLineColor } from './adapters/cpLineColor';
import { sampleView } from './svgViewBridge';
import { useThemeStore } from '../store/themeStore';

/** Cap DPR at 2 — matches the perf budget and avoids 3x/4x fill on hidpi. */
const MAX_DPR = 2;

/**
 * The editable SVG canvas is transparent, so the colour behind it is the panel
 * body background (`--bg-primary`). Clearing the WebGL surface to the same
 * variable keeps the two renderers visually identical when toggling.
 */
const CANVAS_BG_VAR = '--bg-primary';

/** Fallback if the CSS variable is missing (roughly a neutral dark panel). */
const FALLBACK_CLEAR: Rgba = [0.157, 0.172, 0.204, 1];

/** SVG editable crease width: `calc(var(--cp-line-width) * 1.5px)` in user units. */
const CREASE_WIDTH_FACTOR = 1.5;

const dpr = () => Math.min(window.devicePixelRatio || 1, MAX_DPR);

export interface CreasePatternWebglCanvasProps {
  className?: string;
  /** Crease-pattern line segments in model coordinates. */
  lineSegments: readonly CpLineSegmentInput[];
  /** The SVG the WebGL overlay mirrors for pan/zoom (Phase-1 bridge). */
  svgRef: RefObject<SVGSVGElement | null>;
  /** Model → SVG user-coordinate mapping (matches the SVG renderer). */
  modelToSvg: (point: ModelPoint) => ModelPoint;
  /** Assignment colour mode. */
  mode: 'mvf' | 'agrh';
  /** `--cp-line-width` value driving stroke thickness. */
  lineWidth: number;
}

/**
 * WebGL crease-pattern edit surface (behind the `webgl` dev flag).
 *
 * Step 2 of the SVG -> WebGL migration: renders the crease lines read-only,
 * mirroring the SVG's pan/zoom via {@link sampleView} so the two are directly
 * comparable. Interaction and the owned camera arrive in later steps. See
 * implementation-plans/webgl-canvas-workspace-migration.md.
 *
 * Rendering is driven two ways: synchronously on input changes (mount, resize,
 * geometry, theme) so the surface is always current, plus a requestAnimationFrame
 * loop that re-renders while the mirrored SVG transform changes (i.e. during a
 * live pan/zoom). The synchronous path means a backgrounded tab — where rAF is
 * throttled — still shows the correct static frame.
 */
export function CreasePatternWebglCanvas({
  className,
  lineSegments,
  svgRef,
  modelToSvg,
  mode,
  lineWidth,
}: CreasePatternWebglCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CpRenderer | null>(null);
  const renderNowRef = useRef<() => void>(() => {});
  const currentTheme = useThemeStore((state) => state.currentTheme);

  // Per-frame inputs the render paths read without re-subscribing.
  const liveRef = useRef({ modelToSvg, lineWidth });
  useEffect(() => {
    liveRef.current = { modelToSvg, lineWidth };
    // Inputs affecting stroke thickness / mapping changed — redraw.
    renderNowRef.current();
  });

  // Build GPU-ready geometry whenever the segments or mode change. `currentTheme`
  // is an intentional trigger: colours are resolved from theme CSS variables, so
  // the scene must be rebuilt when the theme switches even though its value is
  // not read directly here.
  const scene = useMemo(
    () =>
      cpSnapshotToScene(lineSegments, (color) =>
        resolveCpLineColor(color, mode, document.documentElement)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lineSegments, mode, currentTheme]
  );

  // Renderer lifecycle + render loop (once per mount).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: CpRenderer;
    try {
      renderer = createReglRenderer(canvas);
    } catch (error) {
      console.error('[cp-webgl] failed to initialise WebGL renderer', error);
      return;
    }
    rendererRef.current = renderer;

    let rafId = 0;
    let lastView: ViewTransform | null = null;

    const renderNow = () => {
      const svg = svgRef.current;
      if (!svg) return;
      const ratio = dpr();
      const sampled = sampleView(svg, canvas, liveRef.current.modelToSvg, ratio);
      if (!sampled) return;
      lastView = sampled.view;
      renderer.render({
        clearColor: readCssVarColor(canvas, CANVAS_BG_VAR, FALLBACK_CLEAR),
        view: sampled.view,
        strokeWidthPx: CREASE_WIDTH_FACTOR * liveRef.current.lineWidth * sampled.userScale * ratio,
      });
    };
    renderNowRef.current = renderNow;

    const applySize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = dpr();
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      renderer.resize({ width, height, dpr: ratio });
      renderNow();
    };

    const observer = new ResizeObserver(applySize);
    observer.observe(canvas);
    applySize();

    // Mirror live pan/zoom: while the SVG transform changes, keep redrawing.
    const frame = () => {
      rafId = requestAnimationFrame(frame);
      const svg = svgRef.current;
      if (!svg) return;
      const sampled = sampleView(svg, canvas, liveRef.current.modelToSvg, dpr());
      if (!sampled || (lastView && viewTransformsEqual(lastView, sampled.view))) return;
      renderNow();
    };
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      renderNowRef.current = () => {};
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [svgRef]);

  // Upload geometry whenever it is rebuilt, then redraw immediately.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setScene(scene);
    renderNowRef.current();
  }, [scene]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
