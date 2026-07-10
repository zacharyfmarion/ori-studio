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
import {
  LineHitIndex,
  circleRingIntersectsAabb,
  segmentIntersectsAabb,
} from './picking/lineHitIndex';
import type { ModelPoint, Rgba, Viewport } from './renderer/types';
import { cpSnapshotToScene, type CpLineSegmentInput } from './adapters/cpSnapshotToScene';
import { cpPointsToScene } from './adapters/cpPointsToScene';
import { resolveCpLineColor } from './adapters/cpLineColor';
import { resolveCpPointStyle } from './adapters/cpPointStyle';
import {
  cpFoldedToScene,
  foldedFigureUserBounds,
  type FoldedFigureBounds,
} from './adapters/cpFoldedToScene';
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
/** Click hit tolerances (CSS px). Points/vertices are small precise targets, so
    they win only on a tighter radius than the fatter line tolerance. */
const HIT_TOLERANCE_CSS = 8;
const POINT_HIT_TOLERANCE_CSS = 6;
const CLICK_MOVE_THRESHOLD = 4;

/** Grid colour: `--border-default` composited at 82% (matches the SVG grid line). */
const GRID_COLOR_VAR = '--border-default';
const GRID_COLOR_ALPHA = 0.82;
const GRID_FALLBACK: Rgba = [0.4, 0.43, 0.48, GRID_COLOR_ALPHA];

const dpr = () => Math.min(window.devicePixelRatio || 1, MAX_DPR);

/** A hit primitive from a click (vertices use their cpVertexId string). */
export type CpSelectHit =
  | { kind: 'line'; id: number }
  | { kind: 'point'; id: number }
  | { kind: 'vertex'; id: string }
  | { kind: 'circle'; id: number };

/** Ids touched by a marquee, by primitive type. */
export interface CpBoxSelection {
  lines: number[];
  points: number[];
  vertices: string[];
  circles: number[];
}

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
  /** Currently selected ids (lines/points/circles are 1-based; vertices are cpVertexId). */
  selectedLineIds: readonly number[];
  selectedPointIds: readonly number[];
  selectedVertexIds: readonly string[];
  selectedCircleIds: readonly number[];
  /** Per-vertex cpVertexId, parallel to `vertices`, for mapping a hit to an id. */
  vertexIds: readonly string[];
  /** Click-select callback: the hit primitive, or null for a background click. */
  onSelect: (hit: CpSelectHit | null, additive: boolean) => void;
  /** Marquee (box) select callback with the touched ids by type. */
  onBoxSelect: (sets: CpBoxSelection, additive: boolean) => void;
  /**
   * Drag a folded figure by `delta` SVG user units (cmd/ctrl-drag over it,
   * mirroring Oriedita). Called repeatedly during the drag with incremental
   * deltas.
   */
  onMoveFoldedFigure: (figureId: string, delta: { x: number; y: number }) => void;
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
  selectedPointIds,
  selectedVertexIds,
  selectedCircleIds,
  vertexIds,
  onSelect,
  onBoxSelect,
  onMoveFoldedFigure,
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

  // Spatial indices for click hit-testing. Points/vertices are indexed as
  // zero-length segments so the same distance query applies (id = index + 1).
  const hitIndex = useMemo(
    () => new LineHitIndex(lineSegments.map((s, i) => ({ id: i + 1, a: s.a, b: s.b }))),
    [lineSegments]
  );
  const vertexIndex = useMemo(
    () => new LineHitIndex(vertices.map((v, i) => ({ id: i + 1, a: v, b: v }))),
    [vertices]
  );
  const pointIndex = useMemo(
    () => new LineHitIndex(points.map((p, i) => ({ id: i + 1, a: p, b: p }))),
    [points]
  );
  // Folded-figure pick boxes (SVG user coords) for cmd-drag move, in draw order.
  const foldedBounds = useMemo<FoldedFigureBounds[]>(
    () => foldedFigureUserBounds(foldedFigures),
    [foldedFigures]
  );

  // Per-frame / per-interaction inputs the effect reads without re-subscribing.
  const live = {
    modelToSvg,
    svgToModel,
    lineWidth,
    grid,
    gridVisible,
    contentBounds,
    hitIndex,
    vertexIndex,
    pointIndex,
    lineSegments,
    points,
    vertices,
    vertexIds,
    circles,
    circleRadiusToSvg,
    foldedBounds,
    onSelect,
    onBoxSelect,
    onMoveFoldedFigure,
  };
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
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
        resolveCpPointStyle(document.documentElement, pointSize),
        {
          pointIdx: new Set(selectedPointIds.map((id) => id - 1)),
          vertexIdx: new Set(
            vertexIds.reduce<number[]>((acc, vid, j) => {
              if (selectedVertexIds.includes(vid)) acc.push(j);
              return acc;
            }, [])
          ),
          circleIdx: new Set(selectedCircleIds.map((id) => id - 1)),
          color: readCssVarColor(document.documentElement, SELECTION_COLOR_VAR, SELECTION_FALLBACK),
        }
      ),
      folded: cpFoldedToScene(foldedFigures),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      lineSegments,
      selectedLineIds,
      selectedPointIds,
      selectedVertexIds,
      selectedCircleIds,
      vertexIds,
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
    // a plain drag marquee-selects.
    const clientToUser = (clientX: number, clientY: number): ModelPoint | null => {
      const cam = cameraRef.current;
      if (!cam) return null;
      const ratio = dpr();
      const rect = canvas.getBoundingClientRect();
      return unprojectDevicePoint(
        userCameraToView(cam, viewportOf(ratio)),
        (clientX - rect.left) * ratio,
        (clientY - rect.top) * ratio
      );
    };
    const clientToModel = (clientX: number, clientY: number): ModelPoint | null => {
      const userPt = clientToUser(clientX, clientY);
      return userPt ? liveRef.current.svgToModel(userPt) : null;
    };

    // Topmost folded figure whose pick box contains the cursor (draw order:
    // later figures render on top, so scan back-to-front).
    const figureAt = (clientX: number, clientY: number): string | null => {
      const u = clientToUser(clientX, clientY);
      if (!u) return null;
      const bounds = liveRef.current.foldedBounds;
      for (let i = bounds.length - 1; i >= 0; i--) {
        const b = bounds[i].bounds;
        if (u.x >= b.minX && u.x <= b.maxX && u.y >= b.minY && u.y <= b.maxY) {
          return bounds[i].id;
        }
      }
      return null;
    };

    const modelToleranceOf = (cssTol: number): number => {
      const cam = cameraRef.current;
      if (!cam) return cssTol;
      const scale = viewTransformScale(
        modelViewFromCamera(cam, viewportOf(dpr()), liveRef.current.modelToSvg)
      );
      return (cssTol * dpr()) / Math.max(1e-6, scale);
    };

    // Pick the primitive under the cursor. Vertices/points win only on a tight
    // radius (small precise targets) so a click near a junction still lets you
    // grab the crease; circles match near their ring.
    const hitTest = (clientX: number, clientY: number): CpSelectHit | null => {
      const m = clientToModel(clientX, clientY);
      if (!m) return null;
      const l = liveRef.current;
      const ptTol = modelToleranceOf(POINT_HIT_TOLERANCE_CSS);
      const lineTol = modelToleranceOf(HIT_TOLERANCE_CSS);

      const v = l.vertexIndex.query(m.x, m.y, ptTol);
      if (v > 0) return { kind: 'vertex', id: l.vertexIds[v - 1] };
      const p = l.pointIndex.query(m.x, m.y, ptTol);
      if (p > 0) return { kind: 'point', id: p };
      const line = l.hitIndex.query(m.x, m.y, lineTol);
      if (line > 0) return { kind: 'line', id: line };
      for (let i = 0; i < l.circles.length; i++) {
        const c = l.circles[i];
        if (Math.abs(Math.hypot(m.x - c.x, m.y - c.y) - c.r) <= lineTol) {
          return { kind: 'circle', id: i + 1 };
        }
      }
      return null;
    };

    // Transient marquee rectangle rendered as a plain DOM overlay.
    const marquee = document.createElement('div');
    marquee.className = 'cp-webgl-marquee';
    marquee.style.display = 'none';
    canvas.parentElement?.appendChild(marquee);
    const updateMarquee = (clientX: number, clientY: number) => {
      const parent = canvas.parentElement?.getBoundingClientRect();
      if (!parent) return;
      marquee.style.display = 'block';
      marquee.style.left = `${Math.min(pressX, clientX) - parent.left}px`;
      marquee.style.top = `${Math.min(pressY, clientY) - parent.top}px`;
      marquee.style.width = `${Math.abs(clientX - pressX)}px`;
      marquee.style.height = `${Math.abs(clientY - pressY)}px`;
    };
    const boxSelect = (clientX: number, clientY: number, additive: boolean) => {
      const p1 = clientToModel(pressX, pressY);
      const p2 = clientToModel(clientX, clientY);
      if (!p1 || !p2) return;
      const box = {
        minX: Math.min(p1.x, p2.x),
        maxX: Math.max(p1.x, p2.x),
        minY: Math.min(p1.y, p2.y),
        maxY: Math.max(p1.y, p2.y),
      };
      const l = liveRef.current;
      const inBox = (p: ModelPoint) =>
        p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
      const sets: CpBoxSelection = { lines: [], points: [], vertices: [], circles: [] };
      // Crossing marquee for lines; enclosed centres for points/vertices/circles.
      l.lineSegments.forEach((s, i) => {
        if (segmentIntersectsAabb(s.a, s.b, box)) sets.lines.push(i + 1);
      });
      l.points.forEach((p, i) => {
        if (inBox(p)) sets.points.push(i + 1);
      });
      l.vertices.forEach((v, j) => {
        if (inBox(v)) sets.vertices.push(l.vertexIds[j]);
      });
      l.circles.forEach((c, i) => {
        if (circleRingIntersectsAabb(c.x, c.y, c.r, box)) sets.circles.push(i + 1);
      });
      l.onBoxSelect(sets, additive);
    };

    let panning = false;
    let selecting = false;
    let moved = false;
    // Active folded-figure drag: figure id + last cursor position in user coords.
    let movingFigure: string | null = null;
    let lastUserX = 0;
    let lastUserY = 0;
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
        // cmd/ctrl over a folded figure grabs it to move; otherwise it pans.
        const figureId = figureAt(e.clientX, e.clientY);
        const u = figureId ? clientToUser(e.clientX, e.clientY) : null;
        if (figureId && u) {
          movingFigure = figureId;
          lastUserX = u.x;
          lastUserY = u.y;
        } else {
          panning = true;
        }
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
      if (movingFigure) {
        const u = clientToUser(e.clientX, e.clientY);
        if (u) {
          liveRef.current.onMoveFoldedFigure(movingFigure, {
            x: u.x - lastUserX,
            y: u.y - lastUserY,
          });
          lastUserX = u.x;
          lastUserY = u.y;
          // The store update re-renders via the foldedFigures prop; no manual
          // draw here (and the camera has not moved, so user coords stay valid).
        }
      } else if (panning && cameraRef.current) {
        const ratio = dpr();
        panUserCamera(cameraRef.current, (e.clientX - lastX) * ratio, (e.clientY - lastY) * ratio);
        lastX = e.clientX;
        lastY = e.clientY;
        renderNow();
      } else if (selecting && moved) {
        updateMarquee(e.clientX, e.clientY);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (selecting) {
        if (moved) boxSelect(e.clientX, e.clientY, e.shiftKey);
        else liveRef.current.onSelect(hitTest(e.clientX, e.clientY), e.shiftKey);
      }
      marquee.style.display = 'none';
      panning = false;
      selecting = false;
      movingFigure = null;
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
      marquee.remove();
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
