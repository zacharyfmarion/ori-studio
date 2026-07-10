import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { createReglRenderer } from './renderer/reglRenderer';
import type { CpRenderer } from './renderer/CpRenderer';
import { readCssVarColor } from './renderer/cssColor';
import {
  fitUserCamera,
  modelViewFromCamera,
  panUserCamera,
  seedUserCamera,
  unprojectDevicePoint,
  userCameraToView,
  viewTransformScale,
  zoomUserCameraAt,
  type UserBounds,
  type UserCamera,
} from './renderer/camera';
import { LineHitIndex } from './picking/lineHitIndex';
import type { ModelPoint, Rgba, Viewport } from './renderer/types';
import { cpSnapshotToScene, type CpLineSegmentInput } from './adapters/cpSnapshotToScene';
import { cpPointsToScene } from './adapters/cpPointsToScene';
import { resolveCpLineColor } from './adapters/cpLineColor';
import { resolveCpPointStyle } from './adapters/cpPointStyle';
import { cpFoldedToScene } from './adapters/cpFoldedToScene';
import type { OristudioCpFoldedFigureEntry } from '../engine/oristudioCpTypes';
import {
  cpGridLinesToStrokes,
  gridBoundsKey,
  visibleGridBounds,
} from './adapters/cpGridToScene';
import { sampleView } from './svgViewBridge';
import { orieditaGridLinesForModelBounds } from '../lib/creasePatternViewport';
import type { OristudioCpGridMetadata } from '../engine/oristudioCpTypes';
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

/** Point/vertex outline width in CSS px (SVG non-scaling stroke ~1.4). */
const POINT_OUTLINE_CSS = 1.4;

/** Selection highlight: accent colour + a wider stroke. */
const SELECTION_COLOR_VAR = '--accent-primary';
const SELECTION_FALLBACK: Rgba = [0.4, 0.6, 1, 1];
const SELECTION_WIDTH_MUL = 2.6;
/** Click hit tolerance and click-vs-drag threshold, in CSS px. */
const HIT_TOLERANCE_CSS = 8;
const CLICK_MOVE_THRESHOLD = 4;

/** Grid colour: `--border-default` composited at 82% (matches the SVG grid line). */
const GRID_COLOR_VAR = '--border-default';
const GRID_COLOR_ALPHA = 0.82;
const GRID_FALLBACK: Rgba = [0.4, 0.43, 0.48, GRID_COLOR_ALPHA];

const dpr = () => Math.min(window.devicePixelRatio || 1, MAX_DPR);

export interface CreasePatternWebglCanvasProps {
  className?: string;
  /** Crease-pattern line segments in model coordinates. */
  lineSegments: readonly CpLineSegmentInput[];
  /** The SVG the WebGL overlay mirrors for pan/zoom (Phase-1 bridge). */
  svgRef: RefObject<SVGSVGElement | null>;
  /** Model → SVG user-coordinate mapping (matches the SVG renderer). */
  modelToSvg: (point: ModelPoint) => ModelPoint;
  /** SVG user → model mapping (inverse of {@link modelToSvg}) for hit-testing. */
  svgToModel: (point: ModelPoint) => ModelPoint;
  /** Currently selected line ids (1-based, matching the SVG's index+1). */
  selectedLineIds: readonly number[];
  /** Click-select callback: a line id, or null for a background click. */
  onSelectLine: (lineId: number | null, additive: boolean) => void;
  /** Assignment colour mode. */
  mode: 'mvf' | 'agrh';
  /** `--cp-line-width` value driving stroke thickness. */
  lineWidth: number;
  /** Explicit crease points in model coordinates. */
  points: readonly ModelPoint[];
  /** Vertices (line-endpoint markers) in model coordinates. */
  vertices: readonly ModelPoint[];
  /** `--cp-point-size` value driving point/vertex radius. */
  pointSize: number;
  /** Circle-packing circles in model coordinates (radius in model units). */
  circles: readonly { x: number; y: number; r: number }[];
  /** Model radius → SVG user-unit radius (matches the SVG renderer). */
  circleRadiusToSvg: (radius: number) => number;
  /** Generated folded figures (render-snapshot primitives). */
  foldedFigures: readonly OristudioCpFoldedFigureEntry[];
  /** Grid parameters, or null when there is no grid. */
  grid: OristudioCpGridMetadata | null;
  /** Whether the grid is shown. */
  gridVisible: boolean;
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
  svgToModel,
  selectedLineIds,
  onSelectLine,
  mode,
  lineWidth,
  points,
  vertices,
  pointSize,
  circles,
  circleRadiusToSvg,
  foldedFigures,
  grid,
  gridVisible,
}: CreasePatternWebglCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CpRenderer | null>(null);
  const renderNowRef = useRef<() => void>(() => {});
  const gridKeyRef = useRef<string | null>(null);
  // Owned camera (Phase 2). Null until seeded from the SVG's current fit.
  const cameraRef = useRef<UserCamera | null>(null);
  const currentTheme = useThemeStore((state) => state.currentTheme);

  // Content bounds in SVG user coords, for the initial camera fit (independent
  // of the SVG's own fixed-rect fit, which mis-centres imported cameras).
  const contentBounds = useMemo<UserBounds | null>(() => {
    if (lineSegments.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const seg of lineSegments) {
      for (const p of [seg.a, seg.b]) {
        const u = modelToSvg(p);
        if (u.x < minX) minX = u.x;
        if (u.y < minY) minY = u.y;
        if (u.x > maxX) maxX = u.x;
        if (u.y > maxY) maxY = u.y;
      }
    }
    return { minX, minY, maxX, maxY };
  }, [lineSegments, modelToSvg]);

  // Spatial index for click hit-testing (rebuilt when the geometry changes).
  const hitIndex = useMemo(
    () => new LineHitIndex(lineSegments.map((s, i) => ({ id: i + 1, a: s.a, b: s.b }))),
    [lineSegments]
  );

  // Per-frame / per-interaction inputs the effect reads without re-subscribing.
  const liveRef = useRef({
    modelToSvg,
    svgToModel,
    lineWidth,
    grid,
    gridVisible,
    contentBounds,
    hitIndex,
    onSelectLine,
  });
  useEffect(() => {
    liveRef.current = {
      modelToSvg,
      svgToModel,
      lineWidth,
      grid,
      gridVisible,
      contentBounds,
      hitIndex,
      onSelectLine,
    };
    // Inputs affecting stroke thickness / mapping changed — redraw.
    renderNowRef.current();
  });

  // Force a grid rebuild when its params, visibility, or theme colour change.
  useEffect(() => {
    gridKeyRef.current = null;
    renderNowRef.current();
  }, [grid, gridVisible, currentTheme]);

  // Build GPU-ready geometry whenever the segments or mode change. `currentTheme`
  // is an intentional trigger: colours are resolved from theme CSS variables, so
  // the scene must be rebuilt when the theme switches even though its value is
  // not read directly here.
  const scene = useMemo(
    () => ({
      ...cpSnapshotToScene(
        lineSegments,
        (color) => resolveCpLineColor(color, mode, document.documentElement),
        {
          selected: new Set(selectedLineIds),
          color: readCssVarColor(document.documentElement, SELECTION_COLOR_VAR, SELECTION_FALLBACK),
          widthMul: SELECTION_WIDTH_MUL,
        }
      ),
      points: cpPointsToScene(
        points,
        vertices,
        circles.map((c) => ({ center: { x: c.x, y: c.y }, radius: circleRadiusToSvg(c.r) })),
        resolveCpPointStyle(document.documentElement, pointSize)
      ),
      folded: cpFoldedToScene(foldedFigures),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      lineSegments,
      selectedLineIds,
      points,
      vertices,
      circles,
      circleRadiusToSvg,
      foldedFigures,
      mode,
      pointSize,
      currentTheme,
    ]
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

    const viewportOf = (ratio: number): Viewport => ({
      width: canvas.width,
      height: canvas.height,
      dpr: ratio,
    });

    // Seed the owned camera once. Prefer fitting the actual geometry bounds
    // (correct for any imported camera); fall back to the SVG's current fit if
    // there is no geometry yet.
    const ensureCamera = (viewport: Viewport, ratio: number): UserCamera | null => {
      if (cameraRef.current) return cameraRef.current;
      const bounds = liveRef.current.contentBounds;
      if (bounds) {
        cameraRef.current = fitUserCamera(bounds, viewport);
        return cameraRef.current;
      }
      const svg = svgRef.current;
      if (!svg) return null;
      const sampled = sampleView(svg, canvas, liveRef.current.modelToSvg, ratio);
      if (!sampled) return null;
      const seeded = seedUserCamera(sampled.userView, viewport);
      if (!seeded) return null;
      cameraRef.current = seeded;
      return seeded;
    };

    const renderNow = () => {
      const ratio = dpr();
      const viewport = viewportOf(ratio);
      const cam = ensureCamera(viewport, ratio);
      if (!cam) return;

      const view = modelViewFromCamera(cam, viewport, liveRef.current.modelToSvg);
      const userView = userCameraToView(cam, viewport);

      // Grid is view-dependent: regenerate its lines when the visible region
      // (or params/theme, via gridKeyRef reset) changes.
      const gridMeta = liveRef.current.grid;
      if (gridMeta && liveRef.current.gridVisible) {
        const bounds = visibleGridBounds(view, canvas.width, canvas.height);
        if (bounds) {
          const key = gridBoundsKey(bounds, gridMeta);
          if (key !== gridKeyRef.current) {
            gridKeyRef.current = key;
            const lines = orieditaGridLinesForModelBounds(bounds, gridMeta);
            const color = readCssVarColor(canvas, GRID_COLOR_VAR, GRID_FALLBACK);
            renderer.setGrid(
              cpGridLinesToStrokes(lines, [color[0], color[1], color[2], GRID_COLOR_ALPHA])
            );
          }
        }
      } else if (gridKeyRef.current !== null) {
        gridKeyRef.current = null;
        renderer.setGrid(null);
      }

      renderer.render({
        clearColor: readCssVarColor(canvas, CANVAS_BG_VAR, FALLBACK_CLEAR),
        view,
        userView,
        // Crease width (1.5 * lineWidth user units) and point radii (user units)
        // scale by device-px-per-user = camera zoom.
        strokeWidthPx: CREASE_WIDTH_FACTOR * liveRef.current.lineWidth * cam.zoom,
        userScalePx: cam.zoom,
        pointOutlinePx: POINT_OUTLINE_CSS * ratio,
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

    // --- Pointer interaction on the canvas ---
    // cmd/ctrl + drag pans; a plain click selects the crease under the cursor;
    // a plain drag is reserved for tools (later phases).
    const hitTestLine = (clientX: number, clientY: number): number => {
      const cam = cameraRef.current;
      if (!cam) return -1;
      const ratio = dpr();
      const viewport = viewportOf(ratio);
      const rect = canvas.getBoundingClientRect();
      const userPt = unprojectDevicePoint(
        userCameraToView(cam, viewport),
        (clientX - rect.left) * ratio,
        (clientY - rect.top) * ratio
      );
      if (!userPt) return -1;
      const modelPt = liveRef.current.svgToModel(userPt);
      const scale = viewTransformScale(modelViewFromCamera(cam, viewport, liveRef.current.modelToSvg));
      const tolModel = (HIT_TOLERANCE_CSS * ratio) / Math.max(1e-6, scale);
      return liveRef.current.hitIndex.query(modelPt.x, modelPt.y, tolModel);
    };

    let panning = false;
    let selecting = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;
    let pressX = 0;
    let pressY = 0;
    const onPointerDown = (e: PointerEvent) => {
      lastX = pressX = e.clientX;
      lastY = pressY = e.clientY;
      moved = false;
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        panning = true;
      } else {
        selecting = true;
      }
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (
        Math.abs(e.clientX - pressX) > CLICK_MOVE_THRESHOLD ||
        Math.abs(e.clientY - pressY) > CLICK_MOVE_THRESHOLD
      ) {
        moved = true;
      }
      if (panning && cameraRef.current) {
        const ratio = dpr();
        panUserCamera(cameraRef.current, (e.clientX - lastX) * ratio, (e.clientY - lastY) * ratio);
        lastX = e.clientX;
        lastY = e.clientY;
        renderNow();
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (selecting && !moved) {
        const id = hitTestLine(e.clientX, e.clientY);
        liveRef.current.onSelectLine(id > 0 ? id : null, e.shiftKey);
      }
      panning = false;
      selecting = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = cameraRef.current;
      if (!cam) return;
      const ratio = dpr();
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * ratio;
      const cy = (e.clientY - rect.top) * ratio;
      zoomUserCameraAt(cam, viewportOf(ratio), cx, cy, Math.pow(1.0015, -e.deltaY));
      renderNow();
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      renderNowRef.current = () => {};
      cameraRef.current = null;
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
