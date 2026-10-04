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
import { cpModelToSvg } from '../../lib/creasePatternViewport';
import { cpLineStyleDashPatterns } from '../../lib/oristudioCpLineStyle';
import { CP_DEFAULT_SNAP_RADIUS } from '../../lib/cpSnapRadiusSetting';
import { resolveWheelGesture, type WheelGesturePreference } from '../../lib/wheelGesture';
import { reportError } from '../../monitoring';
import { cpGeometryStrokesToScene } from '../adapters/cpGeometryToScene';
import { createCpLineAppearanceResolver } from '../adapters/cpLineStyle';
import { CpRendererUnavailable, type CpRendererStatus } from '../CpRendererUnavailable';
import { cpCanvasCursor } from '../cpCanvasCursor';
import { cpDpr } from '../cpDpr';
import { cpSizingScales } from '../cpSizingScales';
import { applyPinchToCamera } from '../gestures/pinchCamera';
import { contactCentroid, pinchTransform, type GesturePoint } from '../../lib/gestures/pinchTransform';
import { LineHitIndex, type IndexedSegment } from '../picking/lineHitIndex';
import {
  cameraZoomForPercent,
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
import { readCssVarColor, readCssVarNumber } from '../renderer/cssColor';
import {
  canvasDiagramInk,
  CP_CREASE_WIDTH_FACTOR,
  DIAGRAM_LINE_INK,
  type DiagramPens,
} from './diagram/diagramInk';
import { diagramGroundInk } from './diagram/diagramColors';
import type { FoldPose } from './fold/foldPlayback';
import {
  DEFAULT_SURFACE_SHARES,
  EMPTY_FOLDED,
  foldPoseGeometry,
  type FoldPaint,
} from './fold/foldPoseGeometry';
import type { FoldScene } from './fold/foldScene';
import {
  INK_COLOR_VAR,
  INK_FALLBACK,
  INPUT_COLOR_VAR,
  INPUT_FALLBACK,
  referencesFoldPaint,
  referencesOverlayColors,
  referencesPaperFaces,
  withAlpha,
  type ReadTokenColor,
} from './referencesCanvasInks';
import { splitStrokesAtFolds, type SplitStrokes } from './fold/foldSplit';
import { createReglRenderer } from '../renderer/reglRenderer';
import type { Rgba, StrokeGeometry, Viewport } from '../renderer/types';
import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import {
  awaitContextRestore,
  classifyCpWebglFailure,
  cpWebglSupport,
  describeCpWebglGap,
} from '../renderer/webglSupport';
import {
  CP_LINE_HIT_MIN_CSS,
  CP_LINE_HIT_RATIO,
  CP_POINT_HIT_MIN_CSS,
  CP_POINT_HIT_RATIO,
  cpHitRadiusModel,
  CP_LINE_HIT_MIN_CSS_COARSE,
  CP_POINT_HIT_MIN_CSS_COARSE,
} from '../snapRadius';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';
import type { ModelBounds } from './referencesStepGeometry';
import {
  applyCreaseVisibility,
  concatOverlayPoints,
  concatStrokes,
  hoveredCreaseToPreviewStroke,
  hoveredVertexToOverlayPoint,
  isClick,
  highlightedVerticesToOverlayPoints,
  referencesCreasePens,
  modelBoundsToUser,
  resolveReferencesPick,
  transportUserBounds,
  sheetFillGeometry,
  sheetOutline,
  verticesOfLines,
  type ReferencesCreaseVisibility,
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
 * — vertices first, then creases — and calls `onPick`. The same hit test runs
 * under a passing pointer, once a frame, and what it finds is drawn in the
 * pick accent — a translucent stroke over the crease, a ring round the vertex
 * — so that a pattern of identical lines says which of them a click would
 * take. Everything else it draws beyond the document arrives as props: which
 * creases to highlight, which vertices, the step's ghost lines and marks.
 * Colours are read from the theme on the canvas element and re-read when
 * `inkKey` changes.
 */

export interface ReferencesCpViewHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  /** Zoom to a percentage, about the centre — the viewport toolbar's presets. */
  setZoomPercent: (percent: number) => void;
  /** Frame the whole crease pattern. */
  fit: () => void;
  /** Point the camera at model-space bounds without zooming out (a jump, not a fit). */
  frameModelBounds: (bounds: ModelBounds) => void;
  /**
   * Put the `fold` prop's flap at a pose, or lay the paper flat again with
   * null. Imperative because it arrives once a frame from the transport's
   * animation loop, and a prop would re-render the panel on every one.
   */
  setFoldPose: (pose: FoldPose | null) => void;
}

/**
 * The canvas's camera, as the layer drawn over it needs to see it.
 *
 * Model space → CSS pixels of the canvas box. The pen the layer draws with is
 * not here: it comes from the reader's crease width, so the diagram and the
 * creases under it are the same weight whatever the camera is doing.
 */
export interface ReferencesDiagramView {
  view: CpOverlayView;
}

/** What the view draws as picked. Ids as {@link ReferencesPick}: 1-based crease, 0-based vertex. */
export type ReferencesSelection = { kind: 'line'; id: number } | { kind: 'vertex'; idx: number };

export interface ReferencesCpViewProps {
  geometry: CpGeometryTransport;
  mode: 'mvf' | 'agrh';
  /**
   * The References line width: the paper style's edge pen, which every pen
   * here is measured from (`referencesCanvasPens`).
   */
  lineWidth: number;
  /**
   * The pens the creases are drawn in, by what each is on the paper, in the
   * ink `lineWidth` makes (`referencesCanvasPens`). The diagram table without.
   */
  pens?: DiagramPens;
  pointSize: number;
  wheelGesture: WheelGesturePreference;
  /** The user's snap radius, model units; sets the click radii at the live zoom. */
  snapRadius?: number;
  /** 0-based vertex indices drawn in the "new crease" colour. */
  highlightVertexIdx: ReadonlySet<number>;
  /**
   * The step's own lines, already packed for the preview channel.
   *
   * Built from the same primitives the filmstrip card draws
   * (`diagram/diagramToScene.ts`), so the two pictures cannot disagree about
   * what a step contains. The symbols that go with them — arcs, arrowheads,
   * the turn-over glyph, letters, the rings round the marks — are drawn by
   * `ReferencesDiagramLayer` over this canvas, because this renderer has no
   * vocabulary for any of them.
   */
  diagramStrokes?: StrokeGeometry | null;
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
   * ones this step is about — and, through `pickable`, what can be hovered or
   * picked: a crease the folder has not made yet is not something they can
   * point at. Omit to draw the whole document at full strength.
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
  /**
   * The active step's fold, for {@link ReferencesCpViewHandle.setFoldPose}
   * to move. Null when the card has nothing to fold. At rest it changes
   * nothing; with a pose set, every line on the paper is split at the fold
   * and the flap's half rides the folded channel (`fold/foldSplit.ts`).
   */
  fold?: FoldScene | null;
  selected: ReferencesSelection | null;
  onPick: (hit: ReferencesPick | null) => void;
  /**
   * The live camera, reported every frame it changes.
   *
   * Deliberately not a store: this canvas publishes into none of the editor's
   * singletons (see the note at the top of this file), and the layer that reads
   * it is its own sibling. De-duped here, so a redraw that does not move the
   * camera does not wake it.
   */
  onViewChange?: (view: ReferencesDiagramView) => void;
  /**
   * The zoom as a percentage, for the viewport toolbar's readout. 100% is
   * actual size — one user unit to one CSS pixel — the editor's definition, so
   * the two readouts agree about the same pattern. De-duped like the view.
   */
  onZoomPercentChange?: (percent: number) => void;
  /** The camera refits when this changes (a new document), never on an edit. */
  framingKey: string;
  /** DOM-resolved colours — the theme's and the paper style's — are re-read when this changes. */
  inkKey?: string;
  ariaLabel: string;
  className?: string;
}

const CANVAS_BG_VAR = '--bg-primary';
const FALLBACK_CLEAR: Rgba = [0.157, 0.172, 0.204, 1];
const POINT_OUTLINE_CSS = 1.4;
/** Highlighted creases draw this much wider than their neighbours. */
const HIGHLIGHT_WIDTH_MUL = 2.6;
/**
 * How far a folding flap overlaps its base at the hinge, in CSS pixels: a
 * hair more than the anti-aliasing seam between two draws that share an
 * edge, and less than a crease is wide.
 */
const HINGE_OVERLAP_CSS = 0.75;
const ZOOM_STEP = 1.25;

/** How far back a crease an earlier step made sits, which the aux lines share (`diagramColors.ts`). */
const CREASE_ALPHA_VAR = '--references-crease-alpha';
const CREASE_ALPHA_FALLBACK = 0.75;

const EMPTY_IDS: ReadonlySet<number> = new Set();
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

/** The workspace's tokens as the canvas resolves them. */
function tokenColorsOf(canvas: HTMLCanvasElement): ReadTokenColor {
  return (name, fallback) => readCssVarColor(canvas, name, fallback);
}

/** The same thing under the pointer as a frame ago, by identity rather than position. */
function samePick(a: ReferencesPick | null, b: ReferencesPick | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'line') return b.kind === 'line' && a.id === b.id;
  return b.kind === 'vertex' && a.idx === b.idx;
}

/** What the upload effects last computed, before any fold was applied. */
interface FoldUploads {
  strokes: StrokeGeometry | null;
  preview: StrokeGeometry | null;
  /** The paper, in the colour of the face the reader is on; null when there is no geometry yet. */
  sheet: { geometry: CpGeometryTransport; border: ReadonlySet<number> | null; color: Rgba } | null;
}

/**
 * The uploads split at a fold, each kept while its own upload and the fold
 * stand: a hover changes the preview every frame the pointer moves, and must
 * not cost a re-split of the crease pattern under it.
 */
interface FoldRig {
  scene: FoldScene;
  /** Which of the scene's flaps the split is for: a pose moves one at a time. */
  flap: number;
  strokes: { source: StrokeGeometry; split: SplitStrokes } | null;
  preview: { source: StrokeGeometry; split: SplitStrokes } | null;
  paint: Omit<FoldPaint, 'modelToUser'>;
}

/** Everything the imperative handlers read, refreshed every render without re-binding them. */
interface LiveProps {
  /** Model → SVG, mirrored about the sheet when the paper is on its back. */
  modelToSvg: (point: Point) => Point;
  /** The paper is on its back, so the sheet is filled with its other face. */
  mirrored: boolean;
  lineWidth: number;
  wheelGesture: WheelGesturePreference;
  snapRadius: number;
  /** The hit floors, in CSS px: fingertip-sized under a coarse pointer. */
  pointFloorCss: number;
  lineFloorCss: number;
  onPick: (hit: ReferencesPick | null) => void;
  onViewChange?: (view: ReferencesDiagramView) => void;
  onZoomPercentChange?: (percent: number) => void;
  contentBounds: UserBounds | null;
  vertices: readonly Point[];
  hitIndexes: ReferencesHitIndexes;
  fold: FoldScene | null;
}

export const ReferencesCpView = forwardRef<ReferencesCpViewHandle, ReferencesCpViewProps>(
  function ReferencesCpView(props, ref) {
    const {
      geometry,
      mode,
      lineWidth,
      pens = DIAGRAM_LINE_INK,
      pointSize,
      wheelGesture,
      snapRadius = CP_DEFAULT_SNAP_RADIUS,
      highlightVertexIdx,
      diagramStrokes = null,
      onViewChange,
      onZoomPercentChange,
      selected,
      sheetLineIds = null,
      creaseVisibility = ALL_CREASES,
      mirrored = false,
      fold = null,
      onPick,
      framingKey,
      inkKey,
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
    // What the pointer is over, and whether it is dragging — what the cursor
    // and the hover mark need. Both are mirrored in refs the raw handlers read
    // and write, and only pushed into state when the answer changes, so a
    // pointermove along the same crease re-renders nothing (the Edit canvas's
    // `applyCreaseHover` shape, `CreasePatternWebglCanvas.tsx`).
    const [hovered, setHovered] = useState<ReferencesPick | null>(null);
    // A fingertip is not a cursor: the hit floors grow under a coarse pointer,
    // and the mark under the finger shows on touch-down rather than on hover.
    const coarse = useIsCoarsePointerSurface();
    const pointFloorCss = coarse ? CP_POINT_HIT_MIN_CSS_COARSE : CP_POINT_HIT_MIN_CSS;
    const lineFloorCss = coarse ? CP_LINE_HIT_MIN_CSS_COARSE : CP_LINE_HIT_MIN_CSS;
    const [dragging, setDragging] = useState(false);
    const hoveredRef = useRef<ReferencesPick | null>(null);

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
    // The sheet in scope is what the camera fits and what `frameModelBounds`
    // clamps against; another pattern's extent is not this pattern's context.
    const contentBounds = useMemo(
      () => transportUserBounds(geometry, sheetLineIds),
      [geometry, sheetLineIds]
    );
    // The paper as the sheet fill draws it, for the marks that take a
    // different ink off it.
    const borderLineIds = creaseVisibility.borderLineIds ?? null;
    const paperOutline = useMemo(
      () => sheetOutline(geometry, borderLineIds),
      [geometry, borderLineIds]
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
    /**
     * What a click or a passing pointer can land on.
     *
     * While something is being read, what is drawn (`creaseVisibility.pickable`)
     * — the creases made so far, or the one reference being read, the border
     * among them — and the vertices those creases make: where they cross,
     * where they meet the border, and the sheet's corners, which are there
     * from the start. A point where one line merely changes colour is not a
     * landmark and is left out. A crease that is not drawn is not there to
     * point at, so hovering it marks nothing and a click there is a click on
     * blank paper. Otherwise the whole sheet in scope.
     *
     * No vertex is drawn until it is hovered, picked or named by a step: the
     * creases say where they meet, and a dot at every crossing crowded them.
     */
    const pickableLineIds = creaseVisibility.pickable ?? sheetLineIds;
    const pickableVertexIdx = useMemo<Set<number> | null>(
      () =>
        creaseVisibility.pickable
          ? verticesOfLines(geometry, vertices, creaseVisibility.pickable, { dropCollinear: true })
          : sheetVertexIdx,
      [geometry, vertices, creaseVisibility.pickable, sheetVertexIdx]
    );
    const hitIndexes = useMemo<ReferencesHitIndexes>(
      () => ({
        vertices: new LineHitIndex(
          vertices
            .map((v, i) => ({ id: i + 1, a: v, b: v }))
            .filter((entry) => pickableVertexIdx === null || pickableVertexIdx.has(entry.id - 1))
        ),
        lines: new LineHitIndex(
          lineSegmentsOf(geometry).filter(
            (segment) => pickableLineIds === null || pickableLineIds.has(segment.id)
          )
        ),
      }),
      [geometry, vertices, pickableVertexIdx, pickableLineIds]
    );

    const liveRef = useRef<LiveProps>({
      modelToSvg,
      mirrored,
      lineWidth,
      wheelGesture,
      snapRadius,
      pointFloorCss,
      lineFloorCss,
      onPick,
      onViewChange,
      onZoomPercentChange,
      contentBounds,
      vertices,
      hitIndexes,
      fold,
    });
    // The fold's pose, and what the channels held before it was applied, so
    // the paper can be laid flat again from exactly what was uploaded.
    const poseRef = useRef<FoldPose | null>(null);
    const fullRef = useRef<FoldUploads>({ strokes: null, preview: null, sheet: null });
    const rigRef = useRef<FoldRig | null>(null);
    const applyFoldRef = useRef<() => void>(() => undefined);
    const lastViewRef = useRef<ReferencesDiagramView | null>(null);
    const lastZoomPercentRef = useRef<number | null>(null);
    // Declared before every effect below, so within one commit the handlers
    // and uploads read this render's values.
    useEffect(() => {
      liveRef.current = {
        modelToSvg,
        mirrored,
        lineWidth,
        wheelGesture,
        snapRadius,
        pointFloorCss,
        lineFloorCss,
        onPick,
        onViewChange,
        onZoomPercentChange,
        contentBounds,
        vertices,
        hitIndexes,
        fold,
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
        // Already lost is a loss arriving early, not a gap — same handling as
        // `onContextLost`, and like it not reported. See the editor canvas.
        if (gap === 'context-lost-at-start') {
          preservedCameraRef.current = cameraRef.current;
          setRendererStatus({ kind: 'context-lost' });
          return awaitContextRestore(canvas, () =>
            setRendererGeneration((generation) => generation + 1)
          );
        }
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

      const reportView = (view: CpOverlayView) => {
        const seen = lastViewRef.current;
        const same =
          seen !== null &&
          seen.view.origin[0] === view.origin[0] &&
          seen.view.origin[1] === view.origin[1] &&
          seen.view.ex[0] === view.ex[0] &&
          seen.view.ex[1] === view.ex[1] &&
          seen.view.ey[0] === view.ey[0] &&
          seen.view.ey[1] === view.ey[1];
        if (same) return;
        const next = { view };
        lastViewRef.current = next;
        liveRef.current.onViewChange?.(next);
      };

      const reportZoom = (cam: UserCamera, ratio: number) => {
        const percent = Math.round((cam.zoom / ratio) * 100);
        if (percent === lastZoomPercentRef.current) return;
        lastZoomPercentRef.current = percent;
        liveRef.current.onZoomPercentChange?.(percent);
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
        // The layer over this canvas draws through the same camera, in CSS
        // pixels rather than device ones.
        reportView({
          origin: [view.origin[0] / ratio, view.origin[1] / ratio],
          ex: [view.ex[0] / ratio, view.ex[1] / ratio],
          ey: [view.ey[0] / ratio, view.ey[1] / ratio],
        });
        reportZoom(cam, ratio);
        renderer.render({
          clearColor: readCssVarColor(canvas, CANVAS_BG_VAR, FALLBACK_CLEAR),
          view,
          userView,
          // The edge pen is the unit width; each crease's own pen is its multiple.
          strokeWidthPx: CP_CREASE_WIDTH_FACTOR * liveRef.current.lineWidth * ratio * widthBoost,
          // A crease on the flap is the same crease: the same pen.
          foldedStrokeWidthPx:
            CP_CREASE_WIDTH_FACTOR * liveRef.current.lineWidth * ratio * widthBoost,
          userScalePx: cam.zoom,
          markerScalePx,
          pointScalePx,
          constantOutlinePx: POINT_OUTLINE_CSS * ratio,
          markerOutlinePx: POINT_OUTLINE_CSS * markerScalePx,
          // No point layer is uploaded: the vertices this view marks ride
          // the overlay channel (see the overlay upload below).
          pointOutlinePx: POINT_OUTLINE_CSS * pointScalePx,
          pointOpacity: 1,
        });
      };
      renderNowRef.current = renderNow;

      /**
       * Bring the channels in line with the pose: at rest, exactly what the
       * upload effects computed; posed, the paper split at the fold and the
       * flap drawn through the folded channel. The split is kept while the
       * uploads and the fold it was made for stay the same, so a frame of
       * the animation costs one pack of the flap and nothing of the base.
       */
      const applyFold = () => {
        const full = fullRef.current;
        const pose = poseRef.current;
        const scene = liveRef.current.fold;
        const sheetFill = (flaps: FoldScene['flaps']) =>
          full.sheet
            ? sheetFillGeometry(full.sheet.geometry, full.sheet.border, full.sheet.color, flaps)
            : null;
        const moving = pose && scene ? scene.flaps[pose.flap] : undefined;
        if (!pose || !scene || !moving) {
          rigRef.current = null;
          if (full.strokes) renderer.setStrokes(full.strokes);
          renderer.setPreview(full.preview);
          renderer.setSheetFill(sheetFill([]));
          renderer.setFolded(EMPTY_FOLDED);
          return;
        }
        const flaps = [moving];
        let rig = rigRef.current;
        if (!rig || rig.scene !== scene || rig.flap !== pose.flap) {
          rig = {
            scene,
            flap: pose.flap,
            strokes: null,
            preview: null,
            paint: referencesFoldPaint(tokenColorsOf(canvas), liveRef.current.mirrored),
          };
          rigRef.current = rig;
          // The paper the flap has left is the ground now, not sheet.
          renderer.setSheetFill(sheetFill(flaps));
        }
        if (full.strokes && rig.strokes?.source !== full.strokes) {
          rig.strokes = { source: full.strokes, split: splitStrokesAtFolds(full.strokes, flaps) };
          renderer.setStrokes(rig.strokes.split.base);
        }
        if (full.preview && rig.preview?.source !== full.preview) {
          rig.preview = { source: full.preview, split: splitStrokesAtFolds(full.preview, flaps) };
          renderer.setPreview(rig.preview.split.base);
        } else if (!full.preview && rig.preview) {
          rig.preview = null;
          renderer.setPreview(null);
        }
        // The overlap is a screen-space hairline, so it is measured against
        // the camera each time the flap is posed: model units per CSS pixel.
        const cam = cameraRef.current;
        const modelToUser = liveRef.current.modelToSvg;
        const o = modelToUser({ x: 0, y: 0 });
        const e = modelToUser({ x: 1, y: 0 });
        const userPerModel = Math.hypot(e.x - o.x, e.y - o.y) || 1;
        const cssPerModel = cam ? (cam.zoom / dpr()) * userPerModel : 1;
        renderer.setFolded(
          foldPoseGeometry(
            scene,
            pose,
            [rig.strokes?.split.flap, rig.preview?.split.flap],
            { ...rig.paint, modelToUser },
            { ...DEFAULT_SURFACE_SHARES, hingeOverlap: HINGE_OVERLAP_CSS / cssPerModel }
          )
        );
      };
      applyFoldRef.current = applyFold;

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
          cpHitRadiusModel(live.snapRadius, zoom, CP_POINT_HIT_RATIO, live.pointFloorCss),
          cpHitRadiusModel(live.snapRadius, zoom, CP_LINE_HIT_RATIO, live.lineFloorCss)
        );
      };

      // Hover, for the cursor and the hover mark. Coalesced to a frame because
      // `LineHitIndex` falls back to a linear scan at fit zoom (~2 ms at 50k
      // segments), which is fine once per frame and not fine once per
      // pointermove sample.
      let hoverProbe = 0;
      let hoverAt: { x: number; y: number } | null = null;
      const applyHover = (next: ReferencesPick | null) => {
        if (samePick(next, hoveredRef.current)) return;
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
          applyHover(hitTest(at.x, at.y));
        });
      };
      const cancelHover = () => {
        hoverAt = null;
        if (hoverProbe !== 0) {
          cancelAnimationFrame(hoverProbe);
          hoverProbe = 0;
        }
        applyHover(null);
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
          // No hover on touch, so the mark shows under the finger from the
          // press, and follows it while the press is still a tap: what a
          // release will pick is visible before it is picked.
          if (e.pointerType === 'touch') applyHover(hitTest(e.clientX, e.clientY));
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
        if (press && !moved && !isClick(press, { x: e.clientX, y: e.clientY })) {
          moved = true;
          // A pan, not a tap: nothing will be picked, so nothing is marked.
          if (e.pointerType === 'touch') applyHover(null);
        } else if (press && !moved && e.pointerType === 'touch') {
          applyHover(hitTest(e.clientX, e.clientY));
        }
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
          // that picked a crease leaves the cursor where the press left it. A
          // finger has left; nothing is under it.
          if (e.pointerType === 'touch') applyHover(null);
          else probeHover(e.clientX, e.clientY);
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
        applyFoldRef.current = () => undefined;
        rigRef.current = null;
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
    // colours are DOM-resolved, so `inkKey` is a dependency on purpose.
    useEffect(() => {
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!renderer || !canvas) return;
      // Only the *picked* crease takes the selection accent here. The active
      // step's creases are recoloured in `applyCreaseVisibility` instead, to the
      // one direction the step folds — see
      // `ReferencesCreaseVisibility.emphasisColor`.
      const picked = selected?.kind === 'line' ? new Set([selected.id]) : EMPTY_IDS;
      // Colour by the crease's own colour; the paper style's pens replace the
      // editor's line style below, so its View ▸ Line style has no say here.
      const { strokes: packed } = cpGeometryStrokesToScene(
        geometry,
        createCpLineAppearanceResolver('color', mode, canvas),
        cpLineStyleDashPatterns('color'),
        {
          selected: picked,
          color: readCssVarColor(canvas, INPUT_COLOR_VAR, INPUT_FALLBACK),
          widthMul: HIGHLIGHT_WIDTH_MUL,
        }
      );
      // The directions the crate settled, in this canvas's ink. Resolved here
      // because this is the one place that owns the palette; the rule that says
      // *which* direction lives in `referencesCreaseVisibility`. A crease of
      // the pattern is a crease pattern's line, so its direction is in the fold
      // inks, never the diagram-crease inks a step's instruction is drawn in.
      const palette = referencesOverlayColors(tokenColorsOf(canvas));
      // Thin lines — the creases an earlier step made, and the pattern's aux
      // lines — in the aux pen's ink, held back as far as the card holds them.
      const aux = withAlpha(
        palette.unassigned,
        readCssVarNumber(canvas, CREASE_ALPHA_VAR, CREASE_ALPHA_FALLBACK)
      );
      const segmentCount = geometry.segEndpoints.length / 4;
      const inkCss = canvasDiagramInk(lineWidth);
      // Every crease in its pen: the paper style's, by what it is on the paper.
      const strokes = referencesCreasePens(packed, geometry.segAttr, segmentCount, {
        pens,
        inkCss,
        ink: {
          edge: readCssVarColor(canvas, INK_COLOR_VAR, INK_FALLBACK),
          'fold-mountain': palette.mountain,
          'fold-valley': palette.valley,
          aux,
        },
        picked,
      });
      fullRef.current.strokes = applyCreaseVisibility(
        strokes,
        segmentCount,
        {
          ...creaseVisibility,
          ink: { mountain: palette.mountain, valley: palette.valley, aux },
        },
        inkCss,
        pens
      );
      applyFoldRef.current();
      // The sheet, in the paper style's colour for the face the reader is on:
      // the style's paper is not the theme's ground, so it is drawn on both.
      fullRef.current.sheet = {
        geometry,
        border: creaseVisibility.borderLineIds ?? null,
        color: referencesPaperFaces(tokenColorsOf(canvas), mirrored).up,
      };
      applyFoldRef.current();
      renderNowRef.current();
    }, [
      lineWidth,
      pens,
      geometry,
      mode,
      selected,
      creaseVisibility,
      mirrored,
      inkKey,
      rendererGeneration,
    ]);

    // The step's lines that the pattern does not contain, over the creases —
    // and the crease under the pointer, in the accent it would be picked in.
    // On this channel rather than in the crease upload, which is the whole
    // document: a hover must not cost a 50k-segment re-pack. The picked crease
    // is already drawn in the accent, so hovering it adds nothing.
    useEffect(() => {
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!renderer || !canvas) return;
      const hoverStroke =
        hovered?.kind === 'line' && !(selected?.kind === 'line' && selected.id === hovered.id)
          ? hoveredCreaseToPreviewStroke(
              geometry,
              hovered.id,
              readCssVarColor(canvas, INPUT_COLOR_VAR, INPUT_FALLBACK),
              HIGHLIGHT_WIDTH_MUL
            )
          : null;
      fullRef.current.preview = concatStrokes(diagramStrokes, hoverStroke);
      applyFoldRef.current();
      renderNowRef.current();
    }, [diagramStrokes, hovered, selected, geometry, inkKey, rendererGeneration]);

    // A different fold under the same uploads: the split is for the old one.
    useEffect(() => {
      applyFoldRef.current();
      renderNowRef.current();
    }, [fold]);

    // Input rings, the new mark, the picked/highlighted vertices and the ring
    // round the vertex under the pointer, on top of everything. This channel
    // draws at full opacity whatever the crowding, which is why the vertex
    // marks live here rather than in the point layer.
    useEffect(() => {
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!renderer || !canvas) return;
      // The style's ink on the paper, the theme's off it: a dot on the sheet's
      // edge is half on the ground (`highlightedVerticesToOverlayPoints`).
      const dotInks = {
        paper: readCssVarColor(canvas, INK_COLOR_VAR, INK_FALLBACK),
        ground: diagramGroundInk(canvas),
      };
      const highlighted = new Set(highlightVertexIdx);
      if (selected?.kind === 'vertex') highlighted.add(selected.idx);
      const picked = [...highlighted]
        .map((idx) => vertices[idx])
        .filter((point): point is Point => point !== undefined);
      const hoverRing =
        hovered?.kind === 'vertex' && !(selected?.kind === 'vertex' && selected.idx === hovered.idx)
          ? hoveredVertexToOverlayPoint(
              hovered.point,
              readCssVarColor(canvas, INPUT_COLOR_VAR, INPUT_FALLBACK),
              pointSize
            )
          : null;
      renderer.setOverlayPoints(
        concatOverlayPoints(
          highlightedVerticesToOverlayPoints(picked, dotInks, pointSize, paperOutline),
          hoverRing
        )
      );
      renderNowRef.current();
    }, [
      highlightVertexIdx,
      selected,
      hovered,
      vertices,
      pointSize,
      paperOutline,
      inkKey,
      rendererGeneration,
    ]);

    // Width is a per-frame parameter; a change only needs a redraw.
    useEffect(() => {
      renderNowRef.current();
    }, [lineWidth, inkKey]);

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
          setZoomPercent: (percent) => {
            const cam = cameraRef.current;
            const vp = viewport();
            if (!cam || !vp) return;
            // The inverse of `reportZoom`: 100% is one user unit per CSS pixel.
            cam.zoom = cameraZoomForPercent(percent, vp.dpr);
            renderNowRef.current();
          },
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
          setFoldPose: (pose) => {
            poseRef.current = pose;
            applyFoldRef.current();
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
      creaseHovered: hovered !== null,
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
