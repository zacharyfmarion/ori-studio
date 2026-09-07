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
import { cpCanvasCursor } from '../cpCanvasCursor';
import { cpDpr } from '../cpDpr';
import { cpSizingScales, cpVertexCrowding, cpVertexSpacingModel } from '../cpSizingScales';
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
  applyCreaseVisibility,
  ghostSegmentsToStrokes,
  isClick,
  concatOverlayPoints,
  highlightedVerticesToOverlayPoints,
  markersToOverlayPoints,
  modelBoundsToUser,
  resolveReferencesPick,
  transportUserBounds,
  verticesOfLines,
  type ReferencesCreaseVisibility,
  type ReferencesOverlayColors,
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
  /** 0-based vertex indices drawn in the "new crease" colour. */
  highlightVertexIdx: ReadonlySet<number>;
  /** Lines that do not (yet) exist in the pattern, drawn over it. */
  ghostSegments?: readonly ReferencesGhostSegment[];
  /** Marks: input rings and the new mark's disc. */
  markers?: readonly ReferencesMarker[];
  /**
   * The sheet in scope: the 1-based crease ids of the pattern being read.
   *
   * Everything outside it is not this problem — the workspace answers for one
   * crease pattern at a time — so those creases and the vertices that only they
   * touch are neither drawn nor pickable. Without the picking half, a crease
   * hidden with its sheet still answered a click, and the workspace would
   * quietly start describing a pattern that is not on screen. Null scopes to
   * the whole document.
   */
  sheetLineIds?: ReadonlySet<number> | null;
  /**
   * Which of the document's creases this step shows, and how faintly.
   *
   * The sheet as it stands at the active step: creases a later step makes are
   * not drawn at all, and creases an earlier step made are dimmed behind the
   * ones this step is about. Omit to draw the whole document at full strength.
   */
  creaseVisibility?: ReferencesCreaseVisibility;
  /**
   * Draw the pattern as seen from the back of the paper.
   *
   * A reflection about the sheet's own vertical centre line, folded into the
   * `modelToSvg` the camera is built from — so it costs one negation and the
   * inverse comes back for free, which means picking mirrors with the drawing
   * rather than needing its own case. The folded figure does the same thing
   * with `mirror: -1`.
   */
  mirrored?: boolean;
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

const MOUNTAIN_COLOR_VAR = '--fold-mountain';
const MOUNTAIN_FALLBACK: Rgba = [1, 0.302, 0.365, 1];
const VALLEY_COLOR_VAR = '--fold-valley';
const VALLEY_FALLBACK: Rgba = [0.376, 0.647, 0.98, 1];
const INK_COLOR_VAR = '--fold-border';
const INK_FALLBACK: Rgba = [0.067, 0.078, 0.09, 1];
const INPUT_COLOR_VAR = '--cp-reference-input';
const INPUT_FALLBACK: Rgba = [0.949, 0.353, 0.722, 1];
const FOLDED_COLOR_VAR = '--fold-unassigned';
const FOLDED_FALLBACK: Rgba = [0.604, 0.643, 0.678, 1];
/** Ghosted "folded so far" lines sit back from the pattern. */
const FOLDED_ALPHA = 0.55;
/** The part of a fold that is not creased: present, but barely. */
const UNFOLDED_ALPHA = 0.22;

const EMPTY_IDS: ReadonlySet<number> = new Set();
const EMPTY_GHOSTS: readonly ReferencesGhostSegment[] = [];
const EMPTY_MARKERS: readonly ReferencesMarker[] = [];
/** No step filter: the whole document, at full strength. */
const ALL_CREASES: ReferencesCreaseVisibility = { visible: null, dimmed: null, dimAlpha: 1 };

/** The shared CP policy — see `cpDpr.ts`; the editor renders under the same cap. */
const dpr = cpDpr;

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

/** The mid-x of the sheet in scope, in model space, for the back-view mirror. */
function sheetCentreX(
  geometry: CpGeometryTransport,
  ids: ReadonlySet<number> | null
): number | null {
  const endpoints = geometry.segEndpoints;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i + 3 < endpoints.length; i += 4) {
    if (ids !== null && !ids.has(i / 4 + 1)) continue;
    min = Math.min(min, endpoints[i], endpoints[i + 2]);
    max = Math.max(max, endpoints[i], endpoints[i + 2]);
  }
  return Number.isFinite(min) && Number.isFinite(max) ? (min + max) / 2 : null;
}

function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], color[3] * alpha];
}

/**
 * The overlay's inks, resolved from the canvas's own theme.
 *
 * A crease is drawn in the colour that says which way it folds — the one thing
 * the reader is looking for — so the overlay has no "new crease" hue of its
 * own. Marks and arrows take the ink the paper's edge is drawn in, the way a
 * printed diagram does.
 */
function overlayColors(canvas: HTMLCanvasElement): ReferencesOverlayColors {
  return {
    folded: withAlpha(readCssVarColor(canvas, FOLDED_COLOR_VAR, FOLDED_FALLBACK), FOLDED_ALPHA),
    input: readCssVarColor(canvas, INPUT_COLOR_VAR, INPUT_FALLBACK),
    mark: readCssVarColor(canvas, INK_COLOR_VAR, INK_FALLBACK),
    mountain: readCssVarColor(canvas, MOUNTAIN_COLOR_VAR, MOUNTAIN_FALLBACK),
    valley: readCssVarColor(canvas, VALLEY_COLOR_VAR, VALLEY_FALLBACK),
    unassigned: readCssVarColor(canvas, FOLDED_COLOR_VAR, FOLDED_FALLBACK),
    unfoldedAlpha: UNFOLDED_ALPHA,
  };
}

/** Everything the imperative handlers read, refreshed every render without re-binding them. */
interface LiveProps {
  /** Model → SVG, mirrored about the sheet when the paper is on its back. */
  modelToSvg: (point: Point) => Point;
  lineWidth: number;
  pointSize: number;
  wheelGesture: WheelGesturePreference;
  snapRadius: number;
  onPick: (hit: ReferencesPick | null) => void;
  contentBounds: UserBounds | null;
  vertices: readonly Point[];
  /** Median crease length, for the vertex crowding ramp. */
  vertexSpacingModel: number;
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
      highlightVertexIdx,
      ghostSegments = EMPTY_GHOSTS,
      markers = EMPTY_MARKERS,
      selected,
      sheetLineIds = null,
      creaseVisibility = ALL_CREASES,
      mirrored = false,
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
    // What the pointer is over, and whether it is dragging — the two inputs the
    // cursor needs. Both are mirrored in refs the raw handlers read and write,
    // and only pushed into state when the answer flips, so a pointermove over
    // unchanged ground re-renders nothing (the Edit canvas's `applyCreaseHover`
    // shape, `CreasePatternWebglCanvas.tsx`).
    const [hovered, setHovered] = useState(false);
    const [dragging, setDragging] = useState(false);
    const hoveredRef = useRef(false);

    const vertices = useMemo(() => vertexPointsFromTransport(geometry), [geometry]);
    /**
     * The vertices the sheet in scope actually touches, 0-based into
     * `vertices`.
     *
     * A mask rather than a filtered list, because a vertex's index into the
     * full list is its identity everywhere else — `highlightVertexIdx` and
     * `selected` are both indices into it (`useReferencesView`), so compacting
     * the array here would silently renumber them.
     */
    const sheetVertexIdx = useMemo<Set<number> | null>(
      () => (sheetLineIds ? verticesOfLines(geometry, vertices, sheetLineIds) : null),
      [geometry, vertices, sheetLineIds]
    );
    const sheetVertices = useMemo(
      () => (sheetVertexIdx ? vertices.filter((_, i) => sheetVertexIdx.has(i)) : vertices),
      [vertices, sheetVertexIdx]
    );
    /**
     * The vertices the *step* has made, which is not the same set.
     *
     * A vertex is where creases cross, so one whose creases are all still to be
     * folded does not exist yet on the paper — drawing it gave away where later
     * folds land and made the sheet look finished from step one. Picking is
     * deliberately left on the whole sheet: asking "how do I get this point"
     * before reaching its step is the question the workspace is for.
     */
    const drawnVertices = useMemo(() => {
      const visible = creaseVisibility.visible;
      if (!visible) return sheetVertices;
      const kept = verticesOfLines(geometry, vertices, visible);
      return vertices.filter((_, i) => kept.has(i));
    }, [geometry, vertices, sheetVertices, creaseVisibility]);
    // What the vertex crowding ramp measures against — the same strided median
    // the editor uses, so the two surfaces fade at the same point.
    const vertexSpacingModel = useMemo(() => {
      const endpoints = geometry.segEndpoints;
      return cpVertexSpacingModel(
        (i) => Math.hypot(endpoints[i * 4 + 2] - endpoints[i * 4], endpoints[i * 4 + 3] - endpoints[i * 4 + 1]),
        endpoints.length / 4
      );
    }, [geometry]);
    // The sheet in scope is what the camera fits and what `frameModelBounds`
    // clamps against; another pattern's extent is not this pattern's context.
    const contentBounds = useMemo(
      () => transportUserBounds(geometry, sheetLineIds),
      [geometry, sheetLineIds]
    );
    /**
     * Model → SVG, reflected about the sheet's own vertical centre when the
     * paper is on its back.
     *
     * Folded into the map the camera is built from rather than applied to the
     * scene, so the camera, the hit test and every overlay channel see one
     * consistent space — and `unprojectDevicePoint` inverts the reflected
     * transform, so a click on the mirrored drawing lands on the crease it
     * looks like it is on.
     */
    const modelToSvg = useMemo(() => {
      if (!mirrored) return cpModelToSvg;
      const centre = sheetCentreX(geometry, sheetLineIds);
      if (centre === null) return cpModelToSvg;
      return (point: Point) => cpModelToSvg({ x: 2 * centre - point.x, y: point.y });
    }, [mirrored, geometry, sheetLineIds]);
    const hitIndexes = useMemo<ReferencesHitIndexes>(
      () => ({
        vertices: new LineHitIndex(
          vertices
            .map((v, i) => ({ id: i + 1, a: v, b: v }))
            .filter((entry) => sheetVertexIdx === null || sheetVertexIdx.has(entry.id - 1))
        ),
        lines: new LineHitIndex(
          lineSegmentsOf(geometry).filter(
            (segment) => sheetLineIds === null || sheetLineIds.has(segment.id)
          )
        ),
      }),
      [geometry, vertices, sheetVertexIdx, sheetLineIds]
    );

    const liveRef = useRef<LiveProps>({
      modelToSvg,
      lineWidth,
      pointSize,
      wheelGesture,
      snapRadius,
      onPick,
      contentBounds,
      vertices,
      vertexSpacingModel,
      hitIndexes,
    });
    // Declared before every effect below, so within one commit the handlers
    // and uploads read this render's values.
    useEffect(() => {
      liveRef.current = {
        modelToSvg,
        lineWidth,
        pointSize,
        wheelGesture,
        snapRadius,
        onPick,
        contentBounds,
        vertices,
        vertexSpacingModel,
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
        const view = modelViewFromCamera(cam, viewport, liveRef.current.modelToSvg);
        const userView = userCameraToView(cam, viewport);
        const bounds = liveRef.current.contentBounds;
        const fitZoom = bounds ? fitUserCamera(bounds, viewport).zoom : cam.zoom;
        const { widthBoost, markerScalePx, pointScalePx } = cpSizingScales({
          camZoom: cam.zoom,
          fitZoom,
          ratio,
        });
        // The editor's vertex fade, ported rather than re-decided: on a dense
        // pattern (a 9.4k-segment CP has a ~5 CSS px vertex pitch) a field of
        // full-opacity dots buries the creases the user is trying to pick.
        // The picked and step-highlighted vertices ride the overlay channel
        // instead, which is never faded — see the overlay upload below.
        const { pointOpacity, pointRingScale } = cpVertexCrowding({
          vertexSpacingModel: liveRef.current.vertexSpacingModel,
          pointSize: liveRef.current.pointSize,
          modelPxPerUnit: Math.hypot(view.ex[0], view.ex[1]),
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
          pointOutlinePx: POINT_OUTLINE_CSS * pointScalePx * pointRingScale,
          pointOpacity,
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
        const view = modelViewFromCamera(cam, viewportOf(ratio), liveRef.current.modelToSvg);
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

      // Hover, for the cursor. Coalesced to a frame because `LineHitIndex`
      // falls back to a linear scan at fit zoom (~2 ms at 50k segments), which
      // is fine once per frame and not fine once per pointermove sample.
      let hoverProbe = 0;
      let hoverAt: { x: number; y: number } | null = null;
      const applyHover = (next: boolean) => {
        if (next === hoveredRef.current) return;
        hoveredRef.current = next;
        setHovered(next);
      };
      const probeHover = (clientX: number, clientY: number) => {
        hoverAt = { x: clientX, y: clientY };
        if (hoverProbe !== 0) return;
        hoverProbe = requestAnimationFrame(() => {
          hoverProbe = 0;
          const at = hoverAt;
          if (!at) return;
          applyHover(hitTest(at.x, at.y) !== null);
        });
      };
      const cancelHover = () => {
        hoverAt = null;
        if (hoverProbe !== 0) {
          cancelAnimationFrame(hoverProbe);
          hoverProbe = 0;
        }
        applyHover(false);
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
          setDragging(true);
          cancelHover();
        } else {
          // A second finger turns the gesture into a camera gesture; no click
          // can come out of it.
          press = null;
        }
      };

      const onPointerMove = (e: PointerEvent) => {
        // No contact down: the pointer is only passing over, so all this does is
        // decide the cursor. `pointers` is empty then, which is why the hover
        // probe sits above the guard the gesture handling starts with.
        if (!pointers.has(e.pointerId)) {
          if (pointers.size === 0) probeHover(e.clientX, e.clientY);
          return;
        }
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
        if (pointers.size === 0) {
          setDragging(false);
          // The pointer has not moved, but what is under it may have: a click
          // that picked a crease leaves the cursor where the press left it.
          probeHover(e.clientX, e.clientY);
        }
      };

      const onPointerCancel = (e: PointerEvent) => {
        pointers.delete(e.pointerId);
        if (press?.pointerId === e.pointerId) press = null;
        if (pointers.size === 0) setDragging(false);
      };

      const onPointerLeave = () => cancelHover();

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
      canvas.addEventListener('pointerleave', onPointerLeave);
      canvas.addEventListener('wheel', onWheel, { passive: false });

      return () => {
        observer?.disconnect();
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerCancel);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        canvas.removeEventListener('wheel', onWheel);
        cancelHover();
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

    // Turning the paper over changes the map, not the camera: the pattern
    // reflects in place rather than refitting.
    useEffect(() => {
      renderNowRef.current();
    }, [modelToSvg]);

    // --- Scene uploads -------------------------------------------------------
    // Creases, with the highlighted ones in the "new crease" colour. Theme
    // colours are DOM-resolved, so `themeKey` is a dependency on purpose.
    useEffect(() => {
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!renderer || !canvas) return;
      // Only the *picked* crease is recoloured. The active step's creases are
      // emphasised by width in `applyCreaseVisibility` instead, so they keep the
      // mountain/valley ink the Edit canvas gives them — see
      // `ReferencesCreaseVisibility.emphasis`.
      const picked = selected?.kind === 'line' ? new Set([selected.id]) : EMPTY_IDS;
      const { strokes } = cpGeometryStrokesToScene(
        geometry,
        createCpLineAppearanceResolver(lineStyle, mode, canvas),
        cpLineStyleDashPatterns(lineStyle),
        {
          selected: picked,
          color: readCssVarColor(canvas, INPUT_COLOR_VAR, INPUT_FALLBACK),
          widthMul: HIGHLIGHT_WIDTH_MUL,
        }
      );
      renderer.setStrokes(
        applyCreaseVisibility(strokes, geometry.segEndpoints.length / 4, creaseVisibility)
      );
      renderNowRef.current();
    }, [geometry, lineStyle, mode, selected, creaseVisibility, themeKey, rendererGeneration]);

    // Vertex dots. Deliberately *without* the highlighted ones: this layer rides
    // the crowding ramp (`renderNow`) and fades to nothing on a dense pattern,
    // so the picked vertex is drawn on the overlay channel below instead.
    useEffect(() => {
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!renderer || !canvas) return;
      renderer.setPoints(
        cpPointsToScene([], drawnVertices, [], resolveCpPointStyle(canvas, pointSize), {
          pointIdx: new Set(),
          circleIdx: new Set(),
          vertexIdx: new Set(),
          color: readCssVarColor(canvas, INK_COLOR_VAR, INK_FALLBACK),
        })
      );
      renderNowRef.current();
    }, [drawnVertices, pointSize, themeKey, rendererGeneration]);

    // The step's lines that the pattern does not contain, over the creases.
    useEffect(() => {
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!renderer || !canvas) return;
      renderer.setPreview(
        ghostSegmentsToStrokes(ghostSegments, overlayColors(canvas))
      );
      renderNowRef.current();
    }, [ghostSegments, themeKey, rendererGeneration]);

    // Input rings, the new mark, and the picked/highlighted vertices, on top of
    // everything. This channel draws at full opacity whatever the crowding, which
    // is why the vertex marks live here rather than in the point layer.
    useEffect(() => {
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!renderer || !canvas) return;
      const newColor = readCssVarColor(canvas, INK_COLOR_VAR, INK_FALLBACK);
      const highlighted = new Set(highlightVertexIdx);
      if (selected?.kind === 'vertex') highlighted.add(selected.idx);
      const picked = [...highlighted]
        .map((idx) => vertices[idx])
        .filter((point): point is Point => point !== undefined);
      renderer.setOverlayPoints(
        concatOverlayPoints(
          markersToOverlayPoints(markers, {
            input: readCssVarColor(canvas, INPUT_COLOR_VAR, INPUT_FALLBACK),
            mark: newColor,
          }),
          highlightedVerticesToOverlayPoints(picked, newColor, pointSize)
        )
      );
      renderNowRef.current();
    }, [
      markers,
      highlightVertexIdx,
      selected,
      vertices,
      pointSize,
      themeKey,
      rendererGeneration,
    ]);

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

    // The shared predicate, not a second copy of the rule. Both a vertex and a
    // crease report as `creaseHovered`: here they are the same press — a click
    // that selects what is under the cursor — where in the editor a vertex under
    // Move Vertex is dragged, which is what `vertexGrabbable` is for.
    const cursor = cpCanvasCursor({
      panToolActive: false,
      panModifierHeld: false,
      panDragging: dragging,
      creaseHovered: hovered,
    });

    return (
      <div className={['references-view', className].filter(Boolean).join(' ')}>
        <canvas
          ref={canvasRef}
          className="references-canvas"
          role="img"
          aria-label={ariaLabel}
          data-testid="references-cp-view"
          style={cursor ? { cursor } : undefined}
        />
        {rendererStatus && <CpRendererUnavailable status={rendererStatus} />}
      </div>
    );
  }
);
