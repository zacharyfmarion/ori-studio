import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { vertexPointsFromTransport } from '../../engine/oristudioCpGeometry';
import type { Point } from '../../lib/geometry';
import { cpModelToSvg, type OristudioCpLineStyle } from '../../lib/creasePatternViewport';
import { cpLineStyleDashPatterns } from '../../lib/oristudioCpLineStyle';
import { CP_DEFAULT_SNAP_RADIUS } from '../../lib/cpSnapRadiusSetting';
import { resolveWheelGesture, type WheelGesturePreference } from '../../lib/wheelGesture';
import { reportError } from '../../monitoring';
import { cpGeometryStrokesToScene } from '../adapters/cpGeometryToScene';
import { createCpLineAppearanceResolver } from '../adapters/cpLineStyle';
import { cpPointsToScene } from '../adapters/cpPointsToScene';
import { resolveCpPointStyle } from '../adapters/cpPointStyle';
import { CpRendererUnavailable, type CpRendererStatus } from '../CpRendererUnavailable';
import { cpSizingScales } from '../cpSizingScales';
import { applyPinchToCamera } from '../gestures/pinchCamera';
import { contactCentroid, pinchTransform, type GesturePoint } from '../gestures/pinchTransform';
import { LineHitIndex, type IndexedSegment } from '../picking/lineHitIndex';
import {
  fitUserCamera,
  frameUserCameraOnBounds,
  modelViewFromCamera,
  panUserCamera,
  unprojectDevicePoint,
  userCameraToView,
  zoomUserCameraAt,
  type UserBounds,
  type UserCamera,
} from '../renderer/camera';
import type { CpRenderer } from '../renderer/CpRenderer';
import { readCssVarColor } from '../renderer/cssColor';
import { createReglRenderer } from '../renderer/reglRenderer';
import type { Rgba, Viewport } from '../renderer/types';
import { classifyCpWebglFailure, cpWebglSupport, describeCpWebglGap } from '../renderer/webglSupport';
import {
  CP_LINE_HIT_MIN_CSS,
  CP_LINE_HIT_RATIO,
  CP_POINT_HIT_MIN_CSS,
  CP_POINT_HIT_RATIO,
  cpHitRadiusModel,
} from '../snapRadius';
import type { ModelBounds, ReferencesGhostSegment, ReferencesMarker } from './referencesStepGeometry';
import {
  ghostSegmentsToStrokes,
  isClick,
  markersToOverlayPoints,
  modelBoundsToUser,
  resolveReferencesPick,
  transportUserBounds,
  type ReferencesHitIndexes,
  type ReferencesPick,
} from './referencesViewGeometry';

/**
 * The References workspace's crease-pattern view: the document's creases,
 * read-only, with the active step's references drawn over them.
 *
 * A small, props-driven surface on the renderer seam (plan decision D5) rather
 * than a mode of `CreasePatternWebglCanvas`: that canvas has no read-only mode,
 * takes ~80 tool props, and registers the camera, surface-press and
 * transform-preview singletons on mount. This one reuses its exported pieces —
 * `createReglRenderer` behind `CpRenderer`, the owned `UserCamera`, the scene
 * adapters, `LineHitIndex` — and none of its registrations. It does **not**
 * carry the `cp-webgl-layer` class (the editor's floating toolbars forward
 * wheel events to the first such canvas) and publishes into no store.
 *
 * Input: wheel and drag pan/zoom, two-finger pinch through a local pointer map,
 * and a click (under four CSS px of travel) that hit-tests **on release only**
 * — vertices first, then creases — and calls `onPick`. Everything it draws
 * beyond the document arrives as props: which creases to highlight, which
 * vertices, the step's ghost lines and marks. Colours are read from the theme
 * on the canvas element and re-read when `themeKey` changes.
 */

export interface ReferencesCpViewHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  /** Frame the whole crease pattern. */
  fit: () => void;
  /** Point the camera at model-space bounds without zooming out (a jump, not a fit). */
  frameModelBounds: (bounds: ModelBounds) => void;
}

/** What the view draws as picked. Ids as {@link ReferencesPick}: 1-based crease, 0-based vertex. */
export type ReferencesSelection = { kind: 'line'; id: number } | { kind: 'vertex'; idx: number };

export interface ReferencesCpViewProps {
  geometry: CpGeometryTransport;
  lineStyle: OristudioCpLineStyle;
  mode: 'mvf' | 'agrh';
  lineWidth: number;
  pointSize: number;
  wheelGesture: WheelGesturePreference;
  /** The user's snap radius, model units; sets the click radii at the live zoom. */
  snapRadius?: number;
  /** 1-based crease ids drawn in the "new crease" colour (the step's CP creases). */
  highlightLineIds: ReadonlySet<number>;
  /** 0-based vertex indices drawn in the "new crease" colour. */
  highlightVertexIdx: ReadonlySet<number>;
  /** Lines that do not (yet) exist in the pattern, drawn over it. */
  ghostSegments?: readonly ReferencesGhostSegment[];
  /** Marks: input rings and the new mark's disc. */
  markers?: readonly ReferencesMarker[];
  selected: ReferencesSelection | null;
  onPick: (hit: ReferencesPick | null) => void;
  /** The camera refits when this changes (a new document), never on an edit. */
  framingKey: string;
  /** Theme-resolved colours are re-read when this changes. */
  themeKey?: string;
  ariaLabel: string;
  className?: string;
}

const CANVAS_BG_VAR = '--bg-primary';
const FALLBACK_CLEAR: Rgba = [0.157, 0.172, 0.204, 1];
/** Matches the editor's crease width law so the pattern looks the same here. */
const CREASE_WIDTH_FACTOR = 1.5;
const POINT_OUTLINE_CSS = 1.4;
/** Highlighted creases draw this much wider than their neighbours. */
const HIGHLIGHT_WIDTH_MUL = 2.6;
const ZOOM_STEP = 1.25;

const NEW_COLOR_VAR = '--cp-reference-new';
const NEW_FALLBACK: Rgba = [0.639, 0.902, 0.208, 1];
const INPUT_COLOR_VAR = '--cp-reference-input';
const INPUT_FALLBACK: Rgba = [0.949, 0.353, 0.722, 1];
const FOLDED_COLOR_VAR = '--fold-unassigned';
const FOLDED_FALLBACK: Rgba = [0.604, 0.643, 0.678, 1];
/** Ghosted "folded so far" lines sit back from the pattern. */
const FOLDED_ALPHA = 0.55;

const EMPTY_GHOSTS: readonly ReferencesGhostSegment[] = [];
const EMPTY_MARKERS: readonly ReferencesMarker[] = [];

function dpr(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
}

function lineSegmentsOf(geometry: CpGeometryTransport): IndexedSegment[] {
  const endpoints = geometry.segEndpoints;
  const count = endpoints.length / 4;
  const segments: IndexedSegment[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const e = i * 4;
    segments[i] = {
      id: i + 1,
      a: { x: endpoints[e], y: endpoints[e + 1] },
      b: { x: endpoints[e + 2], y: endpoints[e + 3] },
    };
  }
  return segments;
}

function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], color[3] * alpha];
}

/** Everything the imperative handlers read, refreshed every render without re-binding them. */
interface LiveProps {
  lineWidth: number;
  wheelGesture: WheelGesturePreference;
  snapRadius: number;
  onPick: (hit: ReferencesPick | null) => void;
  contentBounds: UserBounds | null;
  vertices: readonly Point[];
  hitIndexes: ReferencesHitIndexes;
}

export const ReferencesCpView = forwardRef<ReferencesCpViewHandle, ReferencesCpViewProps>(
  function ReferencesCpView(props, ref) {
    const {
      geometry,
      lineStyle,
      mode,
      lineWidth,
      pointSize,
      wheelGesture,
      snapRadius = CP_DEFAULT_SNAP_RADIUS,
      highlightLineIds,
      highlightVertexIdx,
      ghostSegments = EMPTY_GHOSTS,
      markers = EMPTY_MARKERS,
      selected,
      onPick,
      framingKey,
      themeKey,
      ariaLabel,
      className,
    } = props;

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<CpRenderer | null>(null);
    const cameraRef = useRef<UserCamera | null>(null);
    const preservedCameraRef = useRef<UserCamera | null>(null);
    const fitRequestedRef = useRef(true);
    const renderNowRef = useRef<() => void>(() => undefined);
    const [rendererStatus, setRendererStatus] = useState<CpRendererStatus | null>(null);
    // Bumped when a lost context comes back, so the lifecycle effect rebuilds
    // the renderer and every upload effect below re-runs against it.
    const [rendererGeneration, setRendererGeneration] = useState(0);

    const vertices = useMemo(() => vertexPointsFromTransport(geometry), [geometry]);
    const contentBounds = useMemo(() => transportUserBounds(geometry), [geometry]);
    const hitIndexes = useMemo<ReferencesHitIndexes>(
      () => ({
        vertices: new LineHitIndex(vertices.map((v, i) => ({ id: i + 1, a: v, b: v }))),
        lines: new LineHitIndex(lineSegmentsOf(geometry)),
      }),
      [geometry, vertices]
    );

    const liveRef = useRef<LiveProps>({
      lineWidth,
      wheelGesture,
      snapRadius,
      onPick,
      contentBounds,
      vertices,
      hitIndexes,
    });
    // Declared before every effect below, so within one commit the handlers
    // and uploads read this render's values.
    useEffect(() => {
      liveRef.current = {
        lineWidth,
        wheelGesture,
        snapRadius,
        onPick,
        contentBounds,
        vertices,
        hitIndexes,
      };
    });

    // --- Renderer lifecycle, camera, input -----------------------------------
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const support = cpWebglSupport();
      if (!support.supported) {
        setRendererStatus({ kind: 'unsupported', detail: describeCpWebglGap(support.gap) });
        return;
      }

      let renderer: CpRenderer;
      try {
        renderer = createReglRenderer(canvas, {
          onContextLost: () => {
            preservedCameraRef.current = cameraRef.current;
            setRendererStatus({ kind: 'context-lost' });
          },
          onContextRestored: () => setRendererGeneration((generation) => generation + 1),
        });
      } catch (error) {
        const gap = classifyCpWebglFailure(canvas);
        reportError(error, {
          surface: 'references:webgl',
          tags: { webgl_gap: gap ?? 'unclassified' },
        });
        setRendererStatus({
          kind: 'unsupported',
          detail: gap
            ? describeCpWebglGap(gap)
            : error instanceof Error
              ? error.message
              : String(error),
        });
        return;
      }
      setRendererStatus(null);
      rendererRef.current = renderer;

      const viewportOf = (ratio: number): Viewport => ({
        width: canvas.width,
        height: canvas.height,
        dpr: ratio,
      });

      const ensureCamera = (viewport: Viewport): UserCamera | null => {
        if (preservedCameraRef.current) {
          cameraRef.current = preservedCameraRef.current;
          preservedCameraRef.current = null;
          fitRequestedRef.current = false;
          return cameraRef.current;
        }
        if (cameraRef.current && !fitRequestedRef.current) return cameraRef.current;
        const bounds = liveRef.current.contentBounds;
        if (!bounds) return cameraRef.current;
        fitRequestedRef.current = false;
        cameraRef.current = fitUserCamera(bounds, viewport);
        return cameraRef.current;
      };

      const renderNow = () => {
        const ratio = dpr();
        const viewport = viewportOf(ratio);
        if (viewport.width === 0 || viewport.height === 0) return;
        const cam = ensureCamera(viewport);
        if (!cam) return;
        const view = modelViewFromCamera(cam, viewport, cpModelToSvg);
        const userView = userCameraToView(cam, viewport);
        const bounds = liveRef.current.contentBounds;
        const fitZoom = bounds ? fitUserCamera(bounds, viewport).zoom : cam.zoom;
        const { widthBoost, markerScalePx, pointScalePx } = cpSizingScales({
          camZoom: cam.zoom,
          fitZoom,
          ratio,
        });
        renderer.render({
          clearColor: readCssVarColor(canvas, CANVAS_BG_VAR, FALLBACK_CLEAR),
          view,
          userView,
          strokeWidthPx: CREASE_WIDTH_FACTOR * liveRef.current.lineWidth * ratio * widthBoost,
          userScalePx: cam.zoom,
          markerScalePx,
          pointScalePx,
          constantOutlinePx: POINT_OUTLINE_CSS * ratio,
          markerOutlinePx: POINT_OUTLINE_CSS * markerScalePx,
          pointOutlinePx: POINT_OUTLINE_CSS * pointScalePx,
          pointOpacity: 1,
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
      // jsdom has no ResizeObserver; the size is then applied once.
      const observer =
        typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(applySize);
      observer?.observe(canvas);
      applySize();

      // --- Pointer input: pan, pinch, click ---------------------------------
      // A local map of the contacts on this canvas, in press order. Two or more
      // is a pinch; the transform is differenced frame to frame, so each
      // `pointermove` (one contact at a time) is a valid sample.
      const pointers = new Map<number, GesturePoint>();
      let press: { pointerId: number; x: number; y: number } | null = null;
      let moved = false;

      const hitTest = (clientX: number, clientY: number): ReferencesPick | null => {
        const cam = cameraRef.current;
        if (!cam) return null;
        const ratio = dpr();
        const rect = canvas.getBoundingClientRect();
        const view = modelViewFromCamera(cam, viewportOf(ratio), cpModelToSvg);
        const model = unprojectDevicePoint(
          view,
          (clientX - rect.left) * ratio,
          (clientY - rect.top) * ratio
        );
        if (!model) return null;
        // `cpHitRadiusModel` wants CSS px per user unit; the camera zoom is in
        // device px, hence the ratio. Vertices get the tighter radius so a
        // crease cannot shadow its own endpoint — see `snapRadius.ts`.
        const zoom = cam.zoom / ratio;
        const live = liveRef.current;
        return resolveReferencesPick(
          live.hitIndexes,
          live.vertices,
          model,
          cpHitRadiusModel(live.snapRadius, zoom, CP_POINT_HIT_RATIO, CP_POINT_HIT_MIN_CSS),
          cpHitRadiusModel(live.snapRadius, zoom, CP_LINE_HIT_RATIO, CP_LINE_HIT_MIN_CSS)
        );
      };

      const onPointerDown = (e: PointerEvent) => {
        // The right button is the panel's context menu; nothing to do here.
        if (e.button !== 0) return;
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 1) {
          press = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
          moved = false;
        } else {
          // A second finger turns the gesture into a camera gesture; no click
          // can come out of it.
          press = null;
        }
      };

      const onPointerMove = (e: PointerEvent) => {
        if (!pointers.has(e.pointerId)) return;
        const cam = cameraRef.current;
        const prev = [...pointers.values()];
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const next = [...pointers.values()];
        if (!cam) return;
        const ratio = dpr();
        if (pointers.size >= 2) {
          const anchor = contactCentroid(prev);
          if (!anchor) return;
          const rect = canvas.getBoundingClientRect();
          applyPinchToCamera(
            cam,
            viewportOf(ratio),
            pinchTransform(prev, next),
            { x: anchor.x - rect.left, y: anchor.y - rect.top },
            ratio
          );
          renderNow();
          return;
        }
        const from = prev[0];
        if (press && !moved && !isClick(press, { x: e.clientX, y: e.clientY })) moved = true;
        // A drag pans from the first pixel; the click test on release is what
        // says whether it was one. The few pixels a click wobbles by are a pan
        // nobody sees.
        panUserCamera(cam, (e.clientX - from.x) * ratio, (e.clientY - from.y) * ratio);
        renderNow();
      };

      const onPointerUp = (e: PointerEvent) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          // Already released, or never captured under this browser's rules.
        }
        const wasPress = press !== null && press.pointerId === e.pointerId;
        if (wasPress && !moved && pointers.size === 0) {
          liveRef.current.onPick(hitTest(e.clientX, e.clientY));
        }
        if (wasPress) press = null;
      };

      const onPointerCancel = (e: PointerEvent) => {
        pointers.delete(e.pointerId);
        if (press?.pointerId === e.pointerId) press = null;
      };

      const onWheel = (e: WheelEvent) => {
        const cam = cameraRef.current;
        if (!cam) return;
        e.preventDefault();
        const ratio = dpr();
        const gesture = resolveWheelGesture(e, liveRef.current.wheelGesture);
        if (gesture.kind === 'pan') {
          // Negated: `panUserCamera` takes a *drag* delta, and a scroll moves
          // the content the other way — so the paper follows the fingers.
          panUserCamera(cam, -gesture.dx * ratio, -gesture.dy * ratio);
        } else {
          if (gesture.factor === 1) return;
          const rect = canvas.getBoundingClientRect();
          zoomUserCameraAt(
            cam,
            viewportOf(ratio),
            (e.clientX - rect.left) * ratio,
            (e.clientY - rect.top) * ratio,
            gesture.factor
          );
        }
        renderNow();
      };

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerCancel);
      canvas.addEventListener('wheel', onWheel, { passive: false });

      return () => {
        observer?.disconnect();
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerCancel);
        canvas.removeEventListener('wheel', onWheel);
        renderNowRef.current = () => undefined;
        rendererRef.current = null;
        renderer.dispose();
      };
    }, [rendererGeneration]);

    // --- Framing -------------------------------------------------------------
    useEffect(() => {
      fitRequestedRef.current = true;
      renderNowRef.current();
    }, [framingKey]);

    // --- Scene uploads -------------------------------------------------------
    // Creases, with the highlighted ones in the "new crease" colour. Theme
    // colours are DOM-resolved, so `themeKey` is a dependency on purpose.
    useEffect(() => {
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!renderer || !canvas) return;
      const highlighted = new Set(highlightLineIds);
      if (selected?.kind === 'line') highlighted.add(selected.id);
      const { strokes } = cpGeometryStrokesToScene(
        geometry,
        createCpLineAppearanceResolver(lineStyle, mode, canvas),
        cpLineStyleDashPatterns(lineStyle),
        {
          selected: highlighted,
          color: readCssVarColor(canvas, NEW_COLOR_VAR, NEW_FALLBACK),
          widthMul: HIGHLIGHT_WIDTH_MUL,
        }
      );
      renderer.setStrokes(strokes);
      renderNowRef.current();
    }, [geometry, lineStyle, mode, highlightLineIds, selected, themeKey, rendererGeneration]);

    // Vertex dots, with the highlighted ones (and the picked one) in the same colour.
    useEffect(() => {
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!renderer || !canvas) return;
      const highlighted = new Set(highlightVertexIdx);
      if (selected?.kind === 'vertex') highlighted.add(selected.idx);
      renderer.setPoints(
        cpPointsToScene([], vertices, [], resolveCpPointStyle(canvas, pointSize), {
          pointIdx: new Set(),
          circleIdx: new Set(),
          vertexIdx: highlighted,
          color: readCssVarColor(canvas, NEW_COLOR_VAR, NEW_FALLBACK),
        })
      );
      renderNowRef.current();
    }, [vertices, pointSize, highlightVertexIdx, selected, themeKey, rendererGeneration]);

    // The step's lines that the pattern does not contain, over the creases.
    useEffect(() => {
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!renderer || !canvas) return;
      renderer.setPreview(
        ghostSegmentsToStrokes(ghostSegments, {
          folded: withAlpha(readCssVarColor(canvas, FOLDED_COLOR_VAR, FOLDED_FALLBACK), FOLDED_ALPHA),
          input: readCssVarColor(canvas, INPUT_COLOR_VAR, INPUT_FALLBACK),
          new: readCssVarColor(canvas, NEW_COLOR_VAR, NEW_FALLBACK),
        })
      );
      renderNowRef.current();
    }, [ghostSegments, themeKey, rendererGeneration]);

    // Input rings and the new mark, on top of everything.
    useEffect(() => {
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!renderer || !canvas) return;
      renderer.setOverlayPoints(
        markersToOverlayPoints(markers, {
          input: readCssVarColor(canvas, INPUT_COLOR_VAR, INPUT_FALLBACK),
          new: readCssVarColor(canvas, NEW_COLOR_VAR, NEW_FALLBACK),
        })
      );
      renderNowRef.current();
    }, [markers, themeKey, rendererGeneration]);

    // Width is a per-frame parameter; a change only needs a redraw.
    useEffect(() => {
      renderNowRef.current();
    }, [lineWidth, themeKey]);

    // --- Imperative handle -----------------------------------------------------
    useImperativeHandle(
      ref,
      () => {
        const viewport = (): Viewport | null => {
          const canvas = canvasRef.current;
          if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
          return { width: canvas.width, height: canvas.height, dpr: dpr() };
        };
        const zoomBy = (factor: number) => {
          const cam = cameraRef.current;
          const vp = viewport();
          if (!cam || !vp) return;
          zoomUserCameraAt(cam, vp, vp.width / 2, vp.height / 2, factor);
          renderNowRef.current();
        };
        return {
          zoomIn: () => zoomBy(ZOOM_STEP),
          zoomOut: () => zoomBy(1 / ZOOM_STEP),
          fit: () => {
            fitRequestedRef.current = true;
            renderNowRef.current();
          },
          frameModelBounds: (bounds) => {
            const cam = cameraRef.current;
            const vp = viewport();
            if (!cam || !vp) return;
            cameraRef.current = frameUserCameraOnBounds(
              modelBoundsToUser(bounds),
              vp,
              cam,
              liveRef.current.contentBounds
            );
            renderNowRef.current();
          },
        };
      },
      []
    );

    return (
      <div className={['references-view', className].filter(Boolean).join(' ')}>
        <canvas
          ref={canvasRef}
          className="references-canvas"
          role="img"
          aria-label={ariaLabel}
          data-testid="references-cp-view"
        />
        {rendererStatus && <CpRendererUnavailable status={rendererStatus} />}
      </div>
    );
  }
);
